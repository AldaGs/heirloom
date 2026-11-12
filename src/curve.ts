import { CURVE_POINTS, type Values } from './sliders.ts';

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Monotone cubic (Fritsch–Carlson) through points with increasing x: no overshoot, no wiggles. */
export function monotone(xs: number[], ys: number[]) {
  const n = xs.length, d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = xs.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = clamp01((x - xs[i]) / h), t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** Parametric curve: four soft regions (shadows/darks/lights/highlights) bend the identity line. */
export function parametric(v: Values) {
  const bump = (x: number, c: number) => Math.max(0, 1 - Math.abs(x - c) / 0.35) ** 2 * x * (1 - x) * 4;
  return (x: number) => clamp01(x
    + (v.curveShadows * bump(x, 0.125) + v.curveDarks * bump(x, 0.375) + v.curveLights * bump(x, 0.625) + v.curveHighlights * bump(x, 0.875)) / 100 * 0.25);
}

export const pointYs = (v: Values) => Array.from({ length: CURVE_POINTS }, (_, i) => v[`pc${i}`] / 100);
export const pointXs = Array.from({ length: CURVE_POINTS }, (_, i) => i / (CURVE_POINTS - 1));

/** 256-entry LUT = point curve ∘ parametric curve (applied per RGB channel in display space). */
export function buildLut(v: Values) {
  const p = parametric(v), pc = monotone(pointXs, pointYs(v));
  return Float32Array.from({ length: 256 }, (_, i) => clamp01(pc(p(i / 255))));
}
