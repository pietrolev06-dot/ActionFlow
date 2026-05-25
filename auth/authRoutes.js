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
  authenticateWithApple,
  buildAppleAuthUrl,
  getAppleAuthConfig,
  isAppleAuthConfigured,
} = require("./appleAuth");
const {
  findOrCreateUser,
  updateUserSettings,
} = require("../models/userStore");

function redirectToLoginWithAuthError(res, provider) {
  return res.redirect(`/login?authError=${encodeURIComponent(provider)}`);
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
    req.session.appleOAuthState = state;
    res.cookieSession();

    return res.redirect(buildAppleAuthUrl(state));
  });

  async function handleAppleCallback(req, res) {
    console.log("[DEBUG] /auth/apple/callback hit");
    const payload = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const { code, state, error, user: appleUserPayload } = payload;

    if (error) {
      delete req.session.appleOAuthState;
      res.cookieSession();
      return redirectToLoginWithAuthError(res, "apple");
    }

    if (!code || typeof code !== "string") {
      delete req.session.appleOAuthState;
      res.cookieSession();
      return redirectToLoginWithAuthError(res, "apple");
    }

    if (!state || state !== req.session.appleOAuthState) {
      delete req.session.appleOAuthState;
      res.cookieSession();
      return redirectToLoginWithAuthError(res, "apple");
    }

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

      delete req.session.appleOAuthState;
      req.session.user = buildSessionUser(user);
      res.cookieSession();

      return res.redirect("/");
    } catch (authError) {
      console.warn("[FloMind] Apple authentication failed:", authError.message);
      delete req.session.appleOAuthState;
      res.cookieSession();
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
