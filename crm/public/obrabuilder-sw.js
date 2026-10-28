/**
 * ObraBuilder — service worker for the builder app (scope /partner). Network first; the app
 * shell is kept for a quick start and an offline message. API calls are never cached.
 */
const CACHE = 'obrabuilder-v1';
const SHELL = ['/partner-portal.html', '/partner-login.html', '/obrabuilder.webmanifest', '/assets/obrabuilder/icon-192.png?v=1'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('obrabuilder-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && (req.mode === 'navigate' || /\.(css|js|png|webp|svg)$/.test(url.pathname))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(async () => {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      if (req.mode === 'navigate') return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:40px;text-align:center;color:#221E1A"><h1>You are offline</h1><p>ObraBuilder needs a connection. Try again in a moment.</p></body>', { headers: { 'Content-Type': 'text/html' } });
      return Response.error();
    }),
  );
});
