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
var voiceRecognition = null;
var voiceInputAttivo = false;
var voiceBaseText = "";
var DAILY_PLAN_STORAGE_KEY = "actionflow_daily_plan";
var DAILY_PLAN_DEFAULT_DURATION = 30;
var DAILY_PLAN_MAX_TASKS = 4;
var DAILY_PLAN_MAX_SLOT_MINUTES = 180;
var DAILY_PLAN_DEBUG = true;
var ANALYSIS_PREVIEW_MAX_ITEMS = 6;
var pendingAnalysisResult = null;

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
    seAvanzaTempo: sezioni.seAvanzaTempo,
    daFareOggi: sezioni.mattina.concat(sezioni.pomeriggio),
    totali: {
      taskConsiderati: plan.totali && typeof plan.totali.taskConsiderati === "number" ? plan.totali.taskConsiderati : sezioni.mattina.length + sezioni.pomeriggio.length + sezioni.seAvanzaTempo.length,
      minutiMattina: minutiMattina,
      minutiPomeriggio: minutiPomeriggio,
      minutiDaFareOggi: minutiMattina + minutiPomeriggio,
      taskMattina: sezioni.mattina.length,
      taskPomeriggio: sezioni.pomeriggio.length,
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

function openAnalysisPreview(azioni, scadenze) {
  pendingAnalysisResult = {
    azioni: Array.isArray(azioni) ? azioni.slice() : [],
    scadenze: Array.isArray(scadenze) ? scadenze.slice() : []
  };

  renderAnalysisPreview(pendingAnalysisResult.azioni, pendingAnalysisResult.scadenze);
  openAnalysisPreviewModal();
}

function confirmAnalysisPreview() {
  if (!pendingAnalysisResult) {
    closeAnalysisPreviewModal();
    return;
  }

  mostraRisultati(pendingAnalysisResult.azioni, pendingAnalysisResult.scadenze);
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
  bottone.title = attivo ? "Ferma input vocale" : "Input vocale";
}

function startVoiceInput() {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  var textarea = document.getElementById("testo-input");

  if (!SpeechRecognition) {
    mostraErroreInput("Input vocale non supportato in questo browser.");
    return;
  }

  if (!textarea) return;

  if (voiceInputAttivo && voiceRecognition) {
    voiceRecognition.stop();
    return;
  }

  nascondiErroreInput();
  voiceBaseText = textarea.value ? textarea.value.trim() : "";
  voiceRecognition = new SpeechRecognition();
  voiceRecognition.lang = "it-IT";
  voiceRecognition.continuous = true;
  voiceRecognition.interimResults = true;

  voiceRecognition.onstart = function() {
    voiceInputAttivo = true;
    aggiornaStatoVoiceButton(true);
  };

  voiceRecognition.onresult = function(event) {
    var finalTranscript = "";
    var interimTranscript = "";

    for (var i = event.resultIndex; i < event.results.length; i++) {
      var transcript = event.results[i][0] ? event.results[i][0].transcript : "";
      if (event.results[i].isFinal) {
        finalTranscript += transcript + " ";
      } else {
        interimTranscript += transcript;
      }
    }

    var parti = [];
    if (voiceBaseText) parti.push(voiceBaseText);
    if (finalTranscript.trim()) parti.push(finalTranscript.trim());
    var testoFinale = parti.join(" ").trim();
    textarea.value = interimTranscript.trim() ? (testoFinale ? testoFinale + " " + interimTranscript.trim() : interimTranscript.trim()) : testoFinale;
  };

  voiceRecognition.onerror = function(event) {
    voiceInputAttivo = false;
    aggiornaStatoVoiceButton(false);

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      mostraErroreInput("Microfono non disponibile o permesso negato.");
    } else if (event.error === "audio-capture") {
      mostraErroreInput("Microfono non disponibile su questo dispositivo.");
    } else if (event.error !== "aborted") {
      mostraErroreInput("Errore durante l'input vocale. Riprova.");
    }
  };

  voiceRecognition.onend = function() {
    voiceInputAttivo = false;
    aggiornaStatoVoiceButton(false);
    voiceBaseText = textarea.value ? textarea.value.trim() : "";
  };

  try {
    voiceRecognition.start();
  } catch (err) {
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
      mappa[lista[i].testo] = lista[i];
    }
  }

  return mappa;
}

