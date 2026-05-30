const crypto = require("crypto");
const {
  AUTH_PROVIDERS,
  getAppleDisplayNameFallback,
} = require("./authHelpers");

const APPLE_AUTH_BASE_URL = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys";
const APPLE_ISSUER = "https://appleid.apple.com";
const APPLE_AUTH_SCOPES = ["name", "email"];

let cachedAppleKeys = null;
let cachedAppleKeysExpiresAt = 0;

function normalizeApplePrivateKey(privateKey) {
  return String(privateKey || "").trim().replace(/\\n/g, "\n");
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function getAppleAuthConfig() {
  return {
    clientId: (process.env.APPLE_CLIENT_ID || "").trim(),
    teamId: (process.env.APPLE_TEAM_ID || "").trim(),
    keyId: (process.env.APPLE_KEY_ID || "").trim(),
    privateKey: normalizeApplePrivateKey(process.env.APPLE_PRIVATE_KEY || ""),
    callbackUrl: (process.env.APPLE_CALLBACK_URL || "").trim(),
  };
}

function isAppleAuthConfigured() {
  const { clientId, teamId, keyId, privateKey, callbackUrl } = getAppleAuthConfig();
  return Boolean(clientId && teamId && keyId && privateKey && callbackUrl);
}

function buildAppleAuthUrl(state) {
  const { clientId, callbackUrl } = getAppleAuthConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    response_mode: "form_post",
    scope: APPLE_AUTH_SCOPES.join(" "),
    state,
  });

  return `${APPLE_AUTH_BASE_URL}?${params.toString()}`;
}

function generateAppleClientSecret() {
  const { clientId, teamId, keyId, privateKey } = getAppleAuthConfig();
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "ES256",
    kid: keyId,
    typ: "JWT",
  };
  const payload = {
    iss: teamId,
    iat: now,
    exp: now + 60 * 60,
    aud: APPLE_ISSUER,
    sub: clientId,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto
    .createSign("SHA256")
    .update(signingInput)
    .end()
    .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });

  return `${signingInput}.${signature.toString("base64url")}`;
}

function sanitizeAppleTokenResponseBody(data) {
  if (typeof data === "string") {
    return data
      .replace(/(access_token|refresh_token|id_token|client_secret)=([^&\s]+)/gi, "$1=[redacted]")
      .slice(0, 2000);
  }

  if (!data || typeof data !== "object") {
    return data || null;
  }

  const sanitized = { ...data };
  [
    "access_token",
    "refresh_token",
    "id_token",
    "client_secret",
  ].forEach((tokenKey) => {
    if (Object.prototype.hasOwnProperty.call(sanitized, tokenKey)) {
      sanitized[tokenKey] = "[redacted]";
    }
  });

  return sanitized;
}

async function exchangeAppleCodeForTokens(code) {
  const { clientId, callbackUrl } = getAppleAuthConfig();
  const clientSecret = generateAppleClientSecret();
  console.log("[FloMind] apple client secret generated");
  console.log("[FloMind] apple token exchange started");

  const response = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: callbackUrl,
    }),
  });
  const responseBody = await response.text();
  let data = {};

  if (responseBody) {
    try {
      data = JSON.parse(responseBody);
    } catch (error) {
      data = responseBody;
    }
  }

  if (!response.ok) {
    const errorDescription = data && typeof data === "object"
      ? data.error_description || data.error
      : null;
    const error = new Error(errorDescription || "Apple token exchange failed.");
    error.appleTokenResponseBody = sanitizeAppleTokenResponseBody(data);
    error.appleTokenResponseStatus = response.status;
    throw error;
  }

  if (!data || typeof data !== "object" || !data.id_token) {
    const error = new Error("Apple token response missing id_token.");
    error.appleTokenResponseBody = sanitizeAppleTokenResponseBody(data);
    error.appleTokenResponseStatus = response.status;
    throw error;
  }

  console.log("[FloMind] apple token exchange success");
  return data;
}

