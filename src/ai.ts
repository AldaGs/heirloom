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

/** Models download straight from Hugging Face (never bundled into the deploy). Only model weights are fetched —
 *  photos never leave the device — and every file is sha256-checked before it's cached or run. */
const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
/** Repo with the models we convert ourselves (NAFNet, MobileSAM: scripts/convert_*.py). Override with VITE_HF_MODELS_REPO. */
export const MODELS_REPO = env?.VITE_HF_MODELS_REPO || 'AldaGs/heirloom-models';
const hf = (repo: string, rev: string, file: string) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
export type Model = { file: string; url: string; sha256: string; name: string; license: string; licenseUrl: string; module: string };
const m = (repo: string, rev: string, file: string, sha256: string, name: string, license: string, licenseUrl: string, module: string): Model =>
  ({ file, url: hf(repo, rev, file), sha256, name, license, licenseUrl, module });
export const MODELS = {
  migan: m('andraniksargsyan/migan', '406830d0fa60666da0071c342ad2fbc8f30c5c64', 'migan_pipeline_v2.onnx', '6f1f3530a1a2324b19752018ce756088b07973cda8d7d890034ace5c8a48c40b',
    'MI-GAN 512 (Places2)', 'MIT — Picsart AI Research', 'https://raw.githubusercontent.com/Picsart-AI-Research/MI-GAN/main/LICENSE-WEIGHTS', 'remove'),
  nafnet: m(MODELS_REPO, 'main', 'nafnet_sidd_w32.onnx', '3c19cdf9639c1458ebdfa0b2d77a3a6d5652ee60e0c7c9d9437b5b26651792d1',
    'NAFNet SIDD width32', 'MIT — Megvii Research', 'https://github.com/megvii-research/NAFNet/blob/main/LICENSE', 'denoise'),
  samEnc: m(MODELS_REPO, 'main', 'mobilesam_encoder.onnx', '8c8c964f4bd5d850f9a4ee680d01fd3cccb667d04daaa7d14be878a214cdcee8',
    'MobileSAM encoder', 'Apache-2.0 — Chaoning Zhang et al.', 'https://github.com/ChaoningZhang/MobileSAM/blob/master/LICENSE', 'mask'),
  samDec: m(MODELS_REPO, 'main', 'mobilesam_decoder.onnx', 'ed3ed0820c26da1d744c5e5c3e858e9f80765e422fae03b9ecb5412b85ba0c32',
    'MobileSAM decoder', 'Apache-2.0 — Chaoning Zhang et al.', 'https://github.com/ChaoningZhang/MobileSAM/blob/master/LICENSE', 'mask'),
} satisfies Record<string, Model>;
export type ModelId = keyof typeof MODELS;
const MODEL_HOSTS = ['huggingface.co'];

/** The only path to an AI model. Throws when AI is off; only this app or Hugging Face, and the bytes must match `sha256`. */
export function loadModel(url: string, sha256?: string): Promise<ArrayBuffer> {
  if (!aiEnabled()) return Promise.reject(new AiDisabledError());
  if (/^[a-z]+:/i.test(url)) {
    const u = new URL(url);
    if (u.origin !== location.origin && !(u.protocol === 'https:' && MODEL_HOSTS.includes(u.hostname))) return Promise.reject(new Error('AI models must come from this app or Hugging Face (on-device only)'));
  }
  if (!models.has(url)) models.set(url, fetchCached(url, sha256).catch(e => { models.delete(url); throw e; }));
  return models.get(url)!;
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
async function fetchCached(url: string, sha256?: string) {
  const c = typeof caches !== 'undefined' ? await caches.open(AI_CACHE).catch(() => undefined) : undefined;
  const hit = await c?.match(url);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(url).catch(() => { throw new Error('couldn\'t download the model (offline, or Hugging Face unreachable)'); });
  if (!r.ok) throw new Error(r.status === 404 ? 'model not found on Hugging Face' : `model download failed: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  if (sha256 && hex(await crypto.subtle.digest('SHA-256', buf)) !== sha256) throw new Error('downloaded model failed its integrity check (sha256 mismatch)');
  await c?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream', 'content-length': String(buf.byteLength) } })).catch(() => { /* quota: still works, just not cached */ });
  return buf;
}

export type StoredItem = { url: string; bytes: number };
/** What's in the AI cache (models + the AI runtime), with sizes. Works while AI is off, so space can always be freed. */
export async function storedAiData(): Promise<StoredItem[]> {
  if (typeof caches === 'undefined' || !(await caches.has(AI_CACHE))) return [];
  const c = await caches.open(AI_CACHE), out: StoredItem[] = [];
  for (const req of await c.keys()) {
    const r = await c.match(req);
    const n = +(r?.headers.get('content-length') ?? 0) || (r ? (await r.blob()).size : 0);
    out.push({ url: req.url, bytes: n });
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

/** Can this model be downloaded? (HEAD only, nothing downloaded; Hugging Face reports the file's sha256 as X-Linked-ETag.) */
export async function modelAvailable(mdl: Model) {
  const r = await fetch(mdl.url, { method: 'HEAD' }).catch(() => null);
  if (!r?.ok) return false;
  const tag = r.headers.get('x-linked-etag')?.replace(/"/g, '');
  return !tag || tag === mdl.sha256;
}

/** Modules that will use the gate. Status is shown in Settings so users see exactly what the switch covers. */
export const AI_MODULES = [
  { id: 'mask', name: 'Select subject', what: 'Masking: click any object or the sky to mask it (gradients and brush work without AI)' },
  { id: 'remove', name: 'Remove', what: 'object & spot removal' },
  { id: 'denoise', name: 'AI Denoise', what: 'noise reduction beyond the Detail panel' },
] as const;
