import { MASKS, MASK_ADJ, maskKey, type Values } from './sliders.ts';

/** Mask sliders → shader units, same scale as the global ones (Temp ±100 ≈ ±0.6 EV of warm/cool; Tint ±100 ≈ global ±100). */
export function maskUniforms(v: Values) {
  const scale: Record<string, number> = { exposure: 1, temp: 0.6 / 100, tint: 1 / 150 };
  return Array.from({ length: MASKS }, (_, i) => MASK_ADJ.map(([k]) => (v[maskKey(i, k)] ?? 0) * (scale[k] ?? 0.01))).flat();
}

