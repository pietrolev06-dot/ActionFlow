const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// --- Caricamento variabili d'ambiente ---
const envPath = path.join(__dirname, "key.env");
const hasLocalEnvFile = fs.existsSync(envPath);

if (hasLocalEnvFile) {
  const dotenvResult = dotenv.config({ path: envPath });

  if (dotenvResult.error) {
    console.warn("[FloMind] key.env trovato ma non caricato correttamente da %s", envPath);
    console.warn("[FloMind] Dettaglio:", dotenvResult.error.message);
  } else {
    console.log("[FloMind] key.env caricato da %s", envPath);
  }
} else {
  console.log("[FloMind] key.env non trovato in %s, uso solo variabili d'ambiente.", envPath);
}

function maskApiKey(apiKey) {
  if (!apiKey) return "assente";

  if (apiKey.length <= 8) {
    return apiKey.charAt(0) + "***" + apiKey.charAt(apiKey.length - 1);
  }

  return apiKey.slice(0, 4) + "***" + apiKey.slice(-4);
}

const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();

console.log(
  "[FloMind] OPENAI_API_KEY presente: %s | lunghezza: %d | preview: %s",
  OPENAI_API_KEY ? "si" : "no",
  OPENAI_API_KEY.length,
  maskApiKey(OPENAI_API_KEY)
);

if (!OPENAI_API_KEY) {
  console.error("[FloMind] ERRORE: OPENAI_API_KEY non trovata o vuota nelle variabili d'ambiente. Avvio bloccato.");
  process.exit(1);
}

const express = require("express");
const OpenAI = require("openai").default;
const crypto = require("crypto");
const { createAuthRouter } = require("./auth/authRoutes");
const {
  createBillingRouter,
  createStripeWebhookHandler,
} = require("./billing/billingRoutes");
const { createCalendarRouter } = require("./calendar/calendarRoutes");
const { createSessionMiddleware } = require("./auth/sessionStore");
const { attachCurrentUser } = require("./auth/userSessionMiddleware");
const { getUserStorage, setUserStorage } = require("./models/userDataStore");
const appConfig = require("./appConfig");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const PROJECT_ROOT = __dirname;
const ALLOWED_CORS_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "http://localhost:3000",
  "http://localhost:5173",
]);

console.log("[DEBUG] Startup file:", __filename);

app.use((req, res, next) => {
  console.log("[REQ]", req.method, req.originalUrl);
  next();
});

app.use((req, res, next) => {
  const origin = req.get("origin");

  if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      req.get("access-control-request-headers") || "Content-Type,Authorization"
    );
    res.setHeader("Vary", "Origin");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  return next();
});

// --- Middleware ---
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), createStripeWebhookHandler());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(createSessionMiddleware());
app.use(attachCurrentUser);

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "flomind-api",
    time: new Date().toISOString(),
  });
});

console.log("[DEBUG] Mounting /auth router");
app.use("/auth", (req, res, next) => {
  if (appConfig.BETA_DISABLE_EXTERNAL_SERVICES && (req.path === "/google" || req.path === "/apple")) {
    return res.redirect("/login?betaExternalServicesDisabled=1");
  }

  return next();
});
app.use("/auth", createAuthRouter());
app.use("/api/billing", (req, res, next) => {
  if (appConfig.BETA_DISABLE_EXTERNAL_SERVICES) {
    return res.status(503).json({ error: appConfig.BETA_DISABLED_MESSAGE });
  }

  return next();
});
app.use("/api/billing", createBillingRouter());
app.use("/calendar", createCalendarRouter());
app.get("/appConfig.js", (req, res) => {
  res.type("application/javascript");
  res.send(appConfig.toClientScript());
});
app.use(express.static(PROJECT_ROOT));

app.get("/__health", (req, res) => {
  res.json({ ok: true, file: __filename });
});

app.get("/__diag", (req, res) => {
  res.json({
    ok: true,
    file: __filename,
    pid: process.pid,
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV || null,
    port: process.env.PORT || null,
    hasOpenAiKey: Boolean((process.env.OPENAI_API_KEY || "").trim()),
    hasGoogleClientId: Boolean((process.env.GOOGLE_CLIENT_ID || "").trim()),
    hasGoogleClientSecret: Boolean((process.env.GOOGLE_CLIENT_SECRET || "").trim()),
    hasGoogleRedirectUri: Boolean((process.env.GOOGLE_REDIRECT_URI || "").trim()),
    hasSessionSecret: Boolean((process.env.SESSION_SECRET || "").trim()),
    hasStripeSecretKey: Boolean((process.env.STRIPE_SECRET_KEY || "").trim()),
    hasStripeWebhookSecret: Boolean((process.env.STRIPE_WEBHOOK_SECRET || "").trim()),
    hasStripePriceMonthly: Boolean((process.env.STRIPE_PRICE_MONTHLY || "").trim()),
    hasStripePriceYearly: Boolean((process.env.STRIPE_PRICE_YEARLY || "").trim()),
    hasAppBaseUrl: Boolean((process.env.APP_BASE_URL || "").trim()),
    betaDisableExternalServices: appConfig.BETA_DISABLE_EXTERNAL_SERVICES === true,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/user-storage", (req, res) => {
  if (!req.currentUser || !req.currentUser.id) {
    return res.status(401).json({ error: "Utente non autenticato." });
  }

  return res.json({
    userId: req.currentUser.id,
    storage: getUserStorage(req.currentUser.id),
  });
});

app.put("/api/user-storage", (req, res) => {
  if (!req.currentUser || !req.currentUser.id) {
    return res.status(401).json({ error: "Utente non autenticato." });
  }

  return res.json({
    userId: req.currentUser.id,
    storage: setUserStorage(req.currentUser.id, req.body || {}),
  });
});

// --- Frontend routes ---
app.get("/login", (req, res) => {
  if (req.currentUser) {
    return res.redirect("/");
  }

  return res.sendFile(path.join(PROJECT_ROOT, "login.html"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "index.html"));
});

app.get("/focus", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "focus.html"));
});

