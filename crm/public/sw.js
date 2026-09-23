/**
 * Senior Floors / ObraMate — service worker (cache + Web Push).
 */
const CACHE = 'sf-static-v32';
const PRECACHE = [
  '/dashboard.html',
  '/styles.css',
  '/design-system.css',
  '/mobile-design-system.css',
  '/manifest.json',
  '/crm-shell.css',
  '/crm-pwa-install.css',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && /\.(css|png|jpg|svg|woff2?)$/i.test(url.pathname)) {
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || Promise.reject()))
  );
});

self.addEventListener('push', (event) => {
  let data = {
    title: 'ObraMate',
    body: 'Nova atualização',
    url: '/dashboard.html',
    tag: 'obramate',
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
    self.registration.showNotification(data.title || 'ObraMate', {
      body: data.body || '',
      icon: '/assets/obramate-logo.png',
      badge: '/assets/obramate-logo.png',
      tag: data.tag || 'obramate',
      renotify: true,
      data: { url: data.url || '/dashboard.html' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/dashboard.html';
  const url = new URL(raw, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    })
  );
});
