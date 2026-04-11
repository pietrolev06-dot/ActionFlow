// Migrazione chiavi localStorage
(function() {
  var m = [
    ["drop2action_checklist", "actionflow_checklist"],
    ["drop2action_checklist_done", "actionflow_checklist_done"]
  ];
  for (var i = 0; i < m.length; i++) {
    if (!localStorage.getItem(m[i][1]) && localStorage.getItem(m[i][0])) {
      localStorage.setItem(m[i][1], localStorage.getItem(m[i][0]));
    }
  }
})();

function leggiChecklist() {
  var raw = localStorage.getItem("actionflow_checklist");
  if (!raw) return [];

  try {
    var dati = JSON.parse(raw);
    if (!Array.isArray(dati)) return [];
    return dati;
  } catch (e) {
    return [];
  }
}

function leggiCompletate() {
  var raw = localStorage.getItem("actionflow_checklist_done");
  if (!raw) return {};

  try {
    var dati = JSON.parse(raw);
    if (!dati || typeof dati !== "object") return {};
    return dati;
  } catch (e) {
    return {};
  }
}

function salvaCompletate(completate) {
  localStorage.setItem("actionflow_checklist_done", JSON.stringify(completate));
}

function normalizzaAzioneChecklist(item) {
  if (typeof item === "string") {
    return { testo: item, priorita: "media" };
  }

  if (!item || typeof item !== "object") {
    return null;
  }

  if (!item.testo) {
    return null;
  }

  var priorita = item.priorita;
  if (priorita !== "alta" && priorita !== "media" && priorita !== "bassa") {
    priorita = "media";
  }

  return {
    testo: item.testo,
    priorita: priorita
  };
}

function renderChecklist() {
  var lista = document.getElementById("lista-checklist");
  var vuota = document.getElementById("checklist-vuota");
  var azioni = leggiChecklist();
  var completate = leggiCompletate();

  lista.innerHTML = "";

  if (azioni.length === 0) {
    vuota.classList.remove("nascosto");
    return;
  }

  vuota.classList.add("nascosto");

  for (var i = 0; i < azioni.length; i++) {
    var task = normalizzaAzioneChecklist(azioni[i]);
    if (!task) continue;

    var chiave = "task_" + task.testo;

    var li = document.createElement("li");
    li.className = "checklist-item priorita-" + task.priorita;

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "checklist-task-" + i;
    checkbox.checked = completate[chiave] === true;

    checkbox.addEventListener("change", function(key, el) {
      return function() {
        completate[key] = el.checked;
        salvaCompletate(completate);
      };
    }(chiave, checkbox));

    var label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = task.testo;

    var badge = document.createElement("span");
    badge.className = "badge-priorita priorita-" + task.priorita;
    badge.textContent = task.priorita;

    li.appendChild(checkbox);
    li.appendChild(label);
    li.appendChild(badge);
    lista.appendChild(li);
  }
}

function svuotaChecklist() {
  localStorage.removeItem("actionflow_checklist");
  localStorage.removeItem("actionflow_checklist_done");
  renderChecklist();
}

document.addEventListener("DOMContentLoaded", function() {
  renderChecklist();

  var bottoneSvuota = document.getElementById("bottone-svuota-checklist");
  bottoneSvuota.addEventListener("click", svuotaChecklist);
});
