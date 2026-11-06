/**
 * ObraMate — service worker (static cache + Campo offline + Web Push).
 */
const CACHE = "om-static-v69";
const API_CACHE = "om-api-v1";
const BADGE_CACHE = "om-badge-v1";
const BADGE_URL = "/__om_app_badge_count";
const PRECACHE = [
  // Generated from the Campo pages and the assets the server injects (see src/crm/mount.ts).
  "/offline.html",
  "/om-shell.css?v=20261105-hammer1",
  "/om-shell.js?v=20261105-hammer1",
  // what offline.html itself shows
  "/manifest.json?v=20260930-native2",
  "/assets/favicon-192.png?v=20260924-pwa",
  "/assets/img/mascot/mate-sleeping.webp?v=20261027-m2",
  "/campo/agenda.html",
  "/assets/favicon-192.png?v=20260924-pwa",
  "/campo/campo.css?v=20261105-field1",
  "/om-device.js?v=20261013-badge1",
  "/om-stable-viewport.css?v=20261007-stable1",
  "/assets/obracrew/apple-touch-icon.png?v=1",
  "/om-offline.js?v=20261105-apps3",
  "/campo/campo-data.js?v=20261105-crew-phases1",
  "/campo/campo-gate.js?v=20260925-campo3",
  "/campo/campo-nav.js?v=20261105-crewcam1",
  "/campo/agenda.js?v=20261105-crew-prod1",
  "/mate-panel.css?v=20261027-m2",
  "/mate-panel.js?v=20261104-ux2",
  "/campo/hoje.html",
  "/campo/dia.css?v=20261105-home1",
  "/photo-exif.js?v=20261104-exif1",
  "/campo/campo-photo.js?v=20261105-apps3",
  "/campo/campo-media-queue.js?v=20261104-exif1",
  "/campo/dia.js?v=20261105-field2",
  "/campo/horas.html",
  "/campo/horas.js?v=20261105-field1",
  "/campo/index.html",
  "/campo/stain.html",
  "/campo/stain.css?v=20261105-shell9",
  "/campo/stain.js?v=20261105-field1",
  "/campo/ticket.html",
  "/crm-toast.css?v=20261105-apps3",
  "/crm-toast.js?v=20261104-ux2",
  "/campo/ticket.js?v=20261105-crew-prod1",
  "/om-tokens.css?v=20261105-apps3",
  "/om-ui.css?v=20261105-apps3",
  "/om-ui.js?v=20261105-apps3",
  "/om-theme.css?v=20261105-shell9",
  "/saas-branding.js?v=20261104-crew1",
  "/crm-confirm.css?v=20261105-apps3",
  "/crm-confirm.js?v=20261105-apps3",
  "/crm-skeleton.js?v=20261104-ux2",
];

function isApiGet(url) {
  return url.pathname.startsWith("/api/campo/") || url.pathname === "/api/auth/session";
}

function isNavRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html");
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // One by one: a single missing file used to make addAll fail and leave nothing precached.
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u)))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Lets the page request start while the worker boots, so it no longer delays every navigation.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (_) {}
      }
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE && k !== API_CACHE && k !== BADGE_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

/** fetch() that gives up after `ms`, so a weak signal falls back to the cache instead of hanging. */
function fetchWithin(request, ms, preload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    Promise.resolve(preload)
      .then((pre) => pre || fetch(request))
      .then(
        (res) => {
          clearTimeout(timer);
          resolve(res);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
  });
}

/** Keeps one copy per asset path: a new ?v= replaces the old ones, so the cache no longer grows forever. */
async function putVersioned(request, res) {
  const cache = await caches.open(CACHE);
  const url = new URL(request.url);
  const old = await cache.keys();
  await Promise.all(
    old
      .filter((r) => {
        const u = new URL(r.url);
        return u.pathname === url.pathname && u.search !== url.search;
      })
      .map((r) => cache.delete(r)),
  );
  await cache.put(request, res);
}

