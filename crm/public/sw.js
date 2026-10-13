/**
 * ObraMate — service worker (static cache + Campo offline + Web Push).
 */
const CACHE = "om-static-v59";
const API_CACHE = "om-api-v1";
const PRECACHE = [
  "/offline.html",
  "/home.html",
  "/mais.html",
  "/dashboard.html",
  "/campo/hoje.html",
  "/campo/agenda.html",
  "/campo/horas.html",
  "/campo/ticket.html",
  "/campo/campo.css?v=20261008-modulos1",
  "/campo/dia.css?v=20261008-modulos1",
  "/campo/campo-nav.js?v=20261013-off1",
  "/campo/campo-media-queue.js?v=20260928-media1",
  "/campo/dia.js?v=20261013-off1",
  "/campo/agenda.js?v=20261013-off1",
  "/campo/horas.js?v=20261013-off1",
  "/campo/ticket.js?v=20261013-off1",
  "/om-offline.js?v=20261013-off1",
  "/om-device.js?v=20261013-login1",
  "/styles.css",
  "/design-system.css",
  "/mobile-design-system.css",
  "/om-mobile-nav.css",
  "/om-native-app.css",
  "/obramate-app.css",
  "/manifest.json?v=20260930-native2",
  "/assets/favicon-192.png?v=20260924-pwa",
  "/crm-shell.css",
  "/crm-pwa-install.css",
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
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE && k !== API_CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // HTML navigations: network-first, offline shell fallback.
  if (isNavRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() =>
          caches.match(event.request).then((r) => r || caches.match("/offline.html")),
        ),
    );
    return;
  }

  // Campo / session API: network-first, cache for offline.
  if (isApiGet(url)) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(API_CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.open(API_CACHE).then((c) => c.match(event.request)).then((r) => r || Promise.reject())),
    );
    return;
  }

  // Static assets: network-first with cache put.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && /\.(css|js|png|jpg|svg|woff2?)$/i.test(url.pathname)) {
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || Promise.reject())),
  );
});

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

  event.waitUntil(
    self.registration.showNotification(data.title || "ObraMate", {
      body: data.body || "",
      icon: "/assets/favicon-192.png?v=20260924-pwa",
      badge: "/assets/favicon-192.png?v=20260924-pwa",
      tag: data.tag || "obramate",
      renotify: true,
      data: { url: data.url || "/home.html" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/home.html";
  const url = new URL(raw, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
