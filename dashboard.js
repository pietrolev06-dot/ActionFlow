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

function leggiArchivioAzioni() {
  try {
    var raw = localStorage.getItem("actionflow_archivio_azioni");
    var dati = raw ? JSON.parse(raw) : [];
    return Array.isArray(dati) ? dati : [];
  } catch (e) { return []; }
}

function leggiArchivioScadenze() {
  try {
    var raw = localStorage.getItem("actionflow_archivio_scadenze");
    var dati = raw ? JSON.parse(raw) : [];
    return Array.isArray(dati) ? dati : [];
  } catch (e) { return []; }
}

function leggiChecklistCorrente() {
  try {
    var raw = localStorage.getItem("actionflow_checklist");
    var dati = raw ? JSON.parse(raw) : [];
    return Array.isArray(dati) ? dati : [];
  } catch (e) { return []; }
}

function salvaChecklistCorrente(azioni) {
  localStorage.setItem("actionflow_checklist", JSON.stringify(azioni));
}

function leggiScadenzeCorrenti() {
  try {
    var raw = localStorage.getItem("actionflow_scadenze");
    var dati = raw ? JSON.parse(raw) : [];
    return Array.isArray(dati) ? dati : [];
  } catch (e) { return []; }
}

function salvaScadenzeCorrenti(scadenze) {
  localStorage.setItem("actionflow_scadenze", JSON.stringify(scadenze));
}

function leggiAzioniCompletate() {
  try {
    var raw = localStorage.getItem("actionflow_azioni_done");
    var dati = raw ? JSON.parse(raw) : {};
    return (dati && typeof dati === "object") ? dati : {};
  } catch (e) { return {}; }
}