const STATIC_RE = /\.(css|js|mjs|png|jpe?g|svg|webp|ico|woff2?)$/i;
// Only the field app needs its pages offline; other HTML is per-user (no-store) and is not kept.
const OFFLINE_PAGE_RE = /^\/campo\//;

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML: network first (with the preloaded response), offline copy only for Campo pages.
  if (isNavRequest(event.request)) {
    const keep = OFFLINE_PAGE_RE.test(url.pathname);
    event.respondWith(
      (async () => {
        try {
          const res = await fetchWithin(event.request, keep ? 6000 : 30000, event.preloadResponse);
          if (keep && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        } catch (_) {
          return (keep && (await caches.match(event.request))) || (await caches.match("/offline.html")) || Response.error();
        }
      })(),
    );
    return;
  }

  // Campo / session API: network first, but a weak signal falls back to the last copy after 6s.
  if (isApiGet(url)) {
    event.respondWith(
      fetchWithin(event.request, 6000)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(API_CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.open(API_CACHE).then((c) => c.match(event.request)).then((r) => r || Response.error())),
    );
    return;
  }

  if (!STATIC_RE.test(url.pathname)) return;

  // Versioned assets (?v=) never change: cache first, no network at all once stored.
  if (url.searchParams.has("v")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) =>
          hit ||
          fetch(event.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              event.waitUntil(putVersioned(event.request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Unversioned assets can change at any time: network first, cached copy when offline or too slow.
  event.respondWith(
    fetchWithin(event.request, 8000)
      .then((res) => {
        const copy = res.clone();
        if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || Response.error())),
  );
});

/** Persist unread count for iOS Home Screen app-icon badge (Badging API). */
async function readBadgeCount() {
  try {
    const cache = await caches.open(BADGE_CACHE);
    const res = await cache.match(BADGE_URL);
    if (!res) return 0;
    const j = await res.json();
    return Math.max(0, Number(j.count) || 0);
  } catch (_) {
    return 0;
  }
}

async function writeBadgeCount(n) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  try {
    const cache = await caches.open(BADGE_CACHE);
    await cache.put(
      BADGE_URL,
      new Response(JSON.stringify({ count }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch (_) {
    /* ignore */
  }
  try {
    if (count > 0 && self.navigator && typeof self.navigator.setAppBadge === "function") {
      await self.navigator.setAppBadge(count);
    } else if (self.navigator && typeof self.navigator.clearAppBadge === "function") {
      await self.navigator.clearAppBadge();
    }
  } catch (_) {
    /* ignore — API only on installed PWAs with notification permission */
  }
  return count;
}

async function bumpAppBadge(explicit) {
  if (explicit != null && Number(explicit) >= 0) {
    return writeBadgeCount(explicit);
  }
  const next = (await readBadgeCount()) + 1;
  return writeBadgeCount(next);
}

async function clearAppBadge() {
  return writeBadgeCount(0);
}

self.addEventListener("push", (event) => {
  let data = {
    title: "ObraMate",
    body: "Nova atualização",
    url: "/home.html",
    tag: "obramate",
  };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (_) {
    try {
      const text = event.data && event.data.text();
      if (text) data.body = text;
    } catch (_) {}
  }

  const unread =
    data.unreadCount != null
      ? Number(data.unreadCount)
      : data.badgeCount != null
        ? Number(data.badgeCount)
        : null;

  event.waitUntil(
    Promise.all([
      bumpAppBadge(Number.isFinite(unread) && unread >= 0 ? unread : null),
      self.registration.showNotification(data.title || "ObraMate", {
        body: data.body || "",
        // Alerts the Mate sends carry his face; only same-origin /assets/ paths are accepted.
        icon: typeof data.icon === "string" && /^\/assets\/[\w./?=-]+$/.test(data.icon) ? data.icon : "/assets/favicon-192.png?v=20260924-pwa",
        badge: "/assets/favicon-192.png?v=20260924-pwa",
        tag: data.tag || "obramate",
        renotify: true,
        data: { url: data.url || "/home.html" },
      }),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({ type: "om-push", title: data.title, body: data.body, url: data.url });
        });
      }),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/home.html";
  const url = new URL(raw, self.location.origin).href;

  event.waitUntil(
    Promise.all([
      clearAppBadge(),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin) && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return undefined;
      }),
    ]),
  );
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "CLEAR_APP_BADGE" || type === "om-clear-app-badge") {
    event.waitUntil(clearAppBadge());
  }
});
