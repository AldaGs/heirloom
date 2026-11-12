// Network-first for same-origin GETs, cache as fallback: always fresh online, works offline after one visit.
// AI files (models, ONNX runtime) go to their own cache so Settings can remove them without touching the app.
const CACHE = 'heirloom-v2', AI = 'heirloom-ai';
const isAi = p => p.startsWith('/models/') || /\/ort[-.].*\.(wasm|mjs)$/.test(p);
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k !== AI) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (u.pathname.startsWith('/models/')) return; // models: the app's loadModel() manages AI cache itself
  const name = isAi(u.pathname) ? AI : CACHE;
  e.respondWith(caches.open(name).then(async c => {
    if (name === AI) { const hit = await c.match(r); if (hit) return hit; } // AI runtime: cache-first, it's versioned
    try {
      const res = await fetch(r);
      if (res.ok) c.put(r, res.clone());
      return res;
    } catch {
      return (await c.match(r)) ?? (r.mode === 'navigate' ? await caches.open(CACHE).then(x => x.match('/')) : undefined) ?? Response.error();
    }
  }));
});
