const crypto = require("crypto");
const { AUTH_PROVIDERS } = require("./authHelpers");

const GOOGLE_AUTH_BASE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
const GOOGLE_AUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "https://www.googleapis.com/auth/calendar.events",
];

let cachedGoogleKeys = null;
let cachedGoogleKeysExpiresAt = 0;

function getGoogleAuthConfig() {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || "").trim(),
    iosClientId: (process.env.GOOGLE_IOS_CLIENT_ID || "").trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    redirectUri: (process.env.GOOGLE_REDIRECT_URI || "").trim(),
  };
}

function getGoogleReversedClientId(clientId) {
  const normalizedClientId = String(clientId || "").trim();

  if (!normalizedClientId.endsWith(".apps.googleusercontent.com")) {
    return "";
  }

  return `com.googleusercontent.apps.${normalizedClientId.replace(".apps.googleusercontent.com", "")}`;
}

function isGoogleAuthConfigured() {
  const { clientId, clientSecret, redirectUri } = getGoogleAuthConfig();
  return Boolean(clientId && clientSecret && redirectUri);
}

function getGoogleNativeClientIds() {
  const ids = [
    process.env.GOOGLE_WEB_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
  ];

  return Array.from(new Set(ids.map((id) => String(id || "").trim()).filter(Boolean)));
}

function isGoogleNativeAuthConfigured() {
  const { clientId, iosClientId } = getGoogleAuthConfig();
  return Boolean(clientId && iosClientId);
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

async function exchangeNativeServerAuthCode(serverAuthCode) {
  const { clientId, clientSecret } = getGoogleAuthConfig();
  const code = String(serverAuthCode || "").trim();

  if (!code) {
    return null;
  }

  if (!clientId || !clientSecret) {
    throw new Error("Configurazione Google OAuth nativa incompleta.");
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
    }),
  });
  const responseBody = await response.text();
  let data = {};

  if (responseBody) {
    try {
      data = JSON.parse(responseBody);
    } catch (error) {
      data = { error: responseBody };
    }
  }

  if (!response.ok) {
    throw new Error(data.error_description || data.error || "Google native token exchange failed.");
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

async function fetchGoogleKeys() {
  if (cachedGoogleKeys && Date.now() < cachedGoogleKeysExpiresAt) {
    return cachedGoogleKeys;
  }

  const response = await fetch(GOOGLE_KEYS_URL);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !Array.isArray(data.keys)) {
    throw new Error("Unable to fetch Google public keys.");
  }

  cachedGoogleKeys = data.keys;
  cachedGoogleKeysExpiresAt = Date.now() + 60 * 60 * 1000;
  return cachedGoogleKeys;
}

function decodeJwtPart(part, label) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid Google id_token ${label}.`);
  }
}

async function verifyGoogleIdToken(idToken, allowedAudiences) {
  if (typeof idToken !== "string" || !idToken.trim()) {
    throw new Error("Missing Google id_token.");
  }

  const tokenParts = idToken.trim().split(".");
  if (tokenParts.length !== 3) {
    throw new Error("Invalid Google id_token.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = tokenParts;
  const header = decodeJwtPart(encodedHeader, "header");
  const payload = decodeJwtPart(encodedPayload, "payload");

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid Google id_token header.");
  }

  const keys = await fetchGoogleKeys();
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");

  if (!jwk) {
    throw new Error("Google public key not found.");
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verified = crypto
    .createVerify("RSA-SHA256")
    .update(`${encodedHeader}.${encodedPayload}`)
    .end()
    .verify(publicKey, Buffer.from(encodedSignature, "base64url"));

  if (!verified) {
    throw new Error("Invalid Google id_token signature.");
  }

  const expectedAudiences = Array.isArray(allowedAudiences) && allowedAudiences.length
    ? allowedAudiences
    : getGoogleNativeClientIds();
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);

  if (!GOOGLE_ISSUERS.includes(payload.iss)) {
    throw new Error("Invalid Google id_token issuer.");
  }

  if (!expectedAudiences.some((expectedAudience) => audience.includes(expectedAudience))) {
    throw new Error("Invalid Google id_token audience.");
  }

  if (!payload.exp || Number(payload.exp) <= now) {
    throw new Error("Expired Google id_token.");
  }

  if (payload.nbf && Number(payload.nbf) > now + 300) {
    throw new Error("Google id_token not active.");
  }

  if (!payload.sub) {
    throw new Error("Google id_token missing sub.");
  }

  return payload;
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

async function authenticateWithNativeGoogle(nativePayload) {
  const payload = nativePayload && typeof nativePayload === "object" ? nativePayload : {};
  const serverAuthCode = typeof payload.serverAuthCode === "string" ? payload.serverAuthCode.trim() : "";
  let exchangedTokenData = null;

  console.log("[FloMind] native Google token payload received", {
    hasIdToken: Boolean(payload.idToken),
    hasServerAuthCode: Boolean(serverAuthCode),
    hasEmail: Boolean(payload.email),
  });

  if (serverAuthCode) {
    exchangedTokenData = await exchangeNativeServerAuthCode(serverAuthCode);
  }

  const identityToken = typeof payload.idToken === "string" && payload.idToken.trim()
    ? payload.idToken.trim()
    : (exchangedTokenData && exchangedTokenData.id_token ? exchangedTokenData.id_token : "");
  const idTokenPayload = await verifyGoogleIdToken(identityToken, getGoogleNativeClientIds());
  console.log("[FloMind] native Google id_token verified", {
    audience: idTokenPayload.aud || null,
    hasSub: Boolean(idTokenPayload.sub),
    hasEmail: Boolean(idTokenPayload.email),
    emailVerified: idTokenPayload.email_verified === true || idTokenPayload.email_verified === "true",
  });
  const nativeName = typeof payload.displayName === "string" && payload.displayName.trim()
    ? payload.displayName.trim()
    : null;
  const nativeEmail = typeof payload.email === "string" && payload.email.trim()
    ? payload.email.trim()
    : null;
  const nativeImageUrl = typeof payload.imageUrl === "string" && payload.imageUrl.trim()
    ? payload.imageUrl.trim()
    : null;

  return {
    profile: {
      provider: AUTH_PROVIDERS.GOOGLE,
      providerUserId: idTokenPayload.sub,
      name: idTokenPayload.name || nativeName || null,
      email: idTokenPayload.email || nativeEmail || null,
      avatarUrl: idTokenPayload.picture || nativeImageUrl || null,
      emailVerified: idTokenPayload.email_verified === true || idTokenPayload.email_verified === "true",
    },
    tokens: exchangedTokenData ? normalizeGoogleTokens(exchangedTokenData) : null,
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
  authenticateWithNativeGoogle,
  buildGoogleAuthUrl,
  createOAuthState,
  getGoogleAuthConfig,
  getGoogleNativeClientIds,
  getGoogleReversedClientId,
  GOOGLE_AUTH_SCOPES,
  isGoogleAuthConfigured,
  isGoogleNativeAuthConfigured,
  refreshGoogleAccessToken,
  verifyGoogleIdToken,
};
