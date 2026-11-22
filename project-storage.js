(function () {
  'use strict';

  const STORAGE_KEY = 'mosaic-planner.project.v1';
  const DATABASE_MARKER = 'stored-in-indexeddb';
  const DATABASE = 'mosaic-planner';
  const STORE = 'projects';
  const CURRENT = 'current';
  const LOCAL_IMAGE_LIMIT = 1500000;
  let databasePromise;
  let latestSave = 0;

  function openDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Paikallinen kuvatallennus on varattu.'));
        request.onsuccess = () => {
          const database = request.result;
          database.onversionchange = () => {
            database.close();
            databasePromise = undefined;
          };
          resolve(database);
        };
      }).catch(error => {
        databasePromise = undefined;
        throw error;
      });
    }
    return databasePromise;
  }

  async function storedProject(mode, snapshot) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const store = transaction.objectStore(STORE);
      const request = mode === 'readonly' ? store.get(CURRENT) : store.put(snapshot, CURRENT);
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || new Error('Työn paikallinen tallennus keskeytyi.'));
    });
  }

  function localProject() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  async function load() {
    const local = localProject();
    if (local && local !== DATABASE_MARKER) return JSON.parse(local);
    try {
      return await storedProject('readonly');
    } catch (error) {
      if (local === DATABASE_MARKER) throw error;
      return null;
    }
  }

  async function save(project) {
    const revision = ++latestSave;
    const referenceSize = project.references.reduce((sum, reference) => sum + reference.source.length, 0);
    if (referenceSize <= LOCAL_IMAGE_LIMIT) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
        return;
      } catch {
        // A larger browser store is available when the local storage quota is full.
      }
    }

    try {
      await storedProject('readwrite', project);
      if (revision !== latestSave) return;
      try {
        localStorage.setItem(STORAGE_KEY, DATABASE_MARKER);
      } catch (error) {
        const previous = localProject();
        if (previous && previous !== DATABASE_MARKER) throw error;
      }
    } catch {
      if (revision === latestSave) localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    }
  }

  window.MosaicStorage = { load, save };
}());
