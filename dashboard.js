// Migrazione chiavi localStorage
(function() {
  var m = [
    ["drop2action_archivio_azioni", "actionflow_archivio_azioni"],
    ["drop2action_archivio_scadenze", "actionflow_archivio_scadenze"],
    ["drop2action_checklist", "actionflow_checklist"],
    ["drop2action_scadenze", "actionflow_scadenze"],
    ["drop2action_azioni_done", "actionflow_azioni_done"],
    ["drop2action_profilo", "actionflow_profilo"]
  ];
  for (var i = 0; i < m.length; i++) {
    if (!localStorage.getItem(m[i][1]) && localStorage.getItem(m[i][0])) {
      localStorage.setItem(m[i][1], localStorage.getItem(m[i][0]));
    }
  }
})();

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizzaAzioneDashboard(azione) {
  if (!azione || typeof azione !== "object") return null;
  if (!azione.testo) return null;

  var rawTime = azione.time ? String(azione.time).trim() : null;

  return {
    id: azione.id || generaIdAzione(azione.testo),
    testo: String(azione.testo).trim(),
    priorita: azione.priorita || "bassa",
    scadenzaOriginale: azione.scadenzaOriginale || null,
    dataISO: azione.dataISO || null,
    time: /^([01]?\d|2[0-3]):([0-5]\d)$/.test(rawTime || "") ? rawTime : null,
    durataStimataMinuti: normalizzaDurataStimata(azione.durataStimataMinuti),
    energiaStimata: normalizzaEnergiaStimata(azione.energiaStimata),
    aggiunta: azione.aggiunta || null,
    completato: azione.completato === true,
    completedAt: azione.completedAt || null,
    userId: azione.userId || null
  };
}

function areTaskDuplicates(a, b) {
  var textA = normalizeText(a && a.testo ? a.testo : "");
  var textB = normalizeText(b && b.testo ? b.testo : "");
  var dateA = a && a.dataISO ? String(a.dataISO).trim() : "";
  var dateB = b && b.dataISO ? String(b.dataISO).trim() : "";

  if (!textA || !textB || textA !== textB) return false;
  if (dateA && dateB) return dateA === dateB;
  return true;
}

function mergeTaskRecord(existing, incoming) {
  var base = normalizzaAzioneDashboard(existing) || normalizzaAzioneDashboard(incoming);
  var next = normalizzaAzioneDashboard(incoming) || {};
  if (!base) return null;

  if (next.id && !base.id) base.id = next.id;
  if (livelloPriorita(next.priorita || "bassa") > livelloPriorita(base.priorita || "bassa")) {
    base.priorita = next.priorita;
  }
  if (next.scadenzaOriginale) base.scadenzaOriginale = next.scadenzaOriginale;
  if (next.dataISO) base.dataISO = next.dataISO;
  if (next.time) base.time = next.time;
  if (next.durataStimataMinuti !== null) base.durataStimataMinuti = next.durataStimataMinuti;
  if (next.energiaStimata) base.energiaStimata = next.energiaStimata;
  if (existing && existing.aggiunta) base.aggiunta = existing.aggiunta;
  if (incoming && incoming.aggiunta && !base.aggiunta) base.aggiunta = incoming.aggiunta;
  if ((existing && existing.completato === true) || (incoming && incoming.completato === true)) base.completato = true;
  if (existing && existing.completedAt) base.completedAt = existing.completedAt;
  if (incoming && incoming.completedAt) base.completedAt = incoming.completedAt;
  return base;
}

function dedupeTaskList(items) {
  var source = Array.isArray(items) ? items : [];
  var deduped = [];

  for (var i = 0; i < source.length; i++) {
    var current = normalizzaAzioneDashboard(source[i]);
    var merged = false;
    if (!current) continue;

    for (var j = 0; j < deduped.length; j++) {
      if (areTaskDuplicates(current, deduped[j])) {
        deduped[j] = mergeTaskRecord(deduped[j], source[i]);
        merged = true;
        break;
      }
    }

    if (!merged) deduped.push(current);
  }

  return deduped;
}

function normalizzaScadenzaDashboard(scadenza) {
  if (!scadenza || typeof scadenza !== "object" || !scadenza.testo) return null;
  return {
    testo: String(scadenza.testo).trim(),
    data: scadenza.data || "",
    dataRisolta: scadenza.dataRisolta || scadenza.dataISO || null,
    aggiunta: scadenza.aggiunta || null
  };
}

function getNormalizedDeadlineDate(scadenza) {
  if (!scadenza) return "";
  if (scadenza.dataRisolta) return String(scadenza.dataRisolta).trim();
  if (scadenza.dataISO) return String(scadenza.dataISO).trim();
  return normalizeText(scadenza.data || "");
}

function areDeadlineDuplicates(a, b) {
  var textA = normalizeText(a && a.testo ? a.testo : "");
  var textB = normalizeText(b && b.testo ? b.testo : "");
  if (!textA || !textB || textA !== textB) return false;
  return getNormalizedDeadlineDate(a) === getNormalizedDeadlineDate(b);
}

