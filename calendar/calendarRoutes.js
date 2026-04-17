const express = require("express");
const {
  createCalendarEvent,
  hasCalendarConnection,
  listTodayEvents,
} = require("./calendarService");

function createCalendarRouter() {
  const router = express.Router();

  router.get("/status", (req, res) => {
    const currentUser = req.currentUser;

    res.json({
      connected: !!(currentUser && hasCalendarConnection(currentUser.id)),
      provider: currentUser ? currentUser.provider || null : null,
    });
  });

  router.use((req, res, next) => {
    if (!req.currentUser || !req.currentUser.id) {
      return res.status(401).json({ error: "Utente non autenticato." });
    }

    next();
  });

  router.get("/events/today", async (req, res) => {
    try {
      const events = await listTodayEvents(req.currentUser.id);
      return res.json({ events });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  router.post("/events", async (req, res) => {
    const { title, description, start, end } = req.body || {};

    if (!title || !start || !end) {
      return res.status(400).json({ error: "title, start ed end sono obbligatori." });
    }

    try {
      const event = await createCalendarEvent(req.currentUser.id, {
        title: String(title).trim(),
        description: typeof description === "string" ? description.trim() : "",
        start: String(start),
        end: String(end),
      });

      return res.status(201).json({ event });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = {
  createCalendarRouter,
};
