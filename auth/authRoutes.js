const express = require("express");
const crypto = require("crypto");
const {
  AUTH_PROVIDERS,
  buildSessionUser,
  getSupportedAuthProviders,
} = require("./authHelpers");
const {
  authenticateWithGoogle,
  buildGoogleAuthUrl,
  createOAuthState,
  getGoogleAuthConfig,
  isGoogleAuthConfigured,
} = require("./googleAuth");
const {
  authenticateWithApple,
  buildAppleAuthUrl,
  getAppleAuthConfig,
  isAppleAuthConfigured,
} = require("./appleAuth");
const {
  findOrCreateUser,
  updateUserSettings,
} = require("../models/userStore");

const APPLE_STATE_COOKIE_NAME = "flomind.apple_state";
const APPLE_STATE_TTL_MS = 1000 * 60 * 10;
const FALLBACK_APPLE_STATE_SECRET = crypto.randomBytes(32).toString("hex");

function redirectToLoginWithAuthError(res, provider) {
  return res.redirect(`/login?authError=${encodeURIComponent(provider)}`);
}

function parseCookies(cookieHeader = "") {
  return cookieHeader.split(";").reduce((cookies, part) => {
    const [rawName, ...rawValueParts] = part.trim().split("=");

    if (!rawName) {
      return cookies;
    }

    cookies[rawName] = decodeURIComponent(rawValueParts.join("=") || "");
    return cookies;
  }, {});
}

function getAppleStateSecret() {
  return (
    process.env.APPLE_STATE_SECRET ||
    process.env.SESSION_SECRET ||
    FALLBACK_APPLE_STATE_SECRET
  ).trim();
}

function signAppleState(state, issuedAt) {
  return crypto
    .createHmac("sha256", getAppleStateSecret())
    .update(`${state}.${issuedAt}`)
    .digest("base64url");
}

function stateFingerprint(state) {
  return typeof state === "string" && state
    ? crypto.createHash("sha256").update(state).digest("hex").slice(0, 12)
    : null;
}

function getAppleStateCookieOptions(req) {
  const isSecureRequest = req.secure || req.get("x-forwarded-proto") === "https";
  const secure = process.env.NODE_ENV === "production" || isSecureRequest;

  return {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    path: "/auth/apple",
    maxAge: APPLE_STATE_TTL_MS,
  };
}

function setAppleStateCookie(req, res, state) {
  const issuedAt = Date.now();
  const cookieValue = [
    Buffer.from(state).toString("base64url"),
    String(issuedAt),
    signAppleState(state, issuedAt),
  ].join(".");

  res.cookie(APPLE_STATE_COOKIE_NAME, cookieValue, getAppleStateCookieOptions(req));
}

function clearAppleStateCookie(req, res) {
  const options = getAppleStateCookieOptions(req);
  res.clearCookie(APPLE_STATE_COOKIE_NAME, {
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
    path: options.path,
  });
}

function readAppleStateCookie(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieValue = cookies[APPLE_STATE_COOKIE_NAME];

  if (!cookieValue) {
    return {
      valid: false,
      reason: "missing_cookie",
      state: null,
    };
  }

  const [encodedState, issuedAtRaw, signature] = cookieValue.split(".");
  const issuedAt = Number(issuedAtRaw);

  if (!encodedState || !issuedAt || !signature) {
    return {
      valid: false,
      reason: "malformed_cookie",
      state: null,
    };
  }

  const state = Buffer.from(encodedState, "base64url").toString("utf8");
  const expectedSignature = signAppleState(state, issuedAt);
  const incomingSignature = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    incomingSignature.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(incomingSignature, expectedSignatureBuffer)
  ) {
    return {
      valid: false,
      reason: "bad_signature",
      state,
    };
  }

  if (Date.now() - issuedAt > APPLE_STATE_TTL_MS) {
    return {
      valid: false,
      reason: "expired_cookie",
      state,
    };
  }

  return {
    valid: true,
    reason: null,
    state,
  };
}

function getAppleDebugContext(payload) {
  const appleConfig = getAppleAuthConfig();

  return {
    hasCode: Boolean(payload && payload.code),
    hasIdToken: Boolean(payload && payload.id_token),
    clientId: appleConfig.clientId || null,
    callbackUrl: appleConfig.callbackUrl || null,
    keyId: appleConfig.keyId || null,
    teamId: appleConfig.teamId || null,
  };
}

