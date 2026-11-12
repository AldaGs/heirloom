// Run: node src/ai.test.ts
import assert from 'node:assert/strict';
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) };
(globalThis as any).location = { origin: 'https://app.test' };
let fetched = 0; (globalThis as any).fetch = async () => { fetched++; return { ok: true, clone() { return this; }, arrayBuffer: async () => new ArrayBuffer(4) }; };
const { aiEnabled, setAiEnabled, loadModel, onAiChange } = await import('./ai.ts');

assert.equal(aiEnabled(), false, 'off by default');
await assert.rejects(loadModel('/models/m.onnx'), /turned off/);
assert.equal(fetched, 0, 'no download while off');
let seen: boolean | undefined; const off = onAiChange(on => { seen = on; });
setAiEnabled(true); assert.equal(seen, true); off();
assert.equal((await loadModel('/models/m.onnx')).byteLength, 4);
await assert.rejects(loadModel('https://evil.test/m.onnx'), /on-device/);
setAiEnabled(false); await assert.rejects(loadModel('/models/m.onnx'), /turned off/);
console.log('ai ok');
