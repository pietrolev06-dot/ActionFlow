const fs = require("fs");
const path = require("path");

const STORAGE_PATH = path.join(__dirname, "..", "data", "user-storage.json");
const ARRAY_KEYS = [
  "actionflow_archivio_azioni",
  "actionflow_archivio_scadenze",
  "actionflow_checklist",
  "actionflow_scadenze",
];
const SCOPED_KEYS = [
  "actionflow_daily_plan",
  "actionflow_azioni_done",
  "actionflow_checklist_done",
  "actionflow_analysis_usage",
];

function ensureStorageFile() {
  fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true });

  if (!fs.existsSync(STORAGE_PATH)) {
    fs.writeFileSync(STORAGE_PATH, JSON.stringify({}, null, 2), "utf8");
  }
}

function readStore() {
  ensureStorageFile();

  try {
    const raw = fs.readFileSync(STORAGE_PATH, "utf8");
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function writeStore(store) {
  ensureStorageFile();
  fs.writeFileSync(STORAGE_PATH, JSON.stringify(store || {}, null, 2), "utf8");
}

function cloneRecord(record) {
  return record && typeof record === "object" ? { ...record } : {};
}

function normalizeOwnedArray(records, userId) {
  if (!Array.isArray(records)) {
    return [];
  }

  return records
    .filter((record) => record && typeof record === "object")
    .map((record) => ({
      ...cloneRecord(record),
      userId,
    }));
}

function normalizeScopedObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

function buildEmptySnapshot() {
  const arrays = {};
  const scoped = {};

  ARRAY_KEYS.forEach((key) => {
    arrays[key] = [];
  });

  SCOPED_KEYS.forEach((key) => {
    scoped[key] = {};
  });

  return { arrays, scoped };
}

function getUserStorage(userId) {
  if (!userId) {
    return buildEmptySnapshot();
  }

  const store = readStore();
  const userBucket = store[userId] && typeof store[userId] === "object" ? store[userId] : {};
  const snapshot = buildEmptySnapshot();

  ARRAY_KEYS.forEach((key) => {
    snapshot.arrays[key] = normalizeOwnedArray(
      userBucket.arrays && userBucket.arrays[key],
      userId
    );
  });

  SCOPED_KEYS.forEach((key) => {
    snapshot.scoped[key] = normalizeScopedObject(
      userBucket.scoped && userBucket.scoped[key]
    );
  });

  return snapshot;
}

function setUserStorage(userId, payload) {
  if (!userId) {
    return buildEmptySnapshot();
  }

  const store = readStore();
  const current = getUserStorage(userId);
  const nextSnapshot = buildEmptySnapshot();
  const inputArrays = payload && payload.arrays && typeof payload.arrays === "object" ? payload.arrays : {};
  const inputScoped = payload && payload.scoped && typeof payload.scoped === "object" ? payload.scoped : {};

  ARRAY_KEYS.forEach((key) => {
    const source = Object.prototype.hasOwnProperty.call(inputArrays, key)
      ? inputArrays[key]
      : current.arrays[key];
    nextSnapshot.arrays[key] = normalizeOwnedArray(source, userId);
  });

  SCOPED_KEYS.forEach((key) => {
    const source = Object.prototype.hasOwnProperty.call(inputScoped, key)
      ? inputScoped[key]
      : current.scoped[key];
    nextSnapshot.scoped[key] = normalizeScopedObject(source);
  });

  store[userId] = nextSnapshot;
  writeStore(store);

  return nextSnapshot;
}

module.exports = {
  ARRAY_KEYS,
  SCOPED_KEYS,
  getUserStorage,
  setUserStorage,
};
