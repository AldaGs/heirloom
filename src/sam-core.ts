// Pure helpers for MobileSAM masking. No DOM, testable in Node.

export const SAM = 1024;      // encoder input: long side resized to 1024, zero-padded to 1024²
export const MASK_MAX = 2048; // stored mask resolution (long side); the GPU samples it with linear filtering

export const samScale = (w: number, h: number) => SAM / Math.max(w, h);
export const maskSize = (w: number, h: number) => { const k = Math.min(1, MASK_MAX / Math.max(w, h)); return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }; };

/** RGBA (already resized so its long side is 1024) → zero-padded CHW float 0..255 (normalisation is inside the model). */
export function encoderInput(rgba: Uint8ClampedArray, w: number, h: number) {
  const n = SAM * SAM, out = new Float32Array(3 * n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, o = y * SAM + x;
    out[o] = rgba[i]; out[n + o] = rgba[i + 1]; out[2 * n + o] = rgba[i + 2];
  }
  return out;
}

export type Pt = { x: number; y: number; add: boolean }; // x, y: 0..1 of the image
/** Clicks → decoder inputs (1024-space coords, labels 1/0, plus SAM's padding point when there's no box). */
export function decoderPoints(pts: Pt[], w: number, h: number) {
  const k = samScale(w, h), n = pts.length + 1;
  const coords = new Float32Array(n * 2), labels = new Float32Array(n);
  pts.forEach((p, i) => { coords[i * 2] = p.x * w * k; coords[i * 2 + 1] = p.y * h * k; labels[i] = p.add ? 1 : 0; });
  labels[n - 1] = -1;
  return { coords, labels, n };
}

/** Mask logits → 8-bit coverage in an RGBA buffer (R=G=B=coverage, A=255). Sigmoid gives a soft, anti-aliased edge. */
export function logitsToCoverage(logits: Float32Array, out = new Uint8ClampedArray(logits.length * 4)) {
  for (let i = 0; i < logits.length; i++) {
    const v = 255 / (1 + Math.exp(-logits[i] * 1.5));
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return out;
}
