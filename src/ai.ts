// Global AI switch (FIXER_IMPROVEMENTS §4/§8: AI is opt-in, on-device only, one switch turns all of it off).
// Every AI module must load its model through `loadModel`, so "off" guarantees no model is fetched or run.
const KEY = 'heirloom:ai';
const listeners = new Set<(on: boolean) => void>();

export function aiEnabled() { try { return localStorage.getItem(KEY) === 'true'; } catch { return false; } }

export function setAiEnabled(on: boolean) {
  try { localStorage.setItem(KEY, String(on)); } catch { /* stays off on reload */ }
  if (!on) models.clear(); // drop loaded models so nothing lingers in memory
  listeners.forEach(f => f(on));
}
export const onAiChange = (f: (on: boolean) => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

export class AiDisabledError extends Error { constructor() { super('AI features are turned off (Settings → AI)'); this.name = 'AiDisabledError'; } }

/** AI files live in their own Cache Storage bucket so "Remove downloaded AI data" can drop exactly them. */
export const AI_CACHE = 'heirloom-ai';
const models = new Map<string, Promise<ArrayBuffer>>();

/** Same-origin model files (fetched by `npm run fetch-models`, never from a third party at runtime). */
export const MODELS = {
  migan: { file: 'models/migan_pipeline_v2.onnx', name: 'MI-GAN 512 (Places2)', license: 'MIT — Picsart AI Research', module: 'remove' },
  nafnet: { file: 'models/nafnet_sidd_w32.onnx', name: 'NAFNet SIDD width32', license: 'MIT — Megvii Research', module: 'denoise' },
} as const;
export type ModelId = keyof typeof MODELS;

/** The only path to an AI model. Throws when AI is off; same-origin only, so nothing leaves the device. */
export function loadModel(path: string): Promise<ArrayBuffer> {
  if (!aiEnabled()) return Promise.reject(new AiDisabledError());
  if (/^[a-z]+:/i.test(path) && new URL(path).origin !== location.origin) return Promise.reject(new Error('AI models must be served from this app (on-device only)'));
  if (!models.has(path)) models.set(path, fetchCached(path).catch(e => { models.delete(path); throw e; }));
  return models.get(path)!;
}

async function fetchCached(path: string) {
  const c = typeof caches !== 'undefined' ? await caches.open(AI_CACHE).catch(() => undefined) : undefined;
  const hit = await c?.match(path);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(path);
  if (!r.ok) throw new Error(r.status === 404 ? 'model not installed on this server (run npm run fetch-models)' : `model ${path}: ${r.status}`);
  await c?.put(path, r.clone()).catch(() => { /* quota: still works, just not cached */ });
  return r.arrayBuffer();
}

export type StoredItem = { url: string; bytes: number };
/** What's in the AI cache (models + the AI runtime), with sizes. Works while AI is off, so space can always be freed. */
export async function storedAiData(): Promise<StoredItem[]> {
  if (typeof caches === 'undefined' || !(await caches.has(AI_CACHE))) return [];
  const c = await caches.open(AI_CACHE), out: StoredItem[] = [];
  for (const req of await c.keys()) {
    const r = await c.match(req);
    const n = +(r?.headers.get('content-length') ?? 0) || (r ? (await r.blob()).size : 0);
    out.push({ url: new URL(req.url).pathname, bytes: n });
  }
  return out;
}

/** Delete one item (path) or everything AI has downloaded; also drops in-memory copies. */
export async function removeAiData(path?: string) {
  if (typeof caches === 'undefined') return;
  if (!path) { models.clear(); await caches.delete(AI_CACHE); return; }
  for (const k of models.keys()) if (k.endsWith(path) || path.endsWith(k)) models.delete(k);
  const c = await caches.open(AI_CACHE);
  await c.delete(path);
}

/** Modules that will use the gate. Status is shown in Settings so users see exactly what the switch covers. */
export const AI_MODULES = [
  { id: 'mask', name: 'Masking', what: 'subject / sky selection' },
  { id: 'remove', name: 'Remove', what: 'object & spot removal' },
  { id: 'denoise', name: 'AI Denoise', what: 'noise reduction beyond the Detail panel' },
] as const;