function resolveTaskForDisplay(task, scadenzeMap) {
  var fallback = scadenzeMap && task && task.testo ? scadenzeMap[task.testo] : null;
  var dataISO = task && task.dataISO ? task.dataISO : (fallback ? fallback.dataRisolta || fallback.dataISO || null : null);
  var scadenzaOriginale = task && task.scadenzaOriginale ? task.scadenzaOriginale : (fallback ? fallback.data || fallback.scadenzaOriginale || null : null);
  var resolved = {
    id: task && task.id ? task.id : null,
    testo: task && task.testo ? task.testo : "",
    priorita: task && task.priorita ? task.priorita : "bassa",
    dataISO: dataISO,
    scadenzaOriginale: scadenzaOriginale,
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
      mappa[scadenze[i].testo] = scadenze[i];
    }
  }

  try {
    var raw = localStorage.getItem("actionflow_scadenze");
    var correnti = raw ? JSON.parse(raw) : [];
    if (Array.isArray(correnti)) {
      for (var j = 0; j < correnti.length; j++) {
        if (correnti[j] && correnti[j].testo) {
          mappa[correnti[j].testo] = correnti[j];
        }
      }
    }
  } catch (e) {}

  return mappa;
}

function normalizzaTaskPerPiano(task, completate, scadenzeMap) {
  var azione = normalizzaAzioneSalvata(task);
  var fallbackScadenza = scadenzeMap[azione.testo] || null;
  var durata = normalizzaDurataStimata(azione.durataStimataMinuti);
  var energia = normalizzaEnergiaStimata(azione.energiaStimata);

  return {
    id: task && task.id ? task.id : generaIdAzione(azione.testo || ""),
    testo: azione.testo,
    priorita: azione.priorita || "media",
    dataISO: azione.dataISO || (fallbackScadenza ? fallbackScadenza.dataRisolta || null : null),
    scadenzaOriginale: azione.scadenzaOriginale || (fallbackScadenza ? fallbackScadenza.data || null : null),
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
    var raw = localStorage.getItem("actionflow_checklist");
    var checklist = raw ? JSON.parse(raw) : [];
    if (Array.isArray(checklist)) {
      for (var i = 0; i < checklist.length; i++) {
        var task = normalizzaTaskPerPiano(checklist[i], completate, scadenzeMap);
        if (task.testo) {
          tasks.push(task);
        }
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

  console.log("[ActionFlow][OrganizzaGiornata]", {
    testo: task && task.testo ? task.testo : "",
    dataISO: task && task.dataISO ? task.dataISO : null,
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
    dettagli: details || null
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

  if (getPrimaryTaskCount(planSections) >= DAILY_PLAN_MAX_TASKS) return "limite_task_principali_raggiunto";
  if (giorni === 1) return "task_di_domani_riservato_a_extra";
  if (slotMinutes + durataTask > DAILY_PLAN_MAX_SLOT_MINUTES) return "slot_oltre_180_minuti";
  if (task.energiaStimata === "alta" && highEnergyCount >= 1) return "slot_ha_gia_un_task_alta_energia";

  if (slotTasks.length > 0) {
    var previousTask = slotTasks[slotTasks.length - 1];
    if (isLongTask(previousTask) && isLongTask(task)) {
      return "due_task_lunghi_consecutivi";
    }
  }

  return null;
}

function canAddTaskToSlot(task, slotName, planSections) {
  return getSlotConstraintReason(task, slotName, planSections) === null;
}

function shouldReserveForExtraTime(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);

  if (giorni === 1) return true;
  if (task.energiaStimata === "bassa" && giorni === null && priorita !== "alta") return true;
  return false;
}

function isDueTodayTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);

  return giorni !== null && giorni <= 0;
}

function isUsefulUndatedTask(task) {
  var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
  var priorita = getDynamicPriority(task);

  if (giorni !== null) return false;
  if (isPreparatoryTask(task)) return true;
  if (priorita === "alta") return true;
  if (priorita === "media" && isVeryShortTask(task)) return true;
  return false;
}

function isUrgentPrimaryTask(task) {
  if (isDueTodayTask(task)) return true;
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
  if (isPreparatoryTask(task)) return true;
  if (isVeryShortTask(task) && (giorni === 1 || priorita === "alta" || priorita === "media")) return true;
  return false;
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

  if (task.energiaStimata === "alta") return "mattina";
  if (task.energiaStimata === "media") return "pomeriggio";
  if (giorni !== null && giorni <= 0) return morningCount <= afternoonCount ? "mattina" : "pomeriggio";
  return afternoonCount <= morningCount ? "pomeriggio" : "mattina";
}

function chooseSlotForTask(task, planSections) {
  var preferred = getPreferredSlot(task, planSections);
  var secondary = preferred === "mattina" ? "pomeriggio" : "mattina";
  var preferredReason = getSlotConstraintReason(task, preferred, planSections);
  var secondaryReason;

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

  function tryAssignFromList(taskList, listName) {
    for (var idx = 0; idx < taskList.length; idx++) {
      var task = taskList[idx];
      var slotChoice;

      if (selectedTasks.indexOf(task) !== -1) continue;
      if (shouldReserveForExtraTime(task)) {
        logDailyPlanDebug(task, "escluso_dal_piano_principale", listName + ": riservato a seAvanzaTempo");
        continue;
      }

      slotChoice = chooseSlotForTask(task, planSections);
      if (!slotChoice.slot) {
        if (isUrgentPrimaryTask(task)) {
          blockedUrgentTasks++;
        }
        logDailyPlanDebug(task, "escluso_dal_piano_principale", listName + ": " + slotChoice.reason);
        continue;
      }

      planSections[slotChoice.slot].push(task);
      selectedTasks.push(task);
      logDailyPlanDebug(task, "incluso_nel_piano_principale", listName + ": " + slotChoice.slot + " (" + slotChoice.reason + ")");
    }
  }

  var urgentTasks = [];
  var futureMonitoringTasks = [];
  var fallbackUndatedTasks = [];
  var fallbackFutureTasks = [];

  for (var i = 0; i < tasks.length; i++) {
    if (isUrgentPrimaryTask(tasks[i])) {
      urgentTasks.push(tasks[i]);
    } else if (getTaskDaysFromToday(tasks[i] && tasks[i].dataISO ? tasks[i].dataISO : null) === null) {
      fallbackUndatedTasks.push(tasks[i]);
    } else {
      futureMonitoringTasks.push(tasks[i]);
      if (canFutureTaskAppearToday(tasks[i])) {
        fallbackFutureTasks.push(tasks[i]);
      }
    }
  }

  tryAssignFromList(urgentTasks, "task_di_oggi");

  if (selectedTasks.length < DAILY_PLAN_MAX_TASKS) {
    tryAssignFromList(fallbackUndatedTasks, "fallback_senza_data");
  }

  if (selectedTasks.length < DAILY_PLAN_MAX_TASKS) {
    tryAssignFromList(fallbackFutureTasks, "fallback_future_preparatori");
  }

  return {
    mattina: planSections.mattina,
    pomeriggio: planSections.pomeriggio,
    tasks: selectedTasks,
    futureMonitoringTasks: futureMonitoringTasks,
    blockedUrgentTasks: blockedUrgentTasks,
    minutiMattina: getPlanSlotMinutes(planSections.mattina),
    minutiPomeriggio: getPlanSlotMinutes(planSections.pomeriggio)
  };
}

function buildExtraTimeTasks(sortedTasks, selectedTasks) {
  var extra = [];

  for (var i = 0; i < sortedTasks.length; i++) {
    var task = sortedTasks[i];
    if (selectedTasks.indexOf(task) !== -1) continue;

    var giorni = getTaskDaysFromToday(task && task.dataISO ? task.dataISO : null);
    var urgente = giorni !== null && giorni <= 3;
    var leggero = isVeryShortTask(task) || getTaskEnergyValue(task.energiaStimata) <= 2;
    var importante = getDynamicPriority(task) === "alta" || getTaskUrgencyBucket(task) <= 3;

    if (isFutureMonitoringTask(task)) {
      if (canFutureTaskAppearToday(task) && (giorni !== 1 || isAllowedTomorrowExtraTask(task))) {
        extra.push(task);
        logDailyPlanDebug(task, "incluso_in_se_avanza_tempo", "task futuro ma preparatorio o utile in anticipo");
      } else {
        logDailyPlanDebug(task, "escluso_dal_piano", "task futuro monitorato, non utile oggi");
      }
      continue;
    }

    if (urgente || leggero || importante || isPreparatoryTask(task)) {
      if (giorni !== 1 || isAllowedTomorrowExtraTask(task)) {
        extra.push(task);
        logDailyPlanDebug(task, "incluso_in_se_avanza_tempo", "task leggero, utile o preparatorio");
      } else {
        logDailyPlanDebug(task, "escluso_dal_piano", "task di domani non abbastanza breve o preparatorio");
      }
    } else {
      logDailyPlanDebug(task, "escluso_dal_piano", "task non essenziale per oggi");
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
    seAvanzaTempo: []
  };

  planSections.seAvanzaTempo = buildExtraTimeTasks(ordinati, scelta.tasks);

  if (scelta.tasks.length === 0 && planSections.seAvanzaTempo.length === 0 && ordinati.length > 0) {
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
      taskExtra: planSections.seAvanzaTempo.length,
      taskFuturiMonitorati: scelta.futureMonitoringTasks.length,
      blockedUrgentTasks: scelta.blockedUrgentTasks
    });
  }

  return {
    data: formatISO(inizioOggiLocale()),
    mattina: planSections.mattina,
    pomeriggio: planSections.pomeriggio,
    seAvanzaTempo: planSections.seAvanzaTempo,
    daFareOggi: planSections.mattina.concat(planSections.pomeriggio),
    totali: {
      taskConsiderati: ordinati.length,
      minutiMattina: scelta.minutiMattina,
      minutiPomeriggio: scelta.minutiPomeriggio,
      minutiDaFareOggi: scelta.minutiMattina + scelta.minutiPomeriggio,
      taskMattina: planSections.mattina.length,
      taskPomeriggio: planSections.pomeriggio.length,
      taskFuturiMonitorati: scelta.futureMonitoringTasks.length
    }
  };
}

function buildDailyPlan(tasks) {
  return buildSmartDailyPlan(tasks);
}

function saveDailyPlan(plan) {
  var normalizedPlan = normalizeDailyPlan(plan);
  localStorage.setItem(DAILY_PLAN_STORAGE_KEY, JSON.stringify(normalizedPlan));

  if (DAILY_PLAN_DEBUG) {
    console.log("[ActionFlow][OrganizzaGiornata] saveDailyPlan", countDailyPlanTasks(normalizedPlan));
  }

  return normalizedPlan;
}

function loadDailyPlan() {
  try {
    var raw = localStorage.getItem(DAILY_PLAN_STORAGE_KEY);
    var plan = raw ? normalizeDailyPlan(JSON.parse(raw)) : null;

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
  var seAvanzaTempo = Array.isArray(piano.seAvanzaTempo) ? piano.seAvanzaTempo.slice() : [];

  if (mattina.length === 0 && pomeriggio.length === 0 && Array.isArray(piano.daFareOggi)) {
    var taskOggi = piano.daFareOggi.slice();
    var splitIndex = Math.ceil(taskOggi.length / 2);
    mattina = taskOggi.slice(0, splitIndex);
    pomeriggio = taskOggi.slice(splitIndex);
  }

  return {
    mattina: mattina,
    pomeriggio: pomeriggio,
    seAvanzaTempo: seAvanzaTempo
  };
}

function getFocusTasks(plan) {
  var piano = plan || loadDailyPlan() || { mattina: [], pomeriggio: [], seAvanzaTempo: [] };
  var sezioniPiano = getDailyPlanSections(piano);
  var primarySource = sezioniPiano.mattina.concat(sezioniPiano.pomeriggio);
  var usaExtraComeFallback = primarySource.length === 0;

  if (primarySource.length === 0) {
    primarySource = (sezioniPiano.seAvanzaTempo || []).slice();
  }

  var ora = primarySource.length > 0 ? primarySource[0] : null;
  var dopo = primarySource.slice(1, 4);
  var seAvanzaTempo = usaExtraComeFallback ? primarySource.slice(4) : (sezioniPiano.seAvanzaTempo || []).slice();

  return {
    ora: ora,
    dopo: dopo,
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
      summary.textContent = "Una vista essenziale del prossimo passo, seguita dai task immediatamente successivi.";
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
    { id: "blocco-se-avanza-tempo", listId: "lista-se-avanza-tempo", items: sezioniPiano.seAvanzaTempo }
  ];
  var haContenuto = false;
  var taskPianificati = sezioniPiano.mattina.length + sezioniPiano.pomeriggio.length;

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
  if (!localStorage.getItem(DAILY_PLAN_STORAGE_KEY)) return null;

  var plan = buildDailyPlan(getSavedTasksForPlanning());
  var sezioniPiano = getDailyPlanSections(plan);
  var savedPlan = saveDailyPlan(plan);
  renderDailyPlan(savedPlan, sezioniPiano.mattina.length + sezioniPiano.pomeriggio.length + sezioniPiano.seAvanzaTempo.length === 0);
  return savedPlan;
}

function organizeDay() {
  var plan = buildDailyPlan(getSavedTasksForPlanning());
  var savedPlan = saveDailyPlan(plan);
  renderDailyPlan(savedPlan, true);
  openDailyPlanModal();
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
    if (azioni[i].testo === azione.testo) {
      if (livelloPriorita(azione.priorita) > livelloPriorita(azioni[i].priorita)) {
        azioni[i].priorita = azione.priorita;
      }
      return;
    }
  }

  azioni.push({ testo: azione.testo, priorita: azione.priorita || "media" });
}

function aggiungiScadenzaUnica(scadenze, testoAzione, scadenzaObj) {
  for (var i = 0; i < scadenze.length; i++) {
    if (scadenze[i].testo === testoAzione && scadenze[i].data === scadenzaObj.originale) {
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
  var raw = localStorage.getItem("actionflow_scadenze");
  var scadenze = [];

  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        scadenze = parsed;
      }
    } catch (err) {
      scadenze = [];
    }
  }

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

function normalizzaEnergiaStimata(valore) {
  if (typeof valore !== "string") return null;
  var energia = valore.toLowerCase();
  return energia === "bassa" || energia === "media" || energia === "alta" ? energia : null;
}

function normalizzaAzioneSalvata(azione) {
  if (!azione || typeof azione !== "object") {
    return { testo: "", priorita: "bassa", durataStimataMinuti: null, energiaStimata: null };
  }

  return {
    testo: azione.testo || "",
    priorita: azione.priorita || "bassa",
    scadenzaOriginale: azione.scadenzaOriginale || null,
    dataISO: azione.dataISO || null,
    durataStimataMinuti: normalizzaDurataStimata(azione.durataStimataMinuti),
    energiaStimata: normalizzaEnergiaStimata(azione.energiaStimata)
  };
}

// Converte la risposta del backend nel formato usato dal rendering
function convertiRispostaBackend(data) {
  var azioni = [];
  var scadenze = [];

  if (data.azioni && Array.isArray(data.azioni)) {
    for (var i = 0; i < data.azioni.length; i++) {
      var a = data.azioni[i];
      azioni.push(normalizzaAzioneSalvata({
        testo: a.testo || "",
        priorita: a.priorita || "bassa",
        scadenzaOriginale: a.scadenzaOriginale || null,
        dataISO: a.dataISO || null,
        durataStimataMinuti: a.durataStimataMinuti,
        energiaStimata: a.energiaStimata
      }));

      if (a.scadenzaOriginale) {
        scadenze.push({
          testo: a.testo || "",
          data: a.scadenzaOriginale,
          dataRisolta: a.dataISO || null
        });
      }
    }
  }

  // Aggiungi scadenze extra dal backend che non sono già associate ad azioni
  if (data.scadenze && Array.isArray(data.scadenze)) {
    for (var s = 0; s < data.scadenze.length; s++) {
      var sc = data.scadenze[s];
      var giaTrovata = false;
      for (var e = 0; e < scadenze.length; e++) {
        if (scadenze[e].testo === sc.titolo && scadenze[e].data === sc.scadenzaOriginale) {
          giaTrovata = true;
          break;
        }
      }
      if (!giaTrovata) {
        scadenze.push({
          testo: sc.titolo || "",
          data: sc.scadenzaOriginale || "",
          dataRisolta: sc.dataISO || null
        });
      }
    }
  }

  return { azioni: azioni, scadenze: scadenze };
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
            dateLocali: scadenzeParte
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

        aggiungiAzioneUnica(azioni, { testo: az.testo, priorita: priorita });

        for (var sd = 0; sd < az.dateLocali.length; sd++) {
          aggiungiScadenzaUnica(scadenze, az.testo, az.dateLocali[sd]);
        }
      }
    }
  }

  return { azioni: azioni, scadenze: scadenze };
}

