(function(global) {
  var HABITS_STORAGE_KEY = "actionflow_habits";
  var IMPORTANCE_VALUES = ["alta", "media", "bassa"];
  var FREQUENCY_VALUES = ["daily", "weekly", "specific_weekdays"];
  var DAY_NAME_TO_INDEX = {
    sunday: 0,
    sun: 0,
    domenica: 0,
    monday: 1,
    mon: 1,
    lunedi: 1,
    tuesday: 2,
    tue: 2,
    martedi: 2,
    wednesday: 3,
    wed: 3,
    mercoledi: 3,
    thursday: 4,
    thu: 4,
    giovedi: 4,
    friday: 5,
    fri: 5,
    venerdi: 5,
    saturday: 6,
    sat: 6,
    sabato: 6
  };

  function clone(record) {
    return record && typeof record === "object" ? Object.assign({}, record) : {};
  }

  function generateHabitId() {
    return "habit_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  }

  function toDate(value) {
    if (value instanceof Date && !isNaN(value.getTime())) {
      return value;
    }

    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(value + "T00:00:00");
    }

    var parsed = value ? new Date(value) : new Date();
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  function getDateKey(value) {
    var date = toDate(value);
    var year = date.getFullYear();
    var month = String(date.getMonth() + 1).padStart(2, "0");
    var day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function getDayOfWeek(value) {
    return toDate(value).getDay();
  }

  function normalizeFrequency(value) {
    if (value === "weekdays" || value === "specific weekdays") {
      return "specific_weekdays";
    }

    return FREQUENCY_VALUES.indexOf(value) !== -1 ? value : "daily";
  }

  function normalizeImportance(value) {
    return IMPORTANCE_VALUES.indexOf(value) !== -1 ? value : "media";
  }

  function normalizeMinuteValue(value, fallback) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }

    return Math.round(parsed);
  }

  function normalizeTime(value) {
    if (typeof value !== "string") {
      return null;
    }

    var trimmed = value.trim();
    var match = trimmed.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
      return null;
    }

    return String(match[1]).padStart(2, "0") + ":" + match[2];
  }

  function normalizeDayOfWeek(value) {
    if (typeof value === "number" && value >= 0 && value <= 6) {
      return Math.round(value);
    }

    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (/^[0-6]$/.test(normalized)) {
        return Number(normalized);
      }

      if (Object.prototype.hasOwnProperty.call(DAY_NAME_TO_INDEX, normalized)) {
        return DAY_NAME_TO_INDEX[normalized];
      }
    }

    return null;
  }

  function normalizeDaysOfWeek(daysOfWeek) {
    if (!Array.isArray(daysOfWeek)) {
      return [];
    }

    return daysOfWeek.reduce(function(days, day) {
      var normalized = normalizeDayOfWeek(day);
      if (normalized !== null && days.indexOf(normalized) === -1) {
        days.push(normalized);
      }
      return days;
    }, []).sort();
  }

  function normalizeSelectedWeekday(value) {
    return normalizeDayOfWeek(value);
  }

  function wasCompletedOnDate(habit, referenceDate) {
    return !!(
      habit &&
      habit.completedToday === true &&
      habit.lastCompletedAt &&
      getDateKey(habit.lastCompletedAt) === getDateKey(referenceDate)
    );
  }

  function normalizeHabit(input, referenceDate) {
    var habit = clone(input);
    var frequency = normalizeFrequency(habit.frequency);
    var fixedSchedule = habit.fixedSchedule === true;
    var fixedStartTime = fixedSchedule ? normalizeTime(habit.fixedStartTime) : null;
    var fixedDurationMinutes = fixedSchedule
      ? normalizeMinuteValue(habit.fixedDurationMinutes, null)
      : null;
    var daysOfWeek = normalizeDaysOfWeek(habit.daysOfWeek);
    var createdAt = habit.createdAt || new Date().toISOString();
    var selectedWeekday = normalizeSelectedWeekday(habit.selectedWeekday);

    if (frequency === "weekly" && selectedWeekday === null) {
      selectedWeekday = daysOfWeek.length > 0 ? daysOfWeek[0] : getDayOfWeek(createdAt);
    }

    return {
      id: habit.id || generateHabitId(),
      title: typeof habit.title === "string" ? habit.title.trim() : "",
      frequency: frequency,
      importance: normalizeImportance(habit.importance),
      estimatedDurationMinutes: normalizeMinuteValue(habit.estimatedDurationMinutes, 30),
      estimatedDurationManual: habit.estimatedDurationManual === true,
      fixedSchedule: fixedSchedule,
      fixedStartTime: fixedStartTime,
      fixedDurationMinutes: fixedDurationMinutes,
      daysOfWeek: daysOfWeek,
      selectedWeekday: frequency === "weekly" ? selectedWeekday : null,
      createdAt: createdAt,
      completedToday: wasCompletedOnDate(habit, referenceDate || new Date()),
      lastCompletedAt: habit.lastCompletedAt || null,
      energyLevel: ["bassa", "media", "alta"].indexOf(habit.energyLevel) !== -1 ? habit.energyLevel : null,
      notes: typeof habit.notes === "string" ? habit.notes.trim() : ""
    };
  }

  function readRawHabits() {
    if (global.ActionFlowAuth && typeof global.ActionFlowAuth.readOwnedArray === "function") {
      return global.ActionFlowAuth.readOwnedArray(HABITS_STORAGE_KEY);
    }

    try {
      var parsed = JSON.parse(global.localStorage.getItem(HABITS_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function normalizeHabitList(habits, referenceDate) {
    return (Array.isArray(habits) ? habits : []).map(function(habit) {
      return normalizeHabit(habit, referenceDate || new Date());
    });
  }

  function writeHabitsForDate(habits, referenceDate) {
    var normalized = (Array.isArray(habits) ? habits : []).map(function(habit) {
      return normalizeHabit(habit, referenceDate || new Date());
    });

    if (global.ActionFlowAuth && typeof global.ActionFlowAuth.writeOwnedArray === "function") {
      global.ActionFlowAuth.writeOwnedArray(HABITS_STORAGE_KEY, normalized);
      return normalized;
    }

    global.localStorage.setItem(HABITS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function writeHabits(habits) {
    return writeHabitsForDate(habits, new Date());
  }

  function readHabits(referenceDate) {
    var habits = normalizeHabitList(readRawHabits(), referenceDate || new Date());

    return habits.filter(function(habit) {
      return habit.title;
    });
  }

  function resetHabitCompletionsForDate(referenceDate) {
    var today = referenceDate || new Date();
    var rawHabits = readRawHabits();
    var normalized = normalizeHabitList(rawHabits, today);
    var changed = rawHabits.length !== normalized.length;

    if (!changed) {
      for (var i = 0; i < rawHabits.length; i++) {
        if ((rawHabits[i] && rawHabits[i].completedToday === true) !== normalized[i].completedToday) {
          changed = true;
          break;
        }
      }
    }

    return changed ? writeHabitsForDate(normalized, today) : normalized;
  }

  function isHabitActiveOnDate(habit, referenceDate) {
    var normalized = normalizeHabit(habit, referenceDate);
    var day = getDayOfWeek(referenceDate || new Date());

    if (normalized.frequency === "daily") {
      return true;
    }

    if (normalized.frequency === "specific_weekdays") {
      return normalized.daysOfWeek.indexOf(day) !== -1;
    }

    if (normalized.frequency === "weekly") {
      return normalized.selectedWeekday === day;
    }

    return false;
  }

  function getHabitsForToday(referenceDate) {
    var today = referenceDate || new Date();
    return resetHabitCompletionsForDate(today).filter(function(habit) {
      if (!habit.title) {
        return false;
      }

      return isHabitActiveOnDate(habit, today);
    });
  }

  function addHabit(input) {
    var habits = readHabits();
    var habit = normalizeHabit(input);
    habits.push(habit);
    writeHabits(habits);
    return habit;
  }

  function updateHabit(habitId, patch, referenceDate) {
    var updatedHabit = null;
    var updateDate = referenceDate || new Date();
    var habits = readHabits(updateDate).map(function(habit) {
      if (habit.id !== habitId) {
        return habit;
      }

      updatedHabit = normalizeHabit(Object.assign({}, habit, patch || {}, { id: habit.id }), updateDate);
      return updatedHabit;
    });

    writeHabitsForDate(habits, updateDate);
    return updatedHabit;
  }

  function completeHabit(habitId, referenceDate) {
    var completedAt = toDate(referenceDate || new Date()).toISOString();
    return updateHabit(habitId, {
      completedToday: true,
      lastCompletedAt: completedAt
    }, referenceDate || new Date());
  }

  var api = {
    HABITS_STORAGE_KEY: HABITS_STORAGE_KEY,
    addHabit: addHabit,
    completeHabit: completeHabit,
    getDateKey: getDateKey,
    getDayOfWeek: getDayOfWeek,
    getHabitsForToday: getHabitsForToday,
    isHabitActiveOnDate: isHabitActiveOnDate,
    normalizeHabit: normalizeHabit,
    readHabits: readHabits,
    resetHabitCompletionsForDate: resetHabitCompletionsForDate,
    updateHabit: updateHabit,
    writeHabits: writeHabits
  };

  global.ActionFlowHabits = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
