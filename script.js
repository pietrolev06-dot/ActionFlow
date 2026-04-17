// Migrazione chiavi localStorage da drop2action → actionflow
(function migraLocalStorage() {
  var mappa = [
    ["drop2action_checklist", "actionflow_checklist"],
    ["drop2action_scadenze", "actionflow_scadenze"],
    ["drop2action_archivio_azioni", "actionflow_archivio_azioni"],
    ["drop2action_archivio_scadenze", "actionflow_archivio_scadenze"],
    ["drop2action_azioni_done", "actionflow_azioni_done"],
    ["drop2action_profilo", "actionflow_profilo"]
  ];
  for (var i = 0; i < mappa.length; i++) {
    var vecchia = mappa[i][0], nuova = mappa[i][1];
    if (!localStorage.getItem(nuova) && localStorage.getItem(vecchia)) {
      localStorage.setItem(nuova, localStorage.getItem(vecchia));
    }
  }
})();

// Stato corrente della sessione (per modifica inline)
var azioniCorrente = [];
var scadenzeCorrente = [];
var daPianificareCorrente = [];
var voiceRecognition = null;
var voiceInputAttivo = false;
var voiceBaseText = "";
var voiceFinalTranscript = "";
var voiceInterimTranscript = "";
var voiceShouldRestart = false;
var voiceStoppingManually = false;
var voiceStatus = "idle";
var DAILY_PLAN_STORAGE_KEY = "actionflow_daily_plan";
var DAILY_PLAN_DEFAULT_DURATION = 30;
var DAILY_PLAN_MAX_TASKS = 4;
var DAILY_PLAN_MAX_SLOT_MINUTES = 180;
var DAILY_PLAN_DEBUG = true;
var ANALYSIS_PREVIEW_MAX_ITEMS = 6;
var pendingAnalysisResult = null;

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getTaskNormalizedDate(task) {
  return task && task.dataISO ? String(task.dataISO).trim() : "";
}

function getScadenzaNormalizedDate(scadenza) {
  if (!scadenza) return "";
  if (scadenza.dataRisolta) return String(scadenza.dataRisolta).trim();
  if (scadenza.dataISO) return String(scadenza.dataISO).trim();
  return normalizeText(scadenza.data || "");
}

function mergeTaskRecords(existingTask, incomingTask) {
  var existing = normalizzaAzioneSalvata(existingTask);
  var incoming = normalizzaAzioneSalvata(incomingTask);
  var merged = normalizzaAzioneSalvata(existing);
  var existingPriority = livelloPriorita(existing.priorita || "bassa");
  var incomingPriority = livelloPriorita(incoming.priorita || "bassa");

  merged.testo = incoming.testo || existing.testo;
  merged.priorita = incomingPriority > existingPriority ? incoming.priorita : existing.priorita;
  merged.scadenzaOriginale = incoming.scadenzaOriginale || existing.scadenzaOriginale || null;
  merged.dataISO = incoming.dataISO || existing.dataISO || null;
  merged.time = incoming.time || existing.time || null;
  merged.durataStimataMinuti = normalizzaDurataStimata(incoming.durataStimataMinuti);
  if (merged.durataStimataMinuti === null) {
    merged.durataStimataMinuti = normalizzaDurataStimata(existing.durataStimataMinuti);
  }
  merged.energiaStimata = normalizzaEnergiaStimata(incoming.energiaStimata) || normalizzaEnergiaStimata(existing.energiaStimata);

  if (existingTask && existingTask.aggiunta) merged.aggiunta = existingTask.aggiunta;
  if (incomingTask && incomingTask.aggiunta && !merged.aggiunta) merged.aggiunta = incomingTask.aggiunta;
  if (existingTask && existingTask.id) merged.id = existingTask.id;
  if (incomingTask && incomingTask.id && !merged.id) merged.id = incomingTask.id;
  if ((existingTask && existingTask.completato === true) || (incomingTask && incomingTask.completato === true)) {
    merged.completato = true;
  }
  if (existingTask && existingTask.completedAt) merged.completedAt = existingTask.completedAt;
  if (incomingTask && incomingTask.completedAt) merged.completedAt = incomingTask.completedAt;
  if ((existingTask && existingTask.syncedToCalendar === true) || (incomingTask && incomingTask.syncedToCalendar === true)) {
    merged.syncedToCalendar = true;
  }

  return merged;
}

function areTasksDuplicate(taskA, taskB) {
  var textA = normalizeText(taskA && taskA.testo ? taskA.testo : "");
  var textB = normalizeText(taskB && taskB.testo ? taskB.testo : "");
  var dateA = getTaskNormalizedDate(taskA);
  var dateB = getTaskNormalizedDate(taskB);

  if (!textA || !textB || textA !== textB) return false;
  if (dateA && dateB) return dateA === dateB;
  return true;
}

function isDuplicateTask(task, existingTasks) {
  for (var i = 0; i < existingTasks.length; i++) {
    if (areTasksDuplicate(task, existingTasks[i])) return true;
  }
  return false;
}

function dedupeTasks(tasks) {
  var source = Array.isArray(tasks) ? tasks : [];
  var deduped = [];

  for (var i = 0; i < source.length; i++) {
    var normalizedTask = normalizzaAzioneSalvata(source[i]);
    var merged = false;

    if (!normalizedTask.testo) continue;

    for (var j = 0; j < deduped.length; j++) {
      if (areTasksDuplicate(normalizedTask, deduped[j])) {
        deduped[j] = mergeTaskRecords(deduped[j], source[i]);
        merged = true;
        break;
      }
    }

    if (!merged) {
      deduped.push(mergeTaskRecords({}, source[i]));
    }
  }

  return deduped;
}

function mergeScadenzaRecords(existingDeadline, incomingDeadline) {
  var merged = {
    testo: (incomingDeadline && incomingDeadline.testo) || (existingDeadline && existingDeadline.testo) || "",
    data: (incomingDeadline && incomingDeadline.data) || (existingDeadline && existingDeadline.data) || "",
    dataRisolta: (incomingDeadline && incomingDeadline.dataRisolta) || (incomingDeadline && incomingDeadline.dataISO) || (existingDeadline && existingDeadline.dataRisolta) || (existingDeadline && existingDeadline.dataISO) || null,
    userId: (incomingDeadline && incomingDeadline.userId) || (existingDeadline && existingDeadline.userId) || null
  };

  if (existingDeadline && existingDeadline.aggiunta) merged.aggiunta = existingDeadline.aggiunta;
  if (incomingDeadline && incomingDeadline.aggiunta && !merged.aggiunta) merged.aggiunta = incomingDeadline.aggiunta;

  return merged;
}

function areScadenzeDuplicate(scadenzaA, scadenzaB) {
  var textA = normalizeText(scadenzaA && scadenzaA.testo ? scadenzaA.testo : "");
  var textB = normalizeText(scadenzaB && scadenzaB.testo ? scadenzaB.testo : "");
  var dateA = getScadenzaNormalizedDate(scadenzaA);
  var dateB = getScadenzaNormalizedDate(scadenzaB);

  if (!textA || !textB || textA !== textB) return false;
  if (!dateA || !dateB) return dateA === dateB;
  return dateA === dateB;
}

function dedupeScadenze(scadenze) {
  var source = Array.isArray(scadenze) ? scadenze : [];
  var deduped = [];

  for (var i = 0; i < source.length; i++) {
    var current = mergeScadenzaRecords({}, source[i]);
    var merged = false;

    if (!current.testo) continue;

    for (var j = 0; j < deduped.length; j++) {
      if (areScadenzeDuplicate(current, deduped[j])) {
        deduped[j] = mergeScadenzaRecords(deduped[j], source[i]);
        merged = true;
        break;
      }
    }

    if (!merged) {
      deduped.push(current);
    }
  }

  return deduped;
}

function cleanupStoredTaskDuplicates() {
  var changed = false;
  var storageEntries = [
    { key: "actionflow_checklist", type: "task" },
    { key: "actionflow_archivio_azioni", type: "task" },
    { key: "actionflow_scadenze", type: "deadline" },
    { key: "actionflow_archivio_scadenze", type: "deadline" }
  ];

  for (var i = 0; i < storageEntries.length; i++) {
    try {
      var parsed = window.ActionFlowAuth.readOwnedArray(storageEntries[i].key);
      var cleaned = storageEntries[i].type === "task" ? dedupeTasks(parsed) : dedupeScadenze(parsed);

      if (JSON.stringify(parsed || []) !== JSON.stringify(cleaned)) {
        window.ActionFlowAuth.writeOwnedArray(storageEntries[i].key, cleaned);
        changed = true;
      }
    } catch (e) {}
  }

  return changed;
}

cleanupStoredTaskDuplicates();

function clearAllTaskDataStorage() {
  window.ActionFlowAuth.clearOwnedArray("actionflow_archivio_azioni");
  window.ActionFlowAuth.clearOwnedArray("actionflow_archivio_scadenze");
  window.ActionFlowAuth.clearOwnedArray("actionflow_checklist");
  window.ActionFlowAuth.clearOwnedArray("actionflow_scadenze");
  window.ActionFlowAuth.clearScopedObject("actionflow_azioni_done");
  window.ActionFlowAuth.clearScopedObject("actionflow_checklist_done");
  window.ActionFlowAuth.clearScopedObject(DAILY_PLAN_STORAGE_KEY);

  azioniCorrente = [];
  scadenzeCorrente = [];
}

function setVisibility(element, visible, displayValue) {
  if (!element) return;

  element.classList.toggle("nascosto", !visible);
  element.style.display = visible ? (displayValue || "") : "none";
  element.setAttribute("aria-hidden", visible ? "false" : "true");
}

function countDailyPlanTasks(plan) {
  var sezioni = getDailyPlanSections(plan);
  return {
    mattina: sezioni.mattina.length,
    pomeriggio: sezioni.pomeriggio.length,
    restaDaFareOggi: sezioni.restaDaFareOggi.length,
    seAvanzaTempo: sezioni.seAvanzaTempo.length
  };
}

function normalizeDailyPlan(plan) {
  if (!plan || typeof plan !== "object") return null;

  var sezioni = getDailyPlanSections(plan);
  var minutiMattina = getPlanSlotMinutes(sezioni.mattina);
  var minutiPomeriggio = getPlanSlotMinutes(sezioni.pomeriggio);

  return {
    data: plan.data || formatISO(inizioOggiLocale()),
    mattina: sezioni.mattina,
    pomeriggio: sezioni.pomeriggio,
    restaDaFareOggi: sezioni.restaDaFareOggi,
    seAvanzaTempo: sezioni.seAvanzaTempo,
    daFareOggi: sezioni.mattina.concat(sezioni.pomeriggio).concat(sezioni.restaDaFareOggi),
    meta: plan.meta && typeof plan.meta === "object" ? {
      taskSignature: plan.meta.taskSignature || "",
      sourceTaskCount: typeof plan.meta.sourceTaskCount === "number" ? plan.meta.sourceTaskCount : sezioni.mattina.length + sezioni.pomeriggio.length + sezioni.restaDaFareOggi.length + sezioni.seAvanzaTempo.length
    } : null,
    totali: {
      taskConsiderati: plan.totali && typeof plan.totali.taskConsiderati === "number" ? plan.totali.taskConsiderati : sezioni.mattina.length + sezioni.pomeriggio.length + sezioni.restaDaFareOggi.length + sezioni.seAvanzaTempo.length,
      minutiMattina: minutiMattina,
      minutiPomeriggio: minutiPomeriggio,
      minutiDaFareOggi: minutiMattina + minutiPomeriggio,
      taskMattina: sezioni.mattina.length,
      taskPomeriggio: sezioni.pomeriggio.length,
      taskRestaDaFareOggi: sezioni.restaDaFareOggi.length,
      taskFuturiMonitorati: plan.totali && typeof plan.totali.taskFuturiMonitorati === "number" ? plan.totali.taskFuturiMonitorati : 0
    }
  };
}

function openDailyPlanModal() {
  var modal = document.getElementById("modal-organizza-giornata");
  if (!modal) return;

  setVisibility(modal, true, "flex");
  document.body.style.overflow = "hidden";
}

function closeDailyPlanModal() {
  var modal = document.getElementById("modal-organizza-giornata");
  if (!modal) return;

  setVisibility(modal, false);
  document.body.style.overflow = "";
}

function openAnalysisPreviewModal() {
  var modal = document.getElementById("modal-anteprima-analisi");
  if (!modal) return;

  modal.classList.remove("nascosto");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeAnalysisPreviewModal() {
  var modal = document.getElementById("modal-anteprima-analisi");
  if (!modal) return;

  modal.classList.add("nascosto");
  modal.setAttribute("aria-hidden", "true");
  pendingAnalysisResult = null;
  document.body.style.overflow = document.getElementById("modal-organizza-giornata") && !document.getElementById("modal-organizza-giornata").classList.contains("nascosto") ? "hidden" : "";
}

function renderAnalysisPreview(azioni, scadenze) {
  var list = document.getElementById("analysis-preview-list");
  var empty = document.getElementById("analysis-preview-empty");
  var summary = document.getElementById("analysis-preview-summary");
  var addButton = document.getElementById("bottone-aggiungi-tutto");
  if (!list || !empty || !summary || !addButton) return;

  var items = Array.isArray(azioni) ? azioni.slice(0, ANALYSIS_PREVIEW_MAX_ITEMS) : [];
  var scadenzeMap = buildScadenzaMap(Array.isArray(scadenze) ? scadenze : []);

  list.innerHTML = "";
  empty.classList.toggle("nascosto", items.length > 0);
  addButton.disabled = items.length === 0;

  if (!azioni || azioni.length === 0) {
    summary.textContent = "Non ho trovato task chiari da aggiungere.";
    return;
  }

  summary.textContent = azioni.length === 1
    ? "1 task pronto da confermare."
    : azioni.length + " task pronti da confermare.";

  for (var i = 0; i < items.length; i++) {
    var task = resolveTaskForDisplay(items[i], scadenzeMap);
    var card = document.createElement("article");
    card.className = "analysis-preview-card";

    var title = document.createElement("p");
    title.className = "analysis-preview-text";
    title.textContent = task.testo;
    card.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "analysis-preview-meta";

    var scadenza = task.labelScadenzaDinamica || formatDailyPlanDue(task);
    if (scadenza) {
      var badgeData = document.createElement("span");
      badgeData.className = "badge-data";
      badgeData.textContent = scadenza;
      meta.appendChild(badgeData);
    }

    if (task.durataStimataMinuti) {
      var durata = document.createElement("span");
      durata.className = "azione-durata";
      durata.textContent = task.durataStimataMinuti + " min";
      meta.appendChild(durata);
    }

    if (task.energiaStimata) {
      var energia = document.createElement("span");
      energia.className = "badge-energia badge-energia-" + task.energiaStimata;
      energia.textContent = "Energia: " + task.energiaStimata;
      meta.appendChild(energia);
    }

    if (task.time) {
      var badgeTime = document.createElement("span");
      badgeTime.className = "badge-time";
      badgeTime.textContent = task.time;
      meta.appendChild(badgeTime);
    }

    var badgePriorita = document.createElement("span");
    badgePriorita.className = "badge-priorita priorita-" + (task.prioritaDinamica || "bassa");
    badgePriorita.textContent = task.prioritaDinamica || "bassa";
    meta.appendChild(badgePriorita);

    card.appendChild(meta);
    list.appendChild(card);
  }

  if (azioni.length > ANALYSIS_PREVIEW_MAX_ITEMS) {
    var more = document.createElement("p");
    more.className = "analysis-preview-more";
    more.textContent = "+" + (azioni.length - ANALYSIS_PREVIEW_MAX_ITEMS) + " altre attivita nascoste per mantenere la vista pulita.";
    list.appendChild(more);
  }
}

function openAnalysisPreview(azioni, scadenze, daPianificare) {
  var cleanedAzioni = dedupeTasks(azioni);
  var cleanedScadenze = dedupeScadenze(scadenze);

  pendingAnalysisResult = {
    azioni: cleanedAzioni,
    scadenze: cleanedScadenze,
    daPianificare: Array.isArray(daPianificare) ? daPianificare : []
  };

  renderAnalysisPreview(pendingAnalysisResult.azioni, pendingAnalysisResult.scadenze);
  openAnalysisPreviewModal();
}

function confirmAnalysisPreview() {
  if (!pendingAnalysisResult) {
    closeAnalysisPreviewModal();
    return;
  }

  mostraRisultati(pendingAnalysisResult.azioni, pendingAnalysisResult.scadenze, pendingAnalysisResult.daPianificare);
  closeAnalysisPreviewModal();
}

function setupAnalysisPreviewModal() {
  var modal = document.getElementById("modal-anteprima-analisi");
  var closeButton = document.getElementById("bottone-chiudi-anteprima");
  var cancelButton = document.getElementById("bottone-annulla-anteprima");
  var addButton = document.getElementById("bottone-aggiungi-tutto");

  if (closeButton) {
    closeButton.addEventListener("click", closeAnalysisPreviewModal);
  }

  if (cancelButton) {
    cancelButton.addEventListener("click", closeAnalysisPreviewModal);
  }

  if (addButton) {
    addButton.addEventListener("click", confirmAnalysisPreview);
  }

  if (modal) {
    modal.addEventListener("click", function(event) {
      if (event.target === modal) {
        closeAnalysisPreviewModal();
      }
    });
  }

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      closeAnalysisPreviewModal();
    }
  });
}

function setupDailyPlanModal() {
  var modal = document.getElementById("modal-organizza-giornata");
  var closeButton = document.getElementById("bottone-chiudi-piano");

  if (closeButton) {
    closeButton.addEventListener("click", closeDailyPlanModal);
  }

  if (modal) {
    modal.addEventListener("click", function(event) {
      if (event.target === modal) {
        closeDailyPlanModal();
      }
    });
  }

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      closeDailyPlanModal();
    }
  });
}

function mostraErroreInput(messaggio) {
  var errore = document.getElementById("messaggio-errore");
  var textarea = document.getElementById("testo-input");

  if (errore) {
    errore.textContent = messaggio;
    errore.style.display = "block";
  }

  if (textarea) {
    textarea.classList.add("errore-campo");
  }
}

function nascondiErroreInput() {
  var errore = document.getElementById("messaggio-errore");
  var textarea = document.getElementById("testo-input");

  if (errore) {
    errore.style.display = "none";
  }

  if (textarea) {
    textarea.classList.remove("errore-campo");
  }
}

function aggiornaStatoVoiceButton(attivo) {
  var bottone = document.getElementById("bottone-microfono");
  if (!bottone) return;

  bottone.classList.toggle("is-recording", attivo);
  bottone.setAttribute("aria-pressed", attivo ? "true" : "false");
  if (voiceStatus === "unsupported") {
    bottone.title = "Input vocale non supportato";
    return;
  }

  if (voiceStatus === "error") {
    bottone.title = "Errore input vocale";
    return;
  }

  if (voiceStatus === "paused") {
    bottone.title = "Pausa rilevata: continuo ad ascoltare";
    return;
  }

  if (voiceStatus === "ended") {
    bottone.title = "Ascolto terminato: clicca per riavviare";
    return;
  }

  if (attivo) {
    bottone.title = "Ferma input vocale";
    return;
  }

  bottone.title = "Avvia input vocale";
}

function setVoiceStatus(nextStatus) {
  voiceStatus = nextStatus || "idle";
  aggiornaStatoVoiceButton(voiceInputAttivo);
}

function getSpeechRecognitionConstructor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function appendSpeechSegment(baseText, segment) {
  var base = typeof baseText === "string" ? baseText : "";
  var extra = typeof segment === "string" ? segment.trim() : "";

  if (!extra) return base;
  if (!base) return extra;
  if (/\s$/.test(base)) return base + extra;
  return base + " " + extra;
}

function updateTextareaWithSpeech(textarea) {
  if (!textarea) return;

  var stableText = appendSpeechSegment(voiceBaseText, voiceFinalTranscript);
  var composed = voiceInterimTranscript
    ? appendSpeechSegment(stableText, voiceInterimTranscript)
    : stableText;

  textarea.value = composed;
}

function handleSpeechResult(event, textarea) {
  var finalChunk = "";
  var interimChunk = "";

  if (!event || !event.results) return;

  for (var i = event.resultIndex; i < event.results.length; i++) {
    var transcript = event.results[i][0] ? event.results[i][0].transcript : "";
    if (!transcript) continue;

    if (event.results[i].isFinal) {
      finalChunk = appendSpeechSegment(finalChunk, transcript);
    } else {
      interimChunk = appendSpeechSegment(interimChunk, transcript);
    }
  }

  if (finalChunk) {
    voiceFinalTranscript = appendSpeechSegment(voiceFinalTranscript, finalChunk);
  }

  voiceInterimTranscript = interimChunk;
  updateTextareaWithSpeech(textarea);
  setVoiceStatus("active");
}

