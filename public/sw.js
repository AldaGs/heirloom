// Network-first for same-origin GETs, cache as fallback: always fresh online, works offline after one visit.
// The ONNX runtime goes to its own cache so Settings can remove it without touching the app.
// Models come from Hugging Face (cross-origin, so not handled here): the app's loadModel() caches them in that same bucket.
const CACHE = 'heirloom-v2', AI = 'heirloom-ai';
const isAi = p => /\/ort[-.].*\.(wasm|mjs)$/.test(p);
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE && k !== AI) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
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
