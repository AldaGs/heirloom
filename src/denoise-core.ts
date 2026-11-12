// Pure helpers for AI Denoise (NAFNet, fixed 512² tiles). No DOM, testable in Node.

export const TILE = 512, MARGIN = 48; // each tile keeps only its centre; the margin is context for the network

/** Tile origins along one axis: every pixel is covered by some tile's centre region (edges use the tile edge). */
export function tileStarts(len: number, tile = TILE, margin = MARGIN) {
  if (len <= tile) return [0];
  const step = tile - 2 * margin, out: number[] = [];
  for (let s = 0; ; s += step) { const x = Math.min(s, len - tile); out.push(x); if (x === len - tile) break; }
  return out;
}

/** The part of a tile at `start` whose output is kept: [from, to). Seams sit mid-overlap, ≥ margin from either tile edge. */
export function keepRange(start: number, len: number, tile = TILE, _margin = MARGIN, starts = tileStarts(len, tile, _margin)) {
  const i = starts.indexOf(start);
  const seam = (k: number) => Math.floor((starts[k + 1] + Math.min(len, starts[k] + tile)) / 2); // between tile k and k+1
  return [i === 0 ? 0 : seam(i - 1), i === starts.length - 1 ? len : seam(i)] as const;
}

/** RGBA bytes → float CHW tile (0..1), edge-clamped when the tile runs past the image. */
export function readTile(rgba: Uint8ClampedArray, w: number, h: number, x0: number, y0: number, t = TILE) {
  const out = new Float32Array(3 * t * t), n = t * t;
  for (let y = 0; y < t; y++) {
    const sy = Math.min(h - 1, y0 + y);
    for (let x = 0; x < t; x++) {
      const i = (sy * w + Math.min(w - 1, x0 + x)) * 4, o = y * t + x;
      out[o] = rgba[i] / 255; out[n + o] = rgba[i + 1] / 255; out[2 * n + o] = rgba[i + 2] / 255;
    }
  }
  return out;
}

/**
 * Put a denoised result into the retouch layer at strength s (0..1), on top of whatever the layer already holds.
 * Layer semantics: shown = mix(source, layer.rgb, layer.a). We want shown' = mix(shown, den, s), so
 *   a' = 1 - (1 - a)(1 - s),  rgb' = (rgb·a·(1 - s) + den·s) / a'.
 * Removed areas (a = 1) stay fully covered; earlier removals never ghost back.
 */
export function composePixel(layer: Uint8ClampedArray, i: number, den: [number, number, number], s: number) {
  const a = layer[i + 3] / 255, a2 = 1 - (1 - a) * (1 - s);
  if (a2 <= 0) return;
  for (let c = 0; c < 3; c++) layer[i + c] = Math.round((layer[i + c] * a * (1 - s) + den[c] * 255 * s) / a2);
  layer[i + 3] = Math.round(a2 * 255);
}
