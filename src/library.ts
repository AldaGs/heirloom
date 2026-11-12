import { db } from './db.ts';
import { decodeBitmap } from './decode.ts';
import { RAW_EXT, rawInfo, type Exif } from './raw.ts';
import { defaults, type Values } from './sliders.ts';
import { same, type Step } from './history.ts';

/** Keep `retouch` in step with the current history step, and drop layers no step references. */
export function syncLayers(p: Photo): Photo {
  const used = new Set(p.hist.map(s => s.rt).filter(Boolean) as string[]);
  const layers = p.layers ? Object.fromEntries(Object.entries(p.layers).filter(([k]) => used.has(k))) : undefined;
  const rt = p.hist[p.hi]?.rt;
  return { ...p, layers: layers && Object.keys(layers).length ? layers : undefined, retouch: rt ? layers?.[rt] : undefined };
}

export type Src = { kind: 'blob'; blob: Blob } | { kind: 'handle'; handle: FileSystemFileHandle; folder: string };
export type Photo = {
  id: string; name: string; src: Src; raw: boolean; exif: Exif; asShot: number; date: number; w: number; h: number;
  v: Values; hist: Step[]; hi: number; rating: number; flag: boolean; reject?: boolean; label: number;
  album?: string; // app-side album; '' / undefined = unfiled
  thumb?: Blob;   // ~480 px, grid + filmstrip
  retouch?: Blob; // AI Remove layer in effect (derived: layers[hist[hi].rt]); PNG at the loaded size, alpha = replaced pixels
  layers?: Record<string, Blob>; // every Remove layer referenced by history, by id
  preview?: Blob; // ~2048 px, Cull view (FIXER_IMPROVEMENTS §2)
  url?: string; // runtime-only object URL for the thumbnail
};
export type Folder = { key: string; handle: FileSystemDirectoryHandle };

export const LABELS = ['None', 'Red', 'Yellow', 'Green', 'Blue', 'Purple'];
export const LABEL_COLORS = ['transparent', '#D9534F', '#E8C33A', '#4CA65A', '#4A7BD8', '#9B59B6'];

/** Per-photo defaults: Temp starts at the camera's as-shot Kelvin. */
export const base = (p: { asShot: number }): Values => ({ ...defaults(), temp: p.asShot });
export const isEdited = (p: Photo) => !same(p.v, base(p));
export const isImage = (name: string, type = '') => RAW_EXT.test(name) || /^image\//.test(type) || /\.(jpe?g|png|webp|avif|heic|heif|hif|tiff?)$/i.test(name);

export const fileOf = async (p: Photo): Promise<File> =>
  p.src.kind === 'blob' ? new File([p.src.blob], p.name) : p.src.handle.getFile();

/** Downscale any browser-decodable image to WebP with the long edge ≤ max. */
async function shrink(bmp: ImageBitmap, max: number, quality: number) {
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/webp', quality });
}

/** Thumb + preview from a source image (the original, or a RAW's embedded JPEG). */
export async function makePreviews(src: Blob, name = '') {
  const bmp = await decodeBitmap(src, name);
  try { return { w: bmp.width, h: bmp.height, thumb: await shrink(bmp, 480, 0.8), preview: await shrink(bmp, 2048, 0.85) }; }
  finally { bmp.close(); }
}

/** Background backfill for photos imported before previews existed. Returns null if the source can't be read. */
export async function withPreview(p: Photo): Promise<Photo | null> {
  try {
    const src = p.raw ? p.thumb : await fileOf(p);
    if (!src) return null;
    const { thumb, preview } = await makePreviews(src, p.raw ? '' : p.name);
    return { ...p, thumb, preview };
  } catch { return null; }
}

export async function buildPhoto(file: File, src: Src): Promise<Photo> {
  const raw = RAW_EXT.test(file.name);
  let info: { w: number; h: number; exif: Exif; asShot: number; date?: number; thumb?: Blob; preview?: Blob };
  if (raw) {
    const r = await rawInfo(file);
    // the embedded JPEG is often full-size: derive a light thumb + a cull preview from it
    info = r.thumb ? { ...r, ...(await makePreviews(r.thumb).then(({ thumb, preview }) => ({ thumb, preview })).catch(() => ({}))) } : r;
  } else info = { ...(await makePreviews(file, file.name)), exif: {}, asShot: 5500 };
  const v = base(info);
  return {
    id: crypto.randomUUID(), name: file.name, src, raw, exif: info.exif, asShot: info.asShot,
    date: info.date ?? file.lastModified, w: info.w, h: info.h, thumb: info.thumb, preview: info.preview,
    v, hist: [{ label: 'Import', v, t: Date.now() }], hi: 0, rating: 0, flag: false, label: 0,
  };
}

// ---- Sidecars: open JSON next to the original (FIXER_IMPROVEMENTS §7) ----
// ponytail: JSON only; an .xmp (crs:) writer for Lightroom interop comes later, and must never clobber an existing .xmp.
export const sidecarName = (name: string) => `${name}.heirloom.json`;