app.get("/organizza-giornata", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "organizza-giornata.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "dashboard.html"));
});

app.get("/habits", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "habits.html"));
});

app.get("/checklist", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "checklist.html"));
});

// --- OpenAI client ---
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// --- JSON Schema per la risposta strutturata ---
const ANALYSIS_SCHEMA = {
  type: "json_schema",
  name: "analisi_testo",
  strict: true,
  schema: {
    type: "object",
    properties: {
      activities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: ["event", "deadline", "task"],
              description: "event = fixed date and fixed start time; deadline = due date without fixed execution time; task = flexible completion work."
            },
            title: { type: "string", description: "Clean concise activity title in the user's language." },
            date: { type: ["string", "null"], description: "ISO date yyyy-MM-dd. Required for event/deadline, null when absent for flexible tasks." },
            startTime: { type: ["string", "null"], description: "Fixed start time HH:mm for events only. Null for deadlines and flexible tasks." },
            endTime: { type: ["string", "null"], description: "Fixed end time HH:mm when inferable for events. Null otherwise." },
            indicativeTimeSlot: {
              type: ["string", "null"],
              description: "A broad slot such as morning, afternoon, evening, night or flexible when explicitly suggested but not fixed. Null if absent."
            },
            durationMinutes: { type: "integer", minimum: 0, description: "Estimated execution/event duration. Use 0 for deadlines because they are not schedule blocks." },
            importanceScore: { type: "integer", minimum: 0, maximum: 100 },
            urgencyScore: { type: "integer", minimum: 0, maximum: 100 },
            energyRequiredScore: { type: "integer", minimum: 0, maximum: 100 },
            flexibilityScore: { type: "integer", minimum: 0, maximum: 100, description: "0 means fixed/non-flexible, 100 means fully flexible." },
            category: { type: "string", description: "Short category such as study, health, work, admin, home, finance, personal, errand, other." },
            dependencies: {
              type: "array",
              items: { type: "string" },
              description: "Only clearly inferable prerequisites. Empty array if none."
            }
          },
          required: [
            "type",
            "title",
            "date",
            "startTime",
            "endTime",
            "indicativeTimeSlot",
            "durationMinutes",
            "importanceScore",
            "urgencyScore",
            "energyRequiredScore",
            "flexibilityScore",
            "category",
            "dependencies"
          ],
          additionalProperties: false
        }
      }
    },
    required: ["activities"],
    additionalProperties: false
  }
};

const DAILY_PLANNER_ITEM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    durationMinutes: { type: "integer", minimum: 0 },
    type: { type: "string", enum: ["task", "habit", "event", "calendar"] },
    why: { type: "string" }
  },
  required: ["id", "title", "durationMinutes", "type", "why"],
  additionalProperties: false
};

const DAILY_PLANNER_DEFERRED_ITEM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    title: { type: "string" },
    durationMinutes: { type: "integer", minimum: 0 },
    type: { type: "string", enum: ["task", "habit", "event", "calendar"] },
    whyDeferred: { type: "string" }
  },
  required: ["id", "title", "durationMinutes", "type", "whyDeferred"],
  additionalProperties: false
};

const DAILY_PLANNER_SCHEMA = {
  type: "json_schema",
  name: "smart_daily_plan",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "object",
        properties: {
          label: { type: "string" },
          score: { type: "integer", minimum: 0, maximum: 100 },
          reason: { type: "string" }
        },
        required: ["label", "score", "reason"],
        additionalProperties: false
      },
      energy: {
        type: "object",
        properties: {
          morning: { type: "integer", minimum: 0, maximum: 100 },
          afternoon: { type: "integer", minimum: 0, maximum: 100 },
          evening: { type: "integer", minimum: 0, maximum: 100 }
        },
        required: ["morning", "afternoon", "evening"],
        additionalProperties: false
      },
      sections: {
        type: "object",
        properties: {
          morning: { type: "array", items: DAILY_PLANNER_ITEM_SCHEMA },
          afternoon: { type: "array", items: DAILY_PLANNER_ITEM_SCHEMA },
          evening: { type: "array", items: DAILY_PLANNER_ITEM_SCHEMA }
        },
        required: ["morning", "afternoon", "evening"],
        additionalProperties: false
      },
      deferred: {
        type: "array",
        items: DAILY_PLANNER_DEFERRED_ITEM_SCHEMA
      }
    },
    required: ["summary", "energy", "sections", "deferred"],
    additionalProperties: false
  }
};

