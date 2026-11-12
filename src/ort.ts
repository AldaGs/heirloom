import { loadModel } from './ai.ts';

// Shared ONNX Runtime Web loader for every AI module. Runtime is lazy-imported and bundled same-origin.
type Ort = typeof import('onnxruntime-web/webgpu');
export type Session = import('onnxruntime-web/webgpu').InferenceSession;
const sessions = new Map<string, Promise<{ ort: Ort; s: Session; gpu: boolean }>>();

export async function hasWebGpu() {
  const g = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  return !!g && !!(await g.requestAdapter().catch(() => null));
}

export async function session(file: string) {
  // Model first: loadModel() refuses while AI is off, so the runtime isn't even downloaded then.
  const model = await loadModel(file);
  if (!sessions.has(file)) sessions.set(file, (async () => {
    const ort = await import('onnxruntime-web/webgpu');
    const gpu = await hasWebGpu();
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    // CPU path: run inference in ORT's own worker so the UI never freezes (WebGPU already runs off the main thread)
    if (!gpu) ort.env.wasm.proxy = true;
    const s = await ort.InferenceSession.create(model, { executionProviders: gpu ? ['webgpu', 'wasm'] : ['wasm'] });
    return { ort, s, gpu };
  })().catch(e => { sessions.delete(file); throw e; }));
  return sessions.get(file)!;
}
/** Drop loaded sessions (AI switched off / data removed). */
export const unloadAll = () => sessions.clear();
