import { MODELS } from './ai.ts';
import { session, unloadAll } from './ort.ts';
import { mergeIntoLayer, toCHW, toMask } from './remove-core.ts';

/** @deprecated kept for callers; unloads every AI session. */
export const unloadRemove = unloadAll;

/**
 * Fill the brushed area of `base` (unedited image, 8-bit sRGB) and merge the result into `layer`.
 * `brush` is the RGBA brush canvas at the same size. Returns the new retouch layer.
 */
export async function removeArea(base: ImageData, brush: ImageData, layer?: ImageData): Promise<ImageData> {
  const { width: w, height: h } = base;
  if (brush.width !== w || brush.height !== h) throw new Error('brush size mismatch');
  const { mask, hole, any } = toMask(brush.data, w, h, 4);
  if (!any) throw new Error('Paint over what you want removed first');
  const { ort, s } = await session(MODELS.migan.file);
  const out = await s.run({
    [s.inputNames[0]]: new ort.Tensor('uint8', toCHW(base.data, w, h), [1, 3, h, w]),
    [s.inputNames[1]]: new ort.Tensor('uint8', mask, [1, 1, h, w]),
  });
  const res = out[s.outputNames[0]].data as Uint8Array;
  const next = layer ? new Uint8ClampedArray(layer.data) : new Uint8ClampedArray(w * h * 4);
  return new ImageData(mergeIntoLayer(next, res, hole, w, h), w, h);
}
