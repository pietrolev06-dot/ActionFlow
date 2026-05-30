const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const store = {};
const context = {
  console,
  localStorage: {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => {
      store[key] = value;
    },
    removeItem: (key) => {
      delete store[key];
    }
  },
  window: {
    addEventListener: () => {},
    ActionFlowAuth: {
      readOwnedArray: () => [],
      writeOwnedArray: () => {},
      getCurrentUserId: () => null
    }
  },
  document: {
    addEventListener: () => {},
    body: { setAttribute: () => {} },
    documentElement: { setAttribute: () => {} },
    getElementById: () => null,
    querySelectorAll: () => []
  }
};

vm.createContext(context);
vm.runInContext(fs.readFileSync("script.js", "utf8"), context);

function expectedDate(label) {
  const resolved = context.risolviRiferimentoTemporale(label);
  return resolved ? resolved.dataCalcolata : null;
}

function parsedTasks(text) {
  const tasks = context.analizzaTestoLocale(text).azioni.map((task) => ({
    testo: task.testo,
    dataISO: task.dataISO,
    scadenzaOriginale: task.scadenzaOriginale
  }));
  return JSON.parse(JSON.stringify(tasks));
}

function parsedTasksWithTime(text) {
  const tasks = context.analizzaTestoLocale(text).azioni.map((task) => ({
    testo: task.testo,
    dataISO: task.dataISO,
    time: task.time
  }));
  return JSON.parse(JSON.stringify(tasks));
}

const oggi = expectedDate("oggi");
const domani = expectedDate("domani");
assert.deepStrictEqual(parsedTasks("Domani devo chiamare Marco, preparare il pranzo, studiare analisi e pagare l'affitto"), [
  { testo: "Chiamare Marco", dataISO: domani, scadenzaOriginale: "Domani" },
  { testo: "Preparare il pranzo", dataISO: domani, scadenzaOriginale: "Domani" },
  { testo: "Studiare analisi", dataISO: domani, scadenzaOriginale: "Domani" },
  { testo: "Pagare l'affitto", dataISO: domani, scadenzaOriginale: "Domani" }
]);

assert.deepStrictEqual(parsedTasks("Oggi devo studiare e domani chiamare Marco"), [
  { testo: "Studiare", dataISO: expectedDate("oggi"), scadenzaOriginale: "Oggi" },
  { testo: "Chiamare Marco", dataISO: domani, scadenzaOriginale: "domani" }
]);

assert.deepStrictEqual(parsedTasks("Lunedì palestra, martedì dentista"), [
  { testo: "Palestra", dataISO: expectedDate("Lunedì"), scadenzaOriginale: "Lunedì" },
  { testo: "Dentista", dataISO: expectedDate("martedì"), scadenzaOriginale: "martedì" }
]);

assert.deepStrictEqual(parsedTasksWithTime("Domani alle 9 chiamare Marco e preparare il pranzo"), [
  { testo: "Chiamare Marco", dataISO: domani, time: "09:00" },
  { testo: "Preparare il pranzo", dataISO: domani, time: "09:00" }
]);

const backendLikeResult = context.propagaDateDiFrase(
  "Domani devo chiamare Marco, preparare il pranzo, studiare analisi e pagare l'affitto",
  {
    azioni: [
      { testo: "Chiamare Marco", priorita: "alta", scadenzaOriginale: "Domani", dataISO: domani },
      { testo: "Preparare il pranzo", priorita: "bassa", scadenzaOriginale: null, dataISO: null },
      { testo: "Studiare analisi", priorita: "bassa", scadenzaOriginale: null, dataISO: null },
      { testo: "Pagare l'affitto", priorita: "bassa", scadenzaOriginale: null, dataISO: null }
    ],
    scadenze: [
      { testo: "Chiamare Marco", data: "Domani", dataRisolta: domani }
    ],
    daPianificare: []
  }
);

const backendLikeTasks = JSON.parse(JSON.stringify(backendLikeResult.azioni.map((task) => ({
  testo: task.testo,
  dataISO: task.dataISO,
  scadenzaOriginale: task.scadenzaOriginale
}))));

assert.deepStrictEqual(backendLikeTasks, [
  { testo: "Chiamare Marco", dataISO: domani, scadenzaOriginale: "Domani" },
  { testo: "Preparare il pranzo", dataISO: domani, scadenzaOriginale: "Domani" },
  { testo: "Studiare analisi", dataISO: domani, scadenzaOriginale: "Domani" },
  { testo: "Pagare l'affitto", dataISO: domani, scadenzaOriginale: "Domani" }
]);

console.assert(
  backendLikeResult.azioni.length === 4 && backendLikeResult.azioni.every((task) => task.dataISO === domani),
  "Exact input should create 4 tasks and all should inherit Domani"
);

