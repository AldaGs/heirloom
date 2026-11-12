// Pure helpers for AI Remove (MI-GAN pipeline): layout conversion + retouch-layer merge. No DOM, testable in Node.

/** RGBA (HWC) → RGB planar (CHW) uint8, the pipeline's `image` input. */
export function toCHW(rgba: Uint8ClampedArray, w: number, h: number) {
  const n = w * h, out = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) { out[i] = rgba[i * 4]; out[n + i] = rgba[i * 4 + 1]; out[2 * n + i] = rgba[i * 4 + 2]; }
  return out;
}

/** Brush alpha → the pipeline's `mask`: 255 = keep, 0 = fill. Dilated by `grow` px so object edges are covered. */
export function toMask(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, stride = 1, grow = 2) {
  const hole = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) hole[i] = alpha[i * stride + (stride - 1)] > 16 ? 1 : 0;
  const grown = grow ? dilate(hole, w, h, grow) : hole;
  const mask = new Uint8Array(w * h);
  let any = false;
  for (let i = 0; i < w * h; i++) { mask[i] = grown[i] ? 0 : 255; any ||= !!grown[i]; }
  return { mask, hole: grown, any };
}

/** Square dilation, separable (two 1-D passes). */
export function dilate(m: Uint8Array, w: number, h: number, r: number) {
  const a = new Uint8Array(m.length), b = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    let run = -1e9;
    for (let x = 0; x < w; x++) { if (m[y * w + x]) run = x; if (x - run <= r) a[y * w + x] = 1; }
    run = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) run = x; if (run - x <= r) a[y * w + x] = 1; }
  }
  for (let x = 0; x < w; x++) {
    let run = -1e9;
    for (let y = 0; y < h; y++) { if (a[y * w + x]) run = y; if (y - run <= r) b[y * w + x] = 1; }
    run = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (a[y * w + x]) run = y; if (run - y <= r) b[y * w + x] = 1; }
  }
  return b;
}

/**
 * Write the model's CHW output into the retouch layer (RGBA, alpha 255 where filled).
 * `layer` is the previous retouch layer (or zeros); earlier removals elsewhere are kept.
 */
export function mergeIntoLayer(layer: Uint8ClampedArray, outCHW: Uint8Array, hole: Uint8Array, w: number, h: number) {
  const n = w * h;
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    layer[i * 4] = outCHW[i]; layer[i * 4 + 1] = outCHW[n + i]; layer[i * 4 + 2] = outCHW[2 * n + i]; layer[i * 4 + 3] = 255;
  }
  return layer;
}
