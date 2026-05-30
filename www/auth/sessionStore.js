const crypto = require("crypto");

const SESSION_COOKIE_NAME = "drop2action.sid";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const sessions = new Map();

function signSessionId(sessionId, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(sessionId)
    .digest("hex");
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

function serializeCookie(name, value, maxAgeMs) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];

  if (process.env.NODE_ENV === "production") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

function createSessionMiddleware() {
  const sessionSecret = (process.env.SESSION_SECRET || "").trim();

  return function sessionMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie);
    const signedCookie = cookies[SESSION_COOKIE_NAME];
    let sessionId = null;
    let session = {};

    if (signedCookie) {
      const [incomingSessionId, incomingSignature] = signedCookie.split(".");

      if (
        incomingSessionId &&
        incomingSignature &&
        sessionSecret &&
        incomingSignature === signSessionId(incomingSessionId, sessionSecret)
      ) {
        const storedSession = sessions.get(incomingSessionId);

        if (storedSession && storedSession.expiresAt > Date.now()) {
          sessionId = incomingSessionId;
          session = { ...storedSession.data };
        }
      }
    }

    req.session = session;

    req.session.destroy = () => {
      if (sessionId) {
        sessions.delete(sessionId);
      }

      sessionId = null;
      req.session = {};
      res.setHeader("Set-Cookie", serializeCookie(SESSION_COOKIE_NAME, "", 0));
    };

    res.on("finish", () => {
      if (!sessionSecret || res.headersSent === false) {
        return;
      }

      if (sessionId === null) {
        sessionId = crypto.randomUUID();
      }

      const sessionData = { ...req.session };
      delete sessionData.destroy;

      if (Object.keys(sessionData).length === 0) {
        sessions.delete(sessionId);
        return;
      }

      sessions.set(sessionId, {
        data: sessionData,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
    });

    if (sessionSecret) {
      res.cookieSession = () => {
        if (!sessionId) {
          sessionId = crypto.randomUUID();
        }

        const signedValue = `${sessionId}.${signSessionId(sessionId, sessionSecret)}`;
        res.setHeader(
          "Set-Cookie",
          serializeCookie(SESSION_COOKIE_NAME, signedValue, SESSION_TTL_MS)
        );
      };

      if (sessionId) {
        res.cookieSession();
      }
    } else {
      res.cookieSession = () => {};
    }

    next();
  };
}

module.exports = {
  createSessionMiddleware,
};