function handleSpeechError(event) {
  var errorCode = event && event.error ? event.error : "unknown";

  if (errorCode === "aborted") return;

  if (errorCode === "not-allowed" || errorCode === "service-not-allowed") {
    voiceShouldRestart = false;
    setVoiceStatus("error");
    mostraErroreInput("Microfono non disponibile o permesso negato.");
    return;
  }

  if (errorCode === "audio-capture") {
    voiceShouldRestart = false;
    setVoiceStatus("error");
    mostraErroreInput("Microfono non disponibile su questo dispositivo.");
    return;
  }

  if (errorCode === "no-speech") {
    setVoiceStatus("paused");
    return;
  }

  setVoiceStatus("error");
  mostraErroreInput("Errore durante l'input vocale. Riprova.");
}

function stopVoiceInput() {
  voiceShouldRestart = false;
  voiceStoppingManually = true;

  if (voiceRecognition && voiceInputAttivo) {
    try {
      voiceRecognition.stop();
    } catch (e) {}
  }

  voiceInputAttivo = false;
  voiceInterimTranscript = "";
  setVoiceStatus("ended");
}

function startVoiceInput() {
  var SpeechRecognition = getSpeechRecognitionConstructor();
  var textarea = document.getElementById("testo-input");

  if (!SpeechRecognition) {
    setVoiceStatus("unsupported");
    mostraErroreInput("Input vocale non supportato in questo browser.");
    return;
  }

  if (!textarea) return;

  if (voiceInputAttivo) {
    stopVoiceInput();
    return;
  }

  nascondiErroreInput();
  voiceBaseText = typeof textarea.value === "string" ? textarea.value : "";
  voiceFinalTranscript = "";
  voiceInterimTranscript = "";
  voiceShouldRestart = true;
  voiceStoppingManually = false;
  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = "it-IT";
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = true;

  voiceRecognition.onstart = function() {
    voiceInputAttivo = true;
    setVoiceStatus("active");
  };

  voiceRecognition.onresult = function(event) {
    handleSpeechResult(event, textarea);
  };

  voiceRecognition.onerror = function(event) {
    handleSpeechError(event);
  };

  voiceRecognition.onend = function() {
    voiceInputAttivo = false;

    // Consolida sempre i finali prima di eventuale riavvio, senza perdere testo.
    voiceBaseText = appendSpeechSegment(voiceBaseText, voiceFinalTranscript);
    voiceFinalTranscript = "";
    voiceInterimTranscript = "";
    updateTextareaWithSpeech(textarea);

    if (voiceShouldRestart && !voiceStoppingManually) {
      setVoiceStatus("paused");
      setTimeout(function() {
        if (!voiceShouldRestart) return;
        try {
          voiceRecognition.start();
        } catch (e) {
          setVoiceStatus("ended");
        }
      }, 220);
      return;
    }

    setVoiceStatus("ended");
    voiceStoppingManually = false;
  };

  try {
    voiceRecognition.start();
  } catch (err) {
    setVoiceStatus("error");
    mostraErroreInput("Impossibile avviare l'input vocale ora.");
  }
}

function inizioOggiLocale() {
  var oggi = new Date();
  return new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate());
}

function parseDataISOLocale(dataISO) {
  if (!dataISO || typeof dataISO !== "string") return null;

  var parti = dataISO.split("-");
  if (parti.length !== 3) return null;

  var anno = parseInt(parti[0], 10);
  var mese = parseInt(parti[1], 10);
  var giorno = parseInt(parti[2], 10);

  if (isNaN(anno) || isNaN(mese) || isNaN(giorno)) return null;

  return new Date(anno, mese - 1, giorno);
}

function getTaskDaysFromToday(dataISO) {
  var data = parseDataISOLocale(dataISO);
  if (!data) return null;

  var oggi = inizioOggiLocale();
  var diff = data.getTime() - oggi.getTime();
  return Math.round(diff / 86400000);
}

function formatDateForDisplay(dataISO) {
  var data = parseDataISOLocale(dataISO);
  if (!data) return "";

  return data.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short"
  });
}

function getDynamicDateLabel(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  if (giorni === null) {
    return task && task.scadenzaOriginale ? task.scadenzaOriginale : "";
  }

  if (giorni < 0) return "Scaduto";
  if (giorni === 0) return "Oggi";
  if (giorni === 1) return "Domani";
  if (giorni === 2) return "Dopodomani";
  return formatDateForDisplay(task.dataISO);
}

function getDynamicTaskPriority(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  if (giorni === null) {
    return task && task.priorita ? task.priorita : "bassa";
  }

  if (giorni <= 2) return "alta";
  if (giorni <= 7) return "media";
  return "bassa";
}

function buildScadenzaMap(scadenze) {
  var mappa = {};
  var lista = Array.isArray(scadenze) ? scadenze : [];

  for (var i = 0; i < lista.length; i++) {
    if (lista[i] && lista[i].testo) {
      mappa[normalizeText(lista[i].testo)] = lista[i];
    }
  }

  return mappa;
}

function resolveTaskForDisplay(task, scadenzeMap) {
  var fallback = scadenzeMap && task && task.testo ? scadenzeMap[normalizeText(task.testo)] : null;
  var dataISO = task && task.dataISO ? task.dataISO : (fallback ? fallback.dataRisolta || fallback.dataISO || null : null);
  var scadenzaOriginale = task && task.scadenzaOriginale ? task.scadenzaOriginale : (fallback ? fallback.data || fallback.scadenzaOriginale || null : null);
  var orario = normalizzaOrario(task && task.time ? task.time : null);
  var resolved = {
    id: task && task.id ? task.id : null,
    testo: task && task.testo ? task.testo : "",
    priorita: task && task.priorita ? task.priorita : "bassa",
    dataISO: dataISO,
    scadenzaOriginale: scadenzaOriginale,
    time: orario,
    durataStimataMinuti: task ? task.durataStimataMinuti : null,
    energiaStimata: task ? task.energiaStimata : null,
    completato: task ? task.completato : false
  };

  resolved.prioritaDinamica = getDynamicTaskPriority(resolved);
  resolved.labelScadenzaDinamica = getDynamicDateLabel(resolved);
  return resolved;
}

function getTaskPriorityScore(task) {
  var giorni = getTaskDaysFromToday(task.dataISO);
  var prioritaDinamica = getDynamicTaskPriority(task);

  if (giorni !== null) {
    if (giorni < 0) return 0;
    if (giorni === 0) return 1;
    if (giorni === 1) return 2;
    if (giorni <= 3) return 3;
  }

  if (prioritaDinamica === "alta") return 4;
  if (prioritaDinamica === "media") return 5;
  return 6;
}

function getTaskRelationType(task) {
  var testo = (task && task.testo ? task.testo : "").toLowerCase();
  if (/^(rivedere|verificare|controllare|revisionare)\b/.test(testo)) return "review";
  if (/^(inviare|mandare|spedire|inoltrare)\b/.test(testo)) return "send";
  return "other";
}

function getTaskKeywords(task) {
  var testo = (task && task.testo ? task.testo : "").toLowerCase();
  var stopwords = {
    il: true, lo: true, la: true, i: true, gli: true, le: true, un: true, uno: true, una: true,
    di: true, del: true, della: true, dei: true, delle: true, degli: true, a: true, ad: true,
    al: true, allo: true, alla: true, ai: true, agli: true, alle: true, da: true, in: true,
    con: true, per: true, su: true, tra: true, fra: true,
    rivedere: true, verificare: true, controllare: true, revisionare: true,
    inviare: true, mandare: true, spedire: true, inoltrare: true
  };
  var tokens = testo.match(/[a-z\u00C0-\u00FF]+/g) || [];
  var keywords = [];

  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].length < 4 || stopwords[tokens[i]]) continue;
    if (keywords.indexOf(tokens[i]) === -1) {
      keywords.push(tokens[i]);
    }
  }

  return keywords;
}

function areLinkedTasks(taskA, taskB) {
  var keywordsA = getTaskKeywords(taskA);
  var keywordsB = getTaskKeywords(taskB);

  for (var i = 0; i < keywordsA.length; i++) {
    if (keywordsB.indexOf(keywordsA[i]) !== -1) {
      return true;
    }
  }

  return false;
}

function compareLinkedTasks(taskA, taskB) {
  if (!areLinkedTasks(taskA, taskB)) return 0;

  var typeA = getTaskRelationType(taskA);
  var typeB = getTaskRelationType(taskB);

  if (typeA === "review" && typeB === "send") return -1;
  if (typeA === "send" && typeB === "review") return 1;
  return 0;
}

function getTaskEnergyValue(energiaStimata) {
  if (energiaStimata === "alta") return 3;
  if (energiaStimata === "media") return 2;
  return 1;
}

function isTaskCompletedForPlanner(task, completate) {
  if (!task) return false;
  if (task.completato === true || task.completed === true) return true;

  var id = task.id || generaIdAzione(task.testo || "");
  return completate[id] === true;
}

function getStoredScadenzaMap() {
  var mappa = {};
  var scadenze = leggiArchivioScadenze();

  for (var i = 0; i < scadenze.length; i++) {
    if (scadenze[i] && scadenze[i].testo) {
      mappa[normalizeText(scadenze[i].testo)] = scadenze[i];
    }
  }

  try {
    var correnti = dedupeScadenze(window.ActionFlowAuth.readOwnedArray("actionflow_scadenze"));
    if (Array.isArray(correnti)) {
      for (var j = 0; j < correnti.length; j++) {
        if (correnti[j] && correnti[j].testo) {
          mappa[normalizeText(correnti[j].testo)] = correnti[j];
        }
      }
    }
  } catch (e) {}

  return mappa;
}

function normalizzaTaskPerPiano(task, completate, scadenzeMap) {
  var azione = normalizzaAzioneSalvata(task);
  var fallbackScadenza = scadenzeMap[normalizeText(azione.testo)] || null;
  var durata = normalizzaDurataStimata(azione.durataStimataMinuti);
  var energia = normalizzaEnergiaStimata(azione.energiaStimata);
  var orario = normalizzaOrario(azione.time);

  return {
    id: task && task.id ? task.id : generaIdAzione(azione.testo || ""),
    testo: azione.testo,
    priorita: azione.priorita || "media",
    dataISO: azione.dataISO || (fallbackScadenza ? fallbackScadenza.dataRisolta || null : null),
    scadenzaOriginale: azione.scadenzaOriginale || (fallbackScadenza ? fallbackScadenza.data || null : null),
    time: orario,
    durataStimataMinuti: durata !== null ? durata : DAILY_PLAN_DEFAULT_DURATION,
    energiaStimata: energia || "media",
    completato: isTaskCompletedForPlanner(task || azione, completate),
    prioritaFallbackUsata: !azione.priorita,
    durataFallbackUsata: durata === null,
    energiaFallbackUsata: !energia
  };
}

function getSavedTasksForPlanning() {
  var completate = leggiAzioniCompletate();
  var scadenzeMap = getStoredScadenzaMap();
  var tasks = [];

  try {
    var archivio = dedupeTasks(window.ActionFlowAuth.readOwnedArray("actionflow_archivio_azioni"));
    var sorgente = Array.isArray(archivio) && archivio.length > 0 ? archivio : [];

    if (sorgente.length === 0) {
      var checklist = dedupeTasks(window.ActionFlowAuth.readOwnedArray("actionflow_checklist"));
      if (Array.isArray(checklist)) {
        sorgente = checklist;
      }
    }

    for (var i = 0; i < sorgente.length; i++) {
      var task = normalizzaTaskPerPiano(sorgente[i], completate, scadenzeMap);
      if (task.testo) {
        tasks.push(task);
      }
    }
  } catch (e) {}

  return tasks;
}

function getDynamicPriority(task) {
  return getDynamicTaskPriority(task);
}

function logDailyPlanDebug(task, reason, details) {
  if (!DAILY_PLAN_DEBUG) return;

  var preferredSlot = task ? getTaskForcedSlot(task) : null;
  var slotFinale = details && typeof details === "object" && details.slotFinale ? details.slotFinale : null;
  var dettagli = details && typeof details === "object"
    ? (details.motivo || details.info || details)
    : (details || null);

  console.log("[ActionFlow][OrganizzaGiornata]", {
    testo: task && task.testo ? task.testo : "",
    dataISO: task && task.dataISO ? task.dataISO : null,
    time: task && task.time ? task.time : null,
    preferredSlot: preferredSlot,
    slotFinale: slotFinale,
    priorita: task && task.priorita ? task.priorita : "bassa",
    prioritaDinamica: task ? getDynamicPriority(task) : null,
    punteggioUrgenza: task ? getTaskUrgencyScore(task) : null,
    durataStimataMinuti: task && task.durataStimataMinuti ? task.durataStimataMinuti : DAILY_PLAN_DEFAULT_DURATION,
    energiaStimata: task && task.energiaStimata ? task.energiaStimata : "media",
    completato: task ? task.completato === true : false,
    fallbackPriorita: !!(task && task.prioritaFallbackUsata),
    fallbackDurata: !!(task && task.durataFallbackUsata),
    fallbackEnergia: !!(task && task.energiaFallbackUsata),
    motivo: reason,
    dettagli: dettagli
  });
}

function getTaskUrgencyBucket(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);

  if (giorni !== null) {
    if (giorni < 0) return 0;
    if (giorni === 0) return 1;
    if (giorni === 1) return 2;
    if (giorni <= 3) return 3;
    if (giorni <= 7) return 4;
  }

  if (priorita === "alta") return 5;
  if (priorita === "media") return 6;
  return 7;
}

function getTaskUrgencyScore(task) {
  var bucket = getTaskUrgencyBucket(task);
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var durata = normalizzaDurataStimata(task && task.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;
  var score = bucket * 100;

  if (giorni !== null) {
    score += Math.max(giorni, -3) * 3;
  }

  if (bucket <= 3 && durata <= 20) score -= 18;
  else if (bucket <= 4 && durata <= 30) score -= 10;
  else if (durata > 60) score += 8;

  if (task && task.energiaStimata === "alta") score -= 2;
  if (task && task.energiaStimata === "bassa") score += 2;

  return score;
}

function sortTasksForDailyPlan(tasks) {
  return tasks.slice().sort(function(a, b) {
    var scoreA = getTaskUrgencyScore(a);
    var scoreB = getTaskUrgencyScore(b);
    if (scoreA !== scoreB) return scoreA - scoreB;

    var giorniA = getTaskDaysFromToday(a.dataISO);
    var giorniB = getTaskDaysFromToday(b.dataISO);
    if (giorniA !== null && giorniB !== null && giorniA !== giorniB) {
      return giorniA - giorniB;
    }

    var prioritaA = livelloPriorita(getDynamicTaskPriority(a));
    var prioritaB = livelloPriorita(getDynamicTaskPriority(b));
    if (prioritaA !== prioritaB) return prioritaB - prioritaA;

    var linkedOrder = compareLinkedTasks(a, b);
    if (linkedOrder !== 0) return linkedOrder;

    if (a.durataStimataMinuti !== b.durataStimataMinuti) {
      return a.durataStimataMinuti - b.durataStimataMinuti;
    }

    return (a.testo || "").localeCompare(b.testo || "", "it");
  });
}

function isPreparatoryTask(task) {
  var testo = (task && task.testo ? task.testo : "").toLowerCase();
  if (getTaskRelationType(task) === "review") return true;
  return /(prepar|bozza|outline|raccogli|organizz|impost|verific|controll|rived)/.test(testo);
}

function isVeryShortTask(task) {
  return (normalizzaDurataStimata(task && task.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION) <= 20;
}

function isLongTask(task) {
  return (normalizzaDurataStimata(task && task.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION) > 60;
}

function getPlanSlotMinutes(tasks) {
  var totale = 0;

  for (var i = 0; i < tasks.length; i++) {
    totale += normalizzaDurataStimata(tasks[i] && tasks[i].durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;
  }

  return totale;
}

function getPrimaryTaskCount(planSections) {
  return planSections.mattina.length + planSections.pomeriggio.length;
}

function getHighEnergyCountForSlot(slotTasks) {
  var count = 0;

  for (var i = 0; i < slotTasks.length; i++) {
    if (slotTasks[i] && slotTasks[i].energiaStimata === "alta") {
      count++;
    }
  }

  return count;
}

function getSlotConstraintReason(task, slotName, planSections) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var slotTasks = planSections[slotName] || [];
  var slotMinutes = getPlanSlotMinutes(slotTasks);
  var durataTask = normalizzaDurataStimata(task && task.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;
  var highEnergyCount = getHighEnergyCountForSlot(slotTasks);

  if (giorni === 1) return "task_di_domani_riservato_a_extra";
  if (slotMinutes + durataTask > DAILY_PLAN_MAX_SLOT_MINUTES) return "slot_oltre_180_minuti";
  if (task.energiaStimata === "alta" && highEnergyCount >= 1) return "slot_ha_gia_un_task_alta_energia";

  return null;
}

function canAddTaskToSlot(task, slotName, planSections) {
  return getSlotConstraintReason(task, slotName, planSections) === null;
}

function hasVagueDeadline(task) {
  var scadenza = (task && task.scadenzaOriginale ? task.scadenzaOriginale : "").toLowerCase().trim();

  if (!scadenza) return false;

  return /quando\s+ho\s+tempo|questa\s+settimana|tra\s+qualche\s+giorno|nei\s+prossimi\s+giorni|piu\s+avanti|più\s+avanti|entro\s+il\s+mese|settimana\s+prossima/.test(scadenza);
}

function isLowPriorityFlexibleTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);

  if (hasVagueDeadline(task)) return true;
  if (giorni === null && priorita === "bassa") return true;
  return false;
}

function isExactTodayTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  if (hasVagueDeadline(task)) return false;
  return giorni === 0;
}

function isPastDueTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  if (hasVagueDeadline(task)) return false;
  return giorni !== null && giorni < 0;
}

function isExplicitTodaySlotTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var preferredSlot = getExplicitSlotHint(task);

  if (!preferredSlot || hasVagueDeadline(task)) return false;
  if (giorni !== null && giorni > 0) return false;
  return true;
}

function getTaskTimeMinutes(task) {
  var normalized = normalizzaOrario(task && task.time ? task.time : null);
  var parts;
  var hours;
  var minutes;

  if (!normalized) return null;

  parts = normalized.split(":");
  if (parts.length !== 2) return null;

  hours = parseInt(parts[0], 10);
  minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return null;

  return (hours * 60) + minutes;
}

function getTimeBasedSlotHint(task) {
  var totalMinutes = getTaskTimeMinutes(task);

  if (totalMinutes === null) return null;
  if (totalMinutes >= 360 && totalMinutes < 720) return "mattina";
  if (totalMinutes >= 720 && totalMinutes < 1140) return "pomeriggio";
  return null;
}

function getTaskForcedSlot(task) {
  var explicitHint = getExplicitSlotHint(task);
  var timeHint = getTimeBasedSlotHint(task);

  if (timeHint) return timeHint;
  return explicitHint;
}

function isTimeConstrainedTodayTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  if (!getTimeBasedSlotHint(task) || hasVagueDeadline(task)) return false;
  if (giorni !== null && giorni > 0) return false;
  return true;
}

function isConcreteShortDeadlineTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  if (hasVagueDeadline(task)) return false;
  return giorni !== null && giorni >= 0 && giorni <= 3;
}

function isImportantFutureTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);

  if (hasVagueDeadline(task)) return false;
  if (giorni === null || giorni <= 3) return false;
  if (priorita === "alta" || priorita === "media") return true;
  return task && task.energiaStimata === "alta";
}

function isImportantAndBriefFutureTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);
  var durata = normalizzaDurataStimata(task && task.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;

  if (hasVagueDeadline(task)) return false;
  if (giorni === null || giorni <= 0) return false;
  if (durata > 30) return false;

  if (priorita === "alta") return true;
  if (priorita === "media" && (task.energiaStimata === "alta" || isPreparatoryTask(task))) return true;
  return false;
}

function isImportantUndatedTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);

  if (hasVagueDeadline(task)) return false;
  if (giorni !== null) return false;
  if (priorita === "alta") return true;
  if (priorita === "media" && (task.energiaStimata === "alta" || isPreparatoryTask(task))) return true;
  return false;
}

function shouldReserveForExtraTime(task) {
  if (isLowPriorityFlexibleTask(task)) return true;
  return false;
}

function isDueTodayTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  return giorni !== null && giorni <= 0;
}

function isUsefulUndatedTask(task) {
  return isImportantUndatedTask(task);
}

function isUrgentPrimaryTask(task) {
  if (isConcreteShortDeadlineTask(task)) return true;
  return isUsefulUndatedTask(task);
}

function isFutureMonitoringTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  return giorni !== null && giorni > 0;
}

function canFutureTaskAppearToday(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);

  if (giorni === null || giorni <= 0) return false;
  if (hasVagueDeadline(task)) return false;
  if (isImportantFutureTask(task)) return true;
  if (isPreparatoryTask(task)) return true;
  if (isVeryShortTask(task) && (giorni === 1 || priorita === "alta" || priorita === "media")) return true;
  return false;
}

function getExplicitSlotHint(task) {
  var testo = (task && task.testo ? task.testo : "").toLowerCase();
  var scadenza = (task && task.scadenzaOriginale ? task.scadenzaOriginale : "").toLowerCase();
  var combined = (testo + " " + scadenza).trim();

  if (!combined) return null;
  if (/stamattina|questa\s+mattina|oggi\s+mattina/.test(combined)) return "mattina";
  if (/oggi\s+pomeriggio|questo\s+pomeriggio|nel\s+pomeriggio/.test(combined)) return "pomeriggio";

  return null;
}

function sortTasksWithinSlot(tasks, slotName) {
  return tasks.slice().sort(function(a, b) {
    var timeSlotA = getTimeBasedSlotHint(a);
    var timeSlotB = getTimeBasedSlotHint(b);
    var timeMinutesA = getTaskTimeMinutes(a);
    var timeMinutesB = getTaskTimeMinutes(b);
    var timedScoreA = timeSlotA === slotName && timeMinutesA !== null ? 1 : 0;
    var timedScoreB = timeSlotB === slotName && timeMinutesB !== null ? 1 : 0;
    var hintA = getExplicitSlotHint(a);
    var hintB = getExplicitSlotHint(b);
    var hintScoreA = hintA === slotName ? 1 : 0;
    var hintScoreB = hintB === slotName ? 1 : 0;

    if (timedScoreA !== timedScoreB) return timedScoreB - timedScoreA;
    if (timedScoreA === 1 && timedScoreB === 1 && timeMinutesA !== timeMinutesB) {
      return timeMinutesA - timeMinutesB;
    }

    if (hintScoreA !== hintScoreB) return hintScoreB - hintScoreA;

    var energyA = getTaskEnergyValue(a && a.energiaStimata ? a.energiaStimata : "media");
    var energyB = getTaskEnergyValue(b && b.energiaStimata ? b.energiaStimata : "media");
    if (energyA !== energyB) return energyB - energyA;

    var durationA = normalizzaDurataStimata(a && a.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;
    var durationB = normalizzaDurataStimata(b && b.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;
    if (durationA !== durationB) return durationB - durationA;

    var urgencyA = getTaskUrgencyScore(a);
    var urgencyB = getTaskUrgencyScore(b);
    if (urgencyA !== urgencyB) return urgencyA - urgencyB;

    return (a && a.testo ? a.testo : "").localeCompare(b && b.testo ? b.testo : "", "it");
  });
}

function sortTodayTasksForPlan(tasks) {
  return tasks.slice().sort(function(a, b) {
    var timeA = getTaskTimeMinutes(a);
    var timeB = getTaskTimeMinutes(b);
    var timedA = timeA !== null ? 1 : 0;
    var timedB = timeB !== null ? 1 : 0;
    var forcedA = getTaskForcedSlot(a) ? 1 : 0;
    var forcedB = getTaskForcedSlot(b) ? 1 : 0;
    var urgencyA;
    var urgencyB;

    if (timedA !== timedB) return timedB - timedA;
    if (timedA === 1 && timedB === 1 && timeA !== timeB) return timeA - timeB;

    if (forcedA !== forcedB) return forcedB - forcedA;

    urgencyA = getTaskUrgencyScore(a);
    urgencyB = getTaskUrgencyScore(b);
    if (urgencyA !== urgencyB) return urgencyA - urgencyB;

    if (livelloPriorita(getDynamicPriority(a)) !== livelloPriorita(getDynamicPriority(b))) {
      return livelloPriorita(getDynamicPriority(b)) - livelloPriorita(getDynamicPriority(a));
    }

    return (a && a.testo ? a.testo : "").localeCompare(b && b.testo ? b.testo : "", "it");
  });
}

function sortUntimedTodayTasksForPlan(tasks) {
  return tasks.slice().sort(function(a, b) {
    var urgencyA = getTaskUrgencyScore(a);
    var urgencyB = getTaskUrgencyScore(b);
    var priorityA = livelloPriorita(getDynamicPriority(a));
    var priorityB = livelloPriorita(getDynamicPriority(b));
    var shortA = isVeryShortTask(a) ? 1 : 0;
    var shortB = isVeryShortTask(b) ? 1 : 0;
    var energyA = getTaskEnergyValue(a && a.energiaStimata ? a.energiaStimata : "media");
    var energyB = getTaskEnergyValue(b && b.energiaStimata ? b.energiaStimata : "media");

    if (urgencyA !== urgencyB) return urgencyA - urgencyB;
    if (priorityA !== priorityB) return priorityB - priorityA;
    if (shortA !== shortB) return shortB - shortA;

    // Favor medium/low energy for filler tasks before high-energy ones.
    if (energyA !== energyB) {
      if (energyA === 3) return 1;
      if (energyB === 3) return -1;
      return energyA - energyB;
    }

    return (a && a.testo ? a.testo : "").localeCompare(b && b.testo ? b.testo : "", "it");
  });
}

function sortPlanSections(planSections) {
  planSections.mattina = sortTasksWithinSlot(planSections.mattina || [], "mattina");
  planSections.pomeriggio = sortTasksWithinSlot(planSections.pomeriggio || [], "pomeriggio");
  return planSections;
}

function isAllowedTomorrowExtraTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  if (giorni !== 1) return true;
  return isVeryShortTask(task) || isPreparatoryTask(task);
}

function getPreferredSlot(task, currentPlan) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var morningCount = currentPlan.mattina.length;
  var afternoonCount = currentPlan.pomeriggio.length;
  var forcedSlot = getTaskForcedSlot(task);

  if (forcedSlot) return forcedSlot;

  if (task.energiaStimata === "alta") return "mattina";
  if (task.energiaStimata === "media") return "pomeriggio";
  if (giorni !== null && giorni <= 0) return morningCount <= afternoonCount ? "mattina" : "pomeriggio";
  return afternoonCount <= morningCount ? "pomeriggio" : "mattina";
}

function chooseSlotForTask(task, planSections) {
  var explicitHint = getExplicitSlotHint(task);
  var timeHint = getTimeBasedSlotHint(task);
  var preferred = getPreferredSlot(task, planSections);
  var secondary = preferred === "mattina" ? "pomeriggio" : "mattina";
  var preferredReason = getSlotConstraintReason(task, preferred, planSections);
  var secondaryReason;

  if (timeHint) {
    if (!preferredReason) {
      return { slot: timeHint, reason: "assegnato_slot_orario" };
    }

    return {
      slot: null,
      reason: timeHint + ": " + preferredReason + " (vincolo orario)"
    };
  }

  if (explicitHint) {
    if (!preferredReason) {
      return { slot: explicitHint, reason: "assegnato_slot_esplicito" };
    }

    return {
      slot: null,
      reason: explicitHint + ": " + preferredReason + " (vincolo temporale esplicito)"
    };
  }

  if (!preferredReason) {
    return { slot: preferred, reason: "assegnato_slot_preferito" };
  }

  secondaryReason = getSlotConstraintReason(task, secondary, planSections);
  if (!secondaryReason) {
    return { slot: secondary, reason: "assegnato_slot_secondario" };
  }

  return {
    slot: null,
    reason: preferred + ": " + preferredReason + " | " + secondary + ": " + secondaryReason
  };
}

