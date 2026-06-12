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
      azioni: {
        type: "array",
        items: {
          type: "object",
          properties: {
            testo: { type: "string", description: "Azione pulita e concisa, es. 'Pagare la fattura'" },
            priorita: { type: "string", enum: ["alta", "media", "bassa"], description: "alta = entro 2 giorni, media = 3-7 giorni, bassa = oltre 7 o senza scadenza" },
            scadenzaOriginale: { type: ["string", "null"], description: "Riferimento temporale così come scritto dall'utente, es. 'domani', '30 aprile'. null se assente." },
            dataISO: { type: ["string", "null"], description: "Data in formato ISO yyyy-MM-dd calcolata dal riferimento. null se non determinabile." },
            time: { type: ["string", "null"], description: "Orario estratto in formato HH:mm (24h), es. '16:00', '09:30'. null se assente." },
            durataStimataMinuti: { type: "integer", description: "Stima pratica e realistica della durata dell'azione in minuti interi." },
            energiaStimata: { type: "string", enum: ["bassa", "media", "alta"], description: "Livello di energia mentale richiesto dall'azione." }
          },
          required: ["testo", "priorita", "scadenzaOriginale", "dataISO", "time", "durataStimataMinuti", "energiaStimata"],
          additionalProperties: false
        }
      },
      scadenze: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titolo: { type: "string", description: "Breve descrizione dell'impegno con scadenza" },
            scadenzaOriginale: { type: "string", description: "Riferimento temporale originale" },
            dataISO: { type: ["string", "null"], description: "Data calcolata in formato ISO yyyy-MM-dd" }
          },
          required: ["titolo", "scadenzaOriginale", "dataISO"],
          additionalProperties: false
        }
      },
      daPianificare: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titolo: { type: "string", description: "Breve descrizione dell'attivita con riferimento temporale flessibile" },
            riferimentoTemporale: { type: "string", description: "Riferimento temporale vago originale, es. 'questa settimana'" },
            tipoFlessibilita: {
              type: "string",
              enum: ["settimana_corrente", "settimana_prossima", "prossimi_giorni", "entro_mese", "flessibile"],
              description: "Classificazione del livello di flessibilita temporale"
            },
            durataStimataMinuti: { type: "integer", description: "Stima pratica e realistica della durata dell'attivita in minuti interi." },
            energiaStimata: { type: "string", enum: ["bassa", "media", "alta"], description: "Livello di energia mentale richiesto dall'attivita." }
          },
          required: ["titolo", "riferimentoTemporale", "tipoFlessibilita", "durataStimataMinuti", "energiaStimata"],
          additionalProperties: false
        }
      }
    },
    required: ["azioni", "scadenze", "daPianificare"],
    additionalProperties: false
  }
};