// --- System prompt ---
function buildInstructions(oggi) {
  return `Sei il parser di FloMind. Analizza il testo dell'utente e restituisci solo il JSON richiesto dallo schema.

Data di oggi: ${oggi}

OUTPUT:
- Restituisci un oggetto con activities.
- Ogni activity deve avere tutti i campi richiesti dallo schema.
- Non restituire array legacy come azioni, scadenze o daPianificare.

CLASSIFICAZIONE OBBLIGATORIA:
1. event
- Usa event solo quando l'input contiene una data fissa e un orario di inizio fisso.
- Esempio: "dentista martedi alle 15" -> type "event", date risolta, startTime "15:00".
- Gli eventi sono blocchi fissi: flexibilityScore basso, di solito 0-20.

2. deadline
- Usa deadline quando l'input contiene una data di scadenza o un giorno in cui qualcosa accade/va consegnato, ma non contiene un orario di esecuzione fisso.
- Esempi: "esame di fisica giovedi", "consegna progetto venerdi", "bolletta entro lunedi".
- Una deadline NON e un task da schedulare. Deve influenzare l'urgenza, non diventare un blocco casuale nel calendario.
- Per deadline usa startTime null, endTime null, indicativeTimeSlot null e durationMinutes 0.

3. task
- Usa task quando e qualcosa da completare in modo flessibile.
- Esempio: "studiare fisica" -> type "task", date null, startTime null.
- Se l'utente indica solo una fascia vaga ("stasera", "domani pomeriggio", "questa settimana") senza orario fisso, resta task e usa indicativeTimeSlot quando applicabile; non inventare startTime.
- I task flessibili hanno flexibilityScore medio/alto, in base a vincoli e urgenza.

DATE E ORARI:
- Risolvi "oggi", "domani", "dopodomani" e i giorni della settimana rispetto a Data di oggi.
- Converti date esplicite in yyyy-MM-dd.
- Formatta startTime/endTime in HH:mm con zero-padding.
- Non inventare orari. Se non c'e un orario fisso, startTime deve essere null.
- Per event, se endTime non e esplicito ma la durata e stimabile, calcola endTime da startTime + durationMinutes.
- indicativeTimeSlot puo essere morning, afternoon, evening, night, flexible oppure null.

STIME E SCORE:
- durationMinutes e una stima realistica del tempo operativo per task/event. Usa 0 solo per deadline.
- Stime orientative: micro-task amministrativi 5-10, chiamate 5-15, commissioni 15-45, documenti/revisioni 20-60, allenamento/pulizie/sito 30-90, studio intenso/scrittura/presentazioni 60-120.
- importanceScore, urgencyScore, energyRequiredScore e flexibilityScore sono interi 0-100.
- urgencyScore deve crescere con la vicinanza della date/deadline: oggi o entro 2 giorni alto, 3-7 giorni medio, oltre 7 giorni basso/medio, nessuna data basso salvo parole urgenti.
- energyRequiredScore alto solo per studio intenso, scrittura, progettazione, creativita o deep work. Task pratici, telefonate, commissioni e burocrazia sono bassi o medi.
- importanceScore riflette impatto/conseguenze, non solo urgenza.
- category deve essere breve e stabile: study, health, work, admin, home, finance, personal, errand, other.
- dependencies deve contenere solo prerequisiti chiaramente inferibili dal testo. Se non sono espliciti, usa [].

PULIZIA DEL TITOLO:
- Rimuovi introduzioni come "devo", "bisogna", "ricordati di".
- Mantieni titoli brevi, naturali e senza parole appese.
- Non trasformare una deadline in un task solo per poter assegnare durata.

Rispondi SOLO con il JSON richiesto, senza testo aggiuntivo.`;
}

function classifyFlexibleReference(reference) {
  const value = String(reference || "").toLowerCase();

  if (value.includes("questa settimana")) return "settimana_corrente";
  if (value.includes("settimana prossima")) return "settimana_prossima";
  if (value.includes("tra qualche giorno") || value.includes("nei prossimi giorni")) return "prossimi_giorni";
  if (value.includes("entro il mese")) return "entro_mese";
  return "flessibile";
}