function assignPrimaryTasks(tasks) {
  var planSections = {
    mattina: [],
    pomeriggio: []
  };
  var selectedTasks = [];
  var blockedUrgentTasks = 0;
  var deferredTodayTasks = [];

  function pushDeferredToday(task, reason) {
    if (!task) return;
    if (deferredTodayTasks.indexOf(task) === -1) {
      deferredTodayTasks.push(task);
      logDailyPlanDebug(task, "rinviato_a_resta_da_fare_oggi", { slotFinale: "restaDaFareOggi", motivo: reason || "task di oggi non entrato nei limiti degli slot" });
    }
  }

  function tryReplaceLessImportantTaskForTimed(task, targetSlot) {
    var slotTasks;
    var slotMinutes;
    var durationTask;
    var taskUrgency;
    var candidateIndex = -1;
    var candidateUrgency = -Infinity;
    var candidate;
    var tempSections;

    if (!targetSlot) return null;

    slotTasks = planSections[targetSlot] || [];
    if (slotTasks.length === 0) return null;

    slotMinutes = getPlanSlotMinutes(slotTasks);
    durationTask = normalizzaDurataStimata(task && task.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;
    taskUrgency = getTaskUrgencyScore(task);

    for (var i = 0; i < slotTasks.length; i++) {
      var current = slotTasks[i];
      var currentUrgency = getTaskUrgencyScore(current);
      var currentDuration = normalizzaDurataStimata(current && current.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;

      if (getTaskTimeMinutes(current) !== null) continue;
      if (getTaskForcedSlot(current)) continue;
      if (currentUrgency < taskUrgency) continue;
      if (slotMinutes - currentDuration + durationTask > DAILY_PLAN_MAX_SLOT_MINUTES) continue;

      if (currentUrgency > candidateUrgency) {
        candidateUrgency = currentUrgency;
        candidateIndex = i;
      }
    }

    if (candidateIndex < 0) return null;

    candidate = slotTasks[candidateIndex];
    tempSections = {
      mattina: planSections.mattina.slice(),
      pomeriggio: planSections.pomeriggio.slice()
    };

    tempSections[targetSlot].splice(candidateIndex, 1);
    if (getSlotConstraintReason(task, targetSlot, tempSections)) return null;

    planSections[targetSlot].splice(candidateIndex, 1, task);
    var selectedCandidateIndex = selectedTasks.indexOf(candidate);
    if (selectedCandidateIndex !== -1) selectedTasks.splice(selectedCandidateIndex, 1);
    selectedTasks.push(task);
    return candidate;
  }

  function tryAssignFromList(taskList, listName, maxToAssign) {
    var assignedCount = 0;

    for (var idx = 0; idx < taskList.length; idx++) {
      var task = taskList[idx];
      var slotChoice;

      if (typeof maxToAssign === "number" && assignedCount >= maxToAssign) break;

      if (selectedTasks.indexOf(task) !== -1) continue;
      if (shouldReserveForExtraTime(task)) {
        logDailyPlanDebug(task, "escluso_dal_piano_principale", { slotFinale: "seAvanzaTempo", motivo: listName + ": riservato a seAvanzaTempo" });
        continue;
      }

      slotChoice = chooseSlotForTask(task, planSections);
      if (!slotChoice.slot) {
        var replacedTask = null;

        if (getTaskTimeMinutes(task) !== null) {
          replacedTask = tryReplaceLessImportantTaskForTimed(task, getTaskForcedSlot(task));
        }

        if (replacedTask) {
          assignedCount++;
          pushDeferredToday(replacedTask, "sostituito da task di oggi con orario vincolato");
          logDailyPlanDebug(task, "incluso_nel_piano_principale", { slotFinale: getTaskForcedSlot(task), motivo: listName + ": inserito con priorita oraria, sostituito task meno urgente" });
          continue;
        }

        if (isUrgentPrimaryTask(task) || isConcreteShortDeadlineTask(task)) {
          blockedUrgentTasks++;
        }
        if (isExactTodayTask(task) || isTimeConstrainedTodayTask(task) || isExplicitTodaySlotTask(task)) {
          pushDeferredToday(task, listName + ": " + slotChoice.reason);
          continue;
        }
        logDailyPlanDebug(task, "escluso_dal_piano_principale", { slotFinale: "seAvanzaTempo", motivo: listName + ": " + slotChoice.reason });
        continue;
      }

      planSections[slotChoice.slot].push(task);
      selectedTasks.push(task);
      assignedCount++;
      logDailyPlanDebug(task, "incluso_nel_piano_principale", { slotFinale: slotChoice.slot, motivo: listName + ": " + slotChoice.slot + " (" + slotChoice.reason + ")" });
    }
  }

  var todayTasks = [];
  var pastDueTasks = [];
  var futureMonitoringTasks = [];
  var supplementalFutureTasks = [];
  var todayTaskCount = 0;

  for (var i = 0; i < tasks.length; i++) {
    if (isLowPriorityFlexibleTask(tasks[i])) {
      logDailyPlanDebug(tasks[i], "escluso_dal_piano_principale", { slotFinale: "seAvanzaTempo", motivo: "task flessibile o con scadenza vaga: riservato a seAvanzaTempo" });
      continue;
    }

    if (isTimeConstrainedTodayTask(tasks[i]) || isExplicitTodaySlotTask(tasks[i]) || isExactTodayTask(tasks[i])) {
      todayTasks.push(tasks[i]);
      todayTaskCount++;
      continue;
    }

    if (isPastDueTask(tasks[i])) {
      pastDueTasks.push(tasks[i]);
      continue;
    }

    if (isFutureMonitoringTask(tasks[i])) {
      futureMonitoringTasks.push(tasks[i]);

      if (todayTaskCount < 2 && isImportantAndBriefFutureTask(tasks[i])) {
        supplementalFutureTasks.push(tasks[i]);
      } else {
        logDailyPlanDebug(tasks[i], "escluso_dal_piano_principale", { slotFinale: "seAvanzaTempo", motivo: "task futuro riservato a seAvanzaTempo" });
      }
      continue;
    }

    logDailyPlanDebug(tasks[i], "escluso_dal_piano_principale", { slotFinale: "seAvanzaTempo", motivo: "task senza data o non urgente: non entra nel piano principale di oggi" });
  }

  if (todayTasks.length > 0) {
    var timedTodayTasks = [];
    var untimedTodayTasks = [];

    for (var t = 0; t < todayTasks.length; t++) {
      if (getTaskTimeMinutes(todayTasks[t]) !== null) {
        timedTodayTasks.push(todayTasks[t]);
      } else {
        untimedTodayTasks.push(todayTasks[t]);
      }
    }

    timedTodayTasks = sortTodayTasksForPlan(timedTodayTasks);
    untimedTodayTasks = sortUntimedTodayTasksForPlan(untimedTodayTasks);

    tryAssignFromList(timedTodayTasks, "task_di_oggi_con_orario");
    tryAssignFromList(untimedTodayTasks, "task_di_oggi_senza_orario");

    if (todayTaskCount < 2 && selectedTasks.length < DAILY_PLAN_MAX_TASKS) {
      tryAssignFromList(supplementalFutureTasks, "eccezione_task_futuri_importanti", 2 - todayTaskCount);
    }

    sortPlanSections(planSections);

    return {
      mattina: planSections.mattina,
      pomeriggio: planSections.pomeriggio,
      restaDaFareOggi: sortTodayTasksForPlan(deferredTodayTasks),
      tasks: selectedTasks,
      futureMonitoringTasks: futureMonitoringTasks,
      blockedUrgentTasks: blockedUrgentTasks,
      minutiMattina: getPlanSlotMinutes(planSections.mattina),
      minutiPomeriggio: getPlanSlotMinutes(planSections.pomeriggio)
    };
  }

  tryAssignFromList(pastDueTasks, "task_scaduti");

  if (selectedTasks.length < DAILY_PLAN_MAX_TASKS && supplementalFutureTasks.length > 0) {
    tryAssignFromList(supplementalFutureTasks, "eccezione_task_futuri_importanti", 2);
  }

  sortPlanSections(planSections);

  return {
    mattina: planSections.mattina,
    pomeriggio: planSections.pomeriggio,
    restaDaFareOggi: sortTodayTasksForPlan(deferredTodayTasks),
    tasks: selectedTasks,
    futureMonitoringTasks: futureMonitoringTasks,
    blockedUrgentTasks: blockedUrgentTasks,
    minutiMattina: getPlanSlotMinutes(planSections.mattina),
    minutiPomeriggio: getPlanSlotMinutes(planSections.pomeriggio)
  };
}

function buildExtraTimeTasks(sortedTasks, selectedTasks, deferredTodayTasks) {
  var extra = [];
  var deferredToday = Array.isArray(deferredTodayTasks) ? deferredTodayTasks : [];

  for (var i = 0; i < sortedTasks.length; i++) {
    var task = sortedTasks[i];
    if (selectedTasks.indexOf(task) !== -1) continue;

    if (isExactTodayTask(task) || isTimeConstrainedTodayTask(task) || isExplicitTodaySlotTask(task)) {
      if (deferredToday.indexOf(task) !== -1) {
        logDailyPlanDebug(task, "escluso_da_se_avanza_tempo", { slotFinale: "restaDaFareOggi", motivo: "task di oggi mantenuto in resta da fare oggi" });
      } else {
        logDailyPlanDebug(task, "escluso_da_se_avanza_tempo", { slotFinale: "restaDaFareOggi", motivo: "task di oggi non puo essere trattato come opzionale" });
      }
      continue;
    }

    var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
    var urgente = giorni !== null && giorni <= 3;
    var leggero = isVeryShortTask(task) || getTaskEnergyValue(task.energiaStimata) <= 2;
    var importante = getDynamicPriority(task) === "alta" || getTaskUrgencyBucket(task) <= 3;

    if (isLowPriorityFlexibleTask(task)) {
      extra.push(task);
      logDailyPlanDebug(task, "incluso_in_se_avanza_tempo", { slotFinale: "seAvanzaTempo", motivo: "task con scadenza vaga o bassa priorita flessibile" });
      continue;
    }

    if (isFutureMonitoringTask(task)) {
      if (canFutureTaskAppearToday(task) && (giorni !== 1 || isAllowedTomorrowExtraTask(task))) {
        extra.push(task);
        logDailyPlanDebug(task, "incluso_in_se_avanza_tempo", { slotFinale: "seAvanzaTempo", motivo: "task futuro ma preparatorio o utile in anticipo" });
      } else {
        logDailyPlanDebug(task, "escluso_dal_piano", { slotFinale: "seAvanzaTempo", motivo: "task futuro monitorato, non utile oggi" });
      }
      continue;
    }

    if (urgente || leggero || importante || isPreparatoryTask(task)) {
      if (giorni !== 1 || isAllowedTomorrowExtraTask(task)) {
        extra.push(task);
        logDailyPlanDebug(task, "incluso_in_se_avanza_tempo", { slotFinale: "seAvanzaTempo", motivo: "task leggero, utile o preparatorio" });
      } else {
        logDailyPlanDebug(task, "escluso_dal_piano", { slotFinale: "seAvanzaTempo", motivo: "task di domani non abbastanza breve o preparatorio" });
      }
    } else {
      logDailyPlanDebug(task, "escluso_dal_piano", { slotFinale: "seAvanzaTempo", motivo: "task non essenziale per oggi" });
    }
  }

  return extra;
}

function buildSmartDailyPlan(tasks) {
  var pendenti = [];

  if (DAILY_PLAN_DEBUG) {
    console.log("[ActionFlow][OrganizzaGiornata] Inizio buildSmartDailyPlan", {
      totaleTaskRicevuti: Array.isArray(tasks) ? tasks.length : 0,
      dataOggi: formatISO(inizioOggiLocale())
    });
  }

  for (var i = 0; i < tasks.length; i++) {
    if (!tasks[i].completato) {
      pendenti.push(tasks[i]);
      logDailyPlanDebug(tasks[i], "candidato", "task non completato considerato per il piano");
    } else {
      logDailyPlanDebug(tasks[i], "escluso_dal_piano", "task completato");
    }
  }

  var ordinati = sortTasksForDailyPlan(pendenti);
  var scelta = assignPrimaryTasks(ordinati);
  var planSections = {
    mattina: scelta.mattina.slice(),
    pomeriggio: scelta.pomeriggio.slice(),
    restaDaFareOggi: Array.isArray(scelta.restaDaFareOggi) ? scelta.restaDaFareOggi.slice() : [],
    seAvanzaTempo: []
  };

  planSections.seAvanzaTempo = buildExtraTimeTasks(ordinati, scelta.tasks, planSections.restaDaFareOggi);

  if (scelta.tasks.length === 0 && planSections.seAvanzaTempo.length === 0 && planSections.restaDaFareOggi.length === 0 && ordinati.length > 0) {
    var rescueTask = ordinati[0];
    var rescueSlot = chooseSlotForTask(rescueTask, { mattina: [], pomeriggio: [] });

    if (rescueSlot.slot) {
      planSections[rescueSlot.slot].push(rescueTask);
      scelta.tasks.push(rescueTask);
      scelta.minutiMattina = rescueSlot.slot === "mattina" ? getPlanSlotMinutes(planSections.mattina) : 0;
      scelta.minutiPomeriggio = rescueSlot.slot === "pomeriggio" ? getPlanSlotMinutes(planSections.pomeriggio) : 0;
      logDailyPlanDebug(rescueTask, "rescue_incluso_nel_piano", "nessun task selezionato: attivato fallback sicuro");
    }
  }

  if (DAILY_PLAN_DEBUG) {
    console.log("[ActionFlow][OrganizzaGiornata] Fine buildSmartDailyPlan", {
      taskPrincipali: scelta.tasks.length,
      taskMattina: planSections.mattina.length,
      taskPomeriggio: planSections.pomeriggio.length,
      taskRestaDaFareOggi: planSections.restaDaFareOggi.length,
      taskExtra: planSections.seAvanzaTempo.length,
      taskFuturiMonitorati: scelta.futureMonitoringTasks.length,
      blockedUrgentTasks: scelta.blockedUrgentTasks
    });
  }

  return {
    data: formatISO(inizioOggiLocale()),
    mattina: planSections.mattina,
    pomeriggio: planSections.pomeriggio,
    restaDaFareOggi: planSections.restaDaFareOggi,
    seAvanzaTempo: planSections.seAvanzaTempo,
    daFareOggi: planSections.mattina.concat(planSections.pomeriggio).concat(planSections.restaDaFareOggi),
    totali: {
      taskConsiderati: ordinati.length,
      minutiMattina: scelta.minutiMattina,
      minutiPomeriggio: scelta.minutiPomeriggio,
      minutiDaFareOggi: scelta.minutiMattina + scelta.minutiPomeriggio,
      taskMattina: planSections.mattina.length,
      taskPomeriggio: planSections.pomeriggio.length,
      taskRestaDaFareOggi: planSections.restaDaFareOggi.length,
      taskFuturiMonitorati: scelta.futureMonitoringTasks.length
    }
  };
}

function buildDailyPlan(tasks) {
  return buildSmartDailyPlan(tasks);
}

function getDailyPlanTaskSignature(tasks) {
  var source = Array.isArray(tasks) ? tasks : [];
  var normalized = [];

  for (var i = 0; i < source.length; i++) {
    var task = source[i];
    if (!task || !task.testo) continue;

    normalized.push([
      task.id || generaIdAzione(task.testo || ""),
      normalizeText(task.testo || ""),
      task.priorita || "bassa",
      task.dataISO || "",
      task.time || "",
      task.completato ? "1" : "0"
    ].join("|"));
  }

  normalized.sort();
  return normalized.join("||");
}

function isDailyPlanStale(plan, tasks) {
  var normalizedPlan = normalizeDailyPlan(plan);
  var sourceTasks = Array.isArray(tasks) ? tasks : [];
  var taskSignature = getDailyPlanTaskSignature(sourceTasks);
  var sourceTaskCount = sourceTasks.length;
  var planTaskCount = normalizedPlan && normalizedPlan.meta && typeof normalizedPlan.meta.sourceTaskCount === "number"
    ? normalizedPlan.meta.sourceTaskCount
    : (normalizedPlan && normalizedPlan.totali ? normalizedPlan.totali.taskConsiderati || 0 : 0);

  if (!normalizedPlan) {
    return sourceTaskCount > 0;
  }

  if (!normalizedPlan.meta || !normalizedPlan.meta.taskSignature) {
    return true;
  }

  return normalizedPlan.meta.taskSignature !== taskSignature || planTaskCount !== sourceTaskCount;
}

function canUseScopedPlanningData() {
  return !(window.ActionFlowAuth && typeof window.ActionFlowAuth.isLoaded === "function") || window.ActionFlowAuth.isLoaded();
}

function saveDailyPlan(plan, sourceTasks) {
  var normalizedPlan = normalizeDailyPlan(plan);
  var tasks = Array.isArray(sourceTasks) ? sourceTasks : [];

  if (normalizedPlan) {
    normalizedPlan.meta = {
      taskSignature: getDailyPlanTaskSignature(tasks),
      sourceTaskCount: tasks.length
    };
  }

  window.ActionFlowAuth.writeScopedObject(DAILY_PLAN_STORAGE_KEY, normalizedPlan);

  if (DAILY_PLAN_DEBUG) {
    console.log("[ActionFlow][OrganizzaGiornata] saveDailyPlan", countDailyPlanTasks(normalizedPlan));
  }

  return normalizedPlan;
}

function loadDailyPlan() {
  try {
    var rawPlan = window.ActionFlowAuth.readScopedObject(DAILY_PLAN_STORAGE_KEY);
    var plan = rawPlan && Object.keys(rawPlan).length ? normalizeDailyPlan(rawPlan) : null;

    if (DAILY_PLAN_DEBUG && plan) {
      console.log("[ActionFlow][OrganizzaGiornata] loadDailyPlan", countDailyPlanTasks(plan));
    }

    return plan;
  } catch (e) {
    return null;
  }
}

function formatDailyPlanDue(task) {
  if (task.scadenzaOriginale && task.dataISO && task.scadenzaOriginale !== task.dataISO) {
    return task.scadenzaOriginale + " (" + task.dataISO + ")";
  }

  return task.scadenzaOriginale || task.dataISO || "";
}

function appendTaskMeta(meta, task) {
  var displayTask = resolveTaskForDisplay(task, null);
  var badgePriorita = document.createElement("span");
  badgePriorita.className = "badge-priorita priorita-" + (displayTask.prioritaDinamica || "bassa");
  badgePriorita.textContent = displayTask.prioritaDinamica || "bassa";
  meta.appendChild(badgePriorita);

  if (displayTask.durataStimataMinuti) {
    var durata = document.createElement("span");
    durata.className = "azione-durata";
    durata.textContent = displayTask.durataStimataMinuti + " min";
    meta.appendChild(durata);
  }

  if (displayTask.energiaStimata) {
    var energia = document.createElement("span");
    energia.className = "badge-energia badge-energia-" + displayTask.energiaStimata;
    energia.textContent = "Energia: " + displayTask.energiaStimata;
    meta.appendChild(energia);
  }

  if (displayTask.time) {
    var badgeTime = document.createElement("span");
    badgeTime.className = "badge-time";
    badgeTime.textContent = displayTask.time;
    meta.appendChild(badgeTime);
  }

  var scadenza = displayTask.labelScadenzaDinamica || formatDailyPlanDue(displayTask);
  if (scadenza) {
    var badgeData = document.createElement("span");
    badgeData.className = "badge-data";
    badgeData.textContent = scadenza;
    meta.appendChild(badgeData);
  }
}

function renderDailyPlanTasks(listId, tasks) {
  var lista = document.getElementById(listId);
  if (!lista) return;

  lista.innerHTML = "";

  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    var li = document.createElement("li");
    li.className = "piano-task-item priorita-" + (task.priorita || "bassa");

    var testo = document.createElement("div");
    testo.className = "piano-task-testo";
    testo.textContent = task.testo;
    li.appendChild(testo);

    var meta = document.createElement("div");
    meta.className = "piano-task-meta";
    appendTaskMeta(meta, task);

    li.appendChild(meta);
    lista.appendChild(li);
  }
}

function getDailyPlanSections(plan) {
  var piano = plan || {};
  var mattina = Array.isArray(piano.mattina) ? piano.mattina.slice() : [];
  var pomeriggio = Array.isArray(piano.pomeriggio) ? piano.pomeriggio.slice() : [];
  var restaDaFareOggi = Array.isArray(piano.restaDaFareOggi) ? piano.restaDaFareOggi.slice() : [];
  var seAvanzaTempo = Array.isArray(piano.seAvanzaTempo) ? piano.seAvanzaTempo.slice() : [];

  if (mattina.length === 0 && pomeriggio.length === 0 && restaDaFareOggi.length === 0 && Array.isArray(piano.daFareOggi)) {
    var taskOggi = piano.daFareOggi.slice();
    var splitIndex = Math.ceil(taskOggi.length / 2);
    mattina = taskOggi.slice(0, splitIndex);
    pomeriggio = taskOggi.slice(splitIndex);
  }

  return {
    mattina: mattina,
    pomeriggio: pomeriggio,
    restaDaFareOggi: restaDaFareOggi,
    seAvanzaTempo: seAvanzaTempo
  };
}

function hasFocusLaterTodayHint(task) {
  var testo = (task && task.testo ? task.testo : "").toLowerCase();
  var scadenza = (task && task.scadenzaOriginale ? task.scadenzaOriginale : "").toLowerCase();
  var combined = (testo + " " + scadenza).trim();

  if (!combined) return false;

  return /oggi\s+pomeriggio|questo\s+pomeriggio|nel\s+pomeriggio|piu\s+tardi|più\s+tardi|\bdopo\b/.test(combined);
}

function getFocusTaskBucket(task, sourceSlot) {
  var explicitSlot = getExplicitSlotHint(task);

  if (hasFocusLaterTodayHint(task)) return "later_today";
  if (explicitSlot === "pomeriggio") return "later_today";
  if (sourceSlot === "pomeriggio") return "later_today";
  return "after_now";
}

function getFocusTaskSortScore(entry) {
  var task = entry && entry.task ? entry.task : entry;
  var bucket = entry && entry.focusBucket ? entry.focusBucket : getFocusTaskBucket(task, entry && entry.sourceSlot ? entry.sourceSlot : null);
  var urgency = getTaskUrgencyScore(task);
  var duration = normalizzaDurataStimata(task && task.durataStimataMinuti) || DAILY_PLAN_DEFAULT_DURATION;
  var energy = getTaskEnergyValue(task && task.energiaStimata ? task.energiaStimata : "media");

  if (bucket === "after_now") {
    return {
      bucket: 0,
      urgency: urgency,
      duration: duration,
      energy: energy
    };
  }

  return {
    bucket: 1,
    urgency: urgency,
    duration: duration,
    energy: energy
  };
}

function sortFocusEntries(entries) {
  return entries.slice().sort(function(a, b) {
    var scoreA = getFocusTaskSortScore(a);
    var scoreB = getFocusTaskSortScore(b);

    if (scoreA.bucket !== scoreB.bucket) return scoreA.bucket - scoreB.bucket;
    if (scoreA.urgency !== scoreB.urgency) return scoreA.urgency - scoreB.urgency;
    if (scoreA.duration !== scoreB.duration) return scoreA.duration - scoreB.duration;
    if (scoreA.energy !== scoreB.energy) return scoreA.energy - scoreB.energy;

    var textA = a && a.task && a.task.testo ? a.task.testo : "";
    var textB = b && b.task && b.task.testo ? b.task.testo : "";
    return textA.localeCompare(textB, "it");
  });
}

function decorateFocusTask(task, focusBucket, sourceSlot) {
  var decorated = Object.assign({}, task);
  decorated.focusBucket = focusBucket;
  decorated.focusSourceSlot = sourceSlot || null;
  decorated.focusTimingLabel = focusBucket === "later_today" ? "Più tardi oggi" : "Subito dopo";
  return decorated;
}

function getFocusTasks(plan) {
  var piano = plan || loadDailyPlan() || { mattina: [], pomeriggio: [], restaDaFareOggi: [], seAvanzaTempo: [] };
  var sezioniPiano = getDailyPlanSections(piano);
  var mattina = (sezioniPiano.mattina || []).slice();
  var pomeriggio = (sezioniPiano.pomeriggio || []).slice();
  var restaDaFareOggi = (sezioniPiano.restaDaFareOggi || []).slice();
  var extra = (sezioniPiano.seAvanzaTempo || []).slice();
  var ora = null;
  var dopo = [];
  var piuTardiOggi = [];
  var seAvanzaTempo = extra.slice();

  if (mattina.length > 0) {
    ora = decorateFocusTask(mattina[0], "now", "mattina");
    dopo = mattina.slice(1).map(function(task) {
      return decorateFocusTask(task, "after_now", "mattina");
    });
    piuTardiOggi = sortTodayTasksForPlan(pomeriggio.concat(restaDaFareOggi)).map(function(task) {
      return decorateFocusTask(task, "later_today", "pomeriggio");
    });
  } else if (pomeriggio.length > 0) {
    ora = decorateFocusTask(pomeriggio[0], "now", "pomeriggio");
    piuTardiOggi = sortTodayTasksForPlan(pomeriggio.slice(1).concat(restaDaFareOggi)).map(function(task) {
      return decorateFocusTask(task, "later_today", "pomeriggio");
    });
  } else if (restaDaFareOggi.length > 0) {
    ora = decorateFocusTask(restaDaFareOggi[0], "now", "resta");
    piuTardiOggi = sortTodayTasksForPlan(restaDaFareOggi.slice(1)).map(function(task) {
      return decorateFocusTask(task, "later_today", "resta");
    });
  } else if (extra.length > 0) {
    ora = decorateFocusTask(extra[0], "now", "extra");
    seAvanzaTempo = extra.slice(1);
  }

  return {
    ora: ora,
    dopo: dopo,
    piuTardiOggi: piuTardiOggi,
    seAvanzaTempo: seAvanzaTempo
  };
}

function renderFocusTaskList(listId, tasks, variant) {
  var lista = document.getElementById(listId);
  if (!lista) return;

  lista.innerHTML = "";

  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    var li = document.createElement("li");
    li.className = "focus-task-item" + (variant === "ora" ? " focus-task-item-now" : "");

    var testo = document.createElement("div");
    testo.className = "focus-task-testo";
    testo.textContent = task.testo;
    li.appendChild(testo);

    if (variant === "dopo" && task.focusTimingLabel) {
      var timing = document.createElement("div");
      timing.className = "focus-task-timing";

      var timingBadge = document.createElement("span");
      timingBadge.className = "badge-data";
      timingBadge.textContent = task.focusTimingLabel;

      timing.appendChild(timingBadge);
      li.appendChild(timing);
    }

    var meta = document.createElement("div");
    meta.className = "focus-task-meta";
    appendTaskMeta(meta, task);
    li.appendChild(meta);

    lista.appendChild(li);
  }
}

function renderFocus(plan) {
  var focus = getFocusTasks(plan);
  var section = document.getElementById("sezione-focus");
  var summary = document.getElementById("focus-sommario");
  var groups = [
    { id: "focus-blocco-ora", listId: "focus-lista-ora", items: focus.ora ? [focus.ora] : [], variant: "ora" },
    { id: "focus-blocco-dopo", listId: "focus-lista-dopo", items: focus.dopo, variant: "dopo" },
    { id: "focus-blocco-piu-tardi", listId: "focus-lista-piu-tardi", items: focus.piuTardiOggi, variant: "piu-tardi" },
    { id: "focus-blocco-extra", listId: "focus-lista-extra", items: focus.seAvanzaTempo, variant: "extra" }
  ];
  var visibleCount = 0;

  if (!section) return;

  for (var i = 0; i < groups.length; i++) {
    renderFocusTaskList(groups[i].listId, groups[i].items, groups[i].variant);
    var block = document.getElementById(groups[i].id);
    var visible = groups[i].items.length > 0;
    setVisibility(block, visible, "block");
    if (visible) visibleCount++;
  }

  if (summary) {
    if (focus.ora) {
      summary.textContent = "ORA mostra il prossimo passo immediato, seguito da DOPO e PIÙ TARDI OGGI secondo il piano della giornata.";
    } else {
      summary.textContent = "";
    }
  }

  setVisibility(section, visibleCount > 0, "block");
}

function renderDailyPlan(plan, showEmptyState) {
  var sezione = document.getElementById("sezione-piano-giornaliero");
  var emptyState = document.getElementById("piano-giornaliero-vuoto");
  var summary = document.getElementById("piano-giornaliero-sommario");
  var normalizedPlan = normalizeDailyPlan(plan);
  var sezioniPiano = getDailyPlanSections(normalizedPlan);
  var blocchi = [
    { id: "blocco-mattina", listId: "lista-mattina", items: sezioniPiano.mattina },
    { id: "blocco-pomeriggio", listId: "lista-pomeriggio", items: sezioniPiano.pomeriggio },
    { id: "blocco-resta-da-fare-oggi", listId: "lista-resta-da-fare-oggi", items: sezioniPiano.restaDaFareOggi },
    { id: "blocco-se-avanza-tempo", listId: "lista-se-avanza-tempo", items: sezioniPiano.seAvanzaTempo }
  ];
  var haContenuto = false;
  var taskPianificati = sezioniPiano.mattina.length + sezioniPiano.pomeriggio.length + sezioniPiano.restaDaFareOggi.length;

  if (!sezione) {
    renderFocus(normalizedPlan);
    return;
  }

  if (DAILY_PLAN_DEBUG && normalizedPlan) {
    console.log("[ActionFlow][OrganizzaGiornata] renderDailyPlan", countDailyPlanTasks(normalizedPlan));
  }

  for (var i = 0; i < blocchi.length; i++) {
    renderDailyPlanTasks(blocchi[i].listId, blocchi[i].items);
    var blocco = document.getElementById(blocchi[i].id);
    var visibile = blocchi[i].items.length > 0;
    setVisibility(blocco, visibile, "block");
    if (visibile) haContenuto = true;
  }

  if (summary) {
    if (normalizedPlan && haContenuto) {
      summary.textContent = "Aggiornato al " + (normalizedPlan.data || formatISO(inizioOggiLocale())) + " • " + taskPianificati + " task principali • Mattina " + (normalizedPlan.totali ? normalizedPlan.totali.minutiMattina || 0 : 0) + " min • Pomeriggio " + (normalizedPlan.totali ? normalizedPlan.totali.minutiPomeriggio || 0 : 0) + " min";
    } else {
      summary.textContent = "";
    }
  }

  setVisibility(emptyState, !haContenuto && showEmptyState, "block");

  setVisibility(sezione, haContenuto || showEmptyState, "block");
  renderFocus(normalizedPlan);
}

function refreshDailyPlanIfPresent() {
  var existingPlan = window.ActionFlowAuth.readScopedObject(DAILY_PLAN_STORAGE_KEY);
  if (!existingPlan || Object.keys(existingPlan).length === 0) return null;

  var tasks = getSavedTasksForPlanning();
  var plan = buildDailyPlan(tasks);
  var sezioniPiano = getDailyPlanSections(plan);
  var savedPlan = saveDailyPlan(plan, tasks);
  renderDailyPlan(savedPlan, sezioniPiano.mattina.length + sezioniPiano.pomeriggio.length + sezioniPiano.restaDaFareOggi.length + sezioniPiano.seAvanzaTempo.length === 0);
  return savedPlan;
}

function ensureDailyPlanForCurrentTasks(showEmptyState) {
  var savedPlan = loadDailyPlan();

  if (!canUseScopedPlanningData()) {
    renderDailyPlan(savedPlan, false);
    return savedPlan;
  }

  var tasks = getSavedTasksForPlanning();

  if (isDailyPlanStale(savedPlan, tasks)) {
    savedPlan = saveDailyPlan(buildDailyPlan(tasks), tasks);
  }

  renderDailyPlan(savedPlan, !!showEmptyState);
  return savedPlan;
}

function isDailyPlanPage() {
  return window.location.pathname === "/organizza-giornata" || window.location.pathname.endsWith("/organizza-giornata.html");
}

function organizeDay() {
  var tasks = getSavedTasksForPlanning();
  var plan = buildDailyPlan(tasks);
  var savedPlan = saveDailyPlan(plan, tasks);
  renderDailyPlan(savedPlan, true);

  if (!isDailyPlanPage()) {
    window.location.href = "/organizza-giornata";
  }

  return savedPlan;
}