const tomorrowPlan = context.buildDailyPlan([
  { testo: "Chiamare Marco", priorita: "alta", dataISO: domani, scadenzaOriginale: "Domani", durataStimataMinuti: 15, energiaStimata: "bassa" },
  { testo: "Preparare il pranzo", priorita: "alta", dataISO: domani, scadenzaOriginale: "Domani", durataStimataMinuti: 30, energiaStimata: "media" },
  { testo: "Studiare analisi", priorita: "alta", dataISO: domani, scadenzaOriginale: "Domani", durataStimataMinuti: 60, energiaStimata: "alta" },
  { testo: "Pagare l'affitto", priorita: "alta", dataISO: domani, scadenzaOriginale: "Domani", durataStimataMinuti: 10, energiaStimata: "bassa" }
]);

assert.strictEqual(tomorrowPlan.mattina.length, 0, "Tomorrow tasks should not appear in today's Mattina");
assert.strictEqual(tomorrowPlan.pomeriggio.length, 0, "Tomorrow tasks should not appear in today's Pomeriggio");
assert.strictEqual(tomorrowPlan.seAvanzaTempo.length, 0, "Tomorrow tasks should not appear in today's Se avanza tempo");

const overflowPlan = context.buildDailyPlan([
  { testo: "Task 1", priorita: "alta", dataISO: oggi, scadenzaOriginale: "Oggi", durataStimataMinuti: 15, energiaStimata: "bassa" },
  { testo: "Task 2", priorita: "alta", dataISO: oggi, scadenzaOriginale: "Oggi", durataStimataMinuti: 15, energiaStimata: "bassa" },
  { testo: "Task 3", priorita: "alta", dataISO: oggi, scadenzaOriginale: "Oggi", durataStimataMinuti: 15, energiaStimata: "bassa" },
  { testo: "Task 4", priorita: "alta", dataISO: oggi, scadenzaOriginale: "Oggi", durataStimataMinuti: 15, energiaStimata: "bassa" },
  { testo: "Task 5", priorita: "alta", dataISO: oggi, scadenzaOriginale: "Oggi", durataStimataMinuti: 15, energiaStimata: "bassa" },
  { testo: "Task 6", priorita: "alta", dataISO: oggi, scadenzaOriginale: "Oggi", durataStimataMinuti: 15, energiaStimata: "bassa" }
]);

console.assert(
  JSON.stringify(overflowPlan.mattina.map((task) => task.testo)) === JSON.stringify(["Task 1", "Task 2", "Task 3"]) &&
    JSON.stringify(overflowPlan.pomeriggio.map((task) => task.testo)) === JSON.stringify(["Task 4", "Task 5"]) &&
    overflowPlan.seAvanzaTempo.length === 1,
  "Overflow tasks should move to Se avanza tempo only after the first 5 tasks"
);