function createAuthRouter() {
  console.log("[DEBUG] createAuthRouter() called");
  const router = express.Router();

  router.get("/ping", (req, res) => {
    console.log("[DEBUG] /auth/ping hit");
    res.json({ ok: true, router: "auth" });
  });

  router.get("/me", (req, res) => {
    return res.json({
      user: req.currentUser,
    });
  });

  router.get("/providers", (req, res) => {
    res.json({
      providers: getSupportedAuthProviders(),
    });
  });

  router.post("/settings", (req, res) => {
    if (!req.session || !req.session.user || !req.session.user.id) {
      return res.status(401).json({ error: "Utente non autenticato." });
    }

    const sessionUser = req.session.user;
    const { displayName, avatarUrl, theme } = req.body || {};
    const normalizedTheme = theme === "light" || theme === "dark" || theme === "system"
      ? theme
      : "system";

    let updatedUser = updateUserSettings(sessionUser.id, {
      displayName: typeof displayName === "string" ? displayName.trim() : "",
      avatarUrl: typeof avatarUrl === "string" ? avatarUrl.trim() : "",
      theme: normalizedTheme,
    });

    if (!updatedUser) {
      findOrCreateUser({
        id: sessionUser.id,
        provider: sessionUser.provider,
        providerUserId: sessionUser.providerUserId,
        name: sessionUser.name,
        email: sessionUser.email,
        googleName: sessionUser.googleName || sessionUser.name || null,
        googlePicture: sessionUser.googlePicture || null,
        displayName: sessionUser.displayName || null,
        avatarUrl: sessionUser.avatarUrl || null,
        theme: sessionUser.theme || "system",
        createdAt: sessionUser.createdAt,
      });

      updatedUser = updateUserSettings(sessionUser.id, {
        displayName: typeof displayName === "string" ? displayName.trim() : "",
        avatarUrl: typeof avatarUrl === "string" ? avatarUrl.trim() : "",
        theme: normalizedTheme,
      });
    }

    if (!updatedUser) {
      return res.status(404).json({ error: "Utente non trovato." });
    }

    req.session.user = buildSessionUser(updatedUser);
    res.cookieSession();

    return res.json({
      user: req.session.user,
    });
  });

  router.get("/google", (req, res) => {
    console.log("[DEBUG] /auth/google hit");

    if (!isGoogleAuthConfigured()) {
      const googleConfig = getGoogleAuthConfig();

      return res.status(500).json({
        error: "Configurazione Google OAuth incompleta.",
        checks: {
          hasGoogleClientId: Boolean(googleConfig.clientId),
          hasGoogleClientSecret: Boolean(googleConfig.clientSecret),
          hasGoogleRedirectUri: Boolean(googleConfig.redirectUri),
        },
      });
    }

    const state = createOAuthState();
    req.session.oauthState = state;
    res.cookieSession();

    return res.redirect(buildGoogleAuthUrl(state));
  });

  router.get("/google/callback", async (req, res) => {
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({ error: `Google OAuth error: ${error}` });
    }

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Missing Google authorization code." });
    }

    if (!state || state !== req.session.oauthState) {
      return res.status(400).json({ error: "Invalid OAuth state." });
    }

    try {
      const googleAuth = await authenticateWithGoogle(code);
      const user = findOrCreateUser({
        provider: googleAuth.profile.provider,
        providerUserId: googleAuth.profile.providerUserId,
        name: googleAuth.profile.name || null,
        email: googleAuth.profile.email || null,
        googleName: googleAuth.profile.name || null,
        googlePicture: googleAuth.profile.avatarUrl || null,
        googleTokens: googleAuth.tokens,
      });

      delete req.session.oauthState;
      req.session.user = buildSessionUser(user);
      res.cookieSession();

      return res.redirect("/");
    } catch (authError) {
      return res.status(500).json({
        error: "Google authentication failed.",
        detail: authError.message,
      });
    }
  });

  router.get("/apple", (req, res) => {
    console.log("[DEBUG] /auth/apple hit");

    if (!isAppleAuthConfigured()) {
      const appleConfig = getAppleAuthConfig();

      return res.status(500).json({
        error: "Configurazione Apple OAuth incompleta.",
        checks: {
          hasAppleClientId: Boolean(appleConfig.clientId),
          hasAppleTeamId: Boolean(appleConfig.teamId),
          hasAppleKeyId: Boolean(appleConfig.keyId),
          hasApplePrivateKey: Boolean(appleConfig.privateKey),
          hasAppleCallbackUrl: Boolean(appleConfig.callbackUrl),
        },
      });
    }

    const state = createOAuthState();
    res.cookieSession();
    setAppleStateCookie(req, res, state);
    console.log("[FloMind] apple state generated", {
      stateFingerprint: stateFingerprint(state),
      cookie: {
        httpOnly: true,
        secure: getAppleStateCookieOptions(req).secure,
        sameSite: getAppleStateCookieOptions(req).sameSite,
        path: getAppleStateCookieOptions(req).path,
        maxAgeMs: APPLE_STATE_TTL_MS,
      },
    });

    return res.redirect(buildAppleAuthUrl(state));
  });

  async function handleAppleCallback(req, res) {
    const payload = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const { code, state, error, user: appleUserPayload } = payload;
    const appleDebugContext = getAppleDebugContext(payload);

    console.log("[FloMind] apple callback received", appleDebugContext);
    console.log("[FloMind] apple state received", {
      hasState: Boolean(state),
      stateFingerprint: stateFingerprint(state),
    });

    if (error) {
      console.warn("[FloMind] Apple callback returned error:", error);
      res.cookieSession();
      clearAppleStateCookie(req, res);
      return redirectToLoginWithAuthError(res, "apple");
    }

    if (!code || typeof code !== "string") {
      console.warn("[FloMind] Apple callback missing code", appleDebugContext);
      res.cookieSession();
      clearAppleStateCookie(req, res);
      return redirectToLoginWithAuthError(res, "apple");
    }

    console.log("[FloMind] apple code present");

    const storedAppleState = readAppleStateCookie(req);

    if (!state || !storedAppleState.valid || state !== storedAppleState.state) {
      console.warn("[FloMind] Apple callback invalid state", {
        context: appleDebugContext,
        receivedStateFingerprint: stateFingerprint(state),
        storedStateFingerprint: stateFingerprint(storedAppleState.state),
        stateCookieValid: storedAppleState.valid,
        stateCookieFailureReason: storedAppleState.reason,
      });
      res.cookieSession();
      clearAppleStateCookie(req, res);
      return redirectToLoginWithAuthError(res, "apple");
    }

    console.log("[FloMind] apple state validation success", {
      stateFingerprint: stateFingerprint(state),
    });

    try {
      const appleProfile = await authenticateWithApple(code, appleUserPayload);
      const userInput = {
        provider: appleProfile.provider,
        providerUserId: appleProfile.providerUserId,
      };

      if (appleProfile.email) {
        userInput.email = appleProfile.email;
      }

      if (appleProfile.displayName) {
        userInput.displayName = appleProfile.displayName;
      }

      const user = findOrCreateUser(userInput);

      req.session.user = buildSessionUser(user);
      res.cookieSession();
      clearAppleStateCookie(req, res);
      console.log("[FloMind] apple user created/session started", {
        provider: req.session.user.provider,
        userId: req.session.user.id,
      });

      return res.redirect("/");
    } catch (authError) {
      console.error("[FloMind] Apple authentication failed");
      console.error("[FloMind] Apple auth error message:", authError.message);
      console.error("[FloMind] Apple auth error stack:", authError.stack);
      console.error("[FloMind] Apple auth context:", appleDebugContext);

      if (authError.appleTokenResponseBody) {
        console.error("[FloMind] Apple token endpoint response status:", authError.appleTokenResponseStatus || null);
        console.error("[FloMind] Apple token endpoint response body:", authError.appleTokenResponseBody);
      }

      res.cookieSession();
      clearAppleStateCookie(req, res);
      return redirectToLoginWithAuthError(res, "apple");
    }
  }

  router.get("/apple/callback", handleAppleCallback);
  router.post("/apple/callback", handleAppleCallback);

  router.all("/logout", (req, res) => {
    req.session.destroy();
    return res.json({ user: null });
  });

  router.all("/:provider", (req, res) => {
    const { provider } = req.params;

    if (!getSupportedAuthProviders().includes(provider)) {
      return res.status(404).json({ error: "Provider non supportato." });
    }

    return res.status(501).json({
      error: `Autenticazione ${provider} non ancora implementata.`,
      provider,
      availableProviders: Object.values(AUTH_PROVIDERS),
    });
  });

  return router;
}

module.exports = {
  createAuthRouter,
};
