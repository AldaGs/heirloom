// Procedural masks + brush merging (pure, testable). Coverage lives in the R channel of RGBA ImageData-like buffers.

export type Pt2 = { x: number; y: number }; // 0..1 of the (unrotated) image
type Buf = { data: Uint8ClampedArray; width: number; height: number };
const smooth = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const put = (d: Uint8ClampedArray, i: number, v: number) => { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; };

/** Linear gradient: full effect at `a`, fading to none at `b` (and beyond). Distances in pixels so it isn't skewed by aspect. */
export function linearMask(w: number, h: number, a: Pt2, b: Pt2) {
  const d = new Uint8ClampedArray(w * h * 4);
  const ax = a.x * w, ay = a.y * h, vx = b.x * w - ax, vy = b.y * h - ay, L2 = vx * vx + vy * vy || 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) put(d, y * w + x, 255 * (1 - smooth(((x + .5 - ax) * vx + (y + .5 - ay) * vy) / L2)));
  return { data: d, width: w, height: h };
}

/** Radial: full effect inside the circle through `edge` around `c` at (1 - soft) of its radius, fading to 0 at the radius. */
export function radialMask(w: number, h: number, c: Pt2, edge: Pt2, soft = 0.5) {
  const d = new Uint8ClampedArray(w * h * 4);
  const cx = c.x * w, cy = c.y * h, R = Math.hypot(edge.x * w - cx, edge.y * h - cy) || 1, inner = R * (1 - soft);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot(x + .5 - cx, y + .5 - cy);
    put(d, y * w + x, 255 * (1 - smooth((r - inner) / Math.max(1e-6, R - inner))));
  }
  return { data: d, width: w, height: h };
}

/** Merge brush strokes (alpha channel of `brush`, same size) into a mask: add = max, subtract = min(mask, 1 - stroke). */
export function applyBrush(mask: Buf, brush: Buf, add: boolean) {
  const out = new Uint8ClampedArray(mask.data);
  for (let i = 0; i < mask.width * mask.height; i++) {
    const s = brush.data[i * 4 + 3], m = out[i * 4];
    put(out, i, add ? Math.max(m, s) : Math.min(m, 255 - s));
  }
  return { data: out, width: mask.width, height: mask.height };
}

/** An all-zero mask (start for a brush-only mask). */
export const emptyMask = (w: number, h: number) => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 3; i < d.length; i += 4) d[i] = 255; return { data: d, width: w, height: h }; };