function normalizeIsoDate(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeClockTime(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = match[2] !== undefined ? Number(match[2]) : 0;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function addMinutesToClockTime(startTime, durationMinutes) {
  const normalizedStart = normalizeClockTime(startTime);
  const duration = normalizeDuration(durationMinutes, 0);
  if (!normalizedStart || duration <= 0) return null;

  const [hours, minutes] = normalizedStart.split(":").map(Number);
  const totalMinutes = (hours * 60 + minutes + duration) % (24 * 60);
  const endHours = Math.floor(totalMinutes / 60);
  const endMinutes = totalMinutes % 60;
  return `${String(endHours).padStart(2, "0")}:${String(endMinutes).padStart(2, "0")}`;
}

function normalizeIndicativeTimeSlot(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;

  if (["morning", "mattina"].includes(raw)) return "morning";
  if (["afternoon", "pomeriggio"].includes(raw)) return "afternoon";
  if (["evening", "sera", "serata"].includes(raw)) return "evening";
  if (["night", "notte"].includes(raw)) return "night";
  if (["flexible", "flessibile", "anytime", "quando ho tempo"].includes(raw)) return "flexible";
  return null;
}

function normalizeActivityCategory(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw || "other";
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];

  const dependencies = [];
  for (let i = 0; i < value.length; i++) {
    const dependency = String(value[i] || "").trim();
    if (dependency) dependencies.push(dependency);
  }
  return dependencies;
}

function legacyPriorityFromScore(score) {
  const normalized = clampInteger(score, 0, 100, 20);
  if (normalized >= 67) return "alta";
  if (normalized >= 34) return "media";
  return "bassa";
}

function legacyEnergyFromScore(score) {
  const normalized = clampInteger(score, 0, 100, 35);
  if (normalized >= 67) return "alta";
  if (normalized >= 34) return "media";
  return "bassa";
}

function legacyScoreFromPriority(priority) {
  const raw = String(priority || "").trim().toLowerCase();
  if (raw === "alta" || raw === "high") return 85;
  if (raw === "media" || raw === "medium") return 50;
  return 20;
}

function legacyScoreFromEnergy(energy) {
  const raw = String(energy || "").trim().toLowerCase();
  if (raw === "alta" || raw === "high") return 85;
  if (raw === "media" || raw === "medium") return 50;
  return 25;
}

function normalizeActivityType(source, date, startTime) {
  const rawType = getFirstString(source, ["type", "activityType", "tipo"]).toLowerCase();

  if (date && startTime) return "event";
  if (rawType === "deadline") return "deadline";
  if (rawType === "task") return "task";
  if (rawType === "event") return date ? "deadline" : "task";
  if (date && !startTime) return "deadline";
  return "task";
}

function normalizeActivity(source, index) {
  const item = source && typeof source === "object" ? source : {};
  const title = getFirstString(item, ["title", "titolo", "testo", "text", "name"]) || `Attivita ${index + 1}`;
  const date = normalizeIsoDate(getFirstString(item, ["date", "dataISO", "dueDate", "deadline"]));
  const startTime = normalizeClockTime(getFirstString(item, ["startTime", "time", "orario"]));
  const type = normalizeActivityType(item, date, startTime);
  const isDeadline = type === "deadline";
  const durationMinutes = isDeadline
    ? 0
    : normalizeDuration(getFirstNumber(item, [
      "durationMinutes",
      "durataStimataMinuti",
      "estimatedDurationMinutes",
      "minutes",
      "duration"
    ]), type === "event" ? 30 : 30);
  const explicitEndTime = normalizeClockTime(getFirstString(item, ["endTime", "fine", "end"]));
  const endTime = type === "event"
    ? explicitEndTime || addMinutesToClockTime(startTime, durationMinutes)
    : null;
  const urgencyFallback = legacyScoreFromPriority(getFirstString(item, ["priorita", "priority"]));
  const energyFallback = legacyScoreFromEnergy(getFirstString(item, ["energiaStimata", "energy", "energyLevel"]));

  return {
    type,
    title,
    date,
    startTime: type === "event" ? startTime : null,
    endTime,
    indicativeTimeSlot: type === "deadline" ? null : normalizeIndicativeTimeSlot(item.indicativeTimeSlot || item.preferredSlot || item.slotPreferito),
    durationMinutes,
    importanceScore: clampInteger(item.importanceScore, 0, 100, urgencyFallback),
    urgencyScore: clampInteger(item.urgencyScore, 0, 100, urgencyFallback),
    energyRequiredScore: clampInteger(item.energyRequiredScore, 0, 100, energyFallback),
    flexibilityScore: clampInteger(item.flexibilityScore, 0, 100, type === "task" ? 80 : 10),
    category: normalizeActivityCategory(item.category),
    dependencies: normalizeDependencies(item.dependencies)
  };
}

function buildActivitiesFromLegacyPayload(result) {
  const activities = [];
  const azioni = Array.isArray(result.azioni) ? result.azioni : [];
  const scadenze = Array.isArray(result.scadenze) ? result.scadenze : [];
  const daPianificare = Array.isArray(result.daPianificare) ? result.daPianificare : [];

  for (let i = 0; i < azioni.length; i++) {
    const action = azioni[i];
    if (!action || typeof action !== "object") continue;

    activities.push({
      type: action.dataISO && action.time ? "event" : (action.dataISO ? "deadline" : "task"),
      title: action.testo || action.titolo || "",
      date: action.dataISO || null,
      startTime: action.time || null,
      durationMinutes: action.durataStimataMinuti,
      urgencyScore: legacyScoreFromPriority(action.priorita),
      importanceScore: legacyScoreFromPriority(action.priorita),
      energyRequiredScore: legacyScoreFromEnergy(action.energiaStimata),
      category: "other",
      dependencies: []
    });
  }

  for (let i = 0; i < scadenze.length; i++) {
    const deadline = scadenze[i];
    if (!deadline || typeof deadline !== "object") continue;

    activities.push({
      type: "deadline",
      title: deadline.titolo || deadline.testo || "",
      date: deadline.dataISO || deadline.dataRisolta || null,
      durationMinutes: 0,
      urgencyScore: 70,
      importanceScore: 60,
      energyRequiredScore: 0,
      category: "other",
      dependencies: []
    });
  }

  for (let i = 0; i < daPianificare.length; i++) {
    const flexible = daPianificare[i];
    if (!flexible || typeof flexible !== "object") continue;

    activities.push({
      type: "task",
      title: flexible.titolo || "",
      date: null,
      indicativeTimeSlot: "flexible",
      durationMinutes: flexible.durataStimataMinuti,
      urgencyScore: 20,
      importanceScore: 40,
      energyRequiredScore: legacyScoreFromEnergy(flexible.energiaStimata),
      flexibilityScore: 90,
      category: "other",
      dependencies: []
    });
  }

  return activities;
}

function dedupeActivities(activities) {
  const result = [];
  const seen = new Set();

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    if (!activity || !activity.title) continue;

    const key = [
      activity.type,
      activity.title.toLowerCase(),
      activity.date || "",
      activity.startTime || ""
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    result.push(activity);
  }

  return result;
}

function normalizeAnalysisPayload(parsed) {
  const result = parsed && typeof parsed === "object" ? parsed : {};
  const activitySource = Array.isArray(result.activities)
    ? result.activities
    : buildActivitiesFromLegacyPayload(result);
  const activities = dedupeActivities(activitySource.map((activity, index) => normalizeActivity(activity, index)));
  const azioni = [];
  const scadenze = [];

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];

    if (activity.type === "deadline") {
      if (activity.date) {
        scadenze.push({
          titolo: activity.title,
          scadenzaOriginale: activity.date,
          dataISO: activity.date
        });
      }
      continue;
    }

    azioni.push({
      testo: activity.title,
      priorita: legacyPriorityFromScore(Math.max(activity.urgencyScore, activity.importanceScore)),
      scadenzaOriginale: activity.date,
      dataISO: activity.date,
      time: activity.startTime,
      durataStimataMinuti: activity.durationMinutes,
      energiaStimata: legacyEnergyFromScore(activity.energyRequiredScore),
      activityType: activity.type,
      startTime: activity.startTime,
      endTime: activity.endTime,
      indicativeTimeSlot: activity.indicativeTimeSlot,
      importanceScore: activity.importanceScore,
      urgencyScore: activity.urgencyScore,
      energyRequiredScore: activity.energyRequiredScore,
      flexibilityScore: activity.flexibilityScore,
      category: activity.category,
      dependencies: activity.dependencies
    });
  }

  const daPianificare = Array.isArray(result.daPianificare) ? result.daPianificare.slice() : [];

  result.azioni = azioni;
  result.scadenze = scadenze;
  result.daPianificare = daPianificare;
  result.activities = activities;
  return result;
}