export const toSidecar = (p: Photo) => JSON.stringify({
  app: 'heirloom', version: 1, file: p.name,
  settings: p.v, rating: p.rating, flag: p.flag, reject: !!p.reject, label: LABELS[p.label], album: p.album || undefined,
  history: p.hist.slice(0, p.hi + 1).map(s => ({ label: s.label, t: s.t, settings: s.v, ...(s.rt ? { removeLayer: retouchFile(p.name, s.rt) } : {}) })),
}, null, 2);

export function applySidecar(p: Photo, text: string): Photo {
  const j = JSON.parse(text);
  if (j?.app !== 'heirloom' || typeof j.settings !== 'object') return p;
  const v = { ...base(p), ...j.settings };
  const hist: Step[] = Array.isArray(j.history) && j.history.length
    ? j.history.map((s: { label: string; t: number; settings: Values; removeLayer?: string }) => {
        const rt = s.removeLayer ? layerId(s.removeLayer) : undefined;
        return { label: s.label, t: s.t, v: { ...base(p), ...s.settings }, rt: rt && p.layers?.[rt] ? rt : undefined };
      })
    : [{ label: 'Import', v, t: Date.now() }];
  return syncLayers({ ...p, v, hist, hi: hist.length - 1, rating: +j.rating || 0, flag: !!j.flag, reject: !!j.reject, label: Math.max(0, LABELS.indexOf(j.label)), album: typeof j.album === 'string' ? j.album : undefined });
}

/** Remove layers sit beside the sidecar: `<photo>.<id>.remove.png`. */
export const retouchFile = (name: string, id: string) => `${name}.${id}.remove.png`;
const layerId = (file: string) => file.match(/\.([\w-]+)\.remove\.png$/)?.[1];
/** Layer files a sidecar refers to (to load them before applySidecar). */
export const sidecarLayers = (text: string): string[] => { try { const j = JSON.parse(text); return (j.history ?? []).map((s: { removeLayer?: string }) => s.removeLayer).filter(Boolean); } catch { return []; } };

/** Sidecars live in `<folder>/.heirloom/` so they don't interleave with the photos. */
export const SIDECAR_DIR = '.heirloom';

export async function writeSidecar(p: Photo, folder: FileSystemDirectoryHandle) {
  const dir = await folder.getDirectoryHandle(SIDECAR_DIR, { create: true });
  const w = await (await dir.getFileHandle(sidecarName(p.name), { create: true })).createWritable();
  await w.write(toSidecar(p)); await w.close();
  const keep = new Set(p.hist.slice(0, p.hi + 1).map(s => s.rt).filter(Boolean).map(id => retouchFile(p.name, id!)));
  for (const [id, blob] of Object.entries(p.layers ?? {})) {
    const f = retouchFile(p.name, id);
    if (!keep.has(f)) continue;
    if (await dir.getFileHandle(f).then(() => true, () => false)) continue; // layers never change once written
    const lw = await (await dir.getFileHandle(f, { create: true })).createWritable(); await lw.write(blob); await lw.close();
  }
  // only our own naming pattern for this exact photo is ever deleted
  const prefix = `${p.name}.`;
  for await (const e of dir.values())
    if (e.kind === 'file' && e.name.startsWith(prefix) && e.name.endsWith('.remove.png') && /^[\w-]+$/.test(e.name.slice(prefix.length, -'.remove.png'.length)) && !keep.has(e.name))
      await dir.removeEntry(e.name).catch(() => {});
}

// ---- Folders (desktop Chromium: File System Access) ----
export const canOpenFolders = () => 'showDirectoryPicker' in window;
export const loadFolders = async () => (await db.get<Folder[]>('folders')) ?? [];

