const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// --- Caricamento variabili d'ambiente ---
const envPath = path.join(__dirname, "key.env");
const hasLocalEnvFile = fs.existsSync(envPath);

if (hasLocalEnvFile) {
  const dotenvResult = dotenv.config({ path: envPath });

  if (dotenvResult.error) {
    console.warn("[ActionFlow] key.env trovato ma non caricato correttamente da %s", envPath);
    console.warn("[ActionFlow] Dettaglio:", dotenvResult.error.message);
  } else {
    console.log("[ActionFlow] key.env caricato da %s", envPath);
  }
} else {
  console.log("[ActionFlow] key.env non trovato in %s, uso solo variabili d'ambiente.", envPath);
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
  "[ActionFlow] OPENAI_API_KEY presente: %s | lunghezza: %d | preview: %s",
  OPENAI_API_KEY ? "si" : "no",
  OPENAI_API_KEY.length,
  maskApiKey(OPENAI_API_KEY)
);

if (!OPENAI_API_KEY) {
  console.error("[ActionFlow] ERRORE: OPENAI_API_KEY non trovata o vuota nelle variabili d'ambiente. Avvio bloccato.");
  process.exit(1);
}

const express = require("express");
const OpenAI = require("openai").default;
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const PROJECT_ROOT = __dirname;

// --- Middleware ---
app.use(express.json());
app.use(express.static(PROJECT_ROOT));

// --- Frontend routes ---
app.get("/", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "index.html"));
});

app.get("/focus", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "focus.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(PROJECT_ROOT, "dashboard.html"));
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
            durataStimataMinuti: { type: "integer", description: "Stima pratica e realistica della durata dell'azione in minuti interi." },
            energiaStimata: { type: "string", enum: ["bassa", "media", "alta"], description: "Livello di energia mentale richiesto dall'azione." }
          },
          required: ["testo", "priorita", "scadenzaOriginale", "dataISO", "durataStimataMinuti", "energiaStimata"],
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
      }
    },
    required: ["azioni", "scadenze"],
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
- Se il testo dice "oggi", "domani" o "dopodomani", restituisci una dataISO precisa coerente con la data di oggi.
- Se il testo dice un giorno preciso della settimana (lunedi, martedi, mercoledi, giovedi, venerdi, sabato, domenica), restituisci una dataISO precisa coerente con la data di oggi.
- Se il testo contiene una data esplicita (es. "30 aprile"), convertila in formato ISO.
- Se il riferimento temporale e troppo vago o non identifica un solo giorno preciso, NON inventare una data. In questi casi mantieni scadenzaOriginale e usa dataISO = null.
- Esempi di riferimenti vaghi che non devono produrre una data precisa se il giorno non e determinabile con sicurezza: "questa settimana", "settimana prossima", "piu avanti", "entro il mese", "nei prossimi giorni".
- Non trasformare riferimenti vaghi in "oggi" per default.
- Non inventare scadenze: se un'azione non ha una scadenza, scadenzaOriginale e dataISO devono essere null nell'azione e l'azione non deve comparire nell'array scadenze.

Rispondi SOLO con il JSON richiesto, senza testo aggiuntivo.`;
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
    const parsed = JSON.parse(output);

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

    return res.json(parsed);
  } catch (err) {
    console.error("[ActionFlow] Errore OpenAI:", err.message || err);

    if (err instanceof OpenAI.APIError) {
      return res.status(err.status || 502).json({
        error: "Errore API OpenAI",
        dettaglio: err.message
      });
    }

    return res.status(500).json({ error: "Errore interno del server." });
  }
});

// --- Avvio server ---
app.listen(PORT, () => {
  console.log(`[ActionFlow] Server avviato su http://localhost:${PORT}`);
});
