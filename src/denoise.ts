import { MODELS } from './ai.ts';
import { session } from './ort.ts';
import { TILE, composePixel, keepRange, readTile, tileStarts } from './denoise-core.ts';

export type Progress = (done: number, total: number) => void;

/**
 * Denoise `base` (unedited image, 8-bit sRGB) tile by tile and blend into the retouch `layer` at `strength`.
 * `signal.aborted` stops between tiles (nothing is applied then).
 */
export async function denoise(base: ImageData, strength: number, layer: ImageData | undefined, onProgress: Progress, signal: AbortSignal) {
  const { width: w, height: h, data } = base;
  const { ort, s, gpu } = await session(MODELS.nafnet.file);
  const out = layer ? new Uint8ClampedArray(layer.data) : new Uint8ClampedArray(w * h * 4);
  const xs = tileStarts(w), ys = tileStarts(h), total = xs.length * ys.length, n = TILE * TILE;
  let done = 0;
  onProgress(0, total);
  for (const y0 of ys) for (const x0 of xs) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const r = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', readTile(data, w, h, x0, y0), [1, 3, TILE, TILE]) });
    const d = r[s.outputNames[0]].data as Float32Array;
    const [kx0, kx1] = keepRange(x0, w, TILE, undefined, xs), [ky0, ky1] = keepRange(y0, h, TILE, undefined, ys);
    for (let y = ky0; y < ky1; y++) for (let x = kx0; x < kx1; x++) {
      const o = (y - y0) * TILE + (x - x0), cl = (v: number) => Math.min(1, Math.max(0, v));
      composePixel(out, (y * w + x) * 4, [cl(d[o]), cl(d[n + o]), cl(d[2 * n + o])], strength);
    }
    onProgress(++done, total);
    await new Promise(res => setTimeout(res)); // let the UI paint progress between tiles
  }
  return { layer: new ImageData(out, w, h), gpu };
}