function mergeDeadlineRecord(existing, incoming) {
  var base = normalizzaScadenzaDashboard(existing) || normalizzaScadenzaDashboard(incoming);
  if (!base) return null;
  if (incoming && incoming.data) base.data = incoming.data;
  if (incoming && (incoming.dataRisolta || incoming.dataISO)) base.dataRisolta = incoming.dataRisolta || incoming.dataISO;
  if (existing && existing.aggiunta) base.aggiunta = existing.aggiunta;
  if (incoming && incoming.aggiunta && !base.aggiunta) base.aggiunta = incoming.aggiunta;
  return base;
}

function dedupeDeadlineList(items) {
  var source = Array.isArray(items) ? items : [];
  var deduped = [];

  for (var i = 0; i < source.length; i++) {
    var current = normalizzaScadenzaDashboard(source[i]);
    var merged = false;
    if (!current) continue;

    for (var j = 0; j < deduped.length; j++) {
      if (areDeadlineDuplicates(current, deduped[j])) {
        deduped[j] = mergeDeadlineRecord(deduped[j], source[i]);
        merged = true;
        break;
      }
    }

    if (!merged) deduped.push(current);
  }

  return deduped;
}

function salvaArchivioAzioni(azioni) {
  window.ActionFlowAuth.writeOwnedArray("actionflow_archivio_azioni", dedupeTaskList(azioni));
}

function salvaArchivioScadenze(scadenze) {
  window.ActionFlowAuth.writeOwnedArray("actionflow_archivio_scadenze", dedupeDeadlineList(scadenze));
}

function leggiArchivioAzioni() {
  try {
    var dati = window.ActionFlowAuth.readOwnedArray("actionflow_archivio_azioni");
    var cleaned = dedupeTaskList(Array.isArray(dati) ? dati : []);
    if (JSON.stringify(dati || []) !== JSON.stringify(cleaned)) salvaArchivioAzioni(cleaned);
    return cleaned;
  } catch (e) { return []; }
}

function leggiArchivioScadenze() {
  try {
    var dati = window.ActionFlowAuth.readOwnedArray("actionflow_archivio_scadenze");
    var cleaned = dedupeDeadlineList(Array.isArray(dati) ? dati : []);
    if (JSON.stringify(dati || []) !== JSON.stringify(cleaned)) salvaArchivioScadenze(cleaned);
    return cleaned;
  } catch (e) { return []; }
}

function leggiChecklistCorrente() {
  try {
    var dati = window.ActionFlowAuth.readOwnedArray("actionflow_checklist");
    var cleaned = dedupeTaskList(Array.isArray(dati) ? dati : []);
    if (JSON.stringify(dati || []) !== JSON.stringify(cleaned)) salvaChecklistCorrente(cleaned);
    return cleaned;
  } catch (e) { return []; }
}

function salvaChecklistCorrente(azioni) {
  window.ActionFlowAuth.writeOwnedArray("actionflow_checklist", dedupeTaskList(azioni));
}

function leggiScadenzeCorrenti() {
  try {
    var dati = window.ActionFlowAuth.readOwnedArray("actionflow_scadenze");
    var cleaned = dedupeDeadlineList(Array.isArray(dati) ? dati : []);
    if (JSON.stringify(dati || []) !== JSON.stringify(cleaned)) salvaScadenzeCorrenti(cleaned);
    return cleaned;
  } catch (e) { return []; }
}

function salvaScadenzeCorrenti(scadenze) {
  window.ActionFlowAuth.writeOwnedArray("actionflow_scadenze", dedupeDeadlineList(scadenze));
}

function leggiAzioniCompletate() {
  return window.ActionFlowAuth.readScopedObject("actionflow_azioni_done");
}

function salvaAzioniCompletate(completate) {
  window.ActionFlowAuth.writeScopedObject("actionflow_azioni_done", completate);
}

