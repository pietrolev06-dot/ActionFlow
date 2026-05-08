const express = require("express");
const Stripe = require("stripe");
const {
  findUserById,
  findUserByStripeCustomerId,
  updateUserStripeBilling,
} = require("../models/userStore");

const TRIAL_DAYS = 7;
const PRO_PLAN_STATUSES = new Set(["trialing", "active"]);
const FREE_PLAN_STATUSES = new Set(["canceled", "unpaid", "incomplete_expired"]);

function getStripeConfig() {
  const rawAppBaseUrl = (process.env.APP_BASE_URL || "").trim();

  return {
    secretKey: (process.env.STRIPE_SECRET_KEY || "").trim(),
    webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || "").trim(),
    priceMonthly: (process.env.STRIPE_PRICE_MONTHLY || "").trim(),
    priceYearly: (process.env.STRIPE_PRICE_YEARLY || "").trim(),
    appBaseUrl: rawAppBaseUrl.replace(/\/+$/, ""),
  };
}

function isStripeConfigured() {
  const config = getStripeConfig();
  return Boolean(
    config.secretKey &&
    config.webhookSecret &&
    config.priceMonthly &&
    config.priceYearly &&
    config.appBaseUrl
  );
}

function getStripeClient() {
  const { secretKey } = getStripeConfig();

  if (!secretKey) {
    throw new Error("Stripe non configurato.");
  }

  return new Stripe(secretKey);
}

function requireAuthenticatedUser(req, res) {
  if (!req.currentUser || !req.currentUser.id) {
    res.status(401).json({ error: "Utente non autenticato." });
    return null;
  }

  const user = findUserById(req.currentUser.id);
  if (!user) {
    res.status(404).json({ error: "Utente non trovato." });
    return null;
  }

  return user;
}

function getPriceIdForInterval(interval) {
  const { priceMonthly, priceYearly } = getStripeConfig();
  return interval === "yearly" ? priceYearly : priceMonthly;
}

function getBillingIntervalFromPriceId(priceId) {
  const { priceMonthly, priceYearly } = getStripeConfig();

  if (priceId && priceId === priceYearly) {
    return "yearly";
  }

  if (priceId && priceId === priceMonthly) {
    return "monthly";
  }

  return null;
}

async function ensureStripeCustomer(stripe, user) {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    name: user.displayName || user.name || undefined,
    metadata: {
      appUserId: user.id,
    },
  });

  updateUserStripeBilling(user.id, {
    stripeCustomerId: customer.id,
  });

  return customer.id;
}

function normalizePlanFromSubscriptionStatus(status) {
  if (PRO_PLAN_STATUSES.has(status)) {
    return "pro";
  }

  if (FREE_PLAN_STATUSES.has(status) || status === "deleted") {
    return "free";
  }

  return null;
}

function getSubscriptionPriceId(subscription) {
  return subscription &&
    subscription.items &&
    subscription.items.data &&
    subscription.items.data[0] &&
    subscription.items.data[0].price
    ? subscription.items.data[0].price.id || null
    : null;
}

async function applySubscriptionStateToUser(stripe, user, subscriptionOrId, fallbackCustomerId) {
  if (!user) {
    return null;
  }

  const subscription = typeof subscriptionOrId === "string"
    ? await stripe.subscriptions.retrieve(subscriptionOrId)
    : subscriptionOrId;
  const priceId = getSubscriptionPriceId(subscription);
  const plan = normalizePlanFromSubscriptionStatus(subscription.status);

  return updateUserStripeBilling(user.id, {
    stripeCustomerId: subscription.customer || fallbackCustomerId || user.stripeCustomerId || null,
    stripeSubscriptionId: subscription.id || null,
    stripeSubscriptionStatus: subscription.status || null,
    stripePriceId: priceId,
    billingInterval: getBillingIntervalFromPriceId(priceId),
    plan: plan || user.plan || "free",
  });
}