function salvaAzioniCompletate(completate) {
  localStorage.setItem("actionflow_azioni_done", JSON.stringify(completate));
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
  var resolved = {
    testo: task && task.testo ? task.testo : "",
    priorita: task && task.priorita ? task.priorita : "bassa",
    dataISO: dataISO,
    scadenzaOriginale: scadenzaOriginale,
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
  localStorage.setItem("actionflow_archivio_azioni", JSON.stringify(archAzioni));

  var checklist = leggiChecklistCorrente();
  aggiornaAzioneInLista(checklist, testo, {
    completato: completato,
    completedAt: completedAt
  });
  salvaChecklistCorrente(checklist);
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

function renderDashboardAzioni() {
  var contenitore = document.getElementById("contenitore-dashboard-azioni");
  var vuoto = document.getElementById("dashboard-azioni-vuote");
  var tutteLeAzioni = leggiArchivioAzioni();
  var completate = leggiAzioniCompletate();

  contenitore.innerHTML = "";

  if (tutteLeAzioni.length === 0) {
    vuoto.classList.remove("nascosto");
    return;
  }

  var azioni = applicaFiltri(tutteLeAzioni);

  if (azioni.length === 0) {
    vuoto.textContent = "Nessuna azione corrisponde ai filtri.";
    vuoto.classList.remove("nascosto");
    return;
  }
  vuoto.classList.add("nascosto");

  ordinaAzioniDashboard(azioni);

  var gruppi = { alta: [], media: [], bassa: [] };
  for (var i = 0; i < azioni.length; i++) {
    var p = getDynamicTaskPriority(resolveTaskForDisplay(azioni[i]));
    (gruppi[p] || gruppi.media).push(azioni[i]);
  }

  var ordine = [
    { chiave: "alta",  titolo: "Alta priorità" },
    { chiave: "media", titolo: "Media priorità" },
    { chiave: "bassa", titolo: "Bassa priorità" }
  ];

  for (var g = 0; g < ordine.length; g++) {
    var gruppo = gruppi[ordine[g].chiave];
    if (gruppo.length === 0) continue;

    var sez = document.createElement("div");
    sez.className = "gruppo-priorita gruppo-" + ordine[g].chiave;

    var titolo = document.createElement("h3");
    titolo.className = "titolo-gruppo titolo-gruppo-" + ordine[g].chiave;
    titolo.textContent = ordine[g].titolo;
    sez.appendChild(titolo);

    var ul = document.createElement("ul");

    for (var j = 0; j < gruppo.length; j++) {
      var az = gruppo[j];
      var azDisplay = resolveTaskForDisplay(az);
      var idAz = generaIdAzione(az.testo);
      var durataStimata = normalizzaDurataStimata(azDisplay.durataStimataMinuti);
      var energiaStimata = normalizzaEnergiaStimata(azDisplay.energiaStimata);

      var li = document.createElement("li");
      li.className = "priorita-" + (azDisplay.prioritaDinamica || "media") + " azione-item";
      if (completate[idAz]) li.classList.add("azione-completata");

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = "dash_" + idAz + "_" + g + "_" + j;
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

      if (azDisplay.labelScadenzaDinamica) {
        var badgeData = document.createElement("span");
        badgeData.className = "badge-data dashboard-badge-data dashboard-task-deadline";
        badgeData.textContent = azDisplay.labelScadenzaDinamica;
        scadenzaWrap.appendChild(badgeData);
      }

      var meta = document.createElement("div");
      meta.className = "azione-meta dashboard-task-meta";

      var badgePriorita = document.createElement("span");
      badgePriorita.className = "badge-priorita priorita-" + (azDisplay.prioritaDinamica || "media");
      badgePriorita.textContent = azDisplay.prioritaDinamica || "media";
      meta.appendChild(badgePriorita);

      var indicator = document.createElement("span");
      indicator.className = "dashboard-task-expand-indicator";
      indicator.setAttribute("aria-hidden", "true");
      indicator.textContent = "";

      summary.setAttribute("aria-label", "Apri dettagli task");

      contenuto.appendChild(label);
      if (scadenzaWrap.childNodes.length > 0) {
        contenuto.appendChild(scadenzaWrap);
      }
      contenuto.appendChild(meta);

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

      if (energiaStimata) {
        var badgeEnergia = document.createElement("span");
        badgeEnergia.className = "badge-energia badge-energia-" + energiaStimata;
        badgeEnergia.textContent = "Energia: " + energiaStimata;
        bodyMeta.appendChild(badgeEnergia);
      }

      if (azDisplay.scadenzaOriginale) {
        var dettaglioScadenza = azDisplay.labelScadenzaDinamica && azDisplay.labelScadenzaDinamica !== azDisplay.scadenzaOriginale
          ? azDisplay.scadenzaOriginale
          : "";

        if (dettaglioScadenza) {
          var scadenzaOriginale = document.createElement("span");
          scadenzaOriginale.className = "dashboard-task-secondary-copy";
          scadenzaOriginale.textContent = dettaglioScadenza;
          bodyMeta.appendChild(scadenzaOriginale);
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
      body.appendChild(bodyMeta);
      body.appendChild(actions);

      details.appendChild(summary);
      details.appendChild(body);

      li.appendChild(details);
      ul.appendChild(li);
    }

    sez.appendChild(ul);
    contenitore.appendChild(sez);
  }
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
    localStorage.setItem("actionflow_archivio_azioni", JSON.stringify(archAzioni));

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
    localStorage.setItem("actionflow_archivio_scadenze", JSON.stringify(scadenze));

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

function renderDashboardScadenze() {
  var contenitore = document.getElementById("contenitore-dashboard-scadenze");
  var vuoto = document.getElementById("dashboard-scadenze-vuote");
  var scadenze = leggiArchivioScadenze();
  var azioni = leggiArchivioAzioni();

  contenitore.innerHTML = "";

  if (scadenze.length === 0) {
    vuoto.classList.remove("nascosto");
    return;
  }
  vuoto.classList.add("nascosto");

  ordinaScadenzeDashboard(scadenze);

  var ul = document.createElement("ul");
  ul.className = "lista-scadenze-dashboard";

  for (var i = 0; i < scadenze.length; i++) {
    var sc = scadenze[i];
    var priorita = trovaPrioritaAzione(sc.testo, azioni);

    var li = document.createElement("li");
    li.className = "scadenza-row";

    var badgeData = document.createElement("span");
    badgeData.className = "badge-data";
    var testoData = sc.data || "";
    if (sc.dataRisolta) testoData += " (" + sc.dataRisolta + ")";
    badgeData.textContent = testoData;

    var testoAzione = document.createElement("span");
    testoAzione.className = "scadenza-azione-testo";
    testoAzione.textContent = sc.testo;

    var badgePriorita = document.createElement("span");
    badgePriorita.className = "badge-priorita priorita-" + priorita;
    badgePriorita.textContent = priorita;

    li.appendChild(badgeData);
    li.appendChild(testoAzione);
    li.appendChild(badgePriorita);
    ul.appendChild(li);
  }

  contenitore.appendChild(ul);
}

function svuotaDashboard() {
  localStorage.removeItem("actionflow_archivio_azioni");
  localStorage.removeItem("actionflow_archivio_scadenze");
  renderDashboardAzioni();
  renderDashboardScadenze();
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
  // Profilo
  (function() {
    try {
      var raw = localStorage.getItem("actionflow_profilo");
      var profilo = raw ? JSON.parse(raw) : null;
      if (profilo && profilo.nome) {
        var barra = document.getElementById("barra-profilo-dash");
        if (barra) {
          barra.classList.remove("nascosto");
          var avatar = document.getElementById("dash-profilo-avatar");
          var saluto = document.getElementById("dash-profilo-saluto");
          if (avatar) avatar.textContent = profilo.nome.charAt(0).toUpperCase();
          if (saluto) saluto.textContent = "Ciao, " + profilo.nome;
        }
        var titolo = document.getElementById("titolo-dashboard");
        if (titolo) titolo.textContent = "Dashboard di " + profilo.nome;
      }
    } catch (e) {}
  })();

  renderDashboardAzioni();
  renderDashboardScadenze();
  inizializzaFiltri();

  var bottoneSvuota = document.getElementById("bottone-svuota-dashboard");
  if (bottoneSvuota) {
    bottoneSvuota.addEventListener("click", svuotaDashboard);
  }
});
