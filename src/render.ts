import { createPipeline, histogram, autoExposure, type Source } from './pipeline.ts';
import { decodeRaw } from './raw.ts';
import { decodeBitmap } from './decode.ts';
import { base, fileOf, type Photo } from './library.ts';
import type { Values } from './sliders.ts';

/**
 * Off-screen developer for batch work (export, sync preview). One hidden WebGL context, reused;
 * calls are serialized so two batches never fight over it.
 */
let off: { canvas: HTMLCanvasElement; pipe: ReturnType<typeof createPipeline> } | undefined;
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>): Promise<T> => { const r = queue.then(f, f); queue = r.catch(() => {}); return r; };
const dev = () => { if (!off) { const canvas = document.createElement('canvas'); off = { canvas, pipe: createPipeline(canvas) }; } return off; };

/** Full-resolution source: RAW demosaic or decoded image. Throws a readable reason. */
async function fullSource(p: Photo): Promise<Source> {
  const file = await fileOf(p).catch(() => { throw new Error('original not reachable (reconnect its folder)'); });
  if (p.raw) return { kind: 'raw', ...(await decodeRaw(file)) };
  return { kind: 'bitmap', bmp: await decodeBitmap(file, p.name) };
}

/** Cheap source for previews: the stored ~2048 px preview (RAW: from its embedded JPEG). */
async function previewSource(p: Photo): Promise<Source> {
  const b = p.preview ?? p.thumb;
  if (!b) throw new Error('no preview yet');
  return { kind: 'bitmap', bmp: await createImageBitmap(b) };
}

async function run(src: Source, p: Photo, v: Values) {
  const { canvas, pipe } = dev();
  const patch = p.retouch ? await createImageBitmap(p.retouch, { premultiplyAlpha: 'none' }) : undefined;
  try { await pipe.load(src, patch); } finally { patch?.close(); if (src.kind === 'bitmap') src.bmp.close(); }
  pipe.render(v, p.asShot);
  return canvas;
}

/** Render p at full resolution with v. Returns the (shared) canvas: copy/encode before the next call. */
export const developFull = <T>(p: Photo, v: Values, use: (c: HTMLCanvasElement) => Promise<T> | T) =>
  serial(async () => use(await run(await fullSource(p), p, v)));

/** Small preview of p with v → object-URL-able blob, plus a per-photo auto exposure from its unedited render. */
export const developPreview = (p: Photo, v: (auto: () => number) => Values) =>
  serial(async () => {
    const src = await previewSource(p);
    const { canvas, pipe } = dev();
    try { await pipe.load(src); } finally { if (src.kind === 'bitmap') src.bmp.close(); }
    const auto = () => { pipe.render(base(p), p.asShot); return Math.round(autoExposure(histogram(canvas)) / 0.05) * 0.05; };
    const vals = v(auto);
    pipe.render(vals, p.asShot);
    const k = Math.min(1, 360 / Math.max(canvas.width, canvas.height));
    const c = new OffscreenCanvas(Math.round(canvas.width * k), Math.round(canvas.height * k));
    c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
    return { v: vals, blob: await c.convertToBlob({ type: 'image/webp', quality: 0.8 }) };
  });
