import { MODELS } from './ai.ts';
import { session } from './ort.ts';
import { SAM, decoderPoints, encoderInput, logitsToCoverage, maskSize, samScale, type Pt } from './sam-core.ts';

type Tensor = import('onnxruntime-web/webgpu').Tensor;
let cache: { key: string; emb: Tensor; w: number; h: number } | undefined;

/** Image embedding for `base` (unedited image incl. AI layers). Cached by key; the slow step (seconds), once per photo state. */
export async function embed(key: string, base: ImageData) {
  if (cache?.key === key) return cache;
  const { ort, s } = await session(MODELS.samEnc.file);
  const k = samScale(base.width, base.height), w = Math.round(base.width * k), h = Math.round(base.height * k);
  const c = new OffscreenCanvas(base.width, base.height); c.getContext('2d')!.putImageData(base, 0, 0);
  const r = new OffscreenCanvas(w, h), g = r.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, w, h);
  const input = encoderInput(g.getImageData(0, 0, w, h).data, w, h);
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SAM, SAM]) });
  cache = { key, emb: out[s.outputNames[0]] as Tensor, w: base.width, h: base.height };
  return cache;
}

/** Points → mask coverage (ImageData at the stored mask size). Fast (decoder only). */
export async function segment(key: string, pts: Pt[]) {
  if (!cache || cache.key !== key) throw new Error('image not analysed yet');
  const { ort, s } = await session(MODELS.samDec.file);
  const { w, h } = cache, m = maskSize(w, h), p = decoderPoints(pts, w, h);
  const out = await s.run({
    image_embeddings: cache.emb,
    point_coords: new ort.Tensor('float32', p.coords, [1, p.n, 2]),
    point_labels: new ort.Tensor('float32', p.labels, [1, p.n]),
    mask_input: new ort.Tensor('float32', new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor('float32', new Float32Array([0]), [1]),
    orig_im_size: new ort.Tensor('float32', new Float32Array([m.h, m.w]), [2]),
  });
  return new ImageData(logitsToCoverage(out.masks.data as Float32Array), m.w, m.h);
}
export const forgetEmbedding = () => { cache = undefined; };
