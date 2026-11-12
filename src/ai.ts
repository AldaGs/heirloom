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

const models = new Map<string, Promise<ArrayBuffer>>();
/** The only path to an AI model. Throws when AI is off; same-origin only, so nothing leaves the device. */
export function loadModel(path: string): Promise<ArrayBuffer> {
  if (!aiEnabled()) return Promise.reject(new AiDisabledError());
  if (/^[a-z]+:/i.test(path) && new URL(path).origin !== location.origin) return Promise.reject(new Error('AI models must be served from this app (on-device only)'));
  if (!models.has(path)) models.set(path, fetch(path).then(r => { if (!r.ok) throw new Error(`model ${path}: ${r.status}`); return r.arrayBuffer(); }).catch(e => { models.delete(path); throw e; }));
  return models.get(path)!;
}

/** Modules that will use the gate. Status is shown in Settings so users see exactly what the switch covers. */
export const AI_MODULES = [
  { id: 'mask', name: 'Masking', what: 'subject / sky selection' },
  { id: 'remove', name: 'Remove', what: 'object & spot removal' },
  { id: 'denoise', name: 'AI Denoise', what: 'noise reduction beyond the Detail panel' },
] as const;
