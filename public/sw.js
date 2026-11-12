// Network-first for same-origin GETs, cache as fallback: always fresh online, works offline after one visit.
const CACHE = 'heirloom-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async c => {
    try {
      const res = await fetch(r);
      if (res.ok) c.put(r, res.clone());
      return res;
    } catch {
      return (await c.match(r)) ?? (r.mode === 'navigate' ? await c.match('/') : undefined) ?? Response.error();
    }
  }));
});