async function fetchAppleKeys() {
  if (cachedAppleKeys && Date.now() < cachedAppleKeysExpiresAt) {
    return cachedAppleKeys;
  }

  const response = await fetch(APPLE_KEYS_URL);
  const data = await response.json().catch(() => ({}));

  if (!response.ok || !Array.isArray(data.keys)) {
    throw new Error("Unable to fetch Apple public keys.");
  }

  cachedAppleKeys = data.keys;
  cachedAppleKeysExpiresAt = Date.now() + 60 * 60 * 1000;
  return cachedAppleKeys;
}

function decodeJwtPart(part, label) {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid Apple id_token ${label}.`);
  }
}

async function verifyAppleIdToken(idToken) {
  if (typeof idToken !== "string" || !idToken) {
    throw new Error("Missing Apple id_token.");
  }

  const tokenParts = idToken.split(".");
  if (tokenParts.length !== 3) {
    throw new Error("Invalid Apple id_token.");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = tokenParts;
  const header = decodeJwtPart(encodedHeader, "header");
  const payload = decodeJwtPart(encodedPayload, "payload");

  if (header.alg !== "RS256" || !header.kid) {
    throw new Error("Invalid Apple id_token header.");
  }

  const keys = await fetchAppleKeys();
  const jwk = keys.find((key) => key.kid === header.kid && key.kty === "RSA");

  if (!jwk) {
    throw new Error("Apple public key not found.");
  }

  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verified = crypto
    .createVerify("RSA-SHA256")
    .update(`${encodedHeader}.${encodedPayload}`)
    .end()
    .verify(publicKey, Buffer.from(encodedSignature, "base64url"));

  if (!verified) {
    throw new Error("Invalid Apple id_token signature.");
  }

  const { clientId } = getAppleAuthConfig();
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const now = Math.floor(Date.now() / 1000);

  if (payload.iss !== APPLE_ISSUER) {
    throw new Error("Invalid Apple id_token issuer.");
  }

  if (!audience.includes(clientId)) {
    throw new Error("Invalid Apple id_token audience.");
  }

  if (!payload.exp || Number(payload.exp) <= now) {
    throw new Error("Expired Apple id_token.");
  }

  if (payload.nbf && Number(payload.nbf) > now + 300) {
    throw new Error("Apple id_token not active.");
  }

  if (!payload.sub) {
    throw new Error("Apple id_token missing sub.");
  }

  return payload;
}

function parseAppleUser(userPayload) {
  if (!userPayload) {
    return {};
  }

  let parsed = userPayload;
  if (typeof userPayload === "string") {
    try {
      parsed = JSON.parse(userPayload);
    } catch (error) {
      return {};
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return {};
  }

  const firstName = parsed.name && typeof parsed.name.firstName === "string"
    ? parsed.name.firstName.trim()
    : "";
  const lastName = parsed.name && typeof parsed.name.lastName === "string"
    ? parsed.name.lastName.trim()
    : "";
  const structuredName = [firstName, lastName].filter(Boolean).join(" ");
  const stringName = typeof parsed.name === "string" ? parsed.name.trim() : "";
  const displayName = structuredName || stringName;

  return {
    email: typeof parsed.email === "string" && parsed.email.trim() ? parsed.email.trim() : null,
    displayName: displayName || null,
  };
}

async function authenticateWithApple(code, appleUserPayload) {
  const tokenData = await exchangeAppleCodeForTokens(code);
  const idTokenPayload = await verifyAppleIdToken(tokenData.id_token);
  console.log("[FloMind] apple id_token verified");
  const appleUser = parseAppleUser(appleUserPayload);

  return {
    provider: AUTH_PROVIDERS.APPLE,
    providerUserId: idTokenPayload.sub,
    email: appleUser.email || idTokenPayload.email || null,
    displayName: appleUser.displayName || getAppleDisplayNameFallback(appleUser.email || idTokenPayload.email || null),
  };
}

module.exports = {
  APPLE_AUTH_SCOPES,
  authenticateWithApple,
  buildAppleAuthUrl,
  generateAppleClientSecret,
  getAppleAuthConfig,
  isAppleAuthConfigured,
  verifyAppleIdToken,
};
