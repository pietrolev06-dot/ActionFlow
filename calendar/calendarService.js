const { getGoogleAuthConfig, refreshGoogleAccessToken } = require("../auth/googleAuth");
const { findUserById, updateUserGoogleTokens } = require("../models/userStore");

const GOOGLE_CALENDAR_BASE_URL = "https://www.googleapis.com/calendar/v3/calendars/primary";

function getAuthenticatedGoogleUser(userId) {
  const user = findUserById(userId);
  if (!user || user.provider !== "google" || !user.googleTokens || !user.googleTokens.accessToken) {
    return null;
  }

  return user;
}

function hasCalendarConnection(userId) {
  return !!getAuthenticatedGoogleUser(userId);
}

function isTokenFresh(tokens) {
  if (!tokens || !tokens.accessToken) {
    return false;
  }

  if (!tokens.expiresAt) {
    return true;
  }

  return new Date(tokens.expiresAt).getTime() > Date.now() + 60 * 1000;
}

async function ensureValidAccessToken(userId) {
  const user = getAuthenticatedGoogleUser(userId);

  if (!user) {
    throw new Error("Google Calendar non connesso.");
  }

  if (isTokenFresh(user.googleTokens)) {
    return user.googleTokens.accessToken;
  }

  if (!user.googleTokens.refreshToken) {
    throw new Error("Token Google scaduto. Riconnetti il tuo account.");
  }

  const refreshedTokens = await refreshGoogleAccessToken(user.googleTokens.refreshToken, user.googleTokens);
  updateUserGoogleTokens(userId, refreshedTokens);
  return refreshedTokens.accessToken;
}

async function callGoogleCalendarApi(userId, path, options) {
  const accessToken = await ensureValidAccessToken(userId);
  const response = await fetch(`${GOOGLE_CALENDAR_BASE_URL}${path}`, {
    method: options && options.method ? options.method : "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: options && options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error && data.error.message ? data.error.message : "Google Calendar request failed.");
  }

  return data;
}

function getTodayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  };
}

async function listTodayEvents(userId) {
  const range = getTodayRange();
  const search = new URLSearchParams({
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });

  const data = await callGoogleCalendarApi(userId, `/events?${search.toString()}`, {
    method: "GET",
  });

  return Array.isArray(data.items) ? data.items : [];
}

async function createCalendarEvent(userId, payload) {
  return callGoogleCalendarApi(userId, "/events", {
    method: "POST",
    body: {
      summary: payload.title,
      description: payload.description || "",
      start: {
        dateTime: payload.start,
      },
      end: {
        dateTime: payload.end,
      },
    },
  });
}

module.exports = {
  createCalendarEvent,
  getAuthenticatedGoogleUser,
  hasCalendarConnection,
  listTodayEvents,
};