function getFirstString(source, keys) {
  if (!source || typeof source !== "object") return "";

  for (let i = 0; i < keys.length; i++) {
    const value = source[keys[i]];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function getNestedString(source, pathKeys) {
  let current = source;

  for (let i = 0; i < pathKeys.length; i++) {
    if (!current || typeof current !== "object") return "";
    current = current[pathKeys[i]];
  }

  if (typeof current === "string" && current.trim()) return current.trim();
  if (typeof current === "number" && Number.isFinite(current)) return String(current);
  return "";
}

function getFirstNumber(source, keys) {
  if (!source || typeof source !== "object") return null;

  for (let i = 0; i < keys.length; i++) {
    const value = source[keys[i]];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function getFirstBoolean(source, keys) {
  if (!source || typeof source !== "object") return null;

  for (let i = 0; i < keys.length; i++) {
    if (typeof source[keys[i]] === "boolean") {
      return source[keys[i]];
    }
  }

  return null;
}

function normalizeDuration(value, fallback) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.max(0, Math.round(parsed));
}

function clampInteger(value, min, max, fallback) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : Number(value);

  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizePlannerPriority(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (["alta", "high", "urgent", "importante", "important"].includes(raw)) return "high";
  if (["bassa", "low"].includes(raw)) return "low";
  return "medium";
}

function normalizePlannerEnergy(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (["alta", "high", "energized", "intensa"].includes(raw)) return "high";
  if (["bassa", "low", "tired", "leggera"].includes(raw)) return "low";
  return "medium";
}

function normalizePlannerActivityTypeValue(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["task", "habit", "event", "deadline", "calendar"].includes(raw)) return raw;
  return "task";
}

function scoreFromPlannerPriority(value) {
  const priority = normalizePlannerPriority(value);
  if (priority === "high") return 85;
  if (priority === "medium") return 50;
  return 20;
}

function scoreFromPlannerEnergy(value) {
  const energy = normalizePlannerEnergy(value);
  if (energy === "high") return 85;
  if (energy === "medium") return 50;
  return 25;
}

function normalizePreference(value, allowed, fallback) {
  const raw = String(value || "").trim().toLowerCase();
  return allowed.includes(raw) ? raw : fallback;
}

function getCalendarEventDurationMinutes(event) {
  const explicitDuration = getFirstNumber(event, [
    "durationMinutes",
    "durataMinuti",
    "durataStimataMinuti",
    "estimatedDurationMinutes"
  ]);

  if (explicitDuration !== null) {
    return normalizeDuration(explicitDuration, 0);
  }

  const start = getNestedString(event, ["start", "dateTime"]) ||
    getNestedString(event, ["start", "date"]) ||
    getFirstString(event, ["start", "startTime", "dateTime"]);
  const end = getNestedString(event, ["end", "dateTime"]) ||
    getNestedString(event, ["end", "date"]) ||
    getFirstString(event, ["end", "endTime"]);

  if (!start || !end) return 0;

  const startMs = Date.parse(start);
  const endMs = Date.parse(end);

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return 0;
  }

  return Math.round((endMs - startMs) / 60000);
}

function normalizePlannerTask(task, index) {
  const title = getFirstString(task, ["title", "testo", "text", "name", "summary", "label"]);
  const priorityScore = scoreFromPlannerPriority(getFirstString(task, ["importance", "priorita", "priority"]));
  const energyScore = scoreFromPlannerEnergy(getFirstString(task, ["energy", "energiaStimata", "energyLevel"]));

  return {
    id: getFirstString(task, ["id", "taskId", "uid"]) || `task:${index + 1}`,
    type: "task",
    title: title || `Task ${index + 1}`,
    durationMinutes: normalizeDuration(getFirstNumber(task, [
      "durationMinutes",
      "durataStimataMinuti",
      "estimatedDurationMinutes",
      "minutes",
      "duration"
    ]), 30),
    importance: normalizePlannerPriority(getFirstString(task, ["importance", "priorita", "priority"])),
    energy: normalizePlannerEnergy(getFirstString(task, ["energy", "energiaStimata", "energyLevel"])),
    importanceScore: clampInteger(task && task.importanceScore, 0, 100, priorityScore),
    urgencyScore: clampInteger(task && task.urgencyScore, 0, 100, priorityScore),
    energyRequiredScore: clampInteger(task && task.energyRequiredScore, 0, 100, energyScore),
    flexibilityScore: clampInteger(task && task.flexibilityScore, 0, 100, 80),
    category: getFirstString(task, ["category", "categoria"]) || "other",
    dependencies: Array.isArray(task && task.dependencies) ? task.dependencies.map(String).filter(Boolean) : [],
    dueDate: getFirstString(task, ["dueDate", "dataISO", "date", "deadline"]),
    dueLabel: getFirstString(task, ["dueLabel", "scadenzaOriginale"]),
    time: getFirstString(task, ["time", "startTime", "orario"]),
    endTime: getFirstString(task, ["endTime", "fine"]),
    completed: getFirstBoolean(task, ["completed", "completato"]) === true,
    preferredSlot: getFirstString(task, ["preferredSlot", "slotPreferito"]),
    notes: getFirstString(task, ["notes", "description", "descrizione"]),
    relatedDeadlineTitle: getFirstString(task, ["relatedDeadlineTitle"]),
    relatedDeadlineISO: getFirstString(task, ["relatedDeadlineISO"])
  };
}

function normalizePlannerHabit(habit, index) {
  const title = getFirstString(habit, ["title", "testo", "text", "name", "summary", "label"]);
  const fixedSchedule = getFirstBoolean(habit, ["fixedSchedule", "fixed", "hasFixedTime"]) === true;
  const priorityScore = scoreFromPlannerPriority(getFirstString(habit, ["importance", "priorita", "priority"]));
  const energyScore = scoreFromPlannerEnergy(getFirstString(habit, ["energy", "energiaStimata", "energyLevel"]));

  return {
    id: getFirstString(habit, ["id", "habitId", "uid"]) || `habit:${index + 1}`,
    type: "habit",
    title: title || `Habit ${index + 1}`,
    durationMinutes: normalizeDuration(getFirstNumber(habit, [
      "durationMinutes",
      "durataStimataMinuti",
      "estimatedDurationMinutes",
      "fixedDurationMinutes",
      "minutes",
      "duration"
    ]), 20),
    importance: normalizePlannerPriority(getFirstString(habit, ["importance", "priorita", "priority"])),
    energy: normalizePlannerEnergy(getFirstString(habit, ["energy", "energiaStimata", "energyLevel"])),
    importanceScore: clampInteger(habit && habit.importanceScore, 0, 100, priorityScore),
    urgencyScore: clampInteger(habit && habit.urgencyScore, 0, 100, priorityScore),
    energyRequiredScore: clampInteger(habit && habit.energyRequiredScore, 0, 100, energyScore),
    flexibilityScore: clampInteger(habit && habit.flexibilityScore, 0, 100, fixedSchedule ? 0 : 65),
    category: getFirstString(habit, ["category", "categoria"]) || "habit",
    dependencies: Array.isArray(habit && habit.dependencies) ? habit.dependencies.map(String).filter(Boolean) : [],
    frequency: getFirstString(habit, ["frequency", "frequenza"]),
    completed: getFirstBoolean(habit, ["completed", "completedToday", "completato"]) === true,
    completedToday: getFirstBoolean(habit, ["completedToday", "completed", "completato"]) === true,
    fixedSchedule,
    time: getFirstString(habit, ["time", "fixedStartTime", "startTime", "orario"]),
    preferredSlot: getFirstString(habit, ["preferredSlot", "slotPreferito"])
  };
}

function normalizePlannerCalendarEvent(event, index) {
  const start = getNestedString(event, ["start", "dateTime"]) ||
    getNestedString(event, ["start", "date"]) ||
    getFirstString(event, ["start", "startTime", "dateTime"]);
  const end = getNestedString(event, ["end", "dateTime"]) ||
    getNestedString(event, ["end", "date"]) ||
    getFirstString(event, ["end", "endTime"]);
  const title = getFirstString(event, ["title", "summary", "name", "text", "label"]);
  const transparency = getFirstString(event, ["transparency", "availability"]);

  return {
    id: getFirstString(event, ["id", "eventId", "uid"]) || `calendar:${index + 1}`,
    type: "calendar",
    title: title || `Calendar event ${index + 1}`,
    start,
    end,
    durationMinutes: getCalendarEventDurationMinutes(event),
    allDay: Boolean(getNestedString(event, ["start", "date"]) && !getNestedString(event, ["start", "dateTime"])),
    busy: transparency.toLowerCase() !== "transparent" && transparency.toLowerCase() !== "free",
    location: getFirstString(event, ["location", "luogo"])
  };
}

function normalizePlannerActivity(activity, index) {
  const source = activity && typeof activity === "object" ? activity : {};
  const title = getFirstString(source, ["title", "testo", "text", "name", "summary", "label"]) || `Activity ${index + 1}`;
  const type = normalizePlannerActivityTypeValue(getFirstString(source, ["type", "activityType", "tipo"]));
  const priorityScore = scoreFromPlannerPriority(getFirstString(source, ["importance", "priorita", "priority"]));
  const energyScore = scoreFromPlannerEnergy(getFirstString(source, ["energy", "energiaStimata", "energyLevel"]));
  const date = getFirstString(source, ["date", "dataISO", "dueDate", "deadline"]);
  const startTime = getFirstString(source, ["startTime", "time", "orario"]);
  const normalizedType = type === "task" && date && startTime ? "event" : type;

  return {
    id: getFirstString(source, ["id", "activityId", "taskId", "habitId", "uid"]) || `activity:${index + 1}`,
    type: normalizedType,
    title,
    date: date || null,
    startTime: startTime || null,
    endTime: getFirstString(source, ["endTime", "fine"]) || null,
    indicativeTimeSlot: getFirstString(source, ["indicativeTimeSlot", "preferredSlot", "slotPreferito"]) || null,
    durationMinutes: normalizedType === "deadline" ? 0 : normalizeDuration(getFirstNumber(source, [
      "durationMinutes",
      "durataStimataMinuti",
      "estimatedDurationMinutes",
      "minutes",
      "duration"
    ]), normalizedType === "habit" ? 20 : 30),
    importanceScore: clampInteger(source.importanceScore, 0, 100, priorityScore),
    urgencyScore: clampInteger(source.urgencyScore, 0, 100, priorityScore),
    energyRequiredScore: clampInteger(source.energyRequiredScore, 0, 100, energyScore),
    flexibilityScore: clampInteger(source.flexibilityScore, 0, 100, normalizedType === "task" ? 80 : 10),
    category: getFirstString(source, ["category", "categoria"]) || "other",
    dependencies: Array.isArray(source.dependencies) ? source.dependencies.map(String).filter(Boolean) : [],
    completed: getFirstBoolean(source, ["completed", "completato"]) === true,
    completedToday: getFirstBoolean(source, ["completedToday", "completed", "completato"]) === true,
    relatedDeadlineTitle: getFirstString(source, ["relatedDeadlineTitle"]) || null,
    relatedDeadlineISO: getFirstString(source, ["relatedDeadlineISO"]) || null
  };
}

function buildDailyPlannerInput(body) {
  const payload = body && typeof body === "object" ? body : {};
  const preferences = payload.preferences && typeof payload.preferences === "object" ? payload.preferences : {};

  return {
    today: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" }),
    locale: getFirstString(payload, ["locale"]) || "it-IT",
    preferences: {
      energy: normalizePreference(preferences.energy, ["tired", "normal", "energized"], "normal"),
      availableTime: normalizePreference(preferences.availableTime, ["short", "medium", "full"], "medium"),
      mainFocus: normalizePreference(preferences.mainFocus, ["work", "health", "study", "personal", "balanced"], "balanced")
    },
    activities: (Array.isArray(payload.activities) ? payload.activities : []).map(normalizePlannerActivity),
    tasks: (Array.isArray(payload.tasks) ? payload.tasks : []).map(normalizePlannerTask),
    habits: (Array.isArray(payload.habits) ? payload.habits : []).map(normalizePlannerHabit),
    calendarEvents: (Array.isArray(payload.calendarEvents) ? payload.calendarEvents : []).map(normalizePlannerCalendarEvent)
  };
}

function buildDailyPlannerInstructions(locale) {
  return `You are a smart daily planning engine for FloMind.

Return only the strict JSON object requested by the schema. Do not include markdown or prose outside JSON.

User language:
- Write summary.label, summary.reason, every scheduled item.why and every deferred item.whyDeferred in the user's language inferred from locale "${locale}".
- If locale starts with "it", use natural Italian.

Input model:
- Prefer input.activities when present. Each activity has type: event, deadline, task, habit, or calendar.
- tasks, habits and calendarEvents are legacy-compatible inputs. Treat them with the same rules.

Hard rules:
- Never schedule completed activities.
- Never schedule habits already completed today.
- Never schedule future activities unless their date is today.
- Never schedule deadlines as normal tasks. Do not output type "deadline". A deadline only increases urgency of clearly related tasks.
- Events are fixed blocks and cannot move.
- Busy calendar events are fixed occupied blocks and cannot move.
- Do not overlap tasks with events or calendar blocks.

Planning rules:
- Output sections.morning, sections.afternoon, sections.evening, and deferred.
- Morning is before 12:00, afternoon is 12:00-17:59, evening is 18:00 or later.
- Calendar events with explicit start/end times define occupied capacity. If a calendar event spans sections, place it where it starts and keep later capacity realistic.
- Fixed events, fixed-time tasks and fixed-schedule habits stay in their natural section; defer movable work that conflicts with them.
- High urgency + high importance comes first.
- High energy tasks should be earlier in the day when preferences.energy allows it.
- Low energy tasks fit better later.
- Flexible tasks can move.
- Deadlines increase urgency of related tasks, especially when due today or very soon.
- Respect preferences.energy: tired means lighter load and fewer high-energy items, normal means balanced, energized means high-energy work can be planned earlier.
- Respect preferences.availableTime: short means about 1-2h, medium about 2-4h, full allows a fuller day with margin.
- Respect preferences.mainFocus by favoring matching tasks or habits when choosing among similar items.
- Habits should support the day, not crowd out urgent or important tasks.
- Put useful but non-essential or conflicting items in deferred.
- Include fixed calendar items in sections with type "calendar".
- Use the exact item id from the input. Never invent an id when an input id exists.
- Scheduled items must explain why they were chosen in why.
- Deferred items must explain why they were deferred in whyDeferred.
- durationMinutes must be realistic and non-negative.
- summary.score is 0-100 and reflects how balanced and achievable the plan is.`;
}

function normalizePlanItem(item, fallbackType) {
  const source = item && typeof item === "object" ? item : {};
  const type = ["task", "habit", "event", "calendar"].includes(source.type) ? source.type : fallbackType;

  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id.trim() : crypto.randomUUID(),
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Elemento pianificato",
    durationMinutes: normalizeDuration(source.durationMinutes, 0),
    type: type || "task",
    why: typeof source.why === "string" && source.why.trim() ? source.why.trim() : "Inserito nel piano della giornata."
  };
}