// Prova a rendere un'azione più breve e chiara.
// Se la pulizia non è affidabile, restituisce la frase originale.
function pulisciAzione(frase) {
  var originale = frase.trim();
  var originalePulita = originale.replace(/\s+/g, " ");

  // Rimuove introduzioni comuni all'inizio della frase
  originalePulita = originalePulita.replace(/^(ricordati di|ricordarsi di|ricorda di|non dimenticare di)\s+/i, "");
  originalePulita = originalePulita.replace(/^(devo|devi|dobbiamo|bisogna|occorre|si deve|puoi)\s+/i, "");
  originalePulita = originalePulita.replace(/[\s,;:.!\-]+$/, "").trim();

  var azione = originalePulita;

  // Rimuove la parte finale con la scadenza (se presente in coda)
  azione = azione.replace(/\s*(,|-)?\s*entro\b.*$/i, "");
  azione = azione.replace(/\s*(,|-)?\s*(questo weekend|fine settimana|settimana prossima|fine mese|oggi|domani|dopodomani|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi)\s*$/i, "");
  azione = azione.replace(/\s*(,|-)?\s*alle\s+([01]?\d|2[0-3])(?::([0-5]\d))?\s*$/i, "");
  azione = azione.replace(/\s*(,|-)?\s*(oggi\s+pomeriggio|questo\s+pomeriggio|nel\s+pomeriggio|stamattina|questa\s+mattina|oggi\s+mattina|piu\s+tardi|più\s+tardi|dopo)\s*$/i, "");
  azione = azione.replace(/\s*(,|-)?\s*\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\s*$/i, "");
  azione = azione.replace(/\s*(,|-)?\s*\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(\s+\d{4})?\s*$/i, "");

  azione = azione.replace(/[\s,;:.!\-]+$/, "").trim();

  // Rimuove parole residue appese alla fine (articoli, preposizioni)
  var precedente;
  do {
    precedente = azione;
    azione = azione.replace(/\s+(di|del|della|dei|degli|delle|a|ad|da|in|su|per|con|tra|fra|al|allo|alla|ai|agli|alle|il|lo|la|i|gli|le|un|uno|una|entro)\s*$/i, "");
    azione = azione.replace(/[\s,;:.!\-]+$/, "").trim();
  } while (azione !== precedente);

  // Se il risultato è troppo debole, torna alla frase originale
  if (azione.length < 3 || !/[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(azione)) {
    return originalePulita || originale;
  }

  return azione.charAt(0).toUpperCase() + azione.slice(1);
}

var VERBI_AZIONE_MAPPA = {
  "controllare": "Controllare",
  "controlla": "Controllare",
  "controllalo": "Controllare",
  "controllarlo": "Controllare",
  "verificare": "Verificare",
  "verifica": "Verificare",
  "analizzare": "Analizzare",
  "analizza": "Analizzare",
  "firmare": "Firmare",
  "firma": "Firmare",
  "firmalo": "Firmare",
  "firmarla": "Firmare",
  "firmarlo": "Firmare",
  "inviare": "Inviare",
  "invia": "Inviare",
  "inviarlo": "Inviare",
  "inviarla": "Inviare",
  "mandare": "Inviare",
  "manda": "Inviare",
  "mandarlo": "Inviare",
  "mandarla": "Inviare",
  "rimandare": "Inviare",
  "rimanda": "Inviare",
  "rimandalo": "Inviare",
  "rimandarla": "Inviare",
  "rimandarlo": "Inviare",
  "rimandamelo": "Inviare",
  "rimandamela": "Inviare",
  "contattare": "Contattare",
  "contatta": "Contattare",
  "chiamare": "Chiamare",
  "chiama": "Chiamare",
  "compilare": "Compilare",
  "compila": "Compilare",
  "preparare": "Preparare",
  "prepara": "Preparare",
  "scrivere": "Scrivere",
  "scrivi": "Scrivere",
  "organizzare": "Organizzare",
  "organizza": "Organizzare",
  "rivedere": "Rivedere",
  "rivedi": "Rivedere",
  "fissare": "Fissare",
  "fissa": "Fissare",
  "prenotare": "Prenotare",
  "prenota": "Prenotare",
  "pagare": "Pagare",
  "paga": "Pagare",
  "pagarla": "Pagare",
  "pagarlo": "Pagare",
  "pagarle": "Pagare",
  "saldare": "Pagare",
  "salda": "Pagare",
  "completare": "Completare",
  "completa": "Completare",
  "finire": "Finire",
  "finisci": "Finire",
  "sistemare": "Sistemare",
  "sistema": "Sistemare",
  "sistemarlo": "Sistemare",
  "sistemarla": "Sistemare",
  "migliorare": "Migliorare",
  "migliora": "Migliorare",
  "migliorarlo": "Migliorare",
  "migliorarla": "Migliorare",
  "aggiornare": "Aggiornare",
  "aggiorna": "Aggiornare",
  "aggiornarlo": "Aggiornare",
  "aggiornarla": "Aggiornare",
  "creare": "Creare",
  "crea": "Creare",
  "crearlo": "Creare",
  "crearla": "Creare",
  "pensare": "Pensare",
  "pensa": "Pensare",
  "pensarci": "Pensare",
  "valutare": "Valutare",
  "valuta": "Valutare",
  "valutarlo": "Valutare",
  "valutarla": "Valutare"
};

function pulisciConnettoriInutili(testo) {
  var pulito = testo.trim();

  pulito = pulito.replace(/^(inoltre|poi|ah|grazie|quindi|allora)\b[\s,]*/i, "");
  pulito = pulito.replace(/^(non\s+dimenticare\s+di)\s+/i, "");
  pulito = pulito.replace(/^se\s+e\s+tutto\s+ok\b[\s,]*/i, "");
  pulito = pulito.replace(/^se\s+è\s+tutto\s+ok\b[\s,]*/i, "");

  return pulito.trim();
}

function fraseIgnorabile(testo) {
  var t = testo.trim().toLowerCase();
  return t === "" || t === "inoltre" || t === "poi" || t === "ah" || t === "grazie" || t === "quindi" || t === "allora" || t === "se è tutto ok" || t === "se e tutto ok";
}

function normalizzaToken(token) {
  return token.toLowerCase().replace(/^[^a-zA-ZÀ-ÖØ-öø-ÿ]+|[^a-zA-ZÀ-ÖØ-öø-ÿ]+$/g, "");
}

function trovaVerboCanonico(tokenPulito) {
  if (VERBI_AZIONE_MAPPA[tokenPulito]) {
    return VERBI_AZIONE_MAPPA[tokenPulito];
  }

  if (tokenPulito.indexOf("controll") === 0) return "Controllare";
  if (tokenPulito.indexOf("firm") === 0) return "Firmare";
  if (tokenPulito.indexOf("rimand") === 0 || tokenPulito.indexOf("mand") === 0 || tokenPulito.indexOf("invi") === 0) return "Inviare";
  if (tokenPulito.indexOf("contatt") === 0) return "Contattare";
  if (tokenPulito.indexOf("prepar") === 0) return "Preparare";
  if (tokenPulito.indexOf("pag") === 0 || tokenPulito.indexOf("sald") === 0) return "Pagare";
  if (tokenPulito.indexOf("compil") === 0) return "Compilare";
  if (tokenPulito.indexOf("scriv") === 0) return "Scrivere";
  if (tokenPulito.indexOf("chiam") === 0) return "Chiamare";
  if (tokenPulito.indexOf("sistem") === 0) return "Sistemare";
  if (tokenPulito.indexOf("miglior") === 0) return "Migliorare";
  if (tokenPulito.indexOf("aggiorn") === 0) return "Aggiornare";
  if (tokenPulito.indexOf("cre") === 0 && tokenPulito.indexOf("crea") === 0) return "Creare";
  if (tokenPulito.indexOf("pens") === 0) return "Pensare";
  if (tokenPulito.indexOf("valut") === 0) return "Valutare";
  if (tokenPulito.indexOf("organ") === 0) return "Organizzare";
  if (tokenPulito.indexOf("rived") === 0) return "Rivedere";

  return null;
}

function tokenHaPronomeOggetto(tokenPulito) {
  return /(lo|la|li|le|ne|melo|mela|meli|mele)$/.test(tokenPulito);
}

function livelloPriorita(priorita) {
  if (priorita === "alta") return 3;
  if (priorita === "media") return 2;
  return 1;
}

var HIGH_PRIORITY_DAYS = 2;
var MEDIUM_PRIORITY_DAYS = 7;

function calcolaPrioritaFrase(frase, testoAzione, dateLocali) {
  var fraseNorm = (frase || "").toLowerCase();
  var azioneNorm = (testoAzione || "").toLowerCase();

  // Parole forti → sempre alta
  if (/\b(urgente|subito|deadline)\b/i.test(fraseNorm) || /\b(urgente|subito|deadline)\b/i.test(azioneNorm)) {
    return "alta";
  }

  // Calcola giorni alla scadenza più vicina
  var giorniMin = Infinity;
  if (dateLocali && dateLocali.length > 0) {
    var oggi = new Date();
    oggi.setHours(0, 0, 0, 0);

    for (var i = 0; i < dateLocali.length; i++) {
      var iso = dateLocali[i].dataRisolta;
      if (!iso) continue;
      var parti = iso.split("-");
      if (parti.length !== 3) continue;
      var target = new Date(+parti[0], +parti[1] - 1, +parti[2]);
      target.setHours(0, 0, 0, 0);
      var diff = Math.round((target - oggi) / 86400000);
      if (diff < giorniMin) giorniMin = diff;
    }
  }

  if (giorniMin <= HIGH_PRIORITY_DAYS) return "alta";
  if (giorniMin <= MEDIUM_PRIORITY_DAYS) return "media";
  if (giorniMin < Infinity) return "bassa";

  // Nessuna scadenza → bassa
  return "bassa";
}

var GIORNI_SETTIMANA = {
  "domenica": 0, "lunedì": 1, "lunedi": 1,
  "martedì": 2, "martedi": 2,
  "mercoledì": 3, "mercoledi": 3,
  "giovedì": 4, "giovedi": 4,
  "venerdì": 5, "venerdi": 5,
  "sabato": 6
};

function risolviRiferimentoTemporale(testo) {
  var t = testo.trim().toLowerCase();
  var oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  var data = null;

  if (t === "oggi") {
    data = new Date(oggi);
  } else if (t === "domani") {
    data = new Date(oggi);
    data.setDate(data.getDate() + 1);
  } else if (t === "dopodomani") {
    data = new Date(oggi);
    data.setDate(data.getDate() + 2);
  } else if (t === "questo weekend" || t === "fine settimana") {
    var sabato = 6;
    var diffSab = sabato - oggi.getDay();
    if (diffSab <= 0) diffSab += 7;
    data = new Date(oggi);
    data.setDate(data.getDate() + diffSab);
  } else if (t === "settimana prossima") {
    var lunProssimo = 1;
    var diffLun = lunProssimo - oggi.getDay();
    if (diffLun <= 0) diffLun += 7;
    data = new Date(oggi);
    data.setDate(data.getDate() + diffLun);
    return { riferimentoOriginale: testo.trim(), dataCalcolata: null };
  } else if (t === "fine mese") {
    data = new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0);
  } else if (GIORNI_SETTIMANA[t] !== undefined) {
    var target = GIORNI_SETTIMANA[t];
    var oggiGiorno = oggi.getDay();
    var diff = target - oggiGiorno;
    if (diff <= 0) diff += 7;
    data = new Date(oggi);
    data.setDate(data.getDate() + diff);
  }

  if (!data) return null;

  var iso = data.getFullYear() + "-" +
    String(data.getMonth() + 1).padStart(2, "0") + "-" +
    String(data.getDate()).padStart(2, "0");

  return { riferimentoOriginale: testo.trim(), dataCalcolata: iso };
}

function formatISO(data) {
  return data.getFullYear() + "-" +
    String(data.getMonth() + 1).padStart(2, "0") + "-" +
    String(data.getDate()).padStart(2, "0");
}

function estraiScadenzeDaTesto(testo, regexData) {
  var risultati = [];
  var giaTrovati = [];

  // Trova tutte le date esplicite nella sottofrase
  var regexDateGlobal = new RegExp(regexData.source, "gi");
  var matchData;
  while ((matchData = regexDateGlobal.exec(testo)) !== null) {
    var dataTrovata = matchData[0].trim();
    if (giaTrovati.indexOf(dataTrovata) === -1) {
      giaTrovati.push(dataTrovata);
      risultati.push({ originale: dataTrovata, dataRisolta: null });
    }
  }

  // Trova riferimenti temporali relativi e li risolve (boundary Unicode-safe)
  var regexGiorniGlobal = /(?:^|[^a-zA-ZÀ-ÖØ-öø-ÿ])(questo weekend|fine settimana|settimana prossima|fine mese|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi|oggi|domani|dopodomani)(?=[^a-zA-ZÀ-ÖØ-öø-ÿ]|$)/gi;
  var matchGiorno;
  while ((matchGiorno = regexGiorniGlobal.exec(testo)) !== null) {
    var giornoTrovato = matchGiorno[1].trim();
    if (giaTrovati.indexOf(giornoTrovato) === -1) {
      giaTrovati.push(giornoTrovato);
      var risolto = risolviRiferimentoTemporale(giornoTrovato);
      risultati.push({
        originale: giornoTrovato,
        dataRisolta: risolto ? risolto.dataCalcolata : null
      });
    }
  }

  return risultati;
}

function pulisciOggettoAzione(oggetto) {
  var testo = oggetto;
  testo = testo.replace(/\s*(,|-)?\s*entro\b.*$/i, "");
  testo = testo.replace(/\s*(,|-)?\s*prima\s+della\s+riunione\s+di\s+(lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi)(?=[^a-zA-ZÀ-ÖØ-öø-ÿ]|$).*$/i, "");
  testo = testo.replace(/\s*(,|-)?\s*(questo weekend|fine settimana|settimana prossima|fine mese|oggi|domani|dopodomani|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi)(?=[^a-zA-ZÀ-ÖØ-öø-ÿ]|$).*$/i, "");
  testo = testo.replace(/\s*(,|-)?\s*\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\s*$/i, "");
  testo = testo.replace(/\s*(,|-)?\s*\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(\s+\d{4})?\s*$/i, "");
  testo = testo.replace(/[\s,;:.!\-]+$/, "").trim();

  // Rimuove parole residue appese alla fine (articoli, preposizioni)
  var prec;
  do {
    prec = testo;
    testo = testo.replace(/\s+(di|del|della|dei|degli|delle|a|ad|da|in|su|per|con|tra|fra|al|allo|alla|ai|agli|alle|il|lo|la|i|gli|le|un|uno|una|entro)\s*$/i, "");
    testo = testo.replace(/[\s,;:.!\-]+$/, "").trim();
  } while (testo !== prec);

  return testo;
}

function haScadenzaCondivisaDiGruppo(gruppo) {
  // Ricostruisce il blocco originale per analizzare se la data è una scadenza finale condivisa.
  // Pattern: più azioni + "entro/per" + data alla fine del blocco.
  var testoGruppo = gruppo.join(" ");

  // Controlla se il blocco finisce con un marcatore di scadenza condivisa
  var regexScadenzaFinale = /(?:entro|per|entro il|entro la|entro lo|prima di|prima del|prima della)\s+(?:questo weekend|fine settimana|settimana prossima|fine mese|oggi|domani|dopodomani|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi|\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?|\d{1,2}\s+(?:gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+\d{4})?)(?=[^a-zA-ZÀ-ÖØ-öø-ÿ]|$)\s*$/i;

  return regexScadenzaFinale.test(testoGruppo);
}

function dividiInGruppi(frase) {
  // Step 1: divide per separatori "duri" (poi, inoltre, dopodiché, punto e virgola)
  // che interrompono la continuità tra azioni
  var blocchi = frase.split(/\s*(?:;\s*|,?\s*\b(?:poi|inoltre|dopodiché|dopodiche)\b\s*,?\s*)/i);
  var gruppi = [];

  for (var b = 0; b < blocchi.length; b++) {
    var blocco = blocchi[b].trim();
    if (blocco === "") continue;

    // Step 2: dentro ogni blocco, divide per separatori "morbidi" (virgola, "e")
    var parti = blocco.split(/\s*(?:,|\be\b)\s*/i);
    var gruppo = [];

    for (var p = 0; p < parti.length; p++) {
      var parte = parti[p].trim();
      if (parte !== "") {
        gruppo.push(parte);
      }
    }

    if (gruppo.length > 0) {
      gruppi.push(gruppo);
    }
  }

  return gruppi;
}

// Parole che finiscono in -are/-ere/-ire ma non sono verbi d'azione
var FALSI_INFINITI = {
  "fare": true, "essere": true, "avere": true, "dare": true, "stare": true,
  "dire": true, "andare": true, "venire": true, "sapere": true, "potere": true,
  "dovere": true, "volere": true, "parere": true, "sembrare": true, "pare": true,
  "pure": true, "ore": true, "mare": true, "ire": true, "are": true, "ere": true,
  "inoltre": true, "allore": true, "cuore": true, "amare": true, "benessere": true
};

function eVerboInfinito(token) {
  if (!token || token.length < 5) return false;
  if (FALSI_INFINITI[token]) return false;
  return /(?:are|ere|ire)$/.test(token);
}

function eVerboImperativoOClitico(token) {
  if (!token || token.length < 4) return false;
  if (FALSI_INFINITI[token]) return false;
  // Clitico attaccato: "chiudilo", "mandala", "preparalo"
  if (/(alo|ala|ali|ale|ilo|ila|ili|ile|arlo|arla|arli|arle|erlo|erla|irlo|irla)$/.test(token)) {
    return true;
  }
  return false;
}

function capitalizzaVerbo(token) {
  return token.charAt(0).toUpperCase() + token.slice(1);
}

var REGEX_INTRO_AZIONE = /^(ricordati di|ricordarsi di|ricorda di|non dimenticare di|devo|devi|dobbiamo|bisogna|occorre|si deve|puoi)\s+/i;