// Mostra i risultati nella pagina e salva in localStorage/archivio
function mostraRisultati(azioni, scadenze) {
  azioniCorrente = azioni;
  scadenzeCorrente = scadenze;

  riempiListaAzioni("contenitore-azioni", azioni);
  riempiListaScadenze("lista-scadenze", scadenze);

  localStorage.setItem("actionflow_checklist", JSON.stringify(azioni));
  localStorage.setItem("actionflow_scadenze", JSON.stringify(scadenze));

  salvaInArchivio(azioni, scadenze);
  refreshDailyPlanIfPresent();

  document.getElementById("box-azioni").style.display = azioni.length > 0 ? "block" : "none";
  document.getElementById("box-scadenze").style.display = scadenze.length > 0 ? "block" : "none";

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
    openAnalysisPreview(risultato.azioni, risultato.scadenze);

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
    var raw = localStorage.getItem("actionflow_archivio_azioni");
    var dati = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(dati)) return [];

    return dati.map(function(azione) {
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
    var raw = localStorage.getItem("actionflow_archivio_scadenze");
    var dati = raw ? JSON.parse(raw) : [];
    return Array.isArray(dati) ? dati : [];
  } catch (e) { return []; }
}

function salvaInArchivio(nuoveAzioni, nuoveScadenze) {
  var archAzioni = leggiArchivioAzioni();
  var archScadenze = leggiArchivioScadenze();
  var timestamp = new Date().toISOString();

  for (var i = 0; i < nuoveAzioni.length; i++) {
    var esiste = false;
    for (var j = 0; j < archAzioni.length; j++) {
      if (archAzioni[j].testo === nuoveAzioni[i].testo) {
        // Aggiorna priorità se più alta
        if (livelloPriorita(nuoveAzioni[i].priorita) > livelloPriorita(archAzioni[j].priorita)) {
          archAzioni[j].priorita = nuoveAzioni[i].priorita;
        }
        if (normalizzaDurataStimata(nuoveAzioni[i].durataStimataMinuti) !== null) {
          archAzioni[j].durataStimataMinuti = normalizzaDurataStimata(nuoveAzioni[i].durataStimataMinuti);
        }
        if (normalizzaEnergiaStimata(nuoveAzioni[i].energiaStimata)) {
          archAzioni[j].energiaStimata = normalizzaEnergiaStimata(nuoveAzioni[i].energiaStimata);
        }
        if (nuoveAzioni[i].scadenzaOriginale) {
          archAzioni[j].scadenzaOriginale = nuoveAzioni[i].scadenzaOriginale;
        }
        if (nuoveAzioni[i].dataISO) {
          archAzioni[j].dataISO = nuoveAzioni[i].dataISO;
        }
        esiste = true;
        break;
      }
    }
    if (!esiste) {
      var nuovaAzione = normalizzaAzioneSalvata(nuoveAzioni[i]);
      nuovaAzione.aggiunta = timestamp;
      archAzioni.push(nuovaAzione);
    }
  }

  for (var s = 0; s < nuoveScadenze.length; s++) {
    var duplicata = false;
    for (var k = 0; k < archScadenze.length; k++) {
      if (archScadenze[k].testo === nuoveScadenze[s].testo &&
          archScadenze[k].data === nuoveScadenze[s].data) {
        duplicata = true;
        break;
      }
    }
    if (!duplicata) {
      archScadenze.push({
        testo: nuoveScadenze[s].testo,
        data: nuoveScadenze[s].data,
        dataRisolta: nuoveScadenze[s].dataRisolta || null,
        aggiunta: timestamp
      });
    }
  }

  localStorage.setItem("actionflow_archivio_azioni", JSON.stringify(archAzioni));
  localStorage.setItem("actionflow_archivio_scadenze", JSON.stringify(archScadenze));
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
  var raw = localStorage.getItem("actionflow_azioni_done");
  if (!raw) return {};
  try {
    var dati = JSON.parse(raw);
    if (!dati || typeof dati !== "object") return {};
    return dati;
  } catch (e) {
    return {};
  }
}