function normalizeDeferredPlanItem(item, fallbackType) {
  const source = item && typeof item === "object" ? item : {};
  const type = ["task", "habit", "event", "calendar"].includes(source.type) ? source.type : fallbackType;

  return {
    id: typeof source.id === "string" && source.id.trim() ? source.id.trim() : crypto.randomUUID(),
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Elemento rimandato",
    durationMinutes: normalizeDuration(source.durationMinutes, 0),
    type: type || "task",
    whyDeferred: typeof source.whyDeferred === "string" && source.whyDeferred.trim()
      ? source.whyDeferred.trim()
      : (typeof source.why === "string" && source.why.trim() ? source.why.trim() : "Rimandato per rendere il piano sostenibile.")
  };
}

function normalizeDailyPlannerPayload(parsed) {
  const source = parsed && typeof parsed === "object" ? parsed : {};
  const summary = source.summary && typeof source.summary === "object" ? source.summary : {};
  const energy = source.energy && typeof source.energy === "object" ? source.energy : {};
  const sections = source.sections && typeof source.sections === "object" ? source.sections : {};

  return {
    summary: {
      label: typeof summary.label === "string" && summary.label.trim() ? summary.label.trim() : "Giornata equilibrata",
      score: clampInteger(summary.score, 0, 100, 70),
      reason: typeof summary.reason === "string" && summary.reason.trim() ? summary.reason.trim() : "Piano creato con carico sostenibile."
    },
    energy: {
      morning: clampInteger(energy.morning, 0, 100, 80),
      afternoon: clampInteger(energy.afternoon, 0, 100, 60),
      evening: clampInteger(energy.evening, 0, 100, 35)
    },
    sections: {
      morning: (Array.isArray(sections.morning) ? sections.morning : []).map((item) => normalizePlanItem(item, "task")),
      afternoon: (Array.isArray(sections.afternoon) ? sections.afternoon : []).map((item) => normalizePlanItem(item, "task")),
      evening: (Array.isArray(sections.evening) ? sections.evening : []).map((item) => normalizePlanItem(item, "task"))
    },
    deferred: (Array.isArray(source.deferred) ? source.deferred : []).map((item) => normalizeDeferredPlanItem(item, "task"))
  };
}

function hasInvalidPlannerArrays(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return true;
  if (
    body.preferences !== undefined &&
    (!body.preferences || typeof body.preferences !== "object" || Array.isArray(body.preferences))
  ) {
    return true;
  }

  return (body.activities !== undefined && !Array.isArray(body.activities)) ||
    (body.tasks !== undefined && !Array.isArray(body.tasks)) ||
    (body.habits !== undefined && !Array.isArray(body.habits)) ||
    (body.calendarEvents !== undefined && !Array.isArray(body.calendarEvents));
}

// --- Route POST /plan-day ---
app.post("/plan-day", async (req, res) => {
  if (hasInvalidPlannerArrays(req.body)) {
    return res.status(400).json({ error: "Body non valido: activities, tasks, habits e calendarEvents devono essere array." });
  }

  if (!req.currentUser || req.currentUser.plan !== "pro") {
    return res.status(403).json({ error: "Il planner AI e' disponibile solo con il piano Pro." });
  }

  const plannerInput = buildDailyPlannerInput(req.body || {});

  try {
    const response = await openai.responses.create({
      model: MODEL,
      instructions: buildDailyPlannerInstructions(plannerInput.locale),
      input: JSON.stringify(plannerInput),
      text: {
        format: DAILY_PLANNER_SCHEMA
      },
      temperature: 0.2,
      store: false
    });

    const parsed = normalizeDailyPlannerPayload(JSON.parse(response.output_text));
    return res.json(parsed);
  } catch (err) {
    console.error("[FloMind] Errore OpenAI planner:", err.message || err);
    return res.status(500).json({ error: "Impossibile generare il piano giornaliero." });
  }
});

