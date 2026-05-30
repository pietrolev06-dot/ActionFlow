(function(global) {
  var CAPACITOR_API_BASE_URL = "https://actionflow-2zwl.onrender.com";
  var API_BASE_URL = getApiBaseUrl();
  var OWNER_ALIAS_STORAGE_KEY = "actionflow_owner_aliases";
  var MIGRATION_ARRAY_KEYS = [
    "actionflow_archivio_azioni",
    "actionflow_archivio_scadenze",
    "actionflow_checklist",
    "actionflow_scadenze"
  ];
  var MIGRATION_SCOPED_KEYS = [
    "actionflow_daily_plan",
    "actionflow_azioni_done",
    "actionflow_checklist_done",
    "actionflow_analysis_usage"
  ];
  var USER_STORAGE_SYNC_URL = buildApiUrl("/api/user-storage");
  var authState = {
    user: null,
    loaded: false
  };
  var pendingSyncTimeout = null;

  function isCapacitorRuntime() {
    var capacitor = global.Capacitor;

    if (!capacitor || typeof capacitor.getPlatform !== "function") {
      return false;
    }

    return capacitor.getPlatform() !== "web";
  }

  function getApiBaseUrl() {
    return isCapacitorRuntime() ? CAPACITOR_API_BASE_URL : "";
  }

  function buildApiUrl(path) {
    if (/^https?:\/\//i.test(path)) {
      return path;
    }

    var normalizedPath = path.charAt(0) === "/" ? path : "/" + path;
    return API_BASE_URL ? API_BASE_URL + normalizedPath : normalizedPath;
  }

  function getFetchCredentials() {
    return isCapacitorRuntime() ? "include" : "same-origin";
  }

  function apiFetch(path, options) {
    var requestOptions = Object.assign({}, options || {});

    if (!requestOptions.credentials) {
      requestOptions.credentials = getFetchCredentials();
    }

    return fetch(buildApiUrl(path), requestOptions);
  }

  function navigateToBackend(path) {
    global.location.href = buildApiUrl(path);
  }

  function updateBackendLinks() {
    var links = global.document ? global.document.querySelectorAll("[data-api-route]") : [];

    for (var i = 0; i < links.length; i++) {
      var route = links[i].getAttribute("data-api-route");
      if (route) {
        links[i].setAttribute("href", buildApiUrl(route));
      }
    }
  }

  function cloneRecord(record) {
    return Object.assign({}, record);
  }

  function getStableOwnerKey(user) {
    if (!user || typeof user !== "object") {
      return null;
    }

    if (user.provider && user.providerUserId) {
      return user.provider + ":" + user.providerUserId;
    }

    return user.id || null;
  }

  function getCurrentUserId() {
    return getStableOwnerKey(authState.user);
  }

  function getCurrentUser() {
    return authState.user;
  }

  function getCurrentUserPlan() {
    return authState.user && authState.user.plan === "pro" ? "pro" : "free";
  }

  function readOwnerAliases() {
    try {
      var raw = localStorage.getItem(OWNER_ALIAS_STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeOwnerAliases(aliases) {
    localStorage.setItem(OWNER_ALIAS_STORAGE_KEY, JSON.stringify(aliases || {}));
  }

  function rememberOwnerAlias(legacyId, stableId) {
    if (!legacyId || !stableId || legacyId === stableId) {
      return;
    }

    var aliases = readOwnerAliases();
    if (aliases[legacyId] === stableId) {
      return;
    }

    aliases[legacyId] = stableId;
    writeOwnerAliases(aliases);
  }

  function getCurrentScopeIds() {
    var stableId = getCurrentUserId();
    var aliases = readOwnerAliases();
    var ids = [];

    if (stableId) {
      ids.push(stableId);
    }

    for (var legacyId in aliases) {
      if (Object.prototype.hasOwnProperty.call(aliases, legacyId) && aliases[legacyId] === stableId) {
        ids.push(legacyId);
      }
    }

    return ids;
  }

  function isStableScopedId(userId) {
    return /^(google|apple|email):/.test(String(userId || ""));
  }

  function getScopedStorageKey(baseKey) {
    var userId = getCurrentUserId();
    return userId ? baseKey + "__user_" + userId : baseKey;
  }

  function isRecordInCurrentScope(record) {
    var scopeIds = getCurrentScopeIds();
    var userId = scopeIds.length > 0 ? scopeIds[0] : null;

    if (userId) {
      return !!(record && scopeIds.indexOf(record.userId) !== -1);
    }

    return !record || !record.userId;
  }

  function attachUserId(record) {
    var normalized = cloneRecord(record);
    var userId = getCurrentUserId();

    if (userId) {
      normalized.userId = userId;
    } else if (Object.prototype.hasOwnProperty.call(normalized, "userId")) {
      delete normalized.userId;
    }

    return normalized;
  }

  function shouldSyncWithServer() {
    return !!(authState.user && getCurrentUserId() && getCurrentUserPlan() === "pro");
  }

  function isManagedArrayKey(baseKey) {
    return MIGRATION_ARRAY_KEYS.indexOf(baseKey) !== -1;
  }

  function isManagedScopedKey(baseKey) {
    return MIGRATION_SCOPED_KEYS.indexOf(baseKey) !== -1;
  }

  function readOwnedArray(baseKey) {
    try {
      var raw = localStorage.getItem(baseKey);
      var parsed = raw ? JSON.parse(raw) : [];

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed.filter(isRecordInCurrentScope);
    } catch (e) {
      return [];
    }
  }

  function writeOwnedArrayLocal(baseKey, records) {
    var rawAll;

    try {
      rawAll = JSON.parse(localStorage.getItem(baseKey) || "[]");
    } catch (e) {
      rawAll = [];
    }

    if (!Array.isArray(rawAll)) {
      rawAll = [];
    }

    var preserved = rawAll.filter(function(record) {
      return !isRecordInCurrentScope(record);
    });

    var ownedRecords = (Array.isArray(records) ? records : []).map(attachUserId);
    localStorage.setItem(baseKey, JSON.stringify(preserved.concat(ownedRecords)));
  }

  function writeOwnedArray(baseKey, records) {
    writeOwnedArrayLocal(baseKey, records);

    if (isManagedArrayKey(baseKey)) {
      scheduleServerSync();
    }
  }

  function clearOwnedArray(baseKey) {
    writeOwnedArray(baseKey, []);
  }

  function readScopedObject(baseKey) {
    try {
      var scopeIds = getCurrentScopeIds();
      var keysToTry = [getScopedStorageKey(baseKey)];

      for (var i = 0; i < scopeIds.length; i++) {
        var legacyScopedKey = baseKey + "__user_" + scopeIds[i];
        if (keysToTry.indexOf(legacyScopedKey) === -1) {
          keysToTry.push(legacyScopedKey);
        }
      }

      for (var j = 0; j < keysToTry.length; j++) {
        var raw = localStorage.getItem(keysToTry[j]);
        var parsed = raw ? JSON.parse(raw) : {};

        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          return parsed;
        }
      }

      return {};
    } catch (e) {
      return {};
    }
  }

  function writeScopedObjectLocal(baseKey, value) {
    var scopedKey = getScopedStorageKey(baseKey);
    var scopeIds = getCurrentScopeIds();
    localStorage.setItem(scopedKey, JSON.stringify(value || {}));

    for (var i = 0; i < scopeIds.length; i++) {
      var legacyScopedKey = baseKey + "__user_" + scopeIds[i];
      if (legacyScopedKey !== scopedKey) {
        localStorage.removeItem(legacyScopedKey);
      }
    }
  }

  function writeScopedObject(baseKey, value) {
    writeScopedObjectLocal(baseKey, value);

    if (isManagedScopedKey(baseKey)) {
      scheduleServerSync();
    }
  }

  function clearScopedObject(baseKey) {
    clearScopedObjectLocal(baseKey);

    if (isManagedScopedKey(baseKey)) {
      scheduleServerSync();
    }
  }

  function clearScopedObjectLocal(baseKey) {
    var scopeIds = getCurrentScopeIds();
    localStorage.removeItem(getScopedStorageKey(baseKey));

    for (var i = 0; i < scopeIds.length; i++) {
      localStorage.removeItem(baseKey + "__user_" + scopeIds[i]);
    }
  }

  function getOwnedRecordCount(baseKey, targetUserId) {
    try {
      var raw = localStorage.getItem(baseKey);
      var parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) {
        return 0;
      }

      return parsed.filter(function(record) {
        return record && record.userId === targetUserId;
      }).length;
    } catch (e) {
      return 0;
    }
  }

  function findSingleLegacyOwnerId(stableId) {
    var candidateIds = [];

    for (var i = 0; i < MIGRATION_ARRAY_KEYS.length; i++) {
      try {
        var raw = localStorage.getItem(MIGRATION_ARRAY_KEYS[i]);
        var parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) continue;

        for (var j = 0; j < parsed.length; j++) {
          var userId = parsed[j] && parsed[j].userId;
          if (!userId || userId === stableId || isStableScopedId(userId)) continue;
          if (candidateIds.indexOf(userId) === -1) {
            candidateIds.push(userId);
          }
        }
      } catch (e) {}
    }

    return candidateIds.length === 1 ? candidateIds[0] : null;
  }

  function migrateLegacyOwnerRecords(legacyId, stableId) {
    if (!legacyId || !stableId || legacyId === stableId) {
      return;
    }

    for (var i = 0; i < MIGRATION_ARRAY_KEYS.length; i++) {
      try {
        var raw = localStorage.getItem(MIGRATION_ARRAY_KEYS[i]);
        var parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) continue;

        var changed = false;
        for (var j = 0; j < parsed.length; j++) {
          if (parsed[j] && parsed[j].userId === legacyId) {
            parsed[j].userId = stableId;
            changed = true;
          }
        }

        if (changed) {
          localStorage.setItem(MIGRATION_ARRAY_KEYS[i], JSON.stringify(parsed));
        }
      } catch (e) {}
    }

    for (var k = 0; k < MIGRATION_SCOPED_KEYS.length; k++) {
      var oldKey = MIGRATION_SCOPED_KEYS[k] + "__user_" + legacyId;
      var newKey = MIGRATION_SCOPED_KEYS[k] + "__user_" + stableId;
      var legacyValue = localStorage.getItem(oldKey);

      if (legacyValue && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, legacyValue);
      }

      localStorage.removeItem(oldKey);
    }

    rememberOwnerAlias(legacyId, stableId);
  }

  function migrateCurrentUserOwnership() {
    var stableId = getCurrentUserId();
    var rawUserId = authState.user && authState.user.id ? authState.user.id : null;

    if (!stableId) {
      return;
    }

    rememberOwnerAlias(rawUserId, stableId);

    if (rawUserId && rawUserId !== stableId) {
      migrateLegacyOwnerRecords(rawUserId, stableId);
      return;
    }

    var hasStableRecords = false;
    for (var i = 0; i < MIGRATION_ARRAY_KEYS.length; i++) {
      if (getOwnedRecordCount(MIGRATION_ARRAY_KEYS[i], stableId) > 0) {
        hasStableRecords = true;
        break;
      }
    }

    if (hasStableRecords) {
      return;
    }

    var legacyId = findSingleLegacyOwnerId(stableId);
    if (legacyId) {
      migrateLegacyOwnerRecords(legacyId, stableId);
    }
  }

  function buildCurrentUserStorageSnapshot() {
    var arrays = {};
    var scoped = {};

    for (var i = 0; i < MIGRATION_ARRAY_KEYS.length; i++) {
      arrays[MIGRATION_ARRAY_KEYS[i]] = readOwnedArray(MIGRATION_ARRAY_KEYS[i]);
    }

    for (var j = 0; j < MIGRATION_SCOPED_KEYS.length; j++) {
      scoped[MIGRATION_SCOPED_KEYS[j]] = readScopedObject(MIGRATION_SCOPED_KEYS[j]);
    }

    return {
      arrays: arrays,
      scoped: scoped
    };
  }

  function hasMeaningfulStorageData(snapshot) {
    if (!snapshot || typeof snapshot !== "object") {
      return false;
    }

    var arrays = snapshot.arrays && typeof snapshot.arrays === "object" ? snapshot.arrays : {};
    var scoped = snapshot.scoped && typeof snapshot.scoped === "object" ? snapshot.scoped : {};

    for (var arrayKey in arrays) {
      if (Object.prototype.hasOwnProperty.call(arrays, arrayKey) && Array.isArray(arrays[arrayKey]) && arrays[arrayKey].length > 0) {
        return true;
      }
    }

    for (var scopedKey in scoped) {
      if (
        Object.prototype.hasOwnProperty.call(scoped, scopedKey) &&
        scoped[scopedKey] &&
        typeof scoped[scopedKey] === "object" &&
        Object.keys(scoped[scopedKey]).length > 0
      ) {
        return true;
      }
    }

    return false;
  }

  function applyServerStorageSnapshot(snapshot) {
    var arrays = snapshot && snapshot.arrays && typeof snapshot.arrays === "object" ? snapshot.arrays : {};
    var scoped = snapshot && snapshot.scoped && typeof snapshot.scoped === "object" ? snapshot.scoped : {};

    for (var i = 0; i < MIGRATION_ARRAY_KEYS.length; i++) {
      var arrayKey = MIGRATION_ARRAY_KEYS[i];
      writeOwnedArrayLocal(arrayKey, Array.isArray(arrays[arrayKey]) ? arrays[arrayKey] : []);
    }

    for (var j = 0; j < MIGRATION_SCOPED_KEYS.length; j++) {
      var scopedKey = MIGRATION_SCOPED_KEYS[j];
      writeScopedObjectLocal(scopedKey, scoped[scopedKey] && typeof scoped[scopedKey] === "object" ? scoped[scopedKey] : {});
    }
  }

  function pushCurrentUserStorageSnapshot() {
    if (!shouldSyncWithServer()) {
      return Promise.resolve(null);
    }

    return apiFetch(USER_STORAGE_SYNC_URL, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildCurrentUserStorageSnapshot())
    })
      .then(function(response) {
        if (!response.ok) {
          return null;
        }

        return response.json();
      })
      .catch(function() {
        return null;
      });
  }

  function scheduleServerSync() {
    if (!shouldSyncWithServer()) {
      return;
    }

    if (pendingSyncTimeout) {
      global.clearTimeout(pendingSyncTimeout);
    }

    pendingSyncTimeout = global.setTimeout(function() {
      pendingSyncTimeout = null;
      pushCurrentUserStorageSnapshot();
    }, 80);
  }

  function hydrateCurrentUserStorage() {
    if (!shouldSyncWithServer()) {
      return Promise.resolve(null);
    }

    var localSnapshot = buildCurrentUserStorageSnapshot();

    return apiFetch(USER_STORAGE_SYNC_URL)
      .then(function(response) {
        if (!response.ok) {
          return { storage: null };
        }

        return response.json();
      })
      .then(function(payload) {
        var remoteSnapshot = payload && payload.storage ? payload.storage : null;

        if (hasMeaningfulStorageData(remoteSnapshot)) {
          applyServerStorageSnapshot(remoteSnapshot);
          return remoteSnapshot;
        }

        if (hasMeaningfulStorageData(localSnapshot)) {
          return pushCurrentUserStorageSnapshot();
        }

        return remoteSnapshot;
      })
      .catch(function() {
        return null;
      });
  }

  function notifyReady() {
    global.dispatchEvent(new CustomEvent("actionflow-auth-ready", {
      detail: { user: authState.user }
    }));
  }

  function loadCurrentUser() {
    return apiFetch("/auth/me")
      .then(function(response) {
        if (!response.ok) {
          return { user: null };
        }
        return response.json();
      })
      .then(function(payload) {
        authState.user = payload && payload.user ? payload.user : null;
        authState.loaded = true;
        migrateCurrentUserOwnership();
        return hydrateCurrentUserStorage().then(function() {
          notifyReady();
          return authState.user;
        });
      })
      .catch(function() {
        authState.user = null;
        authState.loaded = true;
        notifyReady();
        return null;
      });
  }

  global.ActionFlowAuth = {
    attachUserId: attachUserId,
    clearOwnedArray: clearOwnedArray,
    clearScopedObject: clearScopedObject,
    getCurrentUser: getCurrentUser,
    getCurrentUserId: getCurrentUserId,
    getScopedStorageKey: getScopedStorageKey,
    isLoaded: function() {
      return authState.loaded;
    },
    loadCurrentUser: loadCurrentUser,
    readOwnedArray: readOwnedArray,
    readScopedObject: readScopedObject,
    writeOwnedArray: writeOwnedArray,
    writeScopedObject: writeScopedObject
  };

  global.ActionFlowApi = {
    API_BASE_URL: API_BASE_URL,
    apiFetch: apiFetch,
    buildApiUrl: buildApiUrl,
    getFetchCredentials: getFetchCredentials,
    isCapacitorRuntime: isCapacitorRuntime,
    navigateToBackend: navigateToBackend
  };

  if (global.document && global.document.readyState === "loading") {
    global.document.addEventListener("DOMContentLoaded", updateBackendLinks);
  } else {
    updateBackendLinks();
  }

  loadCurrentUser();
})(window);
