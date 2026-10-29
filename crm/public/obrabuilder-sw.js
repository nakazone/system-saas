/**
 * ObraBuilder — service worker for the builder app (scope /partner). Network first; the app
 * shell is kept for a quick start and an offline message. API calls are never cached.
 */
const CACHE = 'obrabuilder-v3';
const SHELL = ['/partner-portal.html', '/partner-login.html', '/obrabuilder.webmanifest', '/assets/obrabuilder/icon-192.png?v=2'];

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

// Push from ObraBuilder: a company accepted, scheduled, started, shared photos or finished a job.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'ObraBuilder', body: e.data ? e.data.text() : '' }; }
  const icon = typeof d.icon === 'string' && d.icon.startsWith('/assets/') ? d.icon : '/assets/obrabuilder/icon-192.png?v=2';
  e.waitUntil(self.registration.showNotification(d.title || 'ObraBuilder', {
    body: d.body || '',
    icon,
    badge: '/assets/obrabuilder/icon-192.png?v=2',
    tag: d.tag || 'obrabuilder',
    renotify: true,
    data: { url: typeof d.url === 'string' && d.url.startsWith('/partner') ? d.url : '/partner-portal.html#notifications' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/partner-portal.html#notifications';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).pathname.startsWith('/partner-portal'));
    if (open) { open.focus(); return open.navigate(url).catch(() => open); }
    return self.clients.openWindow(url);
  }));
});