function salvaAzioniCompletate(completate) {
  localStorage.setItem("actionflow_azioni_done", JSON.stringify(completate));
}

function generaIdAzione(testo) {
  return "azione_" + testo.replace(/[^a-zA-Z0-9\u00C0-\u00FF]/g, "_").toLowerCase();
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
  localStorage.setItem("actionflow_checklist", JSON.stringify(azioniCorrente));
  localStorage.setItem("actionflow_scadenze", JSON.stringify(scadenzeCorrente));
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

function mostraProfilo() {
  var barra = document.getElementById("barra-profilo");
  var fallback = document.getElementById("home-greeting-fallback");
  if (!barra) return;

  var profilo = leggiProfilo();
  if (!profilo) {
    profilo = chiediNomeProfilo();
  }
  if (!profilo) {
    barra.classList.add("nascosto");
    if (fallback) fallback.classList.remove("nascosto");
    return;
  }

  barra.classList.remove("nascosto");
  if (fallback) fallback.classList.add("nascosto");

  var avatar = barra.querySelector(".profilo-avatar");
  var saluto = barra.querySelector(".profilo-saluto");

  if (avatar) avatar.textContent = profilo.nome.charAt(0).toUpperCase();
  if (saluto) saluto.textContent = "Ciao, " + profilo.nome;
}

function inizializzaFocusPage() {
  var focusSection = document.getElementById("sezione-focus");
  var emptyState = document.getElementById("focus-empty-state");
  var plan = loadDailyPlan();
  var focus = getFocusTasks(plan);
  var haContenuto = !!(focus.ora || focus.dopo.length || focus.seAvanzaTempo.length);

  if (!focusSection) return;

  renderFocus(plan);

  if (emptyState) {
    emptyState.classList.toggle("nascosto", haContenuto);
  }
  focusSection.classList.toggle("nascosto", !haContenuto);
}

// Collega il bottone checklist anche via JS (fallback robusto)
document.addEventListener("DOMContentLoaded", function() {
  mostraProfilo();
  setupDailyPlanModal();
  setupAnalysisPreviewModal();

  var btnModifica = document.getElementById("btn-modifica-profilo");
  if (btnModifica) btnModifica.addEventListener("click", modificaNomeProfilo);

  var btnReset = document.getElementById("btn-reset-profilo");
  if (btnReset) btnReset.addEventListener("click", eseguiResetProfilo);

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

  renderDailyPlan(loadDailyPlan(), false);
  inizializzaFocusPage();
});