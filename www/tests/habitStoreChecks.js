const assert = require("assert");

const store = {};

global.localStorage = {
  getItem: (key) => store[key] || null,
  setItem: (key, value) => {
    store[key] = value;
  },
  removeItem: (key) => {
    delete store[key];
  }
};

const habits = require("../habits");

habits.writeHabits([
  {
    id: "daily-water",
    title: "Bere acqua",
    frequency: "daily",
    importance: "bassa",
    estimatedDurationMinutes: 5,
    fixedSchedule: false,
    createdAt: "2026-05-01T08:00:00.000Z"
  },
  {
    id: "mon-thu-training",
    title: "Allenamento",
    frequency: "specific_weekdays",
    importance: "alta",
    estimatedDurationMinutes: 45,
    fixedSchedule: true,
    fixedStartTime: "07:30",
    fixedDurationMinutes: 45,
    daysOfWeek: ["monday", "thursday"],
    createdAt: "2026-05-01T08:00:00.000Z"
  },
  {
    id: "weekly-review",
    title: "Review settimanale",
    frequency: "weekly",
    importance: "media",
    estimatedDurationMinutes: 30,
    estimatedDurationManual: true,
    fixedSchedule: false,
    createdAt: "2026-05-04T08:00:00.000Z",
    energyLevel: "alta",
    notes: "Rivedere obiettivi"
  }
]);

assert.deepStrictEqual(
  habits.getHabitsForToday("2026-05-07").map((habit) => habit.id),
  ["daily-water", "mon-thu-training"]
);

assert.deepStrictEqual(
  habits.getHabitsForToday("2026-05-04").map((habit) => habit.id),
  ["daily-water", "mon-thu-training", "weekly-review"]
);

const fixedHabit = habits.getHabitsForToday("2026-05-07").find((habit) => habit.id === "mon-thu-training");
assert.strictEqual(fixedHabit.fixedSchedule, true);
assert.strictEqual(fixedHabit.fixedStartTime, "07:30");
assert.strictEqual(fixedHabit.fixedDurationMinutes, 45);

habits.completeHabit("daily-water", "2026-05-07");

assert.strictEqual(
  habits.getHabitsForToday("2026-05-07").find((habit) => habit.id === "daily-water").completedToday,
  true
);

assert.strictEqual(
  habits.getHabitsForToday("2026-05-08").find((habit) => habit.id === "daily-water").completedToday,
  false
);

assert.strictEqual(habits.readHabits("2026-05-08").length, 3);
assert.strictEqual(habits.readHabits("2026-05-08").find((habit) => habit.id === "weekly-review").energyLevel, "alta");
assert.strictEqual(habits.readHabits("2026-05-08").find((habit) => habit.id === "weekly-review").notes, "Rivedere obiettivi");
assert.strictEqual(habits.readHabits("2026-05-08").find((habit) => habit.id === "weekly-review").estimatedDurationManual, true);
assert.strictEqual(habits.readHabits("2026-05-08").find((habit) => habit.id === "weekly-review").selectedWeekday, 1);

habits.writeHabits([
  {
    id: "weekly-friday",
    title: "Retro venerdi",
    frequency: "weekly",
    selectedWeekday: "friday",
    createdAt: "2026-05-04T08:00:00.000Z",
    lastCompletedAt: "2026-05-01T08:00:00.000Z"
  }
]);

assert.deepStrictEqual(
  habits.getHabitsForToday("2026-05-08").map((habit) => habit.id),
  ["weekly-friday"]
);

assert.deepStrictEqual(
  habits.getHabitsForToday("2026-05-09").map((habit) => habit.id),
  []
);

console.log("Habit store checks passed.");
