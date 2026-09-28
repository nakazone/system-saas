/**
 * Campo media queue — IndexedDB offline uploads for job photos.
 */
(function (global) {
  const DB_NAME = "om_campo_media_v1";
  const STORE = "pending";
  const VER = "20260928-media1";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      Promise.resolve(fn(store))
        .then((v) => {
          tx.oncomplete = () => resolve(v);
          tx.onerror = () => reject(tx.error);
        })
        .catch(reject);
    });
  }

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `u-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function enqueue(item) {
    const row = {
      id: item.id || uuid(),
      jobId: item.jobId,
      dataUrl: item.dataUrl,
      stage: item.stage || null,
      caption: item.caption || null,
      takenAtDevice: item.takenAtDevice || new Date().toISOString(),
      lat: item.lat ?? null,
      lng: item.lng ?? null,
      gpsAccuracyM: item.gpsAccuracyM ?? null,
      address: item.address || null,
      deviceLabel: item.deviceLabel || null,
      isPublic: Boolean(item.isPublic),
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    await withStore("readwrite", (store) => store.put(row));
    notify();
    return row;
  }

  async function list() {
    return withStore("readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function remove(id) {
    await withStore("readwrite", (store) => store.delete(id));
    notify();
  }

  async function countForJob(jobId) {
    const all = await list();
    return all.filter((r) => r.jobId === jobId).length;
  }

  async function flush(jobId, postFn) {
    const all = await list();
    const mine = all.filter((r) => !jobId || r.jobId === jobId);
    const results = [];
    for (const row of mine) {
      try {
        const data = await postFn(row);
        await remove(row.id);
        results.push({ id: row.id, ok: true, data });
      } catch (e) {
        row.attempts = (row.attempts || 0) + 1;
        row.lastError = e.message || "upload failed";
        await withStore("readwrite", (store) => store.put(row));
        results.push({ id: row.id, ok: false, error: row.lastError });
        notify();
        break; // stop on first failure (likely offline)
      }
    }
    notify();
    return results;
  }

  const listeners = new Set();
  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notify() {
    list().then((rows) => {
      listeners.forEach((fn) => {
        try {
          fn(rows);
        } catch (_) {}
      });
    });
  }

  global.__campoMediaQueue = {
    VER,
    enqueue,
    list,
    remove,
    countForJob,
    flush,
    onChange,
  };
})(typeof window !== "undefined" ? window : globalThis);
