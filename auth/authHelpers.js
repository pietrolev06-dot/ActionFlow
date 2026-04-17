const crypto = require("crypto");

const AUTH_PROVIDERS = Object.freeze({
  GOOGLE: "google",
  APPLE: "apple",
  EMAIL: "email",
});

function buildStableUserId(provider, providerUserId, fallbackId) {
  if (provider && providerUserId) {
    return `${provider}:${providerUserId}`;
  }

  return fallbackId || crypto.randomUUID();
}

function getSupportedAuthProviders() {
  return Object.values(AUTH_PROVIDERS);
}

function isSupportedAuthProvider(provider) {
  return getSupportedAuthProviders().includes(provider);
}

function createUser({
  id,
  provider,
  providerUserId,
  name = null,
  email = null,
  displayName = null,
  avatarUrl = null,
  theme = "system",
  googleTokens = null,
  createdAt = new Date().toISOString(),
}) {
  if (!isSupportedAuthProvider(provider)) {
    throw new Error(`Unsupported auth provider: ${provider}`);
  }

  return {
    id: buildStableUserId(provider, providerUserId, id),
    provider,
    providerUserId,
    name,
    email,
    displayName,
    avatarUrl,
    theme,
    googleTokens,
    createdAt,
  };
}

function buildSessionUser(user) {
  return {
    id: user.id,
    provider: user.provider,
    providerUserId: user.providerUserId,
    name: user.name,
    email: user.email,
    displayName: user.displayName || null,
    avatarUrl: user.avatarUrl || null,
    theme: user.theme || "system",
    createdAt: user.createdAt,
  };
}

module.exports = {
  AUTH_PROVIDERS,
  buildStableUserId,
  buildSessionUser,
  createUser,
  getSupportedAuthProviders,
  isSupportedAuthProvider,
};
