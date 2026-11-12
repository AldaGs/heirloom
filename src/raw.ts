import LibRaw from 'libraw-wasm';

export const RAW_EXT = /\.(nef|nrw|cr2|cr3|crw|arw|srf|sr2|dng|raf|orf|rw2|pef|srw|x3f|3fr|iiq|erf|kdc|mrw|rwl)$/i;

export type Exif = { iso?: number; focal?: number; aperture?: number; shutter?: number; camera?: string; lens?: string; focal35?: number; artist?: string };
export type RawInfo = { w: number; h: number; exif: Exif; asShot: number; date?: number; thumb?: Blob };

// Linear 16-bit output in sRGB primaries, camera WB applied ("as shot"), no auto-brighten.
const DECODE = { outputBps: 16, gamm: [1, 1] as [number, number], noAutoBright: true, useCameraWb: true, outputColor: 1, userQual: 3, highlight: 0 };

/**
 * Rough as-shot Kelvin from the camera's WB multipliers vs. its daylight multipliers.
 * ponytail: linear r/b ratio heuristic; exact needs CCT search through cam_xyz (later).
 */
export function asShotKelvin(cam?: number[], pre?: number[]) {
  if (!cam?.[0] || !cam[2] || !pre?.[0] || !pre[2]) return 5500;
  const k = 5500 * ((cam[0] / cam[2]) / (pre[0] / pre[2]));
  return Math.min(12000, Math.max(2000, Math.round(k / 50) * 50));
}

export const fmtShutter = (s?: number) => (!s ? '—' : s >= 1 ? `${+s.toFixed(1)}s` : `1/${Math.round(1 / s)}`);

async function open(file: File) {
  const raw = new LibRaw();
  await raw.open(new Uint8Array(await file.arrayBuffer()), DECODE);
  const m = await raw.metadata(true);
  if (!m) { raw.dispose(); throw new Error("Not a supported RAW file"); }
  const swap = m.flip === 5 || m.flip === 6;
  const info: RawInfo = {
    w: swap ? m.height : m.width, h: swap ? m.width : m.height,
    exif: { iso: m.iso_speed, focal: m.focal_len, aperture: m.aperture, shutter: m.shutter, camera: `${m.camera_make} ${m.camera_model}`.trim(),
      lens: (m.lens?.Lens || m.lens?.makernotes?.Lens || '').trim() || undefined, focal35: m.lens?.FocalLengthIn35mmFormat || undefined, artist: m.artist?.trim() || undefined },
    asShot: asShotKelvin(m.color_data?.cam_mul, m.color_data?.pre_mul),
    date: m.timestamp instanceof Date && !isNaN(+m.timestamp) ? +m.timestamp : undefined,
  };
  return { raw, info };
}

/** Cheap import-time read: metadata + embedded JPEG preview for the filmstrip. */
export async function rawInfo(file: File): Promise<RawInfo> {
  const { raw, info } = await open(file);
  try {
    const t = await raw.thumbnailData();
    if (t?.format === 'jpeg') info.thumb = new Blob([t.data], { type: 'image/jpeg' });
  } catch { /* no preview: filmstrip falls back to a blank tile */ }
  raw.dispose();
  return info;
}

/** Full demosaic → 16-bit linear RGB. Runs in libraw-wasm's own Web Worker. */
export async function decodeRaw(file: File) {
  const { raw } = await open(file);
  try {
    const img = await raw.imageData();
    if (!img || img.colors !== 3 || img.bits !== 16) throw new Error('Unsupported RAW output');
    return { w: img.width, h: img.height, data: img.data as Uint16Array };
  } finally { raw.dispose(); }
}
