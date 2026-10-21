'use strict';

// Scramjet's service worker opens "$scramjet" v1 without an upgrade handler. If it
// runs before ScramjetController.init(), it creates an empty v1 database and the
// controller's upgrade never fires, leaving the required object stores missing.
// This helper guarantees the database exists at v1 with every store Scramjet uses.
(function (scope) {
  const DB_NAME = '$scramjet';
  const DB_VERSION = 1;
  const STORES = ['config', 'cookies', 'redirectTrackers', 'referrerPolicies', 'publicSuffixList'];

  function openWithStores() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of STORES) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const healthy = db.version === DB_VERSION && STORES.every((store) => db.objectStoreNames.contains(store));
        db.close();
        resolve(healthy);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Scramjet storage is blocked by another open tab.'));
    });
  }

  function deleteDatabase(onBlocked) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => { if (onBlocked) onBlocked(); };
    });
  }

  async function ensureScramjetDB(options = {}) {
    let healthy = false;
    try {
      healthy = await openWithStores();
    } catch (error) {
      if (!(error && error.name === 'VersionError')) throw error;
    }
    if (healthy) return;
    if (options.beforeRepair) await options.beforeRepair();
    await deleteDatabase(options.onBlocked);
    if (!(await openWithStores())) throw new Error('Scramjet storage could not be initialised.');
  }

  scope.ensureScramjetDB = ensureScramjetDB;
})(typeof self !== 'undefined' ? self : window);