const habitAwarePlan = context.buildDailyPlan([
  { testo: "Task reale 1", priorita: "alta", dataISO: oggi, durataStimataMinuti: 20, energiaStimata: "bassa" },
  { testo: "Task reale 2", priorita: "media", dataISO: oggi, durataStimataMinuti: 30, energiaStimata: "media" },
  { testo: "Task reale 3", priorita: "media", dataISO: oggi, durataStimataMinuti: 30, energiaStimata: "media", time: "18:00" },
  { id: "habit:palestra", habitId: "palestra", isHabit: true, fixedSchedule: true, testo: "Palestra", priorita: "alta", dataISO: oggi, time: "18:00", durataStimataMinuti: 45, energiaStimata: "media", completato: false },
  { id: "habit-acqua", habitId: "acqua", isHabit: true, fixedSchedule: false, testo: "Bere acqua", priorita: "bassa", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa", completato: false }
]);

const habitPlanMainTexts = JSON.parse(JSON.stringify(
  habitAwarePlan.mattina.concat(habitAwarePlan.pomeriggio).map((task) => task.testo)
));
const habitPlanExtraTexts = JSON.parse(JSON.stringify(habitAwarePlan.seAvanzaTempo.map((task) => task.testo)));

assert.strictEqual(habitPlanMainTexts.indexOf("Palestra") !== -1, true);
assert.strictEqual(habitPlanExtraTexts.indexOf("Task reale 3") !== -1, true);
assert.strictEqual(habitPlanExtraTexts.indexOf("Bere acqua") !== -1, true);

const nonDueHabitPlan = context.buildDailyPlan([
  { id: "habit:daily", habitId: "daily", isHabit: true, frequency: "daily", testo: "Habit daily", priorita: "media", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa", completato: false },
  { id: "habit:weekly-due", habitId: "weekly-due", isHabit: true, frequency: "weekly", selectedWeekday: new Date(oggi + "T00:00:00").getDay(), testo: "Habit weekly due", priorita: "media", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa", completato: false },
  { id: "habit:weekly-later", habitId: "weekly-later", isHabit: true, frequency: "weekly", selectedWeekday: (new Date(oggi + "T00:00:00").getDay() + 1) % 7, testo: "Habit weekly later", priorita: "media", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa", completato: false }
]);

const nonDueHabitTexts = JSON.parse(JSON.stringify(
  nonDueHabitPlan.mattina.concat(nonDueHabitPlan.pomeriggio).concat(nonDueHabitPlan.seAvanzaTempo).map((task) => task.testo)
));
const flexibleHabit = nonDueHabitPlan.mattina.concat(nonDueHabitPlan.pomeriggio).concat(nonDueHabitPlan.seAvanzaTempo).find((task) => task.testo === "Habit weekly later");
assert.strictEqual(nonDueHabitTexts.indexOf("Habit daily") !== -1, true);
assert.strictEqual(nonDueHabitTexts.indexOf("Habit weekly due") !== -1, true);
assert.strictEqual(nonDueHabitTexts.indexOf("Habit weekly later") !== -1, true);
assert.strictEqual(flexibleHabit.flexibleOccurrence, true);
assert.strictEqual(flexibleHabit.recurringLabel, "Anticipabile");

const strictFutureTaskPlan = context.buildDailyPlan([
  { testo: "Task futuro", priorita: "alta", dataISO: domani, durataStimataMinuti: 15, energiaStimata: "bassa" },
  { testo: "Task oggi", priorita: "alta", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa" }
]);

const strictFutureTaskTexts = JSON.parse(JSON.stringify(
  strictFutureTaskPlan.mattina.concat(strictFutureTaskPlan.pomeriggio).concat(strictFutureTaskPlan.seAvanzaTempo).map((task) => task.testo)
));
assert.strictEqual(strictFutureTaskTexts.indexOf("Task futuro"), -1);
assert.strictEqual(strictFutureTaskTexts.indexOf("Task oggi") !== -1, true);

const stableCompletionPlan = context.normalizeDailyPlan({
  data: oggi,
  mattina: [
    { testo: "Task completato", dataISO: oggi, durataStimataMinuti: 30, completato: true },
    { testo: "Task attivo", dataISO: oggi, durataStimataMinuti: 20, completato: false }
  ],
  pomeriggio: [],
  restaDaFareOggi: [],
  seAvanzaTempo: []
});

assert.strictEqual(stableCompletionPlan.mattina.length, 2, "Completed tasks should stay visible in their plan slot");
assert.strictEqual(stableCompletionPlan.totali.minutiMattina, 20, "Completed tasks should not count toward remaining minutes");
assert.strictEqual(context.getFocusTasks(stableCompletionPlan).ora.testo, "Task attivo", "Focus should skip completed plan tasks");

assert.deepStrictEqual(JSON.parse(JSON.stringify(context.estimateHabitPlanningDetails({ title: "Studiare analisi", importance: "alta" }))), {
  duration: 90,
  energy: "alta",
  preferredSlot: "pomeriggio"
});

assert.deepStrictEqual(JSON.parse(JSON.stringify(context.estimateHabitPlanningDetails({ title: "Portare fuori il cane", importance: "media" }))), {
  duration: 15,
  energy: "bassa",
  preferredSlot: null
});

context.focusDateMode = "today";
const todayFocus = context.getFocusTasks({
  mattina: [
    { testo: "Task oggi 1", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa" },
    { testo: "Task domani", dataISO: domani, durataStimataMinuti: 15, energiaStimata: "bassa" }
  ],
  pomeriggio: [
    { testo: "Task oggi 2", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa" }
  ],
  restaDaFareOggi: [],
  seAvanzaTempo: []
});

const todayFocusTexts = JSON.parse(JSON.stringify(
  [todayFocus.ora].concat(todayFocus.dopo).filter(Boolean).map((task) => task.testo)
));
assert.strictEqual(todayFocusTexts.indexOf("Task domani"), -1);
assert.deepStrictEqual(todayFocusTexts.slice().sort(), ["Task oggi 1", "Task oggi 2"].sort());

context.focusDateMode = "tomorrow";
const tomorrowFocus = context.getFocusTasks({
  mattina: [
    { testo: "Task oggi 1", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa" },
    { testo: "Task domani", dataISO: domani, durataStimataMinuti: 15, energiaStimata: "bassa" }
  ],
  pomeriggio: [
    { testo: "Task oggi 2", dataISO: oggi, durataStimataMinuti: 15, energiaStimata: "bassa" }
  ],
  restaDaFareOggi: [],
  seAvanzaTempo: []
});

assert.strictEqual(tomorrowFocus.ora.testo, "Task domani");
assert.deepStrictEqual(JSON.parse(JSON.stringify(tomorrowFocus.dopo.map((task) => task.testo))), []);

console.log("Date propagation parser checks passed.");