function readDashboardGuestUser() {
  try {
    var raw = localStorage.getItem("actionflow_guest_user");
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

function getDashboardCurrentUser() {
  var authUser = window.ActionFlowAuth && typeof window.ActionFlowAuth.getCurrentUser === "function"
    ? window.ActionFlowAuth.getCurrentUser()
    : null;

  return authUser || readDashboardGuestUser();
}

function getDashboardEffectiveUserProfile(user) {
  if (!user) return null;

  var merged = Object.assign({}, user);

  if (merged.displayName) {
    merged.name = merged.displayName;
  }

  if (merged.avatarUrl) {
    merged.picture = merged.avatarUrl;
  }

  return merged;
}

function renderDashboardProfile() {
  var barra = document.getElementById("barra-profilo-dash");
  var avatar = document.getElementById("dash-profilo-avatar");
  var saluto = document.getElementById("dash-profilo-saluto");
  var titolo = document.getElementById("titolo-dashboard");
  var effectiveUser = getDashboardEffectiveUserProfile(getDashboardCurrentUser());
  var displayName = effectiveUser && (effectiveUser.name || effectiveUser.email)
    ? (effectiveUser.name || effectiveUser.email)
    : "";
  var imageUrl = effectiveUser && (effectiveUser.picture || effectiveUser.image || effectiveUser.photoURL || effectiveUser.avatarUrl)
    ? (effectiveUser.picture || effectiveUser.image || effectiveUser.photoURL || effectiveUser.avatarUrl)
    : "";

  if (!displayName) {
    if (barra) barra.classList.add("nascosto");
    if (titolo) titolo.textContent = "Dashboard";
    if (avatar) {
      avatar.textContent = "";
      avatar.style.backgroundImage = "";
      avatar.classList.remove("has-image");
    }
    if (saluto) saluto.textContent = "";
    return;
  }

  if (barra) barra.classList.remove("nascosto");
  if (titolo) titolo.textContent = "Dashboard di " + displayName;
  if (saluto) saluto.textContent = "Ciao, " + displayName;

  if (!avatar) return;

  avatar.textContent = displayName.charAt(0).toUpperCase();
  if (imageUrl) {
    avatar.style.backgroundImage = 'url("' + imageUrl.replace(/"/g, '\\"') + '")';
    avatar.classList.add("has-image");
  } else {
    avatar.style.backgroundImage = "";
    avatar.classList.remove("has-image");
  }
}

function generaIdAzione(testo) {
  return "azione_" + testo.replace(/[^a-zA-Z0-9\u00C0-\u00FF]/g, "_").toLowerCase();
}

function livelloPriorita(p) {
  if (p === "alta") return 3;
  if (p === "media") return 2;
  return 1;
}

function inizioOggiLocale() {
  var oggi = new Date();
  return new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate());
}

var THEME_STORAGE_KEY = "actionflow_theme";

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

  return Math.round((data.getTime() - inizioOggiLocale().getTime()) / 86400000);
}

function formatDateForDisplay(dataISO) {
  var data = parseDataISOLocale(dataISO);
  if (!data) return "";

  return data.toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short"
  });
}

function formatPreciseDateTimeForDisplay(dataISO, time) {
  var data = parseDataISOLocale(dataISO);
  if (!data) return "";

  var testo = data.toLocaleDateString("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "long"
  });

  if (time) {
    testo += " alle " + time;
  }

  return testo;
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

function getPlanningBadgeLabel(scadenzaOriginale) {
  var value = normalizeText(scadenzaOriginale || "");

  if (!value) return "";
  if (value.indexOf("questa settimana") !== -1) return "questa settimana";
  if (value.indexOf("settimana prossima") !== -1) return "settimana prossima";
  if (value.indexOf("tra qualche giorno") !== -1) return "tra qualche giorno";
  if (value.indexOf("nei prossimi giorni") !== -1) return "nei prossimi giorni";
  if (value.indexOf("entro il mese") !== -1) return "entro il mese";
  return "";
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

function normalizzaDurataStimata(valore) {
  var durata = parseInt(valore, 10);
  return !isNaN(durata) && durata > 0 ? durata : null;
}

function normalizzaEnergiaStimata(valore) {
  if (typeof valore !== "string") return null;
  var energia = valore.toLowerCase();
  return energia === "bassa" || energia === "media" || energia === "alta" ? energia : null;
}

function trovaScadenzaAzione(testo) {
  var scadenze = leggiArchivioScadenze();
  for (var i = 0; i < scadenze.length; i++) {
    if (scadenze[i].testo === testo) return scadenze[i];
  }
  return null;
}

function resolveTaskForDisplay(task) {
  var scadenza = trovaScadenzaAzione(task && task.testo ? task.testo : "");
  var dataISO = task && task.dataISO ? task.dataISO : (scadenza ? scadenza.dataRisolta || null : null);
  var scadenzaOriginale = task && task.scadenzaOriginale ? task.scadenzaOriginale : (scadenza ? scadenza.data || null : null);
  var time = task && task.time ? String(task.time).trim() : null;
  var resolved = {
    testo: task && task.testo ? task.testo : "",
    priorita: task && task.priorita ? task.priorita : "bassa",
    dataISO: dataISO,
    scadenzaOriginale: scadenzaOriginale,
    time: /^([01]?\d|2[0-3]):([0-5]\d)$/.test(time || "") ? time : null,
    durataStimataMinuti: task ? task.durataStimataMinuti : null,
    energiaStimata: task ? task.energiaStimata : null
  };

  resolved.prioritaDinamica = getDynamicTaskPriority(resolved);
  resolved.labelScadenzaDinamica = getDynamicDateLabel(resolved);
  return resolved;
}

function aggiornaAzioneInLista(lista, vecchioTesto, aggiornamenti) {
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].testo === vecchioTesto) {
      for (var chiave in aggiornamenti) {
        if (Object.prototype.hasOwnProperty.call(aggiornamenti, chiave) && aggiornamenti[chiave] !== undefined) {
          lista[i][chiave] = aggiornamenti[chiave];
        }
      }
    }
  }
}