var REGEX_RIFERIMENTO_TEMPORALE_INIZIO = /^(?:(?:per|entro)\s+)?(?:oggi|domani|dopodomani|questo weekend|fine settimana|settimana prossima|fine mese|luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\s*,?\s*/i;

function isSegmentoAzione(segmento) {
  var testo = pulisciConnettoriInutili(segmento);
  if (fraseIgnorabile(testo)) return false;

  // Rimuove riferimento temporale in apertura (es. "Domani devo...")
  testo = testo.replace(REGEX_RIFERIMENTO_TEMPORALE_INIZIO, "").trim();
  if (!testo) return false;

  // Signal 1: contiene un'introduzione esplicita di task
  var haIntro = REGEX_INTRO_AZIONE.test(testo);
  var senzaIntro = testo.replace(REGEX_INTRO_AZIONE, "").trim();
  if (!senzaIntro) return false;

  var parole = senzaIntro.split(/\s+/);
  var primaParola = normalizzaToken(parole[0] || "");
  if (!primaParola) return false;

  // Signal 2: la prima parola è un verbo noto
  if (trovaVerboCanonico(primaParola)) return true;

  // Signal 3: la prima parola è un infinito italiano (-are/-ere/-ire)
  if (eVerboInfinito(primaParola)) return true;

  // Signal 4: la prima parola è un imperativo con clitico
  if (eVerboImperativoOClitico(primaParola)) return true;

  // Signal 5: c'è un'introduzione di task seguita da almeno verbo+oggetto
  if (haIntro && parole.length >= 2) {
    // Verifica che la prima parola dopo l'intro sembri un verbo
    // (non un articolo, preposizione, aggettivo)
    var nonVerbi = /^(il|lo|la|i|gli|le|un|uno|una|di|del|della|dei|degli|delle|a|da|in|su|per|con|al|allo|alla|ai|agli|alle|che|non|se|ma|o)$/i;
    if (!nonVerbi.test(primaParola)) return true;
  }

  return false;
}

function estraiAzioneDaParte(parte, oggettoPrecedente) {
  if (!isSegmentoAzione(parte)) {
    return null;
  }

  var testoPulito = pulisciConnettoriInutili(parte);

  // Rimuove riferimento temporale in apertura prima di cercare il verbo
  testoPulito = testoPulito.replace(REGEX_RIFERIMENTO_TEMPORALE_INIZIO, "").trim();

  // Rimuove introduzioni prima di cercare il verbo
  var testoSenzaIntro = testoPulito
    .replace(REGEX_INTRO_AZIONE, "")
    .trim();

  var parole = testoSenzaIntro.split(/\s+/);
  var indiceVerbo = -1;
  var verboCanonico = null;
  var tokenVerbo = "";

  // Pass 1: cerca verbo nella lista nota
  for (var i = 0; i < parole.length; i++) {
    var tokenPulito = normalizzaToken(parole[i]);
    if (!tokenPulito) continue;

    var candidato = trovaVerboCanonico(tokenPulito);
    if (candidato) {
      indiceVerbo = i;
      verboCanonico = candidato;
      tokenVerbo = tokenPulito;
      break;
    }
  }

  // Pass 2: fallback — cerca verbo all'infinito o imperativo+clitico
  if (indiceVerbo === -1) {
    for (var f = 0; f < parole.length && f < 3; f++) {
      var tk = normalizzaToken(parole[f]);
      if (!tk) continue;

      if (eVerboInfinito(tk) || eVerboImperativoOClitico(tk)) {
        indiceVerbo = f;
        verboCanonico = capitalizzaVerbo(tk);
        tokenVerbo = tk;
        break;
      }
    }
  }

  if (indiceVerbo === -1 || !verboCanonico) {
    return null;
  }

  var coda = parole.slice(indiceVerbo + 1).join(" ").trim();
  var oggettoEsplicito = pulisciOggettoAzione(coda);
  var oggettoDaUsare = oggettoEsplicito;

  if (!oggettoDaUsare && tokenHaPronomeOggetto(tokenVerbo) && oggettoPrecedente) {
    oggettoDaUsare = oggettoPrecedente;
  }

  var testoAzione = verboCanonico + (oggettoDaUsare ? " " + oggettoDaUsare : "");
  testoAzione = pulisciAzione(testoAzione);

  if (!testoAzione || fraseIgnorabile(testoAzione)) {
    return null;
  }

  return {
    testo: testoAzione,
    oggettoContext: oggettoEsplicito || oggettoDaUsare || oggettoPrecedente || ""
  };
}

function aggiungiAzioneUnica(azioni, azione) {
  if (!azione || !azione.testo) return;

  for (var i = 0; i < azioni.length; i++) {
    if (areTasksDuplicate(azioni[i], azione)) {
      if (livelloPriorita(azione.priorita) > livelloPriorita(azioni[i].priorita)) {
        azioni[i].priorita = azione.priorita;
      }
      if (azione.dataISO) azioni[i].dataISO = azione.dataISO;
      if (azione.scadenzaOriginale) azioni[i].scadenzaOriginale = azione.scadenzaOriginale;
      if (normalizzaDurataStimata(azione.durataStimataMinuti) !== null) {
        azioni[i].durataStimataMinuti = normalizzaDurataStimata(azione.durataStimataMinuti);
      }
      if (normalizzaEnergiaStimata(azione.energiaStimata)) {
        azioni[i].energiaStimata = normalizzaEnergiaStimata(azione.energiaStimata);
      }
      if (normalizzaOrario(azione.time)) {
        azioni[i].time = normalizzaOrario(azione.time);
      }
      return;
    }
  }

  azioni.push(normalizzaAzioneSalvata(azione));
}

function aggiungiScadenzaUnica(scadenze, testoAzione, scadenzaObj) {
  for (var i = 0; i < scadenze.length; i++) {
    if (areScadenzeDuplicate(scadenze[i], {
      testo: testoAzione,
      data: scadenzaObj.originale,
      dataRisolta: scadenzaObj.dataRisolta || null
    })) {
      return;
    }
  }

  scadenze.push({
    testo: testoAzione,
    data: scadenzaObj.originale,
    dataRisolta: scadenzaObj.dataRisolta || null
  });
}

function escapeICSText(testo) {
  return String(testo || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatDateICS(data) {
  var y = data.getFullYear();
  var m = String(data.getMonth() + 1).padStart(2, "0");
  var d = String(data.getDate()).padStart(2, "0");
  return "" + y + m + d;
}

function parseDataChiara(dataRef, dataRisolta) {
  // Se abbiamo già una data risolta (da riferimento temporale relativo), usala
  if (dataRisolta) {
    var parti = dataRisolta.split("-");
    if (parti.length === 3) {
      var ar = parseInt(parti[0], 10);
      var mr = parseInt(parti[1], 10);
      var dr = parseInt(parti[2], 10);
      var dataR = new Date(ar, mr - 1, dr);
      if (dataR.getFullYear() === ar && dataR.getMonth() === mr - 1 && dataR.getDate() === dr) {
        return dataR;
      }
    }
  }

  if (!dataRef) return null;

  var testo = String(dataRef).trim().toLowerCase();

  // Riferimenti relativi senza dataRisolta: non esportabili
  if (/^(questo weekend|fine settimana|settimana prossima|fine mese|oggi|domani|dopodomani|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica|lunedi|martedi|mercoledi|giovedi|venerdi)$/i.test(testo)) {
    return null;
  }

  // Formato 18/04/2026 o 18-04-2026 (anno opzionale)
  var matchNum = testo.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (matchNum) {
    var giornoNum = parseInt(matchNum[1], 10);
    var meseNum = parseInt(matchNum[2], 10);
    var annoNum = matchNum[3] ? parseInt(matchNum[3], 10) : new Date().getFullYear();
    if (annoNum < 100) annoNum += 2000;

    var dataNum = new Date(annoNum, meseNum - 1, giornoNum);
    if (dataNum.getFullYear() === annoNum && dataNum.getMonth() === meseNum - 1 && dataNum.getDate() === giornoNum) {
      return dataNum;
    }
  }

  // Formato 18 aprile (anno opzionale)
  var mesi = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12
  };
  var matchTesto = testo.match(/^(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?$/);
  if (matchTesto) {
    var giornoTesto = parseInt(matchTesto[1], 10);
    var meseTesto = mesi[matchTesto[2]];
    var annoTesto = matchTesto[3] ? parseInt(matchTesto[3], 10) : new Date().getFullYear();

    var dataTesto = new Date(annoTesto, meseTesto - 1, giornoTesto);
    if (dataTesto.getFullYear() === annoTesto && dataTesto.getMonth() === meseTesto - 1 && dataTesto.getDate() === giornoTesto) {
      return dataTesto;
    }
  }

  return null;
}

function generaUrlGoogleCalendar(scadenza) {
  var data = parseDataChiara(scadenza.data, scadenza.dataRisolta);
  if (!data) return null;

  var y = data.getFullYear();
  var m = String(data.getMonth() + 1).padStart(2, "0");
  var d = String(data.getDate()).padStart(2, "0");
  var dataStr = y + m + d;

  var succ = new Date(data.getFullYear(), data.getMonth(), data.getDate() + 1);
  var y2 = succ.getFullYear();
  var m2 = String(succ.getMonth() + 1).padStart(2, "0");
  var d2 = String(succ.getDate()).padStart(2, "0");
  var dataFineStr = y2 + m2 + d2;

  var titolo = encodeURIComponent(scadenza.testo || "Scadenza");
  var descrizione = encodeURIComponent("Scadenza estratta da ActionFlow: " + (scadenza.data || ""));

  return "https://calendar.google.com/calendar/render?action=TEMPLATE"
    + "&text=" + titolo
    + "&dates=" + dataStr + "/" + dataFineStr
    + "&details=" + descrizione;
}

function costruisciFileICS(scadenze) {
  var righe = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ActionFlow//Scadenze//IT",
    "CALSCALE:GREGORIAN"
  ];

  var now = new Date();
  var stamp = now.getUTCFullYear() +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0") + "T" +
    String(now.getUTCHours()).padStart(2, "0") +
    String(now.getUTCMinutes()).padStart(2, "0") +
    String(now.getUTCSeconds()).padStart(2, "0") + "Z";

  var eventiValidi = 0;

  for (var i = 0; i < scadenze.length; i++) {
    var voce = scadenze[i];
    var dataEvento = parseDataChiara(voce.data, voce.dataRisolta);
    if (!dataEvento) continue;

    eventiValidi++;
    var dataInizio = formatDateICS(dataEvento);
    var giornoSuccessivo = new Date(dataEvento.getFullYear(), dataEvento.getMonth(), dataEvento.getDate() + 1);
    var dataFine = formatDateICS(giornoSuccessivo);
    var uid = "actionflow-" + i + "-" + dataInizio + "@local";

    righe.push("BEGIN:VEVENT");
    righe.push("UID:" + uid);
    righe.push("DTSTAMP:" + stamp);
    righe.push("SUMMARY:" + escapeICSText(voce.testo));
    righe.push("DTSTART;VALUE=DATE:" + dataInizio);
    righe.push("DTEND;VALUE=DATE:" + dataFine);
    righe.push("DESCRIPTION:" + escapeICSText("Scadenza estratta da ActionFlow: " + voce.data));
    righe.push("END:VEVENT");
  }

  righe.push("END:VCALENDAR");

  return {
    contenuto: righe.join("\r\n"),
    eventiValidi: eventiValidi
  };
}

function scaricaFileICS(contenuto) {
  var blob = new Blob([contenuto], { type: "text/calendar;charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var link = document.createElement("a");
  link.href = url;
  link.download = "actionflow-eventi.ics";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function esportaEventiCalendario() {
  var scadenze = window.ActionFlowAuth.readOwnedArray("actionflow_scadenze");

  var risultato = costruisciFileICS(scadenze);
  if (risultato.eventiValidi === 0) {
    alert("Nessuna scadenza con data chiara da esportare.");
    return;
  }

  scaricaFileICS(risultato.contenuto);
}

function normalizzaDurataStimata(valore) {
  var durata = parseInt(valore, 10);
  return !isNaN(durata) && durata > 0 ? durata : null;
}

function normalizzaOrario(valore) {
  var raw = String(valore || "").trim();
  var match;
  var ore;
  var minuti;

  if (!raw) return null;

  match = raw.match(/^([01]?\d|2[0-3])(?::([0-5]\d))?$/);
  if (!match) return null;

  ore = String(parseInt(match[1], 10)).padStart(2, "0");
  minuti = typeof match[2] === "string" ? match[2] : "00";
  return ore + ":" + minuti;
}

function estraiOrarioDaTesto(testo) {
  var source = String(testo || "").toLowerCase();
  var match = source.match(/\balle\s+([01]?\d|2[0-3])(?::([0-5]\d))?\b/i);

  if (!match) return null;
  return normalizzaOrario(match[1] + ":" + (match[2] || "00"));
}

function normalizzaEnergiaStimata(valore) {
  if (typeof valore !== "string") return null;
  var energia = valore.toLowerCase();
  return energia === "bassa" || energia === "media" || energia === "alta" ? energia : null;
}

function normalizzaAzioneSalvata(azione) {
  if (!azione || typeof azione !== "object") {
    return { testo: "", priorita: "bassa", durataStimataMinuti: null, energiaStimata: null, time: null, userId: null, syncedToCalendar: false };
  }

  return {
    testo: String(azione.testo || "").trim(),
    priorita: azione.priorita || "bassa",
    scadenzaOriginale: azione.scadenzaOriginale || null,
    dataISO: azione.dataISO || null,
    time: normalizzaOrario(azione.time),
    durataStimataMinuti: normalizzaDurataStimata(azione.durataStimataMinuti),
    energiaStimata: normalizzaEnergiaStimata(azione.energiaStimata),
    completato: azione.completato === true,
    completedAt: azione.completedAt || null,
    aggiunta: azione.aggiunta || null,
    id: azione.id || null,
    userId: azione.userId || null,
    syncedToCalendar: azione.syncedToCalendar === true
  };
}

// Converte la risposta del backend nel formato usato dal rendering
function convertiRispostaBackend(data) {
  var azioni = [];
  var scadenze = [];
  var daPianificare = [];

  if (data.azioni && Array.isArray(data.azioni)) {
    for (var i = 0; i < data.azioni.length; i++) {
      var a = data.azioni[i];
      aggiungiAzioneUnica(azioni, normalizzaAzioneSalvata({
        testo: a.testo || "",
        priorita: a.priorita || "bassa",
        scadenzaOriginale: a.scadenzaOriginale || null,
        dataISO: a.dataISO || null,
        time: a.time || null,
        durataStimataMinuti: a.durataStimataMinuti,
        energiaStimata: a.energiaStimata
      }));

      if (a.scadenzaOriginale) {
        aggiungiScadenzaUnica(scadenze, a.testo || "", {
          originale: a.scadenzaOriginale,
          dataRisolta: a.dataISO || null
        });
      }
    }
  }

  // Aggiungi scadenze extra dal backend che non sono già associate ad azioni
  if (data.scadenze && Array.isArray(data.scadenze)) {
    for (var s = 0; s < data.scadenze.length; s++) {
      var sc = data.scadenze[s];
      if (sc.scadenzaOriginale || sc.dataISO) {
        aggiungiScadenzaUnica(scadenze, sc.titolo || "", {
          originale: sc.scadenzaOriginale || "",
          dataRisolta: sc.dataISO || null
        });
      }
    }
  }

  if (data.daPianificare && Array.isArray(data.daPianificare)) {
    for (var p = 0; p < data.daPianificare.length; p++) {
      var voce = data.daPianificare[p];
      if (!voce || !voce.titolo) continue;

      daPianificare.push({
        id: voce.id || null,
        titolo: voce.titolo || "",
        riferimentoTemporale: voce.riferimentoTemporale || "",
        tipoFlessibilita: voce.tipoFlessibilita || "flessibile",
        durataStimataMinuti: normalizzaDurataStimata(voce.durataStimataMinuti),
        energiaStimata: normalizzaEnergiaStimata(voce.energiaStimata) || "media"
      });
    }
  }

  return {
    azioni: dedupeTasks(azioni),
    scadenze: dedupeScadenze(scadenze),
    daPianificare: daPianificare
  };
}

// Parser locale (fallback se il backend non è raggiungibile)
function analizzaTestoLocale(testo) {
  var frasi = testo.split(/[.!?\n]+/);
  var regexData = /\b(\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?|\d{1,2}\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(\s+\d{4})?|(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+\d{4})\b/i;

  var azioni = [];
  var scadenze = [];

  for (var i = 0; i < frasi.length; i++) {
    var frase = frasi[i].trim();
    if (frase === "") continue;

    var gruppi = dividiInGruppi(frase);
    var oggettoContext = "";

    for (var g = 0; g < gruppi.length; g++) {
      var gruppo = gruppi[g];
      var azioniGruppo = [];
      var scadenzeGruppo = [];

      for (var j = 0; j < gruppo.length; j++) {
        var parte = gruppo[j].trim();
        if (parte === "") continue;

        var scadenzeParte = estraiScadenzeDaTesto(parte, regexData);
        var azioneEstratta = estraiAzioneDaParte(parte, oggettoContext);

        if (azioneEstratta) {
          oggettoContext = azioneEstratta.oggettoContext;
          azioniGruppo.push({
            testo: azioneEstratta.testo,
            parteOriginale: parte,
            dateLocali: scadenzeParte,
            time: estraiOrarioDaTesto(parte)
          });
        }

        for (var d = 0; d < scadenzeParte.length; d++) {
          var giaPresente = false;
          for (var x = 0; x < scadenzeGruppo.length; x++) {
            if (scadenzeGruppo[x].originale === scadenzeParte[d].originale) {
              giaPresente = true;
              break;
            }
          }
          if (!giaPresente) {
            scadenzeGruppo.push(scadenzeParte[d]);
          }
        }
      }

      for (var a = 0; a < azioniGruppo.length; a++) {
        var az = azioniGruppo[a];
        var priorita = calcolaPrioritaFrase(az.parteOriginale, az.testo, az.dateLocali);

        aggiungiAzioneUnica(azioni, { testo: az.testo, priorita: priorita, time: az.time || null });

        for (var sd = 0; sd < az.dateLocali.length; sd++) {
          aggiungiScadenzaUnica(scadenze, az.testo, az.dateLocali[sd]);
        }
      }
    }
  }

  return { azioni: dedupeTasks(azioni), scadenze: dedupeScadenze(scadenze) };
}

// Mostra i risultati nella pagina e salva in localStorage/archivio
function renderDaPianificare(lista) {
  var contenitore = document.getElementById("lista-da-pianificare");
  if (!contenitore) return;

  contenitore.innerHTML = "";

  for (var i = 0; i < lista.length; i++) {
    var item = lista[i];
    var li = document.createElement("li");

    var titolo = document.createElement("strong");
    titolo.textContent = item.titolo || "";
    li.appendChild(titolo);

    var dettaglio = document.createElement("div");
    dettaglio.textContent = (item.riferimentoTemporale || "") + " • " + (item.tipoFlessibilita || "flessibile");
    li.appendChild(dettaglio);

    if (item.durataStimataMinuti || item.energiaStimata) {
      var meta = document.createElement("div");
      meta.textContent = "Durata: " + (item.durataStimataMinuti || "-") + " min • Energia: " + (item.energiaStimata || "-");
      li.appendChild(meta);
    }

    contenitore.appendChild(li);
  }
}

function mostraRisultati(azioni, scadenze, daPianificare) {
  var azioniDeduplicate = dedupeTasks(azioni);
  var scadenzeDeduplicate = dedupeScadenze(scadenze);

  azioniCorrente = azioniDeduplicate;
  scadenzeCorrente = scadenzeDeduplicate;
  daPianificareCorrente = Array.isArray(daPianificare) ? daPianificare : [];

  riempiListaAzioni("contenitore-azioni", azioniCorrente);
  riempiListaScadenze("lista-scadenze", scadenzeCorrente);
  renderDaPianificare(daPianificareCorrente);

  window.ActionFlowAuth.writeOwnedArray("actionflow_checklist", azioniCorrente);
  window.ActionFlowAuth.writeOwnedArray("actionflow_scadenze", scadenzeCorrente);

  salvaInArchivio(azioniCorrente, scadenzeCorrente);
  refreshDailyPlanIfPresent();
  syncTasksToGoogleCalendarIfNeeded(azioniCorrente);

  document.getElementById("box-azioni").style.display = azioniCorrente.length > 0 ? "block" : "none";
  document.getElementById("box-da-pianificare").style.display = daPianificareCorrente.length > 0 ? "block" : "none";
  document.getElementById("box-scadenze").style.display = scadenzeCorrente.length > 0 ? "block" : "none";

  document.getElementById("risultati").style.display = "block";
}

// Questa funzione viene chiamata quando l'utente clicca il bottone
async function analizzaTesto() {

  var testo = document.getElementById("testo-input").value;
  var errore = document.getElementById("messaggio-errore");
  var textarea = document.getElementById("testo-input");

  if (testo.trim() === "") {
    errore.style.display = "block";
    textarea.classList.add("errore-campo");
    return;
  }

  errore.style.display = "none";
  textarea.classList.remove("errore-campo");

  // Disabilita il bottone durante la chiamata
  var bottone = document.getElementById("bottone-analizza");
  if (bottone) {
    bottone.disabled = true;
    bottone.textContent = "Analisi in corso...";
  }

  var payload = { testo: testo.trim() };

  console.log("[ActionFlow] === INIZIO CHIAMATA ===");
  console.log("[ActionFlow] Metodo: POST");
  console.log("[ActionFlow] URL: /api/analyze");
  console.log("[ActionFlow] Body inviato:", JSON.stringify(payload));

  try {
    var response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    console.log("[ActionFlow] Status risposta:", response.status, response.statusText);
    console.log("[ActionFlow] Content-Type risposta:", response.headers.get("content-type"));

    if (!response.ok) {
      var rawError = await response.text();
      console.error("[ActionFlow] Errore HTTP " + response.status + " — body:", rawError);
      var dettaglio;
      try {
        var parsedErr = JSON.parse(rawError);
        dettaglio = parsedErr.error || parsedErr.dettaglio || rawError;
      } catch (e) {
        dettaglio = rawError;
      }
      throw { tipo: "http", status: response.status, messaggio: dettaglio || "Errore dal server" };
    }

    var rawBody = await response.text();
    console.log("[ActionFlow] Body grezzo ricevuto:", rawBody.substring(0, 300));

    var data;
    try {
      data = JSON.parse(rawBody);
    } catch (e) {
      console.error("[ActionFlow] JSON non valido nella risposta:", e.message);
      throw { tipo: "json", messaggio: "Risposta non è un JSON valido" };
    }

    console.log("[ActionFlow] Risposta backend parsed OK — azioni:", (data.azioni || []).length, "scadenze:", (data.scadenze || []).length);

    var risultato = convertiRispostaBackend(data);
    openAnalysisPreview(risultato.azioni, risultato.scadenze, risultato.daPianificare);

  } catch (err) {
    var avviso = document.getElementById("messaggio-errore");
    var messaggio;

    if (err && err.tipo === "http") {
      console.error("[ActionFlow] Errore server HTTP " + err.status + ":", err.messaggio);
      messaggio = "⚠ Errore dal server (" + err.status + "): " + err.messaggio;
    } else if (err && err.tipo === "json") {
      console.error("[ActionFlow] Risposta JSON non valida:", err.messaggio);
      messaggio = "⚠ Risposta dal server non valida — usando modalità base";
    } else {
      console.error("[ActionFlow] Backend non raggiungibile (errore di rete):", err.message || err);
      messaggio = "⚠ Backend non raggiungibile — usando modalità base";
    }

    // Fallback al parser locale
    var risultato = analizzaTestoLocale(testo);
    openAnalysisPreview(risultato.azioni, risultato.scadenze);

    if (avviso) {
      avviso.textContent = messaggio;
      avviso.style.display = "block";
    }
  } finally {
    if (bottone) {
      bottone.disabled = false;
      bottone.textContent = "Analizza";
    }
    console.log("[ActionFlow] === FINE CHIAMATA ===");
  }
}


// --- ARCHIVIO PERSISTENTE PER LA DASHBOARD ---

function leggiArchivioAzioni() {
  try {
    var dati = window.ActionFlowAuth.readOwnedArray("actionflow_archivio_azioni");
    if (!Array.isArray(dati)) return [];

    var deduplicated = dedupeTasks(dati);

    if (JSON.stringify(dati) !== JSON.stringify(deduplicated)) {
      window.ActionFlowAuth.writeOwnedArray("actionflow_archivio_azioni", deduplicated);
    }

    return deduplicated.map(function(azione) {
      var normalizzata = normalizzaAzioneSalvata(azione);
      if (azione && azione.aggiunta) {
        normalizzata.aggiunta = azione.aggiunta;
      }
      return normalizzata;
    });
  } catch (e) { return []; }
}

function leggiArchivioScadenze() {
  try {
    var dati = window.ActionFlowAuth.readOwnedArray("actionflow_archivio_scadenze");
    var deduplicated = dedupeScadenze(Array.isArray(dati) ? dati : []);

    if (JSON.stringify(dati || []) !== JSON.stringify(deduplicated)) {
      window.ActionFlowAuth.writeOwnedArray("actionflow_archivio_scadenze", deduplicated);
    }

    return deduplicated;
  } catch (e) { return []; }
}

function salvaInArchivio(nuoveAzioni, nuoveScadenze) {
  var archAzioni = dedupeTasks(leggiArchivioAzioni());
  var archScadenze = dedupeScadenze(leggiArchivioScadenze());
  var cleanedAzioni = dedupeTasks(nuoveAzioni);
  var cleanedScadenze = dedupeScadenze(nuoveScadenze);
  var timestamp = new Date().toISOString();

  for (var i = 0; i < cleanedAzioni.length; i++) {
    var esiste = false;
    for (var j = 0; j < archAzioni.length; j++) {
      if (areTasksDuplicate(archAzioni[j], cleanedAzioni[i])) {
        archAzioni[j] = mergeTaskRecords(archAzioni[j], cleanedAzioni[i]);
        esiste = true;
        break;
      }
    }
    if (!esiste) {
      var nuovaAzione = normalizzaAzioneSalvata(cleanedAzioni[i]);
      nuovaAzione.aggiunta = timestamp;
      archAzioni.push(nuovaAzione);
    }
  }

  for (var s = 0; s < cleanedScadenze.length; s++) {
    var duplicata = false;
    for (var k = 0; k < archScadenze.length; k++) {
      if (areScadenzeDuplicate(archScadenze[k], cleanedScadenze[s])) {
        archScadenze[k] = mergeScadenzaRecords(archScadenze[k], cleanedScadenze[s]);
        duplicata = true;
        break;
      }
    }
    if (!duplicata) {
      archScadenze.push({
        testo: cleanedScadenze[s].testo,
        data: cleanedScadenze[s].data,
        dataRisolta: cleanedScadenze[s].dataRisolta || null,
        aggiunta: timestamp,
        userId: window.ActionFlowAuth.getCurrentUserId()
      });
    }
  }

  window.ActionFlowAuth.writeOwnedArray("actionflow_archivio_azioni", dedupeTasks(archAzioni));
  window.ActionFlowAuth.writeOwnedArray("actionflow_archivio_scadenze", dedupeScadenze(archScadenze));
}


function raggruppaPerPriorita(azioni) {
  var gruppi = { alta: [], media: [], bassa: [] };

  for (var i = 0; i < azioni.length; i++) {
    var p = getDynamicTaskPriority(azioni[i]);
    if (gruppi[p]) {
      gruppi[p].push(azioni[i]);
    } else {
      gruppi.media.push(azioni[i]);
    }
  }

  return gruppi;
}

function leggiAzioniCompletate() {
  return window.ActionFlowAuth.readScopedObject("actionflow_azioni_done");
}

function salvaAzioniCompletate(completate) {
  window.ActionFlowAuth.writeScopedObject("actionflow_azioni_done", completate);
}

function generaIdAzione(testo) {
  return "azione_" + testo.replace(/[^a-zA-Z0-9\u00C0-\u00FF]/g, "_").toLowerCase();
}

function userCanUseGoogleCalendar() {
  var currentUser = window.ActionFlowAuth && typeof window.ActionFlowAuth.getCurrentUser === "function"
    ? window.ActionFlowAuth.getCurrentUser()
    : null;

  return !!(currentUser && currentUser.provider === "google");
}

function buildCalendarEventPayloadFromTask(taskDisplay) {
  if (!taskDisplay || !taskDisplay.testo || !taskDisplay.dataISO) {
    return null;
  }

  var startTime = normalizzaOrario(taskDisplay.time) || "09:00";
  var durationMinutes = normalizzaDurataStimata(taskDisplay.durataStimataMinuti) || 30;
  var start = new Date(taskDisplay.dataISO + "T" + startTime + ":00");

  if (Number.isNaN(start.getTime())) {
    return null;
  }

  var end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  var description = "Creato da ActionFlow";

  if (taskDisplay.prioritaDinamica || taskDisplay.priorita) {
    description += "\nPriorita: " + (taskDisplay.prioritaDinamica || taskDisplay.priorita);
  }

  if (taskDisplay.scadenzaOriginale) {
    description += "\nScadenza: " + taskDisplay.scadenzaOriginale;
  }

  return {
    title: taskDisplay.testo,
    description: description,
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

function buildAutoSyncCalendarPayloadFromTask(task) {
  if (!task || !task.testo || !task.dataISO) {
    return null;
  }

  var startTime = normalizzaOrario(task.time);
  var durationMinutes = normalizzaDurataStimata(task.durataStimataMinuti);
  if (!startTime || !durationMinutes) {
    return null;
  }

  var start = new Date(task.dataISO + "T" + startTime + ":00");
  if (Number.isNaN(start.getTime())) {
    return null;
  }

  var end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  return {
    title: task.testo,
    description: "Creato automaticamente da ActionFlow",
    start: start.toISOString(),
    end: end.toISOString(),
  };
}

async function syncTasksToGoogleCalendarIfNeeded(tasks) {
  console.log("[Calendar] Tasks created", Array.isArray(tasks) ? tasks : []);
  console.log("[Calendar] Auto-sync enabled:", isCalendarAutoSyncEnabled());

  if (!isCalendarAutoSyncEnabled() || !userCanUseGoogleCalendar()) {
    return;
  }

  var changed = false;

  for (var i = 0; i < tasks.length; i++) {
    var task = tasks[i];
    console.log("[Calendar] Task scheduling fields", task ? {
      testo: task.testo,
      dataISO: task.dataISO,
      time: task.time,
      durataStimataMinuti: task.durataStimataMinuti,
      syncedToCalendar: task.syncedToCalendar === true
    } : null);

    if (!task || task.syncedToCalendar === true) {
      continue;
    }

    var payload = buildAutoSyncCalendarPayloadFromTask(task);
    if (!payload) {
      continue;
    }

    try {
      console.log("[Calendar] Calling /calendar/events", payload);
      var response = await fetch("/calendar/events", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      console.log("[Calendar] /calendar/events response", {
        ok: response.ok,
        status: response.status
      });

      if (!response.ok) {
        continue;
      }

      task.syncedToCalendar = true;
      changed = true;
      console.log("[Calendar] Event created for task", task.testo);
    } catch (e) {}
  }

  if (changed) {
    window.ActionFlowAuth.writeOwnedArray("actionflow_checklist", tasks);
  }
}

async function aggiungiTaskAGoogleCalendar(taskDisplay) {
  var payload = buildCalendarEventPayloadFromTask(taskDisplay);
  if (!payload) {
    alert("Questa azione non ha ancora una data valida per creare un evento.");
    return;
  }

  try {
    var response = await fetch("/calendar/events", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    var data = await response.json().catch(function() { return {}; });

    if (!response.ok) {
      throw new Error(data.error || "Impossibile creare l'evento Google Calendar.");
    }

    alert("Evento aggiunto a Google Calendar.");
  } catch (error) {
    alert(error && error.message ? error.message : "Impossibile creare l'evento Google Calendar.");
  }
}

// Riempie il contenitore azioni raggruppate per priorità
function riempiListaAzioni(idContenitore, elementi) {
  var contenitore = document.getElementById(idContenitore);
  contenitore.innerHTML = "";
  var scadenzeMap = buildScadenzaMap(scadenzeCorrente);

  var gruppi = raggruppaPerPriorita(elementi);
  var ordine = [
    { chiave: "alta",  titolo: "Alta priorità" },
    { chiave: "media", titolo: "Media priorità" },
    { chiave: "bassa", titolo: "Bassa priorità" }
  ];

  for (var g = 0; g < ordine.length; g++) {
    var gruppo = gruppi[ordine[g].chiave];
    if (gruppo.length === 0) continue;

    var sezioneGruppo = document.createElement("div");
    sezioneGruppo.className = "gruppo-priorita gruppo-" + ordine[g].chiave;

    var titolo = document.createElement("h3");
    titolo.className = "titolo-gruppo titolo-gruppo-" + ordine[g].chiave;
    titolo.textContent = ordine[g].titolo;
    sezioneGruppo.appendChild(titolo);

    var ul = document.createElement("ul");
    var completate = leggiAzioniCompletate();

    for (var i = 0; i < gruppo.length; i++) {
      var azione = gruppo[i];
      var azioneDisplay = resolveTaskForDisplay(azione, scadenzeMap);
      var priorita = azioneDisplay.prioritaDinamica || "media";
      var idAzione = generaIdAzione(azione.testo);

      var li = document.createElement("li");
      li.className = "priorita-" + priorita + " azione-item";
      if (completate[idAzione]) {
        li.classList.add("azione-completata");
      }

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = idAzione + "_" + g + "_" + i;
      checkbox.className = "azione-checkbox";
      checkbox.checked = completate[idAzione] === true;

      (function(cb, liEl, id, taskRef) {
        cb.addEventListener("change", function() {
          var stato = leggiAzioniCompletate();
          stato[id] = cb.checked;
          salvaAzioniCompletate(stato);
          taskRef.completato = cb.checked;
          if (cb.checked) {
            liEl.classList.add("azione-completata");
          } else {
            liEl.classList.remove("azione-completata");
          }
          salvaDatiCorrente();
        });
      })(checkbox, li, idAzione, azione);

      var label = document.createElement("label");
      label.htmlFor = checkbox.id;
      label.className = "azione-testo";
      label.textContent = azioneDisplay.testo;

      var contenuto = document.createElement("div");
      contenuto.className = "azione-contenuto";

      var meta = document.createElement("div");
      meta.className = "azione-meta";

      appendTaskMeta(meta, azioneDisplay);

      contenuto.appendChild(label);
      contenuto.appendChild(meta);

      var btnModifica = document.createElement("button");
      btnModifica.type = "button";
      btnModifica.className = "btn-modifica";
      btnModifica.textContent = "Modifica";

      var btnGoogleCalendar = null;
      if (userCanUseGoogleCalendar() && buildCalendarEventPayloadFromTask(azioneDisplay)) {
        btnGoogleCalendar = document.createElement("button");
        btnGoogleCalendar.type = "button";
        btnGoogleCalendar.className = "btn-modifica";
        btnGoogleCalendar.textContent = "Aggiungi a Google Calendar";
        (function(taskForCalendar) {
          btnGoogleCalendar.addEventListener("click", function() {
            aggiungiTaskAGoogleCalendar(taskForCalendar);
          });
        })(azioneDisplay);
      }

      (function(liEl, az) {
        btnModifica.addEventListener("click", function() {
          attivaEditAzione(liEl, az, azioniCorrente, scadenzeCorrente, function() {
            salvaDatiCorrente();
            riempiListaAzioni(idContenitore, azioniCorrente);
            riempiListaScadenze("lista-scadenze", scadenzeCorrente);
          });
        });
      })(li, azione);

      li.appendChild(checkbox);
      li.appendChild(contenuto);
      if (btnGoogleCalendar) li.appendChild(btnGoogleCalendar);
      li.appendChild(btnModifica);
      ul.appendChild(li);
    }

    sezioneGruppo.appendChild(ul);
    contenitore.appendChild(sezioneGruppo);
  }
}

function attivaEditAzione(li, azione, azioniArr, scadenzeArr, onSave) {
  var vecchioTesto = azione.testo;
  var vecchiaPriorita = azione.priorita || "media";

  // Trova scadenza associata
  var scadenzaAssociata = null;
  for (var i = 0; i < scadenzeArr.length; i++) {
    if (scadenzeArr[i].testo === vecchioTesto) {
      scadenzaAssociata = scadenzeArr[i];
      break;
    }
  }

  li.innerHTML = "";
  li.className = "azione-item azione-edit-mode";

  var inputTesto = document.createElement("input");
  inputTesto.type = "text";
  inputTesto.className = "edit-input edit-input-testo";
  inputTesto.value = vecchioTesto;

  var selectPriorita = document.createElement("select");
  selectPriorita.className = "edit-select";
  ["alta", "media", "bassa"].forEach(function(p) {
    var opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p.charAt(0).toUpperCase() + p.slice(1);
    if (p === vecchiaPriorita) opt.selected = true;
    selectPriorita.appendChild(opt);
  });

  var inputData = document.createElement("input");
  inputData.type = "date";
  inputData.className = "edit-input edit-input-data";
  if (scadenzaAssociata && scadenzaAssociata.dataRisolta) {
    inputData.value = scadenzaAssociata.dataRisolta;
  }

  var btnSalva = document.createElement("button");
  btnSalva.type = "button";
  btnSalva.className = "btn-salva-edit";
  btnSalva.textContent = "Salva";

  var btnAnnulla = document.createElement("button");
  btnAnnulla.type = "button";
  btnAnnulla.className = "btn-modifica";
  btnAnnulla.textContent = "Annulla";
  btnAnnulla.addEventListener("click", function() { onSave(); });

  btnSalva.addEventListener("click", function() {
    var nuovoTesto = inputTesto.value.trim();
    if (!nuovoTesto) return;
    var nuovaPriorita = selectPriorita.value;
    var nuovaData = inputData.value;

    // Aggiorna azione nell'array
    for (var a = 0; a < azioniArr.length; a++) {
      if (azioniArr[a].testo === vecchioTesto) {
        azioniArr[a].testo = nuovoTesto;
        azioniArr[a].priorita = nuovaPriorita;
        break;
      }
    }

    // Aggiorna/aggiungi/rimuovi scadenza
    var idxScadenza = -1;
    for (var s = 0; s < scadenzeArr.length; s++) {
      if (scadenzeArr[s].testo === vecchioTesto) {
        idxScadenza = s;
        break;
      }
    }

    if (nuovaData) {
      var oggettoScadenza = { testo: nuovoTesto, data: nuovaData, dataRisolta: nuovaData };
      if (idxScadenza >= 0) {
        scadenzeArr[idxScadenza] = oggettoScadenza;
      } else {
        scadenzeArr.push(oggettoScadenza);
      }
    } else if (idxScadenza >= 0) {
      // Aggiorna solo il testo se la data non è cambiata
      scadenzeArr[idxScadenza].testo = nuovoTesto;
    }

    // Aggiorna completamento se testo cambiato
    if (nuovoTesto !== vecchioTesto) {
      var comp = leggiAzioniCompletate();
      var vecchioId = generaIdAzione(vecchioTesto);
      var nuovoId = generaIdAzione(nuovoTesto);
      if (comp[vecchioId] !== undefined) {
        comp[nuovoId] = comp[vecchioId];
        delete comp[vecchioId];
        salvaAzioniCompletate(comp);
      }
    }

    onSave();
  });

  li.appendChild(inputTesto);
  li.appendChild(selectPriorita);
  li.appendChild(inputData);
  li.appendChild(btnSalva);
  li.appendChild(btnAnnulla);
}

function salvaDatiCorrente() {
  azioniCorrente = dedupeTasks(azioniCorrente);
  scadenzeCorrente = dedupeScadenze(scadenzeCorrente);
  window.ActionFlowAuth.writeOwnedArray("actionflow_checklist", azioniCorrente);
  window.ActionFlowAuth.writeOwnedArray("actionflow_scadenze", scadenzeCorrente);
  salvaInArchivio(azioniCorrente, scadenzeCorrente);
  refreshDailyPlanIfPresent();
}


// Riempie la lista delle scadenze (azione breve + eventuale data)
function riempiListaScadenze(idLista, elementi) {
  var lista = document.getElementById(idLista);
  lista.innerHTML = "";

  for (var i = 0; i < elementi.length; i++) {
    var li = document.createElement("li");
    li.className = "scadenza-item";

    var testoSpan = document.createElement("span");
    testoSpan.textContent = "→ " + elementi[i].testo;
    li.appendChild(testoSpan);

    // Se ha trovato una data nella frase, aggiunge un badge colorato
    if (elementi[i].data) {
      var badge = document.createElement("span");
      badge.className = "badge-data";
      var testoData = elementi[i].data;
      if (elementi[i].dataRisolta) {
        testoData += " (" + elementi[i].dataRisolta + ")";
      }
      badge.textContent = testoData;
      li.appendChild(badge);
    }

    // Pulsante Google Calendar se la data è valida
    var urlGcal = generaUrlGoogleCalendar(elementi[i]);
    if (urlGcal) {
      var linkGcal = document.createElement("a");
      linkGcal.href = urlGcal;
      linkGcal.target = "_blank";
      linkGcal.rel = "noopener noreferrer";
      linkGcal.className = "btn-gcal";
      linkGcal.textContent = "+ Google Calendar";
      li.appendChild(linkGcal);
    }

    // Pulsante Modifica scadenza
    var btnMod = document.createElement("button");
    btnMod.type = "button";
    btnMod.className = "btn-modifica";
    btnMod.textContent = "Modifica";

    (function(liEl, scadenza) {
      btnMod.addEventListener("click", function() {
        attivaEditScadenza(liEl, scadenza, scadenzeCorrente, function() {
          salvaDatiCorrente();
          riempiListaAzioni("contenitore-azioni", azioniCorrente);
          riempiListaScadenze(idLista, scadenzeCorrente);
        });
      });
    })(li, elementi[i]);

    li.appendChild(btnMod);
    lista.appendChild(li);
  }
}

function attivaEditScadenza(li, scadenza, scadenzeArr, onSave) {
  var vecchioTesto = scadenza.testo;
  var vecchiaData = scadenza.dataRisolta || scadenza.data || "";

  li.innerHTML = "";
  li.className = "scadenza-item azione-edit-mode";

  var inputData = document.createElement("input");
  inputData.type = "date";
  inputData.className = "edit-input edit-input-data";
  inputData.value = vecchiaData;

  var spanTesto = document.createElement("span");
  spanTesto.className = "edit-label-testo";
  spanTesto.textContent = vecchioTesto;

  var btnSalva = document.createElement("button");
  btnSalva.type = "button";
  btnSalva.className = "btn-salva-edit";
  btnSalva.textContent = "Salva";

  var btnAnnulla = document.createElement("button");
  btnAnnulla.type = "button";
  btnAnnulla.className = "btn-modifica";
  btnAnnulla.textContent = "Annulla";
  btnAnnulla.addEventListener("click", function() { onSave(); });

  btnSalva.addEventListener("click", function() {
    var nuovaData = inputData.value;
    for (var s = 0; s < scadenzeArr.length; s++) {
      if (scadenzeArr[s].testo === vecchioTesto) {
        if (nuovaData) {
          scadenzeArr[s].data = nuovaData;
          scadenzeArr[s].dataRisolta = nuovaData;
        }
        break;
      }
    }
    onSave();
  });

  li.appendChild(spanTesto);
  li.appendChild(inputData);
  li.appendChild(btnSalva);
  li.appendChild(btnAnnulla);
}

/* ---- Profilo locale ---- */

function leggiProfilo() {
  try {
    var raw = localStorage.getItem("actionflow_profilo");
    var dati = raw ? JSON.parse(raw) : null;
    return (dati && typeof dati === "object" && dati.nome) ? dati : null;
  } catch (e) { return null; }
}

function salvaProfilo(nome) {
  var profilo = { nome: nome.trim() };
  localStorage.setItem("actionflow_profilo", JSON.stringify(profilo));
  return profilo;
}

function resetProfilo() {
  localStorage.removeItem("actionflow_profilo");
}

function chiediNomeProfilo() {
  var nome = prompt("Come ti chiami?");
  if (nome && nome.trim().length > 0) {
    return salvaProfilo(nome);
  }
  return null;
}

function modificaNomeProfilo() {
  var profilo = leggiProfilo();
  var attuale = profilo ? profilo.nome : "";
  var nome = prompt("Modifica il tuo nome:", attuale);
  if (nome !== null && nome.trim().length > 0) {
    salvaProfilo(nome);
    mostraProfilo();
  }
}

function eseguiResetProfilo() {
  if (confirm("Vuoi davvero resettare il profilo?")) {
    resetProfilo();
    mostraProfilo();
  }
}

function avviaLoginGoogle() {
  window.location.href = "/auth/google";
}

function avviaLoginApple() {
  window.location.href = "/auth/apple";
}

function getUiIconSvg(name) {
  var icons = {
    profile: '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4Z" fill="currentColor"></path><path d="M4.75 19.25a7.25 7.25 0 0 1 14.5 0 .75.75 0 0 1-.75.75H5.5a.75.75 0 0 1-.75-.75Z" fill="currentColor"></path></svg>',
    settings: '<svg viewBox="0 0 24 24" focusable="false"><path d="M9.5 3.75a.75.75 0 0 1 .73.58l.27 1.17a6.9 6.9 0 0 1 2.99 0l.27-1.17a.75.75 0 0 1 1.11-.48l1.6.92a.75.75 0 0 1 .33.92l-.43 1.12c.8.61 1.48 1.34 2 2.18l1.18-.2a.75.75 0 0 1 .84.58l.36 1.8a.75.75 0 0 1-.48.85l-1.12.42a6.94 6.94 0 0 1 0 2.98l1.12.42a.75.75 0 0 1 .48.85l-.36 1.8a.75.75 0 0 1-.84.58l-1.18-.2a6.89 6.89 0 0 1-2 2.18l.43 1.12a.75.75 0 0 1-.33.92l-1.6.92a.75.75 0 0 1-1.11-.48l-.27-1.17a6.9 6.9 0 0 1-2.99 0l-.27 1.17a.75.75 0 0 1-1.11.48l-1.6-.92a.75.75 0 0 1-.33-.92l.43-1.12a6.89 6.89 0 0 1-2-2.18l-1.18.2a.75.75 0 0 1-.84-.58l-.36-1.8a.75.75 0 0 1 .48-.85l1.12-.42a6.94 6.94 0 0 1 0-2.98l-1.12-.42a.75.75 0 0 1-.48-.85l.36-1.8a.75.75 0 0 1 .84-.58l1.18.2a6.89 6.89 0 0 1 2-2.18l-.43-1.12a.75.75 0 0 1 .33-.92l1.6-.92a.75.75 0 0 1 .37-.1ZM12 9.25A2.75 2.75 0 1 0 14.75 12 2.75 2.75 0 0 0 12 9.25Z" fill="currentColor"></path></svg>',
    logout: '<svg viewBox="0 0 24 24" focusable="false"><path d="M10.75 4.75a.75.75 0 0 1 0 1.5h-3.5A1.25 1.25 0 0 0 6 7.5v9a1.25 1.25 0 0 0 1.25 1.25h3.5a.75.75 0 0 1 0 1.5h-3.5A2.75 2.75 0 0 1 4.5 16.5v-9a2.75 2.75 0 0 1 2.75-2.75h3.5Z" fill="currentColor"></path><path d="M14.72 7.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06l2.97-2.97H9.5a.75.75 0 0 1 0-1.5h8.19l-2.97-2.97a.75.75 0 0 1 0-1.06Z" fill="currentColor"></path></svg>',
    dashboard: '<svg viewBox="0 0 24 24" focusable="false"><path d="M5.5 4.5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm8 0h5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Zm0 6.5h5a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1Zm-8 2h5a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-5a1 1 0 0 1-1-1V14a1 1 0 0 1 1-1Z" fill="currentColor"></path></svg>'
  };

  return icons[name] || "";
}

function buildIconLabel(iconName, label) {
  return '<span class="ui-button-content"><span class="ui-icon" aria-hidden="true">' + getUiIconSvg(iconName) + '</span><span>' + label + '</span></span>';
}

var GUEST_USER_STORAGE_KEY = "actionflow_guest_user";
var THEME_STORAGE_KEY = "actionflow_theme";
var USER_SETTINGS_STORAGE_KEY = "actionflow_user_settings";
var pendingSettingsImageDataUrl = "";

function readGuestUser() {
  try {
    var raw = localStorage.getItem(GUEST_USER_STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;

    if (!parsed || typeof parsed !== "object" || !parsed.name) {
      return null;
    }

    return {
      id: parsed.id || "guest-local",
      provider: "guest",
      providerUserId: parsed.id || "guest-local",
      name: parsed.name,
      email: null
    };
  } catch (e) {
    return null;
  }
}

function writeGuestUser(name) {
  var normalizedName = typeof name === "string" ? name.trim() : "";
  if (!normalizedName) return null;

  var guestUser = {
    id: "guest-local",
    name: normalizedName
  };

  localStorage.setItem(GUEST_USER_STORAGE_KEY, JSON.stringify(guestUser));
  return guestUser;
}

function clearGuestUser() {
  localStorage.removeItem(GUEST_USER_STORAGE_KEY);
}

function getCurrentAppUser() {
  var authUser = window.ActionFlowAuth && typeof window.ActionFlowAuth.getCurrentUser === "function"
    ? window.ActionFlowAuth.getCurrentUser()
    : null;

  return authUser || readGuestUser();
}

function syncAuthVisibility() {
  if (window.location.pathname !== "/") {
    return;
  }

  if (readGuestUser()) {
    return;
  }

  if (window.ActionFlowAuth && typeof window.ActionFlowAuth.isLoaded === "function" && !window.ActionFlowAuth.isLoaded()) {
    return;
  }

  if (!getCurrentAppUser()) {
    window.location.replace("/login");
  }
}

function getAccountDisplayLabel(user) {
  if (user && user.name) return user.name;
  if (user && user.email) return user.email;
  return "A";
}

function getAccountImage(user) {
  if (!user || typeof user !== "object") return "";
  return user.picture || user.image || user.photoURL || "";
}

function getAuthUserIdentifier(user) {
  if (!user) return "guest";
  return user.id || user.email || "guest";
}

function getStoredThemePreference() {
  try {
    var theme = localStorage.getItem(THEME_STORAGE_KEY);
    if (theme === "light" || theme === "dark" || theme === "system") {
      return theme;
    }
  } catch (e) {}
  return "system";
}

function getResolvedTheme(theme) {
  if (theme === "light" || theme === "dark") {
    return theme;
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  var resolvedTheme = getResolvedTheme(theme || "system");
  document.body.setAttribute("data-theme", resolvedTheme);
}

function saveThemePreference(theme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  applyTheme(theme);
}

function readStoredUserSettings() {
  try {
    var raw = localStorage.getItem(USER_SETTINGS_STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeStoredUserSettings(settings) {
  localStorage.setItem(USER_SETTINGS_STORAGE_KEY, JSON.stringify(settings || {}));
}

function isCalendarAutoSyncEnabled() {
  return readStoredUserSettings().calendarAutoSync === true;
}

function getEffectiveUserProfile(user) {
  if (!user) return null;

  var merged = Object.assign({}, user);
  var storedSettings = readStoredUserSettings();

  if (storedSettings.displayName) {
    merged.displayName = storedSettings.displayName;
  }

  if (storedSettings.avatarUrl) {
    merged.avatarUrl = storedSettings.avatarUrl;
  }

  if (storedSettings.theme) {
    merged.theme = storedSettings.theme;
  }

  if (merged.displayName) {
    merged.name = merged.displayName;
  }

  if (merged.avatarUrl) {
    merged.picture = merged.avatarUrl;
  }

  return merged;
}

function applyAvatarContent(element, user, fallbackLabel) {
  if (!element) return;

  var imageUrl = getAccountImage(user);
  if (imageUrl) {
    element.textContent = fallbackLabel;
    element.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '\\"') + '")';
    element.classList.add("has-image");
    element.classList.remove("is-icon");
    return;
  }

  if (!user) {
    element.innerHTML = getUiIconSvg("profile");
    element.style.backgroundImage = "";
    element.classList.remove("has-image");
    element.classList.add("is-icon");
    return;
  }

  element.textContent = fallbackLabel;
  element.style.backgroundImage = "";
  element.classList.remove("has-image");
  element.classList.remove("is-icon");
}

function closeAccountMenu() {
  var menu = document.getElementById("account-menu-panel");
  var button = document.getElementById("account-menu-button");

  if (menu) {
    menu.classList.add("nascosto");
    menu.setAttribute("aria-hidden", "true");
  }

  if (button) {
    button.setAttribute("aria-expanded", "false");
  }
}

function openAccountMenu() {
  var menu = document.getElementById("account-menu-panel");
  var button = document.getElementById("account-menu-button");

  if (menu) {
    menu.classList.remove("nascosto");
    menu.setAttribute("aria-hidden", "false");
  }

  if (button) {
    button.setAttribute("aria-expanded", "true");
  }
}

function toggleAccountMenu() {
  var menu = document.getElementById("account-menu-panel");
  if (!menu) return;

  if (menu.classList.contains("nascosto")) {
    openAccountMenu();
  } else {
    closeAccountMenu();
  }
}

async function eseguiLogoutAuth() {
  var authUser = window.ActionFlowAuth && typeof window.ActionFlowAuth.getCurrentUser === "function"
    ? window.ActionFlowAuth.getCurrentUser()
    : null;

  if (!authUser && readGuestUser()) {
    clearGuestUser();
    mostraProfilo();
    syncAuthVisibility();
    closeAccountMenu();
    return;
  }

  try {
    await fetch("/auth/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } catch (e) {}

  if (window.ActionFlowAuth && typeof window.ActionFlowAuth.loadCurrentUser === "function") {
    await window.ActionFlowAuth.loadCurrentUser();
  } else {
    mostraProfilo();
  }

  closeAccountMenu();
}

function openSettingsModal() {
  var modal = document.getElementById("modal-settings");
  var authUser = getCurrentAppUser();
  var effectiveUser = getEffectiveUserProfile(authUser);
  var nameInput = document.getElementById("settings-name-input");
  var imageUrlInput = document.getElementById("settings-image-url-input");
  var fileInput = document.getElementById("settings-image-file-input");
  var themeSelect = document.getElementById("settings-theme-select");
  var calendarAutoSyncInput = document.getElementById("settings-calendar-autosync-input");

  if (!modal || !effectiveUser) return;

  pendingSettingsImageDataUrl = "";
  if (nameInput) nameInput.value = effectiveUser.name || "";
  if (imageUrlInput) imageUrlInput.value = getAccountImage(effectiveUser) || "";
  if (fileInput) fileInput.value = "";
  if (themeSelect) themeSelect.value = effectiveUser.theme || getStoredThemePreference();
  if (calendarAutoSyncInput) calendarAutoSyncInput.checked = isCalendarAutoSyncEnabled();

  modal.classList.remove("nascosto");
  modal.setAttribute("aria-hidden", "false");
}

function closeSettingsModal() {
  var modal = document.getElementById("modal-settings");
  if (!modal) return;

  modal.classList.add("nascosto");
  modal.setAttribute("aria-hidden", "true");
}

function openFocusModal() {
  var modal = document.getElementById("modal-focus");
  if (!modal) return;

  renderFocus(loadDailyPlan());
  inizializzaFocusPage();
  modal.classList.remove("nascosto");
  modal.setAttribute("aria-hidden", "false");
}

function closeFocusModal() {
  var modal = document.getElementById("modal-focus");
  if (!modal) return;

  modal.classList.add("nascosto");
  modal.setAttribute("aria-hidden", "true");
}

async function saveSettingsModal() {
  var authUser = getCurrentAppUser();
  var nameInput = document.getElementById("settings-name-input");
  var imageUrlInput = document.getElementById("settings-image-url-input");
  var themeSelect = document.getElementById("settings-theme-select");
  var calendarAutoSyncInput = document.getElementById("settings-calendar-autosync-input");

  if (!authUser) return;

  var profileImage = pendingSettingsImageDataUrl || (imageUrlInput ? imageUrlInput.value.trim() : "") || "";
  var selectedTheme = themeSelect ? themeSelect.value : "system";
  var calendarAutoSync = !!(calendarAutoSyncInput && calendarAutoSyncInput.checked);
  var settingsPayload = {
    displayName: nameInput ? nameInput.value.trim() : "",
    avatarUrl: profileImage,
    theme: selectedTheme
  };
  var storedSettings = Object.assign({}, readStoredUserSettings(), {
    displayName: settingsPayload.displayName,
    calendarAutoSync: calendarAutoSync
  });

  writeStoredUserSettings(storedSettings);

  if (authUser && authUser.provider === "guest") {
    writeGuestUser(settingsPayload.displayName || authUser.name || "Ospite");
    saveThemePreference(selectedTheme);
    mostraProfilo();
    closeSettingsModal();
    return;
  }

  try {
    var response = await fetch("/auth/settings", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(settingsPayload)
    });

    if (!response.ok) {
      if (response.status === 404) {
        writeStoredUserSettings(settingsPayload);
      } else {
        throw new Error("Impossibile salvare le impostazioni.");
      }
    } else if (window.ActionFlowAuth && typeof window.ActionFlowAuth.loadCurrentUser === "function") {
      await window.ActionFlowAuth.loadCurrentUser();
    }

    saveThemePreference(selectedTheme);
  } catch (e) {
    writeStoredUserSettings(settingsPayload);
    saveThemePreference(selectedTheme);
    mostraProfilo();
    closeSettingsModal();
    return;
  }

  if (!response || response.status === 404) {
    saveThemePreference(selectedTheme);
  }

  mostraProfilo();
  closeSettingsModal();
}

function renderAccountMenu(user) {
  var greetingText = document.getElementById("home-greeting-text");
  var statusLabel = document.getElementById("account-status-label");
  var buttonAvatar = document.getElementById("account-menu-avatar");
  var userInfo = document.getElementById("account-user-info");
  var actions = document.getElementById("account-menu-actions");
  if (!statusLabel) return;
  var effectiveUser = getEffectiveUserProfile(user);

  if (effectiveUser) {
    var authLabel = effectiveUser.name || effectiveUser.email || "Utente";
    var authInitial = authLabel.charAt(0).toUpperCase();

    if (greetingText) greetingText.textContent = "Ciao " + authLabel + ", cosa vuoi fare oggi?";
    statusLabel.textContent = "Connesso";
    applyAvatarContent(buttonAvatar, effectiveUser, authInitial);
    if (userInfo) {
      userInfo.classList.remove("nascosto");
      userInfo.innerHTML =
        '<div id="account-user-avatar" class="profilo-avatar account-user-avatar">' + authInitial + '</div>' +
        '<div class="account-user-copy">' +
        '<strong id="account-user-name" class="account-user-name"></strong>' +
        '<span id="account-user-email" class="account-user-email"></span>' +
        "</div>";

      applyAvatarContent(document.getElementById("account-user-avatar"), effectiveUser, authInitial);
      document.getElementById("account-user-name").textContent = effectiveUser.name || "Utente";
      document.getElementById("account-user-email").textContent = effectiveUser.email || (effectiveUser.provider === "guest" ? "Modalità ospite" : "Account collegato");
    }
    if (actions) {
      actions.innerHTML =
        '<button type="button" id="btn-account-settings" class="profilo-btn">' + buildIconLabel("settings", "Impostazioni") + '</button>' +
        '<button type="button" id="btn-account-logout" class="profilo-btn profilo-btn-reset">' + buildIconLabel("logout", "Esci") + '</button>';
    }
    return;
  }

  if (greetingText) greetingText.textContent = "Ciao, cosa vuoi fare oggi?";
  statusLabel.textContent = "Non connesso";
  applyAvatarContent(buttonAvatar, null, getAccountDisplayLabel(null));
  if (userInfo) {
    userInfo.classList.add("nascosto");
    userInfo.innerHTML =
      '<div id="account-user-avatar" class="profilo-avatar account-user-avatar">A</div>' +
      '<div class="account-user-copy">' +
      '<strong id="account-user-name" class="account-user-name"></strong>' +
      '<span id="account-user-email" class="account-user-email"></span>' +
      "</div>";
  }
  if (actions) {
    actions.innerHTML =
      '<button type="button" id="btn-account-login-google" class="auth-btn auth-btn-primary">Accedi con Google</button>' +
      '<button type="button" id="btn-account-login-apple" class="auth-btn auth-btn-apple">Continua con Apple</button>' +
      '<div id="account-provider-placeholders" class="auth-placeholder-group" aria-label="Provider futuri">' +
      '<button type="button" class="auth-btn auth-btn-secondary" disabled aria-disabled="true">Email presto</button>' +
      "</div>";
  }
}

function mostraProfilo() {
  var authUser = getCurrentAppUser();

  renderAccountMenu(authUser);
  syncAuthVisibility();
}

function inizializzaFocusPage() {
  var focusSection = document.getElementById("sezione-focus");
  var emptyState = document.getElementById("focus-empty-state");
  var plan = loadDailyPlan();
  var focus = getFocusTasks(plan);
  var haContenuto = !!(focus.ora || focus.dopo.length || focus.piuTardiOggi.length || focus.seAvanzaTempo.length);

  if (!focusSection) return;

  renderFocus(plan);

  if (emptyState) {
    emptyState.classList.toggle("nascosto", haContenuto);
  }
  focusSection.classList.toggle("nascosto", !haContenuto);
}

// Collega il bottone checklist anche via JS (fallback robusto)
document.addEventListener("DOMContentLoaded", function() {
  applyTheme(getStoredThemePreference());
  mostraProfilo();
  setupDailyPlanModal();
  setupAnalysisPreviewModal();

  var accountButton = document.getElementById("account-menu-button");
  if (accountButton) accountButton.addEventListener("click", function(event) {
    event.stopPropagation();
    toggleAccountMenu();
  });

  var accountPanel = document.getElementById("account-menu-panel");
  if (accountPanel) accountPanel.addEventListener("click", function(event) {
    event.stopPropagation();

    var target = event.target;
    if (!(target instanceof Element)) return;
    var buttonTarget = target.closest("button");
    if (!(buttonTarget instanceof Element)) return;

    if (buttonTarget.id === "btn-account-login-google") {
      avviaLoginGoogle();
      return;
    }

    if (buttonTarget.id === "btn-account-login-apple") {
      avviaLoginApple();
      return;
    }

    if (buttonTarget.id === "btn-account-settings") {
      closeAccountMenu();
      openSettingsModal();
      return;
    }

    if (buttonTarget.id === "btn-account-logout") {
      eseguiLogoutAuth();
    }
  });

  var btnOpenFocusModal = document.getElementById("btn-open-focus-modal");
  if (btnOpenFocusModal) btnOpenFocusModal.addEventListener("click", openFocusModal);

  var settingsModal = document.getElementById("modal-settings");
  if (settingsModal) settingsModal.addEventListener("click", function(event) {
    if (event.target === settingsModal) {
      closeSettingsModal();
    }
  });

  var focusModal = document.getElementById("modal-focus");
  if (focusModal) focusModal.addEventListener("click", function(event) {
    if (event.target === focusModal) {
      closeFocusModal();
    }
  });

  var btnCloseSettings = document.getElementById("btn-close-settings");
  if (btnCloseSettings) btnCloseSettings.addEventListener("click", closeSettingsModal);

  var btnCloseFocus = document.getElementById("btn-close-focus");
  if (btnCloseFocus) btnCloseFocus.addEventListener("click", closeFocusModal);

  var btnSaveSettings = document.getElementById("btn-save-settings");
  if (btnSaveSettings) btnSaveSettings.addEventListener("click", saveSettingsModal);

  var fileInput = document.getElementById("settings-image-file-input");
  if (fileInput) fileInput.addEventListener("change", function(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) {
      pendingSettingsImageDataUrl = "";
      return;
    }

    var reader = new FileReader();
    reader.onload = function(loadEvent) {
      pendingSettingsImageDataUrl = typeof loadEvent.target.result === "string" ? loadEvent.target.result : "";
    };
    reader.readAsDataURL(file);
  });

  var systemThemeMedia = window.matchMedia("(prefers-color-scheme: dark)");
  if (systemThemeMedia && typeof systemThemeMedia.addEventListener === "function") {
    systemThemeMedia.addEventListener("change", function() {
      if (getStoredThemePreference() === "system") {
        applyTheme("system");
      }
    });
  } else if (systemThemeMedia && typeof systemThemeMedia.addListener === "function") {
    systemThemeMedia.addListener(function() {
      if (getStoredThemePreference() === "system") {
        applyTheme("system");
      }
    });
  }

  document.addEventListener("click", function() {
    closeAccountMenu();
  });

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape") {
      closeAccountMenu();
      closeSettingsModal();
      closeFocusModal();
    }
  });

  var bottoneChecklist = document.getElementById("bottone-checklist");
  if (bottoneChecklist) {
    bottoneChecklist.addEventListener("click", function() {
      window.location.href = "checklist.html";
    });
  }

  var bottoneEsporta = document.getElementById("bottone-esporta-eventi");
  if (bottoneEsporta) {
    bottoneEsporta.addEventListener("click", esportaEventiCalendario);
  }

  var btnRigeneraPiano = document.getElementById("btn-rigenera-piano");
  if (btnRigeneraPiano) {
    btnRigeneraPiano.addEventListener("click", organizeDay);
  }

  ensureDailyPlanForCurrentTasks(isDailyPlanPage());
  inizializzaFocusPage();
});

window.addEventListener("actionflow-auth-ready", function() {
  if (window.ActionFlowAuth && typeof window.ActionFlowAuth.getCurrentUser === "function" && window.ActionFlowAuth.getCurrentUser()) {
    clearGuestUser();
  }

  mostraProfilo();
  ensureDailyPlanForCurrentTasks(isDailyPlanPage());
  inizializzaFocusPage();
});
