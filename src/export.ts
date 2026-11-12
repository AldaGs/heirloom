// Export presets (FIXER_IMPROVEMENTS §6/§10.7): size, format, output sharpening, watermark.

export type Format = 'jpeg' | 'webp' | 'avif' | 'tiff';
export type ExportPreset = {
  name: string; format: Format; quality: number; // 1..100 (ignored by TIFF)
  long: number;            // long edge in px; 0 = full size
  sharpen: 0 | 1 | 2 | 3;  // output sharpening: none / low / standard / high
  watermark: string;       // '' = none; bottom-right
  suffix: string;          // appended to the base name
};

export const SHARPEN = ['None', 'Low', 'Standard', 'High'];
export const BUILTIN_EXPORTS: ExportPreset[] = [
  { name: 'Full-size JPEG', format: 'jpeg', quality: 95, long: 0, sharpen: 0, watermark: '', suffix: '' },
  { name: 'Web 2048 px', format: 'jpeg', quality: 85, long: 2048, sharpen: 2, watermark: '', suffix: '-web' },
  { name: 'Instagram 1080', format: 'jpeg', quality: 90, long: 1080, sharpen: 2, watermark: '', suffix: '-ig' },
  { name: 'Small WebP', format: 'webp', quality: 80, long: 1600, sharpen: 1, watermark: '', suffix: '-sm' },
  { name: 'Archive TIFF', format: 'tiff', quality: 100, long: 0, sharpen: 0, watermark: '', suffix: '' },
];

const EXT: Record<Format, string> = { jpeg: 'jpg', webp: 'webp', avif: 'avif', tiff: 'tif' };
export const outName = (name: string, p: ExportPreset) => `${name.replace(/\.[^.]+$/, '')}${p.suffix}.${EXT[p.format]}`;

/** Output size for a long-edge limit (never upscales). */
export function fitLong(w: number, h: number, long: number) {
  const k = long > 0 ? Math.min(1, long / Math.max(w, h)) : 1;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Unsharp mask with a 3×3 box blur, in place on RGBA bytes. Amount scales with the preset level. */
export function sharpenRGBA(d: Uint8ClampedArray, w: number, h: number, level: number) {
  if (!level) return;
  const amt = [0, 0.3, 0.6, 1][level], src = d.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy)), xx = Math.min(w - 1, Math.max(0, x + dx));
        s += src[(yy * w + xx) * 4 + c];
      }
      d[i + c] = src[i + c] + (src[i + c] - s / 9) * amt;
    }
  }
}

/** Baseline uncompressed 8-bit RGB TIFF (little-endian, one strip). */
export function encodeTiff(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const n = w * h * 3, tags = 10, ifd = 8, extra = ifd + 2 + tags * 12 + 4, bps = extra, data = bps + 6;
  const buf = new Uint8Array(data + n), dv = new DataView(buf.buffer);
  buf.set([0x49, 0x49, 42, 0]); dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, tags, true);
  const tag = (i: number, id: number, type: number, count: number, val: number) => {
    const o = ifd + 2 + i * 12; dv.setUint16(o, id, true); dv.setUint16(o + 2, type, true); dv.setUint32(o + 4, count, true);
    type === 3 && count === 1 ? dv.setUint16(o + 8, val, true) : dv.setUint32(o + 8, val, true);
  };
  tag(0, 256, 4, 1, w); tag(1, 257, 4, 1, h); tag(2, 258, 3, 3, bps); tag(3, 259, 3, 1, 1); tag(4, 262, 3, 1, 2);
  tag(5, 273, 4, 1, data); tag(6, 277, 3, 1, 3); tag(7, 278, 4, 1, h); tag(8, 279, 4, 1, n); tag(9, 284, 3, 1, 1);
  dv.setUint32(ifd + 2 + tags * 12, 0, true);
  dv.setUint16(bps, 8, true); dv.setUint16(bps + 2, 8, true); dv.setUint16(bps + 4, 8, true);
  for (let i = 0, o = data; i < w * h; i++) { buf[o++] = rgba[i * 4]; buf[o++] = rgba[i * 4 + 1]; buf[o++] = rgba[i * 4 + 2]; }
  return buf;
}

/** Resize + sharpen + watermark + encode a developed canvas. Throws if the browser can't encode the format. */
export async function encode(src: HTMLCanvasElement, p: ExportPreset): Promise<Blob> {
  const { w, h } = fitLong(src.width, src.height, p.long);
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  if (p.sharpen) { const im = g.getImageData(0, 0, w, h); sharpenRGBA(im.data, w, h, p.sharpen); g.putImageData(im, 0, 0); }
  if (p.watermark) {
    const fs = Math.max(12, Math.round(Math.min(w, h) * 0.03)), pad = Math.round(fs * 0.8);
    g.font = `500 ${fs}px Inter, system-ui, sans-serif`; g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = fs / 4; g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillText(p.watermark, w - pad, h - pad);
  }
  if (p.format === 'tiff') return new Blob([encodeTiff(g.getImageData(0, 0, w, h).data, w, h)], { type: 'image/tiff' });
  const type = `image/${p.format}`;
  const b = await c.convertToBlob({ type, quality: p.quality / 100 });
  if (b.type !== type) throw new Error(`this browser can't encode ${p.format.toUpperCase()}`);
  return b;
}
