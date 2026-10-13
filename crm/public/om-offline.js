/**
 * ObraMate offline mode — IndexedDB cache for Campo (dia, agenda, tickets) + mutation queue.
 * Network-first when online; serve last snapshot when offline. Syncs on reconnect.
 *
 * window.OmOffline = { api, warm, flush, pendingCount, isOnline, onChange, mountBanner, registerSw }
 */
(function (global) {
  "use strict";
  if (global.OmOffline) return;

  const VER = "20261013-off1";
  const DB_NAME = "om_offline_v1";
  const DB_VER = 1;
  const STORE_CACHE = "snapshots";
  const STORE_QUEUE = "mutations";
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  const listeners = new Set();
  let bannerEl = null;
  let flushing = false;

  function isOnline() {
    return typeof navigator !== "undefined" ? navigator.onLine !== false : true;
  }

  function notify() {
    const payload = { online: isOnline(), pending: 0 };
    pendingCount()
      .then((n) => {
        payload.pending = n;
        listeners.forEach((fn) => {
          try {
            fn(payload);
          } catch (_) {}
        });
        syncBanner(payload);
      })
      .catch(() => syncBanner(payload));
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: "key" });
        }
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB offline open failed"));
    });
  }

  async function withStore(storeName, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      Promise.resolve(fn(store))
        .then((v) => {
          tx.oncomplete = () => resolve(v);
          tx.onerror = () => reject(tx.error);
        })
        .catch(reject);
    });
  }

  function cacheKey(url) {
    try {
      const u = new URL(url, location.origin);
      return u.pathname + u.search;
    } catch (_) {
      return String(url || "");
    }
  }

  function shouldCacheGet(url) {
    const key = cacheKey(url);
    return (
      key.startsWith("/api/campo/") ||
      key === "/api/auth/session" ||
      key.startsWith("/api/work-orders/")
    );
  }

  function canQueueMutation(url, method) {
    const key = cacheKey(url);
    const m = String(method || "GET").toUpperCase();
    if (m === "GET" || m === "HEAD") return false;
    // Safe field actions that can replay later (POST/PATCH/PUT).
    if (/\/api\/campo\/jobs\/[^/]+\/(field-status|checklist|problem|photos|measurements|inspections)(\/|$)/.test(key)) {
      return true;
    }
    if (/\/api\/work-orders\/[^/]+$/.test(key) && m === "PUT") return true;
    return false;
  }

  async function putSnapshot(url, json) {
    const key = cacheKey(url);
    const row = {
      key,
      json,
      savedAt: Date.now(),
      url: key,
    };
    await withStore(STORE_CACHE, "readwrite", (store) => store.put(row));
  }

  async function getSnapshot(url) {
    const key = cacheKey(url);
    const row = await withStore(STORE_CACHE, "readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    });
    if (!row) return null;
    if (Date.now() - (row.savedAt || 0) > MAX_AGE_MS) return null;
    return row;
  }

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  async function enqueueMutation(item) {
    const row = {
      id: item.id || uuid(),
      url: item.url,
      method: String(item.method || "POST").toUpperCase(),
      body: item.body == null ? null : String(item.body),
      label: item.label || "Ação pendente",
      createdAt: new Date().toISOString(),
      attempts: 0,
      lastError: null,
    };
    await withStore(STORE_QUEUE, "readwrite", (store) => store.put(row));
    notify();
    return row;
  }

  async function listMutations() {
    return withStore(STORE_QUEUE, "readonly", (store) => {
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    });
  }

  async function removeMutation(id) {
    await withStore(STORE_QUEUE, "readwrite", (store) => store.delete(id));
    notify();
  }

  async function pendingCount() {
    const rows = await listMutations();
    let media = 0;
    try {
      if (global.__campoMediaQueue && typeof global.__campoMediaQueue.list === "function") {
        media = (await global.__campoMediaQueue.list()).length;
      }
    } catch (_) {}
    return rows.length + media;
  }

  /**
   * Fetch JSON with offline fallback.
   * opts: standard fetch opts + { dataOnly?: boolean, label?: string, allowQueue?: boolean }
   */
  async function api(url, opts) {
    const o = opts || {};
    const method = String(o.method || "GET").toUpperCase();
    const dataOnly = Boolean(o.dataOnly);
    const label = o.label || method + " " + cacheKey(url);
    const allowQueue = o.allowQueue !== false;
    const headers = { Accept: "application/json", ...(o.headers || {}) };
    if (method !== "GET" && method !== "HEAD" && !headers["Content-Type"] && o.body) {
      headers["Content-Type"] = "application/json";
    }

    const fetchOpts = {
      credentials: o.credentials || "include",
      headers,
      method,
      body: o.body,
    };

    if (!isOnline() && method !== "GET" && method !== "HEAD") {
      if (allowQueue && canQueueMutation(url, method)) {
        await enqueueMutation({ url: cacheKey(url), method, body: o.body, label });
        const queued = { success: true, queued: true, offline: true, message: "Guardado offline — envia ao reconectar." };
        if (dataOnly) return queued;
        return queued;
      }
      const err = new Error("Sem internet. Esta ação precisa de sinal.");
      err.offline = true;
      throw err;
    }

    try {
      const res = await fetch(url, fetchOpts);
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        if (!isOnline()) {
          const snap = await getSnapshot("/api/auth/session");
          if (snap && snap.json) {
            const out = { ...snap.json, fromCache: true, offline: true };
            return dataOnly ? out.data ?? out : out;
          }
        }
        location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.search);
        throw new Error("Sessão expirada");
      }
      if (res.ok && method === "GET" && shouldCacheGet(url)) {
        putSnapshot(url, json).catch(() => {});
      }
      if (!res.ok || json.success === false) {
        if (method === "GET" && shouldCacheGet(url)) {
          const snap = await getSnapshot(url);
          if (snap && snap.json) {
            const out = { ...snap.json, fromCache: true, offline: true, savedAt: snap.savedAt };
            if (dataOnly) {
              if (out.data !== undefined) {
                const d = out.data;
                if (d && typeof d === "object") d.__offline = { savedAt: snap.savedAt };
                return d;
              }
              return out;
            }
            return out;
          }
        }
        const err = new Error(json.error || `Erro ${res.status}`);
        err.code = json.code;
        err.data = json.data;
        err.status = res.status;
        throw err;
      }
      if (dataOnly) return json.data !== undefined ? json.data : json;
      return json;
    } catch (e) {
      if (e && e.status === 401) throw e;
      if (method === "GET" && shouldCacheGet(url)) {
        const snap = await getSnapshot(url);
        if (snap && snap.json) {
          const out = { ...snap.json, fromCache: true, offline: true, savedAt: snap.savedAt };
          if (dataOnly) {
            if (out.data !== undefined) {
              const d = out.data;
              if (d && typeof d === "object") d.__offline = { savedAt: snap.savedAt };
              return d;
            }
            return out;
          }
          return out;
        }
      }
      if (!isOnline() && method !== "GET" && allowQueue && canQueueMutation(url, method)) {
        await enqueueMutation({ url: cacheKey(url), method, body: o.body, label });
        const queued = { success: true, queued: true, offline: true, message: "Guardado offline — envia ao reconectar." };
        return dataOnly ? queued : queued;
      }
      throw e;
    }
  }

  /** Prefetch & cache a list of GET urls (best-effort). */
  async function warm(urls) {
    if (!isOnline()) return;
    const list = Array.isArray(urls) ? urls : [];
    await Promise.all(
      list.map(async (u) => {
        try {
          await api(u, { method: "GET" });
        } catch (_) {}
      }),
    );
  }

  async function flushMutations() {
    if (!isOnline() || flushing) return { ok: 0, fail: 0 };
    flushing = true;
    let ok = 0;
    let fail = 0;
    try {
      const rows = await listMutations();
      for (const row of rows) {
        try {
          const res = await fetch(row.url, {
            method: row.method,
            credentials: "include",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: row.body,
          });
          if (res.status === 401) break;
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await removeMutation(row.id);
          ok += 1;
        } catch (e) {
          row.attempts = (row.attempts || 0) + 1;
          row.lastError = (e && e.message) || "fail";
          await withStore(STORE_QUEUE, "readwrite", (store) => store.put(row));
          fail += 1;
          break;
        }
      }
      try {
        if (global.__campoMediaQueue && typeof global.__campoMediaQueue.flush === "function") {
          await global.__campoMediaQueue.flush(null, async (item) => {
            const res = await fetch(`/api/campo/jobs/${encodeURIComponent(item.jobId)}/photos`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({
                data_url: item.dataUrl,
                stage: item.stage,
                caption: item.caption,
                taken_at_device: item.takenAtDevice,
                lat: item.lat,
                lng: item.lng,
                gps_accuracy_m: item.gpsAccuracyM,
                address: item.address,
                device_label: item.deviceLabel,
                is_public: item.isPublic,
              }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || json.success === false) throw new Error(json.error || `HTTP ${res.status}`);
            return json.data;
          });
        }
      } catch (_) {}
    } finally {
      flushing = false;
      notify();
    }
    return { ok, fail };
  }

  function fmtWhen(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return "";
    }
  }

  function syncBanner(state) {
    if (!bannerEl || !document.body) return;
    const online = state.online !== false;
    const pending = state.pending || 0;
    if (online && !pending) {
      bannerEl.hidden = true;
      bannerEl.textContent = "";
      document.body.classList.remove("om-offline");
      return;
    }
    document.body.classList.toggle("om-offline", !online);
    bannerEl.hidden = false;
    if (!online) {
      bannerEl.className = "om-off-banner om-off-banner--down";
      bannerEl.textContent =
        pending > 0
          ? `Sem internet · ${pending} pendente${pending > 1 ? "s" : ""} (envia ao voltar)`
          : "Sem internet · a mostrar dados guardados";
    } else {
      bannerEl.className = "om-off-banner om-off-banner--sync";
      bannerEl.textContent = `A sincronizar ${pending} item${pending > 1 ? "s" : ""}…`;
    }
  }

  function mountBanner(parent) {
    if (bannerEl) return bannerEl;
    ensureCss();
    bannerEl = document.createElement("div");
    bannerEl.id = "omOffBanner";
    bannerEl.className = "om-off-banner";
    bannerEl.hidden = true;
    bannerEl.setAttribute("role", "status");
    const host = parent || document.body;
    if (host.firstChild) host.insertBefore(bannerEl, host.firstChild);
    else host.appendChild(bannerEl);
    notify();
    return bannerEl;
  }

  function ensureCss() {
    if (document.getElementById("om-offline-css")) return;
    const st = document.createElement("style");
    st.id = "om-offline-css";
    st.textContent = `
.om-off-banner{position:sticky;top:0;z-index:1300;padding:8px 14px;text-align:center;font:600 12.5px/1.35 "Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:-.01em}
.om-off-banner--down{background:#3D2A1A;color:#FDE8D0}
.om-off-banner--sync{background:#1F3A2A;color:#D8F3E2}
body.om-offline .cm-tabbar{padding-bottom:env(safe-area-inset-bottom,0)}
.om-off-note{margin:0 0 10px;padding:8px 12px;border-radius:12px;background:#FBF1EA;color:#7A3A12;font-size:12.5px;font-weight:600}
`;
    (document.head || document.documentElement).appendChild(st);
  }

  function registerSw() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  function boot() {
    registerSw();
    mountBanner();
    window.addEventListener("online", () => {
      notify();
      flushMutations().then((r) => {
        if (r.ok > 0 && typeof global.crmToast?.success === "function") {
          global.crmToast.success(
            r.ok === 1 ? "1 item sincronizado." : `${r.ok} itens sincronizados.`,
          );
        }
      });
    });
    window.addEventListener("offline", notify);
    if (isOnline()) setTimeout(() => flushMutations().catch(() => {}), 1200);
    notify();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  global.OmOffline = {
    VER,
    api,
    warm,
    flush: flushMutations,
    pendingCount,
    isOnline,
    onChange,
    mountBanner,
    registerSw,
    putSnapshot,
    getSnapshot,
    fmtWhen,
  };
})(typeof window !== "undefined" ? window : globalThis);