/** Pick a folder, import its photos (top level), pick up existing sidecars. Skips files already in the library. */
export async function importFolder(known: Set<string>, onProgress: (msg: string) => void) {
  const handle = await window.showDirectoryPicker!({ mode: 'readwrite' });
  const folders = await loadFolders();
  let folder = folders.find(f => f.handle.name === handle.name);
  for (const f of folders) if (await f.handle.isSameEntry(handle)) folder = f;
  if (!folder) { folder = { key: crypto.randomUUID(), handle }; await db.set('folders', [...folders, folder]); }
  else folder.handle = handle;

  // ponytail: top-level files only; recurse into subfolders when someone needs it
  const files: FileSystemFileHandle[] = [], legacy: FileSystemFileHandle[] = [], sidecars = new Map<string, FileSystemFileHandle>();
  for await (const e of handle.values()) {
    if (e.kind !== 'file') continue;
    if (e.name.endsWith('.heirloom.json')) legacy.push(e); // sidecars used to sit next to the photos
    else if (isImage(e.name)) files.push(e);
  }
  const scDir = await handle.getDirectoryHandle(SIDECAR_DIR, { create: legacy.length > 0 }).catch(() => null);
  if (scDir) for await (const e of scDir.values())
    if (e.kind === 'file' && e.name.endsWith('.heirloom.json')) sidecars.set(e.name, e);
  // Migrate legacy sidecars into the subfolder. If the subfolder already has one, it wins and the legacy file is left alone.
  for (const old of legacy) {
    if (sidecars.has(old.name)) continue;
    try {
      const nh = await scDir!.getFileHandle(old.name, { create: true });
      const w = await nh.createWritable(); await w.write(await old.getFile()); await w.close();
      await handle.removeEntry(old.name); // only after the copy is safely written
      sidecars.set(old.name, nh);
    } catch (e) { console.warn(`Couldn't move ${old.name}:`, e); sidecars.set(old.name, old); }
  }
  const out: Photo[] = [];
  for (const [i, fh] of files.entries()) {
    if (known.has(`${folder.key}/${fh.name}`)) continue;
    onProgress(`Importing ${i + 1} / ${files.length}…`);
    try {
      let p = await buildPhoto(await fh.getFile(), { kind: 'handle', handle: fh, folder: folder.key });
      const sc = sidecars.get(sidecarName(fh.name));
      if (sc) {
        const text = await (await sc.getFile()).text(), layers: Record<string, Blob> = {};
        for (const f of sidecarLayers(text)) {
          const id = layerId(f), fh = scDir && id ? await scDir.getFileHandle(f).catch(() => null) : null;
          if (id && fh) layers[id] = await fh.getFile();
        }
        p = applySidecar({ ...p, layers }, text);
      }
      out.push(p);
    } catch (e) { console.warn(`Skipped ${fh.name}:`, e); }
  }
  return out;
}

// Library filters (shared by the grid and Cull)
export const FILTERS: [string, (p: Photo) => boolean][] = [
  ['All photos', () => true],
  ['Picks', p => p.flag],
  ['Rejected', p => !!p.reject],
  ['Edited', isEdited],
  ['Raw only', p => p.raw],
  ['Rated', p => p.rating > 0],
];
/** Album filter: null = all, '' = unfiled, else that album. */
export const inAlbum = (a: string | null) => (p: Photo) => a === null || (p.album ?? '') === a;
export const albumsOf = (ps: Photo[]) => [...new Set(ps.map(p => p.album).filter(Boolean) as string[])].sort();
export const byDate = (a: Photo, b: Photo) => b.date - a.date;

export const photoKey = (p: Photo) => (p.src.kind === 'handle' ? `${p.src.folder}/${p.name}` : p.id);

// ---- Whole-library export / import (Phase 8, FIXER_IMPROVEMENTS §7) ----
// Edits only (the same data as each sidecar, plus albums): originals stay where they are.
export type LibraryFile = { app: 'heirloom-library'; version: 1; exported: number; photos: (ReturnType<typeof JSON.parse> & { w: number; h: number; date: number })[] };

export const exportLibrary = (ps: Photo[]) => JSON.stringify({
  app: 'heirloom-library', version: 1, exported: Date.now(),
  photos: ps.map(p => ({ ...JSON.parse(toSidecar(p)), w: p.w, h: p.h, date: p.date })),
} satisfies LibraryFile, null, 1);

/** Match entries to photos by file name + dimensions (name alone if unique). Returns updated photos and what didn't match. */
export function importLibrary(ps: Photo[], text: string) {
  const j = JSON.parse(text) as LibraryFile;
  if (j?.app !== 'heirloom-library' || !Array.isArray(j.photos)) throw new Error('Not a Heirloom library file');
  const byName = new Map<string, Photo[]>();
  for (const p of ps) byName.set(p.name, [...(byName.get(p.name) ?? []), p]);
  const updates = new Map<string, Photo>(), missing: string[] = [];
  for (const e of j.photos) {
    const c = byName.get(e.file) ?? [];
    const hit = c.filter(p => (p.w === e.w && p.h === e.h) || (p.w === e.h && p.h === e.w));
    const p = hit.length === 1 ? hit[0] : c.length === 1 ? c[0] : undefined;
    if (!p || updates.has(p.id)) { missing.push(e.file + (c.length > 1 ? ' (ambiguous)' : '')); continue; }
    updates.set(p.id, applySidecar(p, JSON.stringify(e)));
  }
  return { photos: ps.map(p => updates.get(p.id) ?? p), matched: updates.size, total: j.photos.length, missing };
}

/** Thumbnail with the AI Remove layer drawn over it (thumb itself stays original so reverting is lossless). */
export async function retouchedThumb(p: Photo): Promise<Blob | undefined> {
  if (!p.thumb || !p.retouch) return p.thumb;
  const [t, r] = await Promise.all([createImageBitmap(p.thumb), createImageBitmap(p.retouch)]);
  const c = new OffscreenCanvas(t.width, t.height), g = c.getContext('2d')!;
  g.drawImage(t, 0, 0); g.imageSmoothingQuality = 'high'; g.drawImage(r, 0, 0, t.width, t.height);
  t.close(); r.close();
  return c.convertToBlob({ type: 'image/webp', quality: 0.8 });
}