// --- Route POST /api/analyze ---
app.post("/api/analyze", async (req, res) => {
  const { testo } = req.body;

  if (!testo || typeof testo !== "string" || testo.trim() === "") {
    return res.status(400).json({ error: "Il campo 'testo' è obbligatorio." });
  }

  // Data di oggi timezone-safe (Roma / Europe)
  const oggi = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });

  try {
    const response = await openai.responses.create({
      model: MODEL,
      instructions: buildInstructions(oggi),
      input: testo.trim(),
      text: {
        format: ANALYSIS_SCHEMA
      },
      temperature: 0.2,
      store: false
    });

    const output = response.output_text;
    const parsed = normalizeAnalysisPayload(JSON.parse(output));

    // Aggiunge id univoco a ogni attivita, azione e scadenza
    if (Array.isArray(parsed.activities)) {
      for (let i = 0; i < parsed.activities.length; i++) {
        parsed.activities[i].id = crypto.randomUUID();
      }
    }
    if (Array.isArray(parsed.azioni)) {
      for (let i = 0; i < parsed.azioni.length; i++) {
        parsed.azioni[i].id = crypto.randomUUID();
      }
    }
    if (Array.isArray(parsed.scadenze)) {
      for (let i = 0; i < parsed.scadenze.length; i++) {
        parsed.scadenze[i].id = crypto.randomUUID();
      }
    }
    if (Array.isArray(parsed.daPianificare)) {
      for (let i = 0; i < parsed.daPianificare.length; i++) {
        parsed.daPianificare[i].id = crypto.randomUUID();
      }
    }

    return res.json(parsed);
  } catch (err) {
    console.error("[FloMind] Errore OpenAI:", err.message || err);

    if (err instanceof OpenAI.APIError) {
      return res.status(err.status || 502).json({
        error: "Errore API OpenAI",
        dettaglio: err.message
      });
    }

    return res.status(500).json({ error: "Errore interno del server." });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

// --- Avvio server ---
function printRegisteredRoutes() {
  function visitStack(stack, prefix) {
    if (!Array.isArray(stack)) return;

    for (const layer of stack) {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods || {})
          .filter((method) => layer.route.methods[method])
          .map((method) => method.toUpperCase())
          .join(",");
        console.log("[ROUTE]", methods, `${prefix}${layer.route.path}`);
        continue;
      }

      if (layer.name === "router" && layer.handle && Array.isArray(layer.handle.stack)) {
        let nextPrefix = prefix;

        if (layer.regexp && layer.regexp.fast_slash !== true) {
          const match = String(layer.regexp).match(/\\\/([^\\]+)\\\/\?\(\?=\\\/\|\$\)\/i/);
          if (match && match[1]) {
            nextPrefix += "/" + match[1].replace(/\\\//g, "/");
          }
        }

        visitStack(layer.handle.stack, nextPrefix);
      }
    }
  }

  const rootStack = (app.router && app.router.stack) || (app._router && app._router.stack) || [];
  console.log("[DEBUG] Registered routes:");
  visitStack(rootStack, "");
}

app.listen(PORT, () => {
  printRegisteredRoutes();
  console.log(`[FloMind] Server avviato su http://localhost:${PORT}`);
});