async function handleCheckoutCompleted(stripe, session) {
  const customerId = typeof session.customer === "string" ? session.customer : null;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
  const userId = session.metadata && session.metadata.appUserId ? session.metadata.appUserId : null;
  const user = (userId && findUserById(userId)) || findUserByStripeCustomerId(customerId);

  if (!user) {
    return null;
  }

  if (!subscriptionId) {
    return updateUserStripeBilling(user.id, {
      stripeCustomerId: customerId,
    });
  }

  return applySubscriptionStateToUser(stripe, user, subscriptionId, customerId);
}

async function handleSubscriptionUpdated(stripe, subscription, deleted) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
  const user = findUserByStripeCustomerId(customerId);

  if (!user) {
    return null;
  }

  if (deleted) {
    return updateUserStripeBilling(user.id, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: null,
      stripeSubscriptionStatus: "deleted",
      stripePriceId: null,
      billingInterval: null,
      plan: "free",
    });
  }

  return applySubscriptionStateToUser(stripe, user, subscription, customerId);
}

function createBillingRouter() {
  const router = express.Router();

  router.post("/create-checkout-session", async (req, res) => {
    if (!isStripeConfigured()) {
      return res.status(500).json({ error: "Stripe non configurato." });
    }

    const user = requireAuthenticatedUser(req, res);
    if (!user) {
      return;
    }

    const interval = req.body && req.body.interval === "yearly" ? "yearly" : "monthly";
    const priceId = getPriceIdForInterval(interval);

    try {
      const stripe = getStripeClient();
      const customerId = await ensureStripeCustomer(stripe, user);
      const { appBaseUrl } = getStripeConfig();
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        subscription_data: {
          trial_period_days: TRIAL_DAYS,
          metadata: {
            appUserId: user.id,
            billingInterval: interval,
          },
        },
        success_url: `${appBaseUrl}/?checkout=success`,
        cancel_url: `${appBaseUrl}/?checkout=cancelled`,
        metadata: {
          appUserId: user.id,
          billingInterval: interval,
        },
      });

      return res.json({
        url: session.url,
      });
    } catch (error) {
      return res.status(400).json({
        error: error.message || "Impossibile creare la sessione Stripe Checkout.",
      });
    }
  });

  router.post("/create-portal-session", async (req, res) => {
    if (!isStripeConfigured()) {
      return res.status(500).json({ error: "Stripe non configurato." });
    }

    const user = requireAuthenticatedUser(req, res);
    if (!user) {
      return;
    }

    if (!user.stripeCustomerId) {
      return res.status(400).json({ error: "Nessun account di fatturazione associato." });
    }

    try {
      const stripe = getStripeClient();
      const { appBaseUrl } = getStripeConfig();
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: appBaseUrl,
      });

      return res.json({
        url: session.url,
      });
    } catch (error) {
      return res.status(400).json({
        error: error.message || "Impossibile aprire il Customer Portal.",
      });
    }
  });

  return router;
}

function createStripeWebhookHandler() {
  return async function stripeWebhookHandler(req, res) {
    if (!isStripeConfigured()) {
      return res.status(500).json({ error: "Stripe non configurato." });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      return res.status(400).send("Missing Stripe signature.");
    }

    try {
      const stripe = getStripeClient();
      const { webhookSecret } = getStripeConfig();
      const event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);

      switch (event.type) {
        case "checkout.session.completed":
          await handleCheckoutCompleted(stripe, event.data.object);
          break;
        case "customer.subscription.created":
        case "customer.subscription.updated":
          await handleSubscriptionUpdated(stripe, event.data.object, false);
          break;
        case "customer.subscription.deleted":
          await handleSubscriptionUpdated(stripe, event.data.object, true);
          break;
        default:
          break;
      }

      return res.json({ received: true });
    } catch (error) {
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }
  };
}

module.exports = {
  createBillingRouter,
  createStripeWebhookHandler,
  getStripeConfig,
  isStripeConfigured,
};
