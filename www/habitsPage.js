(function() {
  var THEME_STORAGE_KEY = "actionflow_theme";
  var editingHabitId = null;
  var lastFocusedElement = null;

  function getStoredThemePreference() {
    try {
      var theme = localStorage.getItem(THEME_STORAGE_KEY);
      return theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
    } catch (e) {
      return "system";
    }
  }

  function getResolvedTheme(theme) {
    if (theme === "light" || theme === "dark") return theme;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme(theme) {
    var resolvedTheme = getResolvedTheme(theme || "system");
    var preference = theme === "light" || theme === "dark" || theme === "system" ? theme : "system";
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.setAttribute("data-theme-preference", preference);
    document.documentElement.style.colorScheme = resolvedTheme;
    document.body.setAttribute("data-theme", resolvedTheme);
    document.body.setAttribute("data-theme-preference", preference);
    document.body.style.colorScheme = resolvedTheme;
  }

  function formatHabitDuration(minutes) {
    var duration = Number(minutes);
    if (!Number.isFinite(duration) || duration <= 0) return "";
    if (duration === 60) return "1 ora";
    if (duration === 120) return "2 ore";
    return Math.round(duration) + " min";
  }

  function getFrequencyLabel(habit) {
    var days = Array.isArray(habit.daysOfWeek) ? habit.daysOfWeek : [];
    var labels = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

    if (habit.frequency === "daily") return "Ogni giorno";
    if (habit.frequency === "specific_weekdays") {
      return days.length ? days.map(function(day) { return labels[day]; }).join(", ") : "Giorni specifici";
    }

    return "Settimanale";
  }

  function isHabitDueToday(habit) {
    return !!(
      window.ActionFlowHabits &&
      typeof window.ActionFlowHabits.isHabitActiveOnDate === "function" &&
      window.ActionFlowHabits.isHabitActiveOnDate(habit, new Date())
    );
  }

  function getHabitStatus(habit) {
    if (habit.completedToday) {
      return { label: "Completata", className: "is-completed" };
    }

    if (isHabitDueToday(habit)) {
      return { label: "Da fare oggi", className: "is-due" };
    }

    return { label: "Saltata", className: "is-skipped" };
  }

  function getHabitAccentClass(habit) {
    if (habit.importance === "alta") return "accent-high";
    if (habit.importance === "bassa") return "accent-low";
    return "accent-mid";
  }

  function getCheckedHabitWeekdays() {
    var weekdays = document.querySelectorAll("#habit-weekdays input[type='checkbox']:checked");
    var selected = [];

    for (var i = 0; i < weekdays.length; i++) {
      selected.push(Number(weekdays[i].value));
    }

    return selected;
  }

  function setCheckedHabitWeekdays(daysOfWeek) {
    var days = Array.isArray(daysOfWeek) ? daysOfWeek.map(Number) : [];
    var weekdays = document.querySelectorAll("#habit-weekdays input[type='checkbox']");

    for (var i = 0; i < weekdays.length; i++) {
      weekdays[i].checked = days.indexOf(Number(weekdays[i].value)) !== -1;
    }
  }

  function setHabitFormStatus(message, variant) {
    var status = document.getElementById("habit-form-status");
    if (!status) return;

    status.textContent = message || "";
    status.classList.toggle("is-error", variant === "error");
  }

  function aggiornaHabitFrequencyFields() {
    var frequency = document.getElementById("habit-frequency");
    var weekdays = document.getElementById("habit-weekdays");
    var weekdaysGroup = document.querySelector(".habit-weekdays-group");
    if (!frequency || !weekdays) return;

    var showWeekdays = frequency.value === "specific_weekdays";
    weekdays.classList.toggle("nascosto", !showWeekdays);
    if (weekdaysGroup) weekdaysGroup.classList.toggle("nascosto", !showWeekdays);
  }

  function openAdvancedPreferences() {
    var advanced = document.getElementById("habit-advanced");
    if (advanced) advanced.open = true;
    aggiornaHabitAdvancedSummary();
  }

  function aggiornaHabitAdvancedSummary() {
    var advanced = document.getElementById("habit-advanced");
    var label = document.getElementById("habit-advanced-summary-label");
    if (!advanced || !label) return;

    label.textContent = "";
    label.setAttribute("aria-label", advanced.open ? "Chiudi preferenze avanzate" : "Apri preferenze avanzate");
  }

  function aggiornaHabitFixedFields() {
    var toggle = document.getElementById("habit-fixed-schedule");
    var fields = document.getElementById("habit-fixed-fields");
    var startTime = document.getElementById("habit-fixed-start");
    if (!toggle || !fields) return;

    fields.classList.toggle("nascosto", !toggle.checked);
    if (startTime) startTime.required = toggle.checked;
  }

  function syncHabitModalState(isOpen) {
    document.documentElement.classList.toggle("modal-open", isOpen);
    document.body.classList.toggle("modal-open", isOpen);
  }

  function setHabitFormMode(mode) {
    var title = document.getElementById("habit-form-title");
    var submit = document.getElementById("habit-submit-button");
    var isEdit = mode === "edit";

    if (title) title.textContent = isEdit ? "Modifica habit" : "Nuova habit";
    if (submit) submit.textContent = isEdit ? "Salva modifiche" : "Salva habit";
  }

  function showHabitForm() {
    var overlay = document.getElementById("habit-form-overlay");
    if (!overlay) return;

    lastFocusedElement = document.activeElement;
    overlay.classList.remove("nascosto");
    overlay.setAttribute("aria-hidden", "false");
    syncHabitModalState(true);

    window.setTimeout(function() {
      var titleInput = document.getElementById("habit-title");
      if (titleInput) titleInput.focus();
    }, 0);
  }

  function hideHabitForm() {
    var overlay = document.getElementById("habit-form-overlay");
    if (!overlay) return;

    overlay.classList.add("nascosto");
    overlay.setAttribute("aria-hidden", "true");
    syncHabitModalState(false);

    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
    lastFocusedElement = null;
  }

  function resetHabitForm() {
    var form = document.getElementById("habit-form");
    var submit = document.getElementById("habit-submit-button");
    editingHabitId = null;

    if (form) form.reset();
    if (submit) submit.textContent = "Salva habit";
    setHabitFormMode("new");

    var advanced = document.getElementById("habit-advanced");
    if (advanced) advanced.open = false;
    aggiornaHabitAdvancedSummary();

    setCheckedHabitWeekdays([]);
    aggiornaHabitFrequencyFields();
    aggiornaHabitFixedFields();
    setHabitFormStatus("");
  }

  function getHabitFormPayload() {
    var title = document.getElementById("habit-title");
    var frequency = document.getElementById("habit-frequency");
    var importance = document.getElementById("habit-importance");
    var duration = document.getElementById("habit-duration");
    var fixedToggle = document.getElementById("habit-fixed-schedule");
    var fixedStart = document.getElementById("habit-fixed-start");
    var energy = document.getElementById("habit-energy");
    var notes = document.getElementById("habit-notes");
    var selectedFrequency = frequency ? frequency.value : "daily";
    var selectedDuration = duration && duration.value ? Number(duration.value) : null;
    var hasManualDuration = Number.isFinite(selectedDuration) && selectedDuration > 0;
    var isFixed = !!(fixedToggle && fixedToggle.checked);
    var daysOfWeek = selectedFrequency === "specific_weekdays" ? getCheckedHabitWeekdays() : [];

    if (!title || !title.value.trim()) {
      return { error: "Inserisci un titolo." };
    }

    if (selectedFrequency === "specific_weekdays" && daysOfWeek.length === 0) {
      openAdvancedPreferences();
      return { error: "Scegli almeno un giorno." };
    }

    if (isFixed && (!fixedStart || !fixedStart.value)) {
      openAdvancedPreferences();
      return { error: "Scegli l'orario di inizio." };
    }

    return {
      habit: {
        title: title.value.trim(),
        frequency: selectedFrequency,
        importance: importance ? importance.value : "media",
        estimatedDurationMinutes: hasManualDuration ? selectedDuration : null,
        estimatedDurationManual: hasManualDuration,
        fixedSchedule: isFixed,
        fixedStartTime: isFixed && fixedStart ? fixedStart.value : null,
        fixedDurationMinutes: null,
        daysOfWeek: daysOfWeek,
        energyLevel: energy && energy.value ? energy.value : null,
        notes: notes && notes.value ? notes.value.trim() : ""
      }
    };
  }

  function readHabits() {
    if (!window.ActionFlowHabits || typeof window.ActionFlowHabits.readHabits !== "function") return [];
    return window.ActionFlowHabits.readHabits();
  }

  function renderHabits() {
    var list = document.getElementById("habits-list");
    var empty = document.getElementById("habits-empty");
    if (!list || !empty) return;

    var habits = readHabits();
    list.innerHTML = "";

    if (!habits.length) {
      empty.classList.remove("nascosto");
      return;
    }

    empty.classList.add("nascosto");

    for (var i = 0; i < habits.length; i++) {
      list.appendChild(buildHabitCard(habits[i]));
    }
  }

  function buildHabitCard(habit) {
    var card = document.createElement("article");
    card.className = "habits-card " + getHabitAccentClass(habit);
    if (habit.completedToday) card.classList.add("is-completed");
    var status = getHabitStatus(habit);
    card.classList.add(status.className);

    var content = document.createElement("div");
    content.className = "habits-card-content";

    var topRow = document.createElement("div");
    topRow.className = "habits-card-top-row";

    var titleWrap = document.createElement("div");
    titleWrap.className = "habits-card-title-wrap";

    var headingRow = document.createElement("div");
    headingRow.className = "habits-card-heading-row";

    var title = document.createElement("h3");
    title.className = "habits-card-title";
    title.textContent = habit.title;
    headingRow.appendChild(title);

    var recurrence = document.createElement("span");
    recurrence.className = "habits-card-recurrence";
    recurrence.textContent = getFrequencyLabel(habit);
    headingRow.appendChild(recurrence);

    titleWrap.appendChild(headingRow);

    topRow.appendChild(titleWrap);

    var completeButton = document.createElement("button");
    completeButton.type = "button";
    completeButton.className = "habits-check-button";
    completeButton.setAttribute("aria-label", habit.completedToday ? "Segna habit come da fare" : "Completa habit");
    completeButton.addEventListener("click", function() {
      if (habit.completedToday) {
        window.ActionFlowHabits.updateHabit(habit.id, {
          completedToday: false,
          lastCompletedAt: null
        });
      } else {
        window.ActionFlowHabits.completeHabit(habit.id);
      }
      renderHabits();
    });
    topRow.appendChild(completeButton);

    content.appendChild(topRow);

    var completion = document.createElement("span");
    completion.className = "habits-card-status " + status.className;
    completion.textContent = status.label;
    content.appendChild(completion);

    card.appendChild(content);

    var actions = document.createElement("div");
    actions.className = "habits-card-actions";

    var editButton = document.createElement("button");
    editButton.type = "button";
    editButton.className = "btn-modifica habits-action-button";
    editButton.textContent = "Modifica";
    editButton.addEventListener("click", function() {
      startEditHabit(habit);
    });
    actions.appendChild(editButton);

    var deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "btn-modifica btn-elimina-task habits-action-button habits-delete-button";
    deleteButton.textContent = "Elimina";
    deleteButton.addEventListener("click", function() {
      deleteHabit(habit.id);
    });
    actions.appendChild(deleteButton);

    card.appendChild(actions);
    return card;
  }

  function startEditHabit(habit) {
    editingHabitId = habit.id;

    document.getElementById("habit-title").value = habit.title || "";
    document.getElementById("habit-frequency").value = habit.frequency || "daily";
    document.getElementById("habit-importance").value = habit.importance || "media";
    document.getElementById("habit-duration").value = habit.estimatedDurationManual === true ? String(habit.estimatedDurationMinutes || "") : "";
    document.getElementById("habit-fixed-schedule").checked = habit.fixedSchedule === true;
    document.getElementById("habit-fixed-start").value = habit.fixedStartTime || "";
    document.getElementById("habit-energy").value = habit.energyLevel || "";
    document.getElementById("habit-notes").value = habit.notes || "";
    setCheckedHabitWeekdays(habit.daysOfWeek || []);

    setHabitFormMode("edit");
    aggiornaHabitFrequencyFields();
    aggiornaHabitFixedFields();
    showHabitForm();
    if (
      habit.estimatedDurationManual === true ||
      habit.fixedSchedule === true ||
      habit.energyLevel ||
      habit.notes ||
      (habit.frequency === "specific_weekdays" && habit.daysOfWeek && habit.daysOfWeek.length)
    ) {
      openAdvancedPreferences();
    }
    setHabitFormStatus("");
  }

  function deleteHabit(habitId) {
    if (!window.confirm("Vuoi eliminare questa habit?")) return;

    var nextHabits = readHabits().filter(function(habit) {
      return habit.id !== habitId;
    });

    window.ActionFlowHabits.writeHabits(nextHabits);
    if (editingHabitId === habitId) {
      resetHabitForm();
      hideHabitForm();
    }
    renderHabits();
  }

  function inizializzaHabitForm() {
    var form = document.getElementById("habit-form");
    var newButton = document.getElementById("habit-new-button");
    var cancelButton = document.getElementById("habit-cancel-button");
    var closeButton = document.getElementById("habit-form-close-button");
    var backdrop = document.getElementById("habit-form-backdrop");
    var frequency = document.getElementById("habit-frequency");
    var fixedToggle = document.getElementById("habit-fixed-schedule");
    var advanced = document.getElementById("habit-advanced");

    if (newButton) {
      newButton.addEventListener("click", function() {
        resetHabitForm();
        showHabitForm();
      });
    }

    if (cancelButton) {
      cancelButton.addEventListener("click", function() {
        resetHabitForm();
        hideHabitForm();
      });
    }

    if (closeButton) {
      closeButton.addEventListener("click", function() {
        resetHabitForm();
        hideHabitForm();
      });
    }

    if (backdrop) {
      backdrop.addEventListener("click", function() {
        resetHabitForm();
        hideHabitForm();
      });
    }

    document.addEventListener("keydown", function(event) {
      var overlay = document.getElementById("habit-form-overlay");
      if (event.key !== "Escape" || !overlay || overlay.classList.contains("nascosto")) return;

      resetHabitForm();
      hideHabitForm();
    });

    if (frequency) frequency.addEventListener("change", aggiornaHabitFrequencyFields);
    if (fixedToggle) fixedToggle.addEventListener("change", aggiornaHabitFixedFields);
    if (advanced) advanced.addEventListener("toggle", aggiornaHabitAdvancedSummary);

    if (form) {
      form.addEventListener("focusin", function(event) {
        var target = event.target;
        if (!target || !target.matches || !target.matches("input, select, textarea")) return;

        window.setTimeout(function() {
          if (typeof target.scrollIntoView === "function") {
            target.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        }, 120);
      });

      form.addEventListener("submit", function(event) {
        event.preventDefault();

        if (!window.ActionFlowHabits || typeof window.ActionFlowHabits.addHabit !== "function") {
          setHabitFormStatus("Habit non disponibile in questa sessione.", "error");
          return;
        }

        if (window.ActionFlowAuth && typeof window.ActionFlowAuth.isLoaded === "function" && !window.ActionFlowAuth.isLoaded()) {
          setHabitFormStatus("Attendi il caricamento del profilo.", "error");
          return;
        }

        var payload = getHabitFormPayload();
        if (payload.error) {
          setHabitFormStatus(payload.error, "error");
          return;
        }

        if (editingHabitId) {
          window.ActionFlowHabits.updateHabit(editingHabitId, payload.habit);
          setHabitFormStatus("Habit aggiornata.");
        } else {
          window.ActionFlowHabits.addHabit(payload.habit);
          setHabitFormStatus("Habit salvata.");
        }

        resetHabitForm();
        hideHabitForm();
        renderHabits();
      });
    }

    aggiornaHabitFrequencyFields();
    aggiornaHabitFixedFields();
    aggiornaHabitAdvancedSummary();
    hideHabitForm();
  }

  document.addEventListener("DOMContentLoaded", function() {
    applyTheme(getStoredThemePreference());
    inizializzaHabitForm();

    if (!window.ActionFlowAuth || typeof window.ActionFlowAuth.isLoaded !== "function" || window.ActionFlowAuth.isLoaded()) {
      renderHabits();
    }
  });

  window.addEventListener("actionflow-auth-ready", renderHabits);
})();