function aggiornaScadenzaInLista(lista, vecchioTesto, nuovoTesto, nuovaData) {
  var trovata = false;

  for (var i = 0; i < lista.length; i++) {
    if (lista[i].testo === vecchioTesto) {
      lista[i].testo = nuovoTesto;
      if (nuovaData) {
        lista[i].data = nuovaData;
        lista[i].dataRisolta = nuovaData;
      }
      trovata = true;
    }
  }

  if (!trovata && nuovaData) {
    lista.push({ testo: nuovoTesto, data: nuovaData, dataRisolta: nuovaData, aggiunta: new Date().toISOString() });
  }
}

function impostaCompletamentoTask(testo, completato) {
  var id = generaIdAzione(testo);
  var stato = leggiAzioniCompletate();
  stato[id] = completato;
  salvaAzioniCompletate(stato);

  var completedAt = completato ? new Date().toISOString() : null;

  var archAzioni = leggiArchivioAzioni();
  aggiornaAzioneInLista(archAzioni, testo, {
    completato: completato,
    completedAt: completedAt
  });
  salvaArchivioAzioni(archAzioni);

  var checklist = leggiChecklistCorrente();
  aggiornaAzioneInLista(checklist, testo, {
    completato: completato,
    completedAt: completedAt
  });
  salvaChecklistCorrente(checklist);
}

function eliminaTaskDashboard(taskId) {
  if (!taskId) return;
  if (!window.confirm("Vuoi eliminare questo task?")) return;

  var deletedTask = null;
  var archivioAzioni = leggiArchivioAzioni().filter(function(task) {
    if (task && task.id === taskId) {
      deletedTask = task;
      return false;
    }
    return true;
  });
  salvaArchivioAzioni(archivioAzioni);

  var checklist = leggiChecklistCorrente().filter(function(task) {
    return task && task.id !== taskId;
  });
  salvaChecklistCorrente(checklist);

  var completate = leggiAzioniCompletate();
  delete completate[taskId];
  if (deletedTask && deletedTask.testo) {
    delete completate[generaIdAzione(deletedTask.testo)];
  }
  salvaAzioniCompletate(completate);

  renderDashboardAzioni();
}

function ordinaAzioniDashboard(azioni) {
  var completate = leggiAzioniCompletate();
  azioni.sort(function(a, b) {
    var compA = completate[generaIdAzione(a.testo)] ? 1 : 0;
    var compB = completate[generaIdAzione(b.testo)] ? 1 : 0;
    if (compA !== compB) return compA - compB;

    var giorniA = getTaskDaysFromToday(resolveTaskForDisplay(a).dataISO);
    var giorniB = getTaskDaysFromToday(resolveTaskForDisplay(b).dataISO);
    if (giorniA !== null && giorniB !== null && giorniA !== giorniB) {
      return giorniA - giorniB;
    }

    return livelloPriorita(getDynamicTaskPriority(b)) - livelloPriorita(getDynamicTaskPriority(a));
  });
}

