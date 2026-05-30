const crypto = require("crypto");
const { AUTH_PROVIDERS } = require("./authHelpers");

const GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_AUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
];

function getGoogleAuthConfig() {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    redirectUri: (process.env.GOOGLE_REDIRECT_URI || "").trim(),
  };
}

function isGoogleAuthConfigured() {
  const { clientId, clientSecret, redirectUri } = getGoogleAuthConfig();
  return Boolean(clientId && clientSecret && redirectUri);
}

function createOAuthState() {
  return crypto.randomBytes(24).toString("hex");
}

function buildGoogleAuthUrl(state) {
  const { clientId, redirectUri } = getGoogleAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_AUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return `${GOOGLE_AUTH_BASE_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getGoogleAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google token exchange failed.");
  }

  return data;
}

async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "Google profile fetch failed.");
  }

  return {
    provider: AUTH_PROVIDERS.GOOGLE,
    providerUserId: data.id,
    name: data.name || null,
    email: data.email || null,
    avatarUrl: data.picture || null,
  };
}

function normalizeGoogleTokens(tokenData, previousTokens) {
  const expiresInSeconds = Number(tokenData.expires_in || 0);
  const expiresAt = expiresInSeconds > 0
    ? new Date(Date.now() + expiresInSeconds * 1000).toISOString()
    : (previousTokens && previousTokens.expiresAt) || null;

  return {
    accessToken: tokenData.access_token || (previousTokens && previousTokens.accessToken) || null,
    refreshToken: tokenData.refresh_token || (previousTokens && previousTokens.refreshToken) || null,
    expiresAt,
    scope: tokenData.scope || (previousTokens && previousTokens.scope) || GOOGLE_AUTH_SCOPES.join(" "),
    tokenType: tokenData.token_type || (previousTokens && previousTokens.tokenType) || "Bearer",
  };
}

async function authenticateWithGoogle(code) {
  const tokenData = await exchangeCodeForTokens(code);
  const profile = await fetchGoogleProfile(tokenData.access_token);

  return {
    profile,
    tokens: normalizeGoogleTokens(tokenData),
  };
}

async function refreshGoogleAccessToken(refreshToken, previousTokens) {
  const { clientId, clientSecret } = getGoogleAuthConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google token refresh failed.");
  }

  return normalizeGoogleTokens(data, previousTokens);
}

module.exports = {
  authenticateWithGoogle,
  buildGoogleAuthUrl,
  createOAuthState,
  getGoogleAuthConfig,
  GOOGLE_AUTH_SCOPES,
  isGoogleAuthConfigured,
  refreshGoogleAccessToken,
};