// --- System prompt ---
function buildInstructions(oggi) {
  return `Sei un assistente che analizza testi in italiano ed estrae azioni (task/to-do) e scadenze.

Data di oggi: ${oggi}

REGOLE PER LE AZIONI:
- Estrai ogni singola azione/task presente nel testo.
- Ogni azione deve avere un testo pulito e conciso (verbo all'infinito + oggetto).
- Rimuovi introduzioni come "devo", "bisogna", "ricordati di".
- Non lasciare frammenti sporchi o parole appese alla fine (articoli, preposizioni).

REGOLE PER LE STIME:
- Per ogni azione stima durataStimataMinuti come numero intero realistico e pratico.
- Preferisci stime conservative e credibili: non gonfiare la durata se il task sembra piccolo o operativo.
- Se il task e semplice o chiaramente eseguibile in poco tempo, usa una stima bassa invece di allargarla inutilmente.
- Usa stime concrete basate sul tipo di attività. Esempi orientativi:
  - pagare una fattura, inviare un documento, prenotare qualcosa: 5-10 minuti
  - chiamare qualcuno: 5-15 minuti
  - pagare una fattura o svolgere un micro-task amministrativo: 5-10 minuti
  - rispondere a una singola email o messaggio importante: 5-15 minuti
  - andare al supermercato o organizzare foto: 15-45 minuti
  - leggere o rivedere un documento: 20-40 minuti
  - aggiornare il CV, rispondere a molte email, sistemare il sito, allenarsi, pulizia casa: 30-90 minuti
  - scrivere un documento importante: 60-120 minuti
  - preparare slide o presentazioni: 60-120 minuti
- Se l'attività è ampia, articolata o creativa, assegna una durata più alta.
- Se il testo descrive un'attività generica ma non enorme, evita di superare 60 minuti senza una ragione chiara.
- Usa durate più alte solo se il task implica lavoro profondo, produzione originale, studio intenso, progettazione o più fasi.
- Non sommare automaticamente tempo di contesto, procrastinazione o pause: stima il tempo operativo reale del task.
- Se il task è ambiguo, scegli una stima media-realistica invece di una stima massima.
- energiaStimata deve essere:
  - bassa: task semplice, veloce, meccanico, amministrativo o poco impegnativo. Usa bassa come default per task pratici e quotidiani. Esempi: pagare fattura, chiamare qualcuno, andare al supermercato, organizzare foto, piccoli task amministrativi.
  - media: task che richiede attenzione, continuità o un minimo di sforzo mentale ma non deep work. Esempi: rivedere un documento, aggiornare il CV, rispondere a molte email, sistemare il sito, allenarsi, pulizia casa.
  - alta: deve essere rara. Usala solo per task cognitivamente intensi, creativi, strategici o complessi, tipici di deep work. Esempi: preparare una presentazione importante, lavorare a un progetto complesso, scrivere un documento importante, studio intenso.
- NON assegnare energia alta a task amministrativi, commissioni, telefonate, pulizia, spesa, riordino, email, aggiornamenti ordinari o revisioni leggere.
- In caso di dubbio tra media e alta, scegli media.
- In caso di dubbio tra bassa e media, scegli bassa per task pratici o meccanici e media solo se serve vera attenzione prolungata.
- Non usare 0 minuti e non lasciare campi mancanti.

REGOLE PER LE PRIORITÀ:
- alta: la scadenza è entro 2 giorni da oggi (incluso oggi)
- media: la scadenza è tra 3 e 7 giorni da oggi (inclusi)
- bassa: la scadenza è oltre 7 giorni oppure non c'è nessuna scadenza

REGOLE PER LE SCADENZE:
- Estrai ogni coppia azione-scadenza trovata.
- L'array scadenze deve contenere SOLO scadenze precise e risolvibili in un giorno preciso.
- Se il testo dice "oggi", "domani" o "dopodomani", restituisci una dataISO precisa coerente con la data di oggi.
- Se il testo dice un giorno preciso della settimana (lunedi, martedi, mercoledi, giovedi, venerdi, sabato, domenica), restituisci una dataISO precisa coerente con la data di oggi.
- Se il testo contiene una data esplicita (es. "30 aprile"), convertila in formato ISO.
- Se il riferimento temporale e troppo vago o non identifica un solo giorno preciso, NON inserirlo in scadenze.
- I riferimenti vaghi devono andare nell'array daPianificare con: titolo, riferimentoTemporale e tipoFlessibilita.
- Ogni elemento di daPianificare deve includere anche durataStimataMinuti ed energiaStimata.
- Esempi di riferimenti vaghi che NON devono comparire in scadenze: "questa settimana", "settimana prossima", "tra qualche giorno", "quando ho tempo", "piu avanti", "entro il mese", "nei prossimi giorni".
- Usa questi valori per tipoFlessibilita:
  - settimana_corrente: per "questa settimana"
  - settimana_prossima: per "settimana prossima"
  - prossimi_giorni: per "tra qualche giorno" o "nei prossimi giorni"
  - entro_mese: per "entro il mese"
  - flessibile: per "quando ho tempo", "piu avanti" o riferimenti simili
- Non trasformare riferimenti vaghi in "oggi" per default.
- Non inventare scadenze: se un'azione non ha una scadenza, scadenzaOriginale e dataISO devono essere null nell'azione e l'azione non deve comparire nell'array scadenze.
- Restituisci sempre tutti e tre gli array: azioni, scadenze, daPianificare. Se una sezione e vuota, restituisci un array vuoto.

REGOLE PER GLI ORARI:
- Estrai l'orario se presente nella frase e compilalo nel campo time dell'azione.
- Formato obbligatorio di time: HH:mm (24 ore), con zero-padding.
- Esempi: "alle 16" -> "16:00", "alle 9" -> "09:00", "alle 16:30" -> "16:30".
- Frasi come "oggi pomeriggio alle 17" devono mantenere sia il riferimento temporale nella scadenza sia time = "17:00".
- Se nella frase non è presente un orario esplicito, imposta time = null.
- Non inventare orari: evita default automatici se non esplicitamente presenti nel testo.

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

function normalizeAnalysisPayload(parsed) {
  const result = parsed && typeof parsed === "object" ? parsed : {};
  const azioni = Array.isArray(result.azioni) ? result.azioni : [];
  const scadenzeSource = Array.isArray(result.scadenze) ? result.scadenze : [];
  const daPianificare = Array.isArray(result.daPianificare) ? result.daPianificare.slice() : [];
  const scadenze = [];

  for (let i = 0; i < scadenzeSource.length; i++) {
    const item = scadenzeSource[i];
    if (!item || typeof item !== "object") continue;

    if (item.dataISO) {
      scadenze.push(item);
      continue;
    }

    const titolo = item.titolo || "";
    const riferimentoTemporale = item.scadenzaOriginale || "";
    let matchedAction = null;

    for (let j = 0; j < azioni.length; j++) {
      if (azioni[j] && azioni[j].testo === titolo) {
        matchedAction = azioni[j];
        break;
      }
    }

    daPianificare.push({
      titolo,
      riferimentoTemporale,
      tipoFlessibilita: classifyFlexibleReference(riferimentoTemporale),
      durataStimataMinuti: matchedAction && Number.isInteger(matchedAction.durataStimataMinuti)
        ? matchedAction.durataStimataMinuti
        : 30,
      energiaStimata: matchedAction && typeof matchedAction.energiaStimata === "string"
        ? matchedAction.energiaStimata
        : "media",
    });
  }

  result.azioni = azioni;
  result.scadenze = scadenze;
  result.daPianificare = daPianificare;
  return result;
}

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

    // Aggiunge id univoco a ogni azione e scadenza
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
