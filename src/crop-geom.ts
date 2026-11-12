// Crop/rotate geometry (pure, testable).
export type Rect = { cropX: number; cropY: number; cropW: number; cropH: number };
export const ASPECTS: [string, number | 'orig' | null][] = [['Free', null], ['Original', 'orig'], ['1:1', 1], ['4:5', 4 / 5], ['3:2', 3 / 2], ['16:9', 16 / 9]];

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const MIN = 0.05;

/**
 * Fit a rect to a pixel aspect ratio r (w/h) inside the frame. A = frame pixel aspect.
 * In fractions: (w·A)/h = r → h = w·A/r. Keeps the centre, shrinks to fit.
 */
export function fitAspect(c: Rect, r: number, A: number): Rect {
  let w = c.cropW, h = (w * A) / r;
  if (h > c.cropH) { h = c.cropH; w = (h * r) / A; }
  const cx = c.cropX + c.cropW / 2, cy = c.cropY + c.cropH / 2;
  return { cropX: clamp(cx - w / 2, 0, 1 - w), cropY: clamp(cy - h / 2, 0, 1 - h), cropW: w, cropH: h };
}

/** The crop box follows the picture when it's turned 90° (dir 1 = clockwise) or mirrored. */
export const turnRect = (c: Rect, dir: 1 | -1): Rect => dir === 1
  ? { cropX: 1 - (c.cropY + c.cropH), cropY: c.cropX, cropW: c.cropH, cropH: c.cropW }
  : { cropX: c.cropY, cropY: 1 - (c.cropX + c.cropW), cropW: c.cropH, cropH: c.cropW };
export const flipRect = (c: Rect, axis: 'h' | 'v'): Rect => axis === 'h'
  ? { ...c, cropX: 1 - (c.cropX + c.cropW) } : { ...c, cropY: 1 - (c.cropY + c.cropH) };