function parseDataPerOrdine(scadenza) {
  if (scadenza.dataRisolta) {
    var p = scadenza.dataRisolta.split("-");
    if (p.length === 3) return new Date(+p[0], +p[1] - 1, +p[2]);
  }

  var testo = (scadenza.data || "").trim().toLowerCase();

  var matchNum = testo.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (matchNum) {
    var anno = matchNum[3] ? parseInt(matchNum[3], 10) : new Date().getFullYear();
    if (anno < 100) anno += 2000;
    return new Date(anno, parseInt(matchNum[2], 10) - 1, parseInt(matchNum[1], 10));
  }

  var mesi = {
    "gennaio": 0, "febbraio": 1, "marzo": 2, "aprile": 3, "maggio": 4, "giugno": 5,
    "luglio": 6, "agosto": 7, "settembre": 8, "ottobre": 9, "novembre": 10, "dicembre": 11
  };
  var matchTesto = testo.match(/^(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?$/);
  if (matchTesto) {
    var annoT = matchTesto[3] ? parseInt(matchTesto[3], 10) : new Date().getFullYear();
    return new Date(annoT, mesi[matchTesto[2]], parseInt(matchTesto[1], 10));
  }

  return new Date(9999, 0, 1);
}

function ordinaScadenzeDashboard(scadenze) {
  scadenze.sort(function(a, b) {
    return parseDataPerOrdine(a) - parseDataPerOrdine(b);
  });
}

function trovaPrioritaAzione(testo, azioni) {
  for (var i = 0; i < azioni.length; i++) {
    if (azioni[i].testo === testo) return getDynamicTaskPriority(resolveTaskForDisplay(azioni[i]));
  }
  return "media";
}

/* ---- Filtri ---- */

var filtriAttivi = {
  priorita: "tutte",
  stato: "tutte",
  soloConScadenza: false
};

function leggiTestiConScadenza() {
  var scadenze = leggiArchivioScadenze();
  var set = {};
  for (var i = 0; i < scadenze.length; i++) {
    set[scadenze[i].testo] = true;
  }
  return set;
}

function applicaFiltri(azioni) {
  var completate = leggiAzioniCompletate();
  var testiConScadenza = filtriAttivi.soloConScadenza ? leggiTestiConScadenza() : null;

  return azioni.filter(function(az) {
    var taskDisplay = resolveTaskForDisplay(az);
    if (filtriAttivi.priorita !== "tutte" && taskDisplay.prioritaDinamica !== filtriAttivi.priorita) {
      return false;
    }
    if (filtriAttivi.stato !== "tutte") {
      var completata = completate[generaIdAzione(az.testo)] === true;
      if (filtriAttivi.stato === "completate" && !completata) return false;
      if (filtriAttivi.stato === "non-completate" && completata) return false;
    }
    if (filtriAttivi.soloConScadenza && !testiConScadenza[az.testo]) {
      return false;
    }
    return true;
  });
}

function isDashboardTaskScheduled(task) {
  var resolved = resolveTaskForDisplay(task);
  return !!(resolved && resolved.dataISO);
}

function isDashboardTaskFlexible(task) {
  var resolved = resolveTaskForDisplay(task);
  return !!(resolved && !resolved.dataISO && normalizeText(resolved.scadenzaOriginale || ""));
}

function buildDashboardTaskItem(az, completate, sectionKey, indexInSection) {
  var azDisplay = resolveTaskForDisplay(az);
  var idAz = generaIdAzione(az.testo);
  var durataStimata = normalizzaDurataStimata(azDisplay.durataStimataMinuti);
  var energiaStimata = normalizzaEnergiaStimata(azDisplay.energiaStimata);

  var li = document.createElement("li");
  li.className = "priorita-" + (azDisplay.prioritaDinamica || "media") + " azione-item";
  if (completate[idAz]) li.classList.add("azione-completata");

  var cb = document.createElement("input");
  cb.type = "checkbox";
  cb.id = "dash_" + sectionKey + "_" + idAz + "_" + indexInSection;
  cb.className = "azione-checkbox";
  cb.checked = completate[idAz] === true;

  cb.addEventListener("click", function(event) {
    event.stopPropagation();
  });

  (function(checkbox, liEl, testoTask) {
    checkbox.addEventListener("change", function() {
      impostaCompletamentoTask(testoTask, checkbox.checked);
      liEl.classList.toggle("azione-completata", checkbox.checked);
      renderDashboardAzioni();
    });
  })(cb, li, az.testo);

  var details = document.createElement("details");
  details.className = "dashboard-task-details";

  var summary = document.createElement("summary");
  summary.className = "dashboard-task-summary";

  var checkWrap = document.createElement("div");
  checkWrap.className = "dashboard-task-check";
  checkWrap.appendChild(cb);

  var contenuto = document.createElement("div");
  contenuto.className = "azione-contenuto dashboard-task-content";

  var label = document.createElement("label");
  label.htmlFor = cb.id;
  label.className = "azione-testo";
  label.textContent = azDisplay.testo;
  label.addEventListener("click", function(event) {
    event.stopPropagation();
  });

  var scadenzaWrap = document.createElement("div");
  scadenzaWrap.className = "dashboard-task-deadline-wrap";

  if (sectionKey === "scadenze" || (sectionKey === "tutti" && azDisplay.dataISO)) {
    if (azDisplay.labelScadenzaDinamica) {
      var badgeData = document.createElement("span");
      badgeData.className = "badge-data dashboard-badge-data dashboard-task-deadline";
      badgeData.textContent = azDisplay.labelScadenzaDinamica;
      scadenzaWrap.appendChild(badgeData);
    }
  } else if (sectionKey === "da-programmare" || (sectionKey === "tutti" && azDisplay.scadenzaOriginale)) {
    var badgePlanningType = document.createElement("span");
    badgePlanningType.className = "badge-data dashboard-badge-data dashboard-task-deadline";
    badgePlanningType.textContent = "Da programmare";
    scadenzaWrap.appendChild(badgePlanningType);

    var planningBadgeLabel = getPlanningBadgeLabel(azDisplay.scadenzaOriginale);
    if (planningBadgeLabel) {
      var badgePlanning = document.createElement("span");
      badgePlanning.className = "badge-data dashboard-badge-data dashboard-task-deadline";
      badgePlanning.textContent = planningBadgeLabel;
      scadenzaWrap.appendChild(badgePlanning);
    }
  }

  var meta = document.createElement("div");
  meta.className = "azione-meta dashboard-task-meta";

  if (sectionKey !== "tutti") {
    var badgePriorita = document.createElement("span");
    badgePriorita.className = "badge-priorita priorita-" + (azDisplay.prioritaDinamica || "media");
    badgePriorita.textContent = (azDisplay.prioritaDinamica || "media").toUpperCase();
    meta.appendChild(badgePriorita);
  }

  if ((sectionKey === "scadenze" || (sectionKey === "tutti" && azDisplay.dataISO)) && azDisplay.time) {
    var badgeTime = document.createElement("span");
    badgeTime.className = "badge-time dashboard-badge-time";
    badgeTime.textContent = azDisplay.time;
    meta.appendChild(badgeTime);
  }

  contenuto.appendChild(label);
  if (scadenzaWrap.childNodes.length > 0) {
    contenuto.appendChild(scadenzaWrap);
  }
  contenuto.appendChild(meta);

  var indicator = document.createElement("span");
  indicator.className = "dashboard-task-expand-indicator";
  indicator.setAttribute("aria-hidden", "true");
  indicator.textContent = "";

  summary.setAttribute("aria-label", "Apri dettagli task");
  summary.appendChild(checkWrap);
  summary.appendChild(contenuto);
  summary.appendChild(indicator);

  var body = document.createElement("div");
  body.className = "dashboard-task-body";

  var bodyMeta = document.createElement("div");
  bodyMeta.className = "dashboard-task-body-meta";

  if (durataStimata) {
    var durata = document.createElement("span");
    durata.className = "azione-durata dashboard-azione-durata";
    durata.textContent = durataStimata + " min";
    bodyMeta.appendChild(durata);
  }

  if ((sectionKey === "scadenze" || (sectionKey === "tutti" && azDisplay.dataISO)) && azDisplay.time) {
    var bodyBadgeTime = document.createElement("span");
    bodyBadgeTime.className = "badge-time dashboard-badge-time";
    bodyBadgeTime.textContent = azDisplay.time;
    bodyMeta.appendChild(bodyBadgeTime);
  }

  if (energiaStimata) {
    var badgeEnergia = document.createElement("span");
    badgeEnergia.className = "badge-energia badge-energia-" + energiaStimata;
    badgeEnergia.textContent = "Energia: " + energiaStimata;
    bodyMeta.appendChild(badgeEnergia);
  }

  if ((sectionKey === "da-programmare" || (sectionKey === "tutti" && !azDisplay.dataISO)) && azDisplay.scadenzaOriginale) {
    var scadenzaOriginale = document.createElement("span");
    scadenzaOriginale.className = "dashboard-task-secondary-copy";
    scadenzaOriginale.textContent = normalizeText(azDisplay.scadenzaOriginale);
    bodyMeta.appendChild(scadenzaOriginale);
  } else if ((sectionKey === "scadenze" || (sectionKey === "tutti" && azDisplay.dataISO)) && azDisplay.scadenzaOriginale) {
    var dettaglioScadenza = formatPreciseDateTimeForDisplay(azDisplay.dataISO, azDisplay.time);

    if (!dettaglioScadenza && azDisplay.labelScadenzaDinamica && azDisplay.labelScadenzaDinamica !== azDisplay.scadenzaOriginale) {
      dettaglioScadenza = azDisplay.scadenzaOriginale;
    }

    if (dettaglioScadenza) {
      var scadenzaOriginalePrecisa = document.createElement("span");
      scadenzaOriginalePrecisa.className = "dashboard-task-secondary-copy";
      scadenzaOriginalePrecisa.textContent = dettaglioScadenza;
      bodyMeta.appendChild(scadenzaOriginalePrecisa);
    }
  }

  var actions = document.createElement("div");
  actions.className = "dashboard-task-actions";

  var btnMod = document.createElement("button");
  btnMod.type = "button";
  btnMod.className = "btn-modifica";
  btnMod.textContent = "Modifica";

  (function(liEl, azioneRef) {
    btnMod.addEventListener("click", function() {
      attivaEditAzioneDash(liEl, azioneRef);
    });
  })(li, az);

  actions.appendChild(btnMod);

  var btnDelete = document.createElement("button");
  btnDelete.type = "button";
  btnDelete.className = "btn-modifica btn-elimina-task";
  btnDelete.setAttribute("aria-label", "Elimina task");
  btnDelete.textContent = "🗑";
  btnDelete.addEventListener("click", function() {
    eliminaTaskDashboard(az.id);
  });

  actions.appendChild(btnDelete);
  body.appendChild(bodyMeta);
  body.appendChild(actions);

  details.appendChild(summary);
  details.appendChild(body);

  li.appendChild(details);
  return li;
}

function renderDashboardTaskSection(contenitore, titoloSezione, azioni, completate, sectionKey, visualPriorityKey) {
  if (!azioni.length) return;

  var gruppoKey = visualPriorityKey || "media";

  var sez = document.createElement("div");
  sez.className = "gruppo-priorita gruppo-" + gruppoKey;

  var titolo = document.createElement("h3");
  titolo.className = "titolo-gruppo titolo-gruppo-" + gruppoKey;
  titolo.textContent = titoloSezione;
  sez.appendChild(titolo);

  var ul = document.createElement("ul");

  for (var i = 0; i < azioni.length; i++) {
    ul.appendChild(buildDashboardTaskItem(azioni[i], completate, sectionKey, i));
  }

  sez.appendChild(ul);
  contenitore.appendChild(sez);
}

function renderDashboardMainTaskGroups(contenitore, azioni, completate) {
  var gruppi = {
    alta: [],
    media: [],
    bassa: []
  };

  for (var i = 0; i < azioni.length; i++) {
    var taskDisplay = resolveTaskForDisplay(azioni[i]);
    var priorita = taskDisplay.prioritaDinamica || "bassa";
    if (!gruppi[priorita]) priorita = "bassa";
    gruppi[priorita].push(azioni[i]);
  }

  renderDashboardTaskSection(contenitore, "ALTA", gruppi.alta, completate, "tutti", "alta");
  renderDashboardTaskSection(contenitore, "MEDIA", gruppi.media, completate, "tutti", "media");
  renderDashboardTaskSection(contenitore, "BASSA", gruppi.bassa, completate, "tutti", "bassa");
}

function renderDashboardSideTaskSection(contenitoreId, vuotoId, azioni, completate, sectionKey) {
  var contenitore = document.getElementById(contenitoreId);
  var vuoto = document.getElementById(vuotoId);
  if (!contenitore || !vuoto) return;

  contenitore.innerHTML = "";

  if (!azioni.length) {
    vuoto.classList.remove("nascosto");
    return;
  }

  vuoto.classList.add("nascosto");
  var ul = document.createElement("ul");

  for (var i = 0; i < azioni.length; i++) {
    ul.appendChild(buildDashboardTaskItem(azioni[i], completate, sectionKey, i));
  }

  contenitore.appendChild(ul);
}

function resetDashboardSideSections() {
  renderDashboardSideTaskSection("contenitore-dashboard-scadenze", "dashboard-scadenze-vuote", [], {}, "scadenze");
  renderDashboardSideTaskSection("contenitore-dashboard-riprogrammare", "dashboard-riprogrammare-vuote", [], {}, "da-programmare");
}

function renderDashboardAzioni() {
  var contenitore = document.getElementById("contenitore-dashboard-azioni");
  var vuoto = document.getElementById("dashboard-azioni-vuote");
  var tutteLeAzioni = leggiArchivioAzioni();
  var completate = leggiAzioniCompletate();

  contenitore.innerHTML = "";

  if (tutteLeAzioni.length === 0) {
    vuoto.classList.remove("nascosto");
    resetDashboardSideSections();
    return;
  }

  var azioni = applicaFiltri(tutteLeAzioni);

  if (azioni.length === 0) {
    vuoto.textContent = "Nessuna azione corrisponde ai filtri.";
    vuoto.classList.remove("nascosto");
    resetDashboardSideSections();
    return;
  }
  vuoto.classList.add("nascosto");

  ordinaAzioniDashboard(azioni);
  var azioniConScadenza = [];
  var azioniDaProgrammare = [];

  for (var i = 0; i < azioni.length; i++) {
    if (isDashboardTaskScheduled(azioni[i])) {
      azioniConScadenza.push(azioni[i]);
    } else if (isDashboardTaskFlexible(azioni[i])) {
      azioniDaProgrammare.push(azioni[i]);
    }
  }

  renderDashboardMainTaskGroups(contenitore, azioni, completate);
  renderDashboardSideTaskSection("contenitore-dashboard-scadenze", "dashboard-scadenze-vuote", azioniConScadenza, completate, "scadenze");
  renderDashboardSideTaskSection("contenitore-dashboard-riprogrammare", "dashboard-riprogrammare-vuote", azioniDaProgrammare, completate, "da-programmare");
}

function attivaEditAzioneDash(li, azione) {
  var vecchioTesto = azione.testo;
  var vecchiaPriorita = azione.priorita || "media";
  var vecchiaDurata = normalizzaDurataStimata(azione.durataStimataMinuti);
  var vecchiaEnergia = normalizzaEnergiaStimata(azione.energiaStimata) || "media";
  var archScadenze = leggiArchivioScadenze();

  // Trova scadenza associata
  var scadenzaData = "";
  for (var i = 0; i < archScadenze.length; i++) {
    if (archScadenze[i].testo === vecchioTesto && archScadenze[i].dataRisolta) {
      scadenzaData = archScadenze[i].dataRisolta;
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
  inputData.value = scadenzaData;

  var inputDurata = document.createElement("input");
  inputDurata.type = "number";
  inputDurata.min = "1";
  inputDurata.step = "5";
  inputDurata.className = "edit-input edit-input-data";
  inputDurata.value = vecchiaDurata || "";
  inputDurata.placeholder = "Durata min";

  var selectEnergia = document.createElement("select");
  selectEnergia.className = "edit-select";
  ["bassa", "media", "alta"].forEach(function(e) {
    var optEnergia = document.createElement("option");
    optEnergia.value = e;
    optEnergia.textContent = "Energia " + e;
    if (e === vecchiaEnergia) optEnergia.selected = true;
    selectEnergia.appendChild(optEnergia);
  });

  var btnSalva = document.createElement("button");
  btnSalva.type = "button";
  btnSalva.className = "btn-salva-edit";
  btnSalva.textContent = "Salva";

  var btnAnnulla = document.createElement("button");
  btnAnnulla.type = "button";
  btnAnnulla.className = "btn-modifica";
  btnAnnulla.textContent = "Annulla";
  btnAnnulla.addEventListener("click", function() {
    renderDashboardAzioni();
  });

  btnSalva.addEventListener("click", function() {
    var nuovoTesto = inputTesto.value.trim();
    if (!nuovoTesto) return;
    var nuovaPriorita = selectPriorita.value;
    var nuovaData = inputData.value;
    var nuovaDurata = normalizzaDurataStimata(inputDurata.value);
    var nuovaEnergia = normalizzaEnergiaStimata(selectEnergia.value) || "media";

    // Aggiorna archivio azioni
    var archAzioni = leggiArchivioAzioni();
    aggiornaAzioneInLista(archAzioni, vecchioTesto, {
      testo: nuovoTesto,
      priorita: nuovaPriorita,
      durataStimataMinuti: nuovaDurata,
      energiaStimata: nuovaEnergia
    });
    salvaArchivioAzioni(archAzioni);

    var checklist = leggiChecklistCorrente();
    aggiornaAzioneInLista(checklist, vecchioTesto, {
      testo: nuovoTesto,
      priorita: nuovaPriorita,
      durataStimataMinuti: nuovaDurata,
      energiaStimata: nuovaEnergia,
      dataISO: nuovaData || undefined
    });
    salvaChecklistCorrente(checklist);

    // Aggiorna archivio scadenze
    var scadenze = leggiArchivioScadenze();
    aggiornaScadenzaInLista(scadenze, vecchioTesto, nuovoTesto, nuovaData);
    salvaArchivioScadenze(scadenze);

    var scadenzeCorrenti = leggiScadenzeCorrenti();
    aggiornaScadenzaInLista(scadenzeCorrenti, vecchioTesto, nuovoTesto, nuovaData);
    salvaScadenzeCorrenti(scadenzeCorrenti);

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

    renderDashboardAzioni();
    renderDashboardScadenze();
  });

  li.appendChild(inputTesto);
  li.appendChild(selectPriorita);
  li.appendChild(inputData);
  li.appendChild(inputDurata);
  li.appendChild(selectEnergia);
  li.appendChild(btnSalva);
  li.appendChild(btnAnnulla);
}

function svuotaTuttiITask() {
  var confirmed = window.confirm("Sei sicuro di voler eliminare tutti i task? Questa azione non pu\u00f2 essere annullata.");
  if (!confirmed) return;

  window.ActionFlowAuth.clearOwnedArray("actionflow_archivio_azioni");
  window.ActionFlowAuth.clearOwnedArray("actionflow_archivio_scadenze");
  window.ActionFlowAuth.clearOwnedArray("actionflow_checklist");
  window.ActionFlowAuth.clearOwnedArray("actionflow_scadenze");
  window.ActionFlowAuth.clearScopedObject("actionflow_azioni_done");
  window.ActionFlowAuth.clearScopedObject("actionflow_checklist_done");
  window.ActionFlowAuth.clearScopedObject("actionflow_daily_plan");
  renderDashboardAzioni();
}

function inizializzaFiltri() {
  var gruppoPriorita = document.getElementById("filtro-priorita");
  var gruppoStato = document.getElementById("filtro-stato");
  var checkScadenza = document.getElementById("filtro-scadenza");

  function gestisciFiltroGruppo(contenitore, chiave) {
    if (!contenitore) return;
    var bottoni = contenitore.querySelectorAll(".filtro-btn");
    for (var i = 0; i < bottoni.length; i++) {
      bottoni[i].addEventListener("click", function() {
        var siblings = this.parentElement.querySelectorAll(".filtro-btn");
        for (var s = 0; s < siblings.length; s++) siblings[s].classList.remove("attivo");
        this.classList.add("attivo");
        filtriAttivi[chiave] = this.getAttribute("data-valore");
        renderDashboardAzioni();
      });
    }
  }

  gestisciFiltroGruppo(gruppoPriorita, "priorita");
  gestisciFiltroGruppo(gruppoStato, "stato");

  if (checkScadenza) {
    checkScadenza.addEventListener("change", function() {
      filtriAttivi.soloConScadenza = this.checked;
      renderDashboardAzioni();
    });
  }
}

document.addEventListener("DOMContentLoaded", function() {
  applyTheme(getStoredThemePreference());
  renderDashboardProfile();

  renderDashboardAzioni();
  inizializzaFiltri();

  var bottoneSvuota = document.getElementById("bottone-svuota-dashboard");
  if (bottoneSvuota) {
    bottoneSvuota.addEventListener("click", svuotaTuttiITask);
  }

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
});

window.addEventListener("actionflow-auth-ready", function() {
  renderDashboardProfile();
  renderDashboardAzioni();
});
