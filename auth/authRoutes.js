const express = require("express");
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
  findOrCreateUser,
  updateUserSettings,
} = require("../models/userStore");

const APPLE_AUTH_BASE_URL = "https://appleid.apple.com/auth/authorize";

function getAppleAuthConfig() {
  return {
    clientId: (process.env.APPLE_CLIENT_ID || "").trim(),
    redirectUri: (process.env.APPLE_REDIRECT_URI || "").trim(),
  };
}

function isAppleAuthConfigured() {
  const { clientId, redirectUri } = getAppleAuthConfig();
  return Boolean(clientId && redirectUri);
}

function buildAppleAuthUrl(state) {
  const { clientId, redirectUri } = getAppleAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "form_post",
    scope: "name email",
    state,
  });

  return `${APPLE_AUTH_BASE_URL}?${params.toString()}`;
}

function maskSensitiveValue(value) {
  if (typeof value !== "string" || !value) {
    return null;
  }

  if (value.length <= 12) {
    return `${value.slice(0, 3)}***${value.slice(-3)}`;
  }

  return `${value.slice(0, 6)}***${value.slice(-6)}`;
}

function parseAppleIdToken(idToken) {
  if (typeof idToken !== "string") {
    throw new Error("Missing Apple id_token.");
  }

  const tokenParts = idToken.split(".");

  if (tokenParts.length < 2) {
    throw new Error("Invalid Apple id_token.");
  }

  const payload = JSON.parse(Buffer.from(tokenParts[1], "base64url").toString("utf8"));

  if (!payload.sub) {
    throw new Error("Apple id_token missing sub.");
  }

  return {
    provider: AUTH_PROVIDERS.APPLE,
    providerUserId: payload.sub,
    email: payload.email || null,
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
        ...googleAuth.profile,
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
          hasAppleRedirectUri: Boolean(appleConfig.redirectUri),
        },
      });
    }

    const state = createOAuthState();
    req.session.appleOAuthState = state;
    res.cookieSession();

    return res.redirect(buildAppleAuthUrl(state));
  });

  router.post("/apple/callback", (req, res) => {
    console.log("[DEBUG] /auth/apple/callback hit");
    const { code, id_token: idToken } = req.body || {};

    console.log("[DEBUG] Apple callback payload:", {
      hasCode: Boolean(code),
      hasIdToken: Boolean(idToken),
      codePreview: maskSensitiveValue(code),
      idTokenPreview: maskSensitiveValue(idToken),
    });

    try {
      const appleProfile = parseAppleIdToken(idToken);
      const user = findOrCreateUser(appleProfile);

      delete req.session.appleOAuthState;
      req.session.user = buildSessionUser(user);
      res.cookieSession();

      return res.redirect("/");
    } catch (authError) {
      return res.status(400).json({
        error: "Apple authentication failed.",
        detail: authError.message,
      });
    }
  });

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
