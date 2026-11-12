import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Encoder } from './Encoder';
import { autoExposure, createPipeline, histogram } from './pipeline.ts';
import { goto, push, pushStep, same } from './history.ts';
import { PRESETS } from './sliders.ts';
import { Adjustments, byKey } from './Adjustments.tsx';
import { ASPECTS, CropOverlay, CropPanel, fitAspect, flipRect, turnRect, type Rect } from './Crop.tsx';
import { frameAspect, orient, wrapAngle } from './sliders.ts';
import { GEOMETRY } from './sliders.ts';
import { useMedia, usePref } from './prefs.ts';
import { decodeRaw, fmtShutter } from './raw.ts';
import { db } from './db.ts';
import { decodeBitmap } from './decode.ts';
import { syncLayers, retouchedThumb, exportLibrary, importLibrary, isEdited, FILTERS, albumsOf, inAlbum, byDate, withPreview, LABELS, LABEL_COLORS, base, buildPhoto, canOpenFolders, fileOf, importFolder, isImage, loadFolders, photoKey, writeSidecar, type Folder, type Photo } from './library.ts';
import { Library } from './Library.tsx';
import { Cull } from './Cull.tsx';
import { ExportDialog, SettingsDialog, SyncDialog } from './Batch.tsx';
import { aiEnabled, onAiChange, setAiEnabled } from './ai.ts';
import { developPreview, maskData } from './render.ts';
import type { Values } from './sliders.ts';
import { DenoisePanel, RemoveOverlay, RemovePanel } from './Remove.tsx';
import { MaskOverlay, MaskPanel, type MaskMode } from './Mask.tsx';
import { applyBrush, emptyMask, linearMask, radialMask, type Pt2 } from './mask-shapes.ts';
import { maskSize } from './sam-core.ts';
import { MASKS, MASK_ADJ, maskKey } from './sliders.ts';
import type { Pt } from './sam-core.ts';
import { NoiseField, ProceduralImageLoader } from './ProceduralImageLoader.tsx';

type Zoom = 'fit' | number; // number: 1 = 100% (one image pixel per device pixel)
const ZOOM_MAX = 8;

const withUrl = (p: Photo): Photo => ({ ...p, url: p.thumb ? URL.createObjectURL(p.thumb) : undefined });
const ago = (t: number) => { const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`; };

export function App() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [curId, setCurId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'library' | 'cull' | 'develop'>('library');
  const [filter, setFilter] = useState(0);
  const [album, setAlbum] = useState<string | null>(null);
  const mobile = useMedia('(max-width: 700px)');
  const [focus, setFocus] = useState(false);            // Focus mode: photo + one floating encoder
  const [lastTool, setLastTool] = usePref('lastTool', 'exposure'); // remembered per device
  const [tool, setTool] = usePref<'edit' | 'presets' | 'crop' | 'info' | 'remove' | 'denoise' | 'mask'>('tool', 'edit');
  const [brush, setBrush] = usePref('removeBrush', 3);
  const brushRef = useRef<HTMLCanvasElement | null>(null);
  const [rmBusy, setRmBusy] = useState(false), [rmMsg, setRmMsg] = useState('');
  const [aspect, setAspectName] = usePref('cropAspect', 'Free');
  const miniHist = useRef<HTMLCanvasElement>(null);
  const cropping = mode === 'develop' && tool === 'crop';
  const cropRef = useRef(false); cropRef.current = cropping; // crop works on the fitted view
  const swipe = useRef<number | null>(null);
  const [locked, setLocked] = useState<Folder[]>([]); // folders whose permission must be re-granted after a reload
  const granted = useRef(new Map<string, FileSystemDirectoryHandle>());
  const saved = useRef(new Map<string, Photo>());
  const [bypass, setBypass] = useState(false);
  const [zoom, setZoom] = useState<Zoom>('fit');
  const [nav, setNav] = useState({ x: 0, y: 0, w: 1, h: 1 });
  const [frame, setFrame] = useState(0);
  const [busy, setBusy] = useState('');
  const view = useRef<HTMLCanvasElement>(null), stage = useRef<HTMLDivElement>(null);
  const histC = useRef<HTMLCanvasElement>(null), navC = useRef<HTMLCanvasElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState<{ kind: 'export' | 'sync' | 'settings'; ids: string[] } | null>(null);
  const [ai, setAi] = useState(aiEnabled);
  useEffect(() => onAiChange(setAi), []);
  const removing = mode === 'develop' && tool === 'remove' && ai;
  const masking = mode === 'develop' && tool === 'mask'; // gradients + brush work without AI; only Select subject needs it
  const sourceView = removing || masking; // tools that work in the source frame: unrotated, uncropped
  const [toast, setToast] = useState<{ msg: string; fails: string[] } | null>(null);
  const [importPreset, setImportPreset] = usePref('importPreset', 'Original');
  const [importAuto, setImportAuto] = usePref('importAuto', false);
  useEffect(() => { if (toast && !toast.fails.length) { const t = setTimeout(() => setToast(null), 8000); return () => clearTimeout(t); } }, [toast]);
  const pipe = useRef<ReturnType<typeof createPipeline>>();
  const cur = photos.find(p => p.id === curId);

  // Swap a photo's thumbnail URL for one that includes its removals (or back to the original after a revert)
  const refreshThumb = async (p: Photo) => {
    const b = await retouchedThumb(p).catch(() => p.thumb);
    if (!b) return;
    const url = URL.createObjectURL(b);
    setPhotos(ps => ps.map(x => { if (x.id !== p.id) return x; if (x.url) URL.revokeObjectURL(x.url); return { ...x, url }; }));
  };
  const updateId = useCallback((id: string, f: (p: Photo) => Photo) => setPhotos(ps => ps.map(p => (p.id === id ? f(p) : p))), []);
  const update = useCallback((f: (p: Photo) => Photo) => setPhotos(ps => ps.map(p => (p.id === curId ? f(p) : p))), [curId]);

  // Restore the library on start (FIXER_IMPROVEMENTS §3: survives a reload)
  useEffect(() => {
    (async () => {
      // older records lack newer settings: fill them from defaults so the shader never sees undefined
      const stored = (await db.allPhotos<Photo>()).map(p => ({ ...p, v: { ...base(p), ...p.v }, hist: p.hist.map(h => ({ ...h, v: { ...base(p), ...h.v } })) }));
      // removals saved before they had history: attach the layer to the current step
      for (const [i, p] of stored.entries()) if (p.retouch && !p.layers) {
        const id = 'legacy';
        stored[i] = { ...p, layers: { [id]: p.retouch }, hist: p.hist.map((h, j) => (j === p.hi ? { ...h, rt: id } : h)) };
      }
      for (const p of stored) saved.current.set(p.id, p);
      setPhotos(stored.map(withUrl));
      const lock: Folder[] = [];
      for (const f of await loadFolders()) {
        if ((await f.handle.queryPermission({ mode: 'readwrite' })) === 'granted') granted.current.set(f.key, f.handle);
        else lock.push(f);
      }
      setLocked(lock);
      for (const p of stored) {
        if (p.preview) continue;
        const np = await withPreview(p);
        if (np) setPhotos(ps => ps.map(x => (x.id === p.id ? withUrl({ ...x, thumb: np.thumb, preview: np.preview }) : x)));
      }
      const last = await db.get<string>('lastPhoto');
      if (last && stored.some(p => p.id === last)) setCurId(last);
    })();
  }, []);

  // Persist changed photos to IndexedDB + their sidecar next to the original (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
      for (const p of photos) {
        if (saved.current.get(p.id) === p) continue;
        saved.current.set(p.id, p);
        const { url: _url, ...rec } = p;
        await db.putPhoto(rec);
        const dir = p.src.kind === 'handle' ? granted.current.get(p.src.folder) : undefined;
        if (dir) await writeSidecar(p, dir).catch(e => console.warn('Sidecar write failed', e));
      }
    }, 400);
    return () => clearTimeout(t);
  }, [photos]);
  useEffect(() => { if (curId) db.set('lastPhoto', curId); }, [curId]);

  /** Import preset + per-photo auto, checked step by step, with a summary afterwards (FIXER_IMPROVEMENTS §5). */
  const applyImport = async (added: Photo[]) => {
    const pr = PRESETS.find(p => p.name === importPreset && p.name !== 'Original');
    if (!added.length || (!pr && !importAuto)) return added;
    const out: Photo[] = [], fails: string[] = [];
    let kept = 0, preset = 0, auto = 0;
    for (const [i, p] of added.entries()) {
      if (isEdited(p)) { kept++; out.push(p); continue; } // sidecar edits win over the import preset
      setBusy(`Applying import settings ${i + 1} / ${added.length}…`);
      let v: Values = { ...base(p), ...pr?.v };
      if (pr) preset++;
      if (importAuto) {
        try { v = (await developPreview(p, a => ({ ...v, exposure: +a().toFixed(2) }))).v; auto++; }
        catch (e) { fails.push(`${p.name}: auto exposure skipped (${(e as Error).message})`); }
      }
      out.push(push(p, v, [pr && `Import preset: ${pr.name}`, importAuto && 'Auto'].filter(Boolean).join(' + ')));
    }
    const n = added.length, steps = [pr && `preset “${pr.name}” ${preset} of ${n}`, importAuto && `auto exposure ${auto} of ${n}`, kept && `${kept} kept their sidecar edits`].filter(Boolean);
    setToast({ msg: `Imported ${n} photo${n === 1 ? '' : 's'}: ${steps.join(' · ')}`, fails });
    return out;
  };

  const addPhotos = async (added: Photo[]) => {
    if (!added.length) return;
    added = await applyImport(added); setBusy('');
    setPhotos(ps => [...ps, ...added.map(withUrl)]);
    setCurId(id => id ?? added[0].id);
  };

  const addFiles = async (files: FileList | File[]) => {
    const added: Photo[] = [];
    for (const file of Array.from(files)) {
      if (!isImage(file.name, file.type)) continue;
      setBusy(`Importing ${file.name}…`);
      try { added.push(await buildPhoto(file, { kind: 'blob', blob: file })); }
      catch (e) { alert(`Couldn't open ${file.name}: ${(e as Error).message}`); }
    }
    setBusy('');
    await addPhotos(added);
  };

  const openFolder = async () => {
    try {
      const added = await importFolder(new Set(photos.map(photoKey)), setBusy);
      for (const f of await loadFolders()) {
        if (!granted.current.has(f.key) && (await f.handle.queryPermission({ mode: 'readwrite' })) === 'granted') granted.current.set(f.key, f.handle);
      }
      await addPhotos(added);
    } catch (e) { if ((e as Error).name !== 'AbortError') alert((e as Error).message); }
    setBusy('');
  };

  const reconnect = async (f: Folder) => {
    if ((await f.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return;
    granted.current.set(f.key, f.handle);
    setLocked(l => l.filter(x => x.key !== f.key));
    setLoadedId(null); // retry loading the current photo if it lives in that folder
  };

  const loadedRt = useRef<Blob | undefined>();
  useEffect(() => {
    if (cur && loadedId === cur.id && loadedRt.current !== cur.retouch) setLoadedId(null);
  }, [cur?.retouch]); // eslint-disable-line react-hooks/exhaustive-deps
  const thumbRt = useRef(new Map<string, Blob | undefined>());
  useEffect(() => {
    for (const p of photos) if (thumbRt.current.get(p.id) !== p.retouch) { const had = thumbRt.current.has(p.id); thumbRt.current.set(p.id, p.retouch); if (had || p.retouch) refreshThumb(p); }
  }, [photos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Masks: decode the current step's mask images and hand them to the GPU (on load, edit, undo/redo)
  const [maskVer, setMaskVer] = useState(0);
  const [maskImgs, setMaskImgs] = useState<(ImageData | undefined)[]>([]);
  useEffect(() => {
    if (!cur || loadedId !== cur.id || !pipe.current) return;
    let live = true;
    (async () => {
      const imgs = await maskData(cur);
      if (!live) return;
      pipe.current!.setMasks(imgs); setMaskImgs(imgs); setMaskVer(x => x + 1);
    })();
    return () => { live = false; };
  }, [cur?.masks, loadedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load current photo into the GPU
  useEffect(() => {
    if (!cur || !view.current || mode !== 'develop' || loadedId === cur.id) return;
    pipe.current ??= createPipeline(view.current);
    let live = true;
    setBusy(cur.raw ? 'Decoding RAW…' : 'Loading…');
    (async () => {
      const file = await fileOf(cur).catch(() => { throw new Error('reconnect its folder first (button in the top bar).'); });
      const patch = cur.retouch ? await createImageBitmap(cur.retouch, { premultiplyAlpha: 'none' }) : undefined;
      loadedRt.current = cur.retouch;
      if (cur.raw) { const r = await decodeRaw(file); if (live) await pipe.current!.load({ kind: 'raw', ...r }, patch); }
      else { const bmp = await decodeBitmap(file, cur.name); if (live) await pipe.current!.load({ kind: 'bitmap', bmp }, patch); bmp.close(); }
      patch?.close();
      if (live) { setLoadedId(cur.id); setZoom('fit'); }
    })().catch(e => alert(`Couldn't decode ${cur.name}: ${e.message}`)).finally(() => setBusy(''));
    return () => { live = false; };
  }, [curId, mode, loadedId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render + histogram + navigator
  useEffect(() => {
    if (!cur || loadedId !== cur.id || !view.current) return;
    {
      const geom = Object.fromEntries(GEOMETRY.map(k => [k, cur.v[k]]));
      const v = bypass ? { ...base(cur), ...geom } : cur.v;
      pipe.current!.render(sourceView ? { ...v, angle: 0, flipH: 0, flipV: 0 } : v, cur.asShot, cropping || sourceView); // Remove/Mask work on the unrotated full frame
      const h = histogram(view.current!);
      drawHist(histC.current!, h);
      if (miniHist.current) drawHist(miniHist.current, h);
      const n = navC.current!, k = Math.min(n.width / view.current!.width, n.height / view.current!.height);
      const g = n.getContext('2d')!;
      g.clearRect(0, 0, n.width, n.height);
      g.drawImage(view.current!, (n.width - view.current!.width * k) / 2, (n.height - view.current!.height * k) / 2, view.current!.width * k, view.current!.height * k);
      setFrame(f => f + 1);
    }
  }, [cur?.v, bypass, loadedId, cropping, sourceView, maskVer]); // eslint-disable-line react-hooks/exhaustive-deps

  const onScroll = () => {
    const s = stage.current!;
    setNav({ x: s.scrollLeft / s.scrollWidth, y: s.scrollTop / s.scrollHeight, w: s.clientWidth / s.scrollWidth, h: s.clientHeight / s.scrollHeight });
  };
  useEffect(onScroll, [zoom, frame]);

  // ---- Continuous zoom: wheel / trackpad pinch / touch pinch, anchored at the pointer; drag to pan ----
  const anchor = useRef<{ rx: number; ry: number; cx: number; cy: number } | null>(null);
  const PAD = () => (mobile ? 8 : 32);
  const fitScale = () => {
    const s = stage.current, c = view.current; if (!s || !c?.width) return 1;
    return Math.min((s.clientWidth - 2 * PAD()) / c.width, (s.clientHeight - 2 * PAD()) / c.height) * devicePixelRatio;
  };
  const scaleNow = () => (zoom === 'fit' ? fitScale() : zoom);
  /** Zoom to `next` keeping the image point under (clientX, clientY) in place. */
  const zoomAt = (next: number, clientX: number, clientY: number) => {
    const s = stage.current, c = view.current; if (!s || !c || !cur) return;
    const fit = fitScale(), z = Math.min(ZOOM_MAX, Math.max(fit, next));
    const cr = c.getBoundingClientRect(), sr = s.getBoundingClientRect();
    anchor.current = { rx: (clientX - cr.left) / cr.width, ry: (clientY - cr.top) / cr.height, cx: clientX - sr.left, cy: clientY - sr.top };
    setZoom(z <= fit * 1.001 ? 'fit' : +z.toFixed(4));
  };
  useLayoutEffect(() => {
    const a = anchor.current, s = stage.current, c = view.current; anchor.current = null;
    if (!a || !s || !c || zoom === 'fit') return;
    s.scrollLeft = c.offsetLeft + a.rx * c.offsetWidth - a.cx;
    s.scrollTop = c.offsetTop + a.ry * c.offsetHeight - a.cy;
  }, [zoom]);
  const zoomRef = useRef(zoomAt); zoomRef.current = zoomAt;
  const scaleRef = useRef(scaleNow); scaleRef.current = scaleNow;
  useEffect(() => {
    const s = stage.current; if (!s) return;
    // wheel: mouse wheel zooms; trackpad pinch arrives as ctrl+wheel with small deltas
    const wheel = (e: WheelEvent) => {
      if (!view.current?.width || cropRef.current) return;
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomRef.current(scaleRef.current() * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
    };
    // touch pinch (two fingers); one finger keeps native scrolling / the swipe gesture
    let pinch: { d: number; z: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const tstart = (e: TouchEvent) => { if (e.touches.length === 2 && !cropRef.current) { pinch = { d: dist(e.touches), z: scaleRef.current() }; swipe.current = null; } };
    const tmove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      zoomRef.current(pinch.z * dist(e.touches) / pinch.d, (e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
    };
    const tend = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    s.addEventListener('wheel', wheel, { passive: false });
    s.addEventListener('touchstart', tstart, { passive: true });
    s.addEventListener('touchmove', tmove, { passive: false });
    s.addEventListener('touchend', tend);
    return () => { s.removeEventListener('wheel', wheel); s.removeEventListener('touchstart', tstart); s.removeEventListener('touchmove', tmove); s.removeEventListener('touchend', tend); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // mouse drag pans while zoomed in
  const pan = useRef<{ x: number; y: number } | null>(null);

  // Actions
  const setVal = (k: string, x: number) => { setLastTool(k); update(p => ({ ...p, v: { ...p.v, [k]: x } })); };
  // Crop tool (FIXER_IMPROVEMENTS §4 geometry). Rect is a fraction of the straightened frame.
  const ratioOf = (name: string) => { const r = ASPECTS.find(a => a[0] === name)?.[1]; return r === 'orig' ? (cur ? frameAspect(cur.w, cur.h, cur.v.angle) : null) : r ?? null; };
  const setRect = (r: Rect) => update(p => ({ ...p, v: { ...p.v, ...r } }));
  // 90° turns keep the straighten part and carry the crop box along; flips mirror it
  const turn = (dir: 1 | -1) => update(p => {
    // the flip is applied on top of the rotation, so with one flip on, a visual clockwise turn is a counter-clockwise angle step
    const mirrored = !!p.v.flipH !== !!p.v.flipV, step = (mirrored ? -dir : dir) * 90;
    const a = wrapAngle(p.v.angle + step), r = orient(a).quarter !== orient(p.v.angle).quarter ? turnRect(p.v as Rect, dir) : (p.v as Rect);
    return push(p, { ...p.v, ...r, angle: a }, dir === 1 ? 'Rotate right' : 'Rotate left');
  });
  const flip = (axis: 'h' | 'v') => update(p => push(p, { ...p.v, ...flipRect(p.v as Rect, axis), [axis === 'h' ? 'flipH' : 'flipV']: p.v[axis === 'h' ? 'flipH' : 'flipV'] ? 0 : 1 }, axis === 'h' ? 'Flip horizontal' : 'Flip vertical'));
  const commitCrop = () => update(p => push(p, p.v, 'Crop'));
  const setAspect = (name: string) => {
    setAspectName(name);
    const r = ratioOf(name);
    if (cur && r) update(p => push(p, { ...p.v, ...fitAspect(p.v as Rect, r, frameAspect(p.w, p.h, p.v.angle)) }, `Crop ${name}`));
  };
  const resetKeys = (keys: string[], label: string) => update(p => {
    const b = base(p);
    return push(p, { ...p.v, ...Object.fromEntries(keys.map(k => [k, b[k]])) }, label);
  });
  const commit = () => update(p => push(p, p.v));
  // History steps can carry an AI Remove layer: syncLayers puts the right one in effect
  const jump = (i: number) => update(p => syncLayers(goto(p, i)));
  const undo = () => update(p => syncLayers(goto(p, p.hi - 1)));
  const redo = () => update(p => syncLayers(goto(p, p.hi + 1)));
  const auto = () => {
    if (!cur || !view.current) return;
    pipe.current!.render(base(cur), cur.asShot);
    const exposure = Math.round(autoExposure(histogram(view.current)) / 0.05) * 0.05;
    update(p => push(p, { ...p.v, exposure: +exposure.toFixed(2) }, 'Auto'));
  };
  // AI Remove: model sees the unedited image (earlier removals included); result goes into the photo's retouch layer
  /** Current retouch layer as straight-alpha pixels at the loaded size (or undefined). */
  const currentLayer = async (w: number, h: number) => {
    if (!cur?.retouch) return undefined;
    const bmp = await createImageBitmap(cur.retouch, { premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(w, h), g = c.getContext('2d')!;
    g.drawImage(bmp, 0, 0, w, h); bmp.close();
    return g.getImageData(0, 0, w, h);
  };
  /** Store a new layer version and add a history step for it. */
  const commitLayer = async (layer: ImageData, label: string) => {
    const c = new OffscreenCanvas(layer.width, layer.height); c.getContext('2d')!.putImageData(layer, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' }), id = crypto.randomUUID().slice(0, 8);
    update(p => syncLayers(pushStep({ ...p, layers: { ...p.layers, [id]: blob } }, label, { rt: id })));
  };

  // AI Remove: model sees the unedited image (earlier AI edits included); result goes into a new layer version
  const runRemove = async () => {
    if (!cur || !pipe.current || !brushRef.current) return;
    setRmBusy(true); setRmMsg('Removing… (first run downloads the model)');
    try {
      const { removeArea } = await import('./remove.ts');
      const baseImg = pipe.current.baseImage(), b = brushRef.current;
      const brushImg = b.getContext('2d')!.getImageData(0, 0, b.width, b.height);
      const layer = await removeArea(baseImg, brushImg, await currentLayer(baseImg.width, baseImg.height));
      b.getContext('2d')!.clearRect(0, 0, b.width, b.height);
      await commitLayer(layer, 'Remove'); setRmMsg('Removed. Undo with Ctrl+Z.');
    } catch (e) { setRmMsg(`Couldn't remove: ${(e as Error).message}`); }
    setRmBusy(false);
  };

  // AI Denoise (NAFNet): whole image, tiled, blended at the chosen strength
  const [dnStrength, setDnStrength] = usePref('denoiseStrength', 70);
  const [dn, setDn] = useState<{ done: number; total: number } | null>(null), [dnMsg, setDnMsg] = useState('');
  const dnAbort = useRef<AbortController | null>(null);
  const runDenoise = async () => {
    if (!cur || !pipe.current) return;
    const ac = new AbortController(); dnAbort.current = ac;
    setDnMsg('Loading model… (first run downloads ~60 MB)'); setDn({ done: 0, total: 1 });
    try {
      const { denoise } = await import('./denoise.ts');
      const baseImg = pipe.current.baseImage(), t0 = performance.now();
      const { layer, gpu } = await denoise(baseImg, dnStrength / 100, await currentLayer(baseImg.width, baseImg.height),
        (done, total) => { setDn({ done, total }); setDnMsg(''); }, ac.signal);
      await commitLayer(layer, `AI Denoise ${dnStrength}%`);
      setDnMsg(`Done in ${((performance.now() - t0) / 1000).toFixed(0)} s (${gpu ? 'WebGPU' : 'CPU'}). Undo with Ctrl+Z.`);
    } catch (e) { setDnMsg((e as Error).name === 'AbortError' ? 'Cancelled — nothing changed.' : `Couldn't denoise: ${(e as Error).message}`); }
    setDn(null); dnAbort.current = null;
  };
  // Masking: AI subject (MobileSAM), linear/radial gradients, brush. Each new or changed mask is a history step.
  const [maskSel, setMaskSel] = useState(0);
  const [mMode, setMMode] = useState<MaskMode>({ kind: 'idle' });
  const [pick, setPick] = useState<{ pts: Pt[]; preview?: ImageData }>({ pts: [] });
  const [work, setWork] = useState<{ slot: number; img: ImageData; label: string } | null>(null); // brush target
  const [showMask, setShowMask] = useState(false);
  const [mkBusy, setMkBusy] = useState(false), [mkMsg, setMkMsg] = useState('');
  const mBrush = useRef<HTMLCanvasElement | null>(null);
  const embKey = cur ? `${cur.id}:${cur.hist[cur.hi].rt ?? ''}` : '';
  const slots = Array.from({ length: MASKS }, (_, i) => !!cur?.masks?.[i]);
  const freeSlot = slots.indexOf(false);
  const mSize = view.current && masking ? maskSize(view.current.width, view.current.height) : { w: 1, h: 1 };
  const endMaskEdit = () => { setMMode({ kind: 'idle' }); setPick({ pts: [] }); setWork(null); };
  const commitMask = async (slot: number, img: ImageData, label: string) => {
    const c = new OffscreenCanvas(img.width, img.height); c.getContext('2d')!.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' }), id = crypto.randomUUID().slice(0, 8);
    update(p => {
      const mk = [...(p.hist[p.hi].mk ?? Array(MASKS).fill(''))]; mk[slot] = id;
      return syncLayers(pushStep({ ...p, layers: { ...p.layers, [id]: blob } }, label, { mk }));
    });
    setMaskSel(slot); endMaskEdit();
  };
  const newMask = async () => { // AI subject
    if (!cur || !pipe.current || freeSlot < 0) return;
    setMkBusy(true); setMkMsg('Analysing photo… (first run downloads ~25 MB)');
    try {
      const { embed } = await import('./sam.ts');
      await embed(embKey, pipe.current.baseImage());
      setPick({ pts: [] }); setMMode({ kind: 'pick' }); setMkMsg('');
    } catch (e) { setMkMsg(`Couldn't analyse: ${(e as Error).message}`); }
    setMkBusy(false);
  };
  const addPoint = async (pt: Pt) => {
    const pts = [...pick.pts, pt]; setPick(pk => ({ ...pk, pts })); setMkBusy(true);
    try { const { segment } = await import('./sam.ts'); const preview = await segment(embKey, pts); setPick({ pts, preview }); setMkMsg(''); }
    catch (e) { setMkMsg(`Couldn't select: ${(e as Error).message}`); }
    setMkBusy(false);
  };
  const finishMask = () => { if (!pick.preview) { setMkMsg('Click the subject first.'); return; } commitMask(freeSlot, pick.preview, `Mask ${freeSlot + 1} (subject)`); setMkMsg('Mask added. Adjust it below.'); };
  const onShape = (kind: 'linear' | 'radial', a: Pt2, b: Pt2) => {
    const m = kind === 'linear' ? linearMask(mSize.w, mSize.h, a, b) : radialMask(mSize.w, mSize.h, a, b);
    commitMask(freeSlot, new ImageData(m.data, m.width, m.height), `Mask ${freeSlot + 1} (${kind})`); setMkMsg('Mask added. Adjust it below.');
  };
  const startBrush = (slot: number, img: ImageData | undefined, label: string) => {
    const base = img ?? new ImageData(emptyMask(mSize.w, mSize.h).data, mSize.w, mSize.h);
    setWork({ slot, img: base, label }); setMMode({ kind: 'brush', add: true, size: 4 });
  };
  // each finished stroke is merged right away, so the tint shows the real result and Add/Subtract can be switched mid-edit
  const strokeEnd = () => {
    const b = mBrush.current; if (!b || !work || mMode.kind !== 'brush') return;
    const stroke = b.getContext('2d')!.getImageData(0, 0, b.width, b.height);
    const merged = applyBrush(work.img, stroke, mMode.add);
    b.getContext('2d')!.clearRect(0, 0, b.width, b.height);
    setWork({ ...work, img: new ImageData(merged.data, merged.width, merged.height) });
  };
  const deleteMask = (i: number) => update(p => {
    const mk = [...(p.hist[p.hi].mk ?? Array(MASKS).fill(''))]; mk[i] = '';
    const v = { ...p.v, ...Object.fromEntries([...MASK_ADJ.map(([k]) => k), 'inv', 'feather'].map(k => [maskKey(i, k), 0])) };
    return syncLayers(pushStep(p, `Delete mask ${i + 1}`, { mk, v }));
  });

  const exportJpeg = () => { if (cur) setDialog({ kind: 'export', ids: [cur.id] }); };
  const applySync = (vs: Map<string, Values>, label: string) => setPhotos(ps => ps.map(p => (vs.has(p.id) ? push(p, vs.get(p.id)!, label) : p)));

  const backup = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportLibrary(photos)], { type: 'application/json' }));
    a.download = `heirloom-library-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const restore = () => {
    const i = document.createElement('input'); i.type = 'file'; i.accept = '.json,application/json';
    i.onchange = async () => {
      try {
        const r = importLibrary(photos, await i.files![0].text());
        setPhotos(r.photos);
        setToast({ msg: `Restored edits for ${r.matched} of ${r.total} photos in the backup.`, fails: r.missing.map(m => `${m}: not in this library — import it first`) });
      } catch (e) { setToast({ msg: "Couldn't restore", fails: [(e as Error).message] }); }
    };
    i.click();
  };
  const moveTo = (ids: Set<string>, a: string) => setPhotos(ps => ps.map(p => (ids.has(p.id) ? { ...p, album: a || undefined } : p)));
  const clearLibrary = async () => {
    if (!confirm(`Remove all ${photos.length} photos from Heirloom? Edits stay in the .heirloom sidecars of opened folders; files imported without a folder lose their edits.`)) return;
    await db.clearAll();
    for (const p of photos) if (p.url) URL.revokeObjectURL(p.url);
    saved.current.clear(); granted.current.clear();
    setPhotos([]); setCurId(null); setLoadedId(null); setLocked([]); setAlbum(null); setMode('library');
  };

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // text fields keep their own keys; checkboxes, sliders and buttons don't swallow shortcuts
      const t = e.target as HTMLElement, typing = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes((t as HTMLInputElement).type));
      if (typing || mode !== 'develop') return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (e.key === '\\') setBypass(true);
      else if (!mod && e.key.toLowerCase() === 'f') setFocus(f => !f);
      else if (e.key === 'Escape' || (e.key === 'Enter' && tool === 'crop')) { setFocus(false); if (tool === 'crop') setTool('edit'); }
      else if (!mod && e.key.toLowerCase() === 'r') setTool(t => (t === 'crop' ? 'edit' : 'crop'));
      else if (!mod && (e.key === '[' || e.key === ']')) turn(e.key === ']' ? 1 : -1);
      else if (!mod && (e.key === '+' || e.key === '=' || e.key === '-') && !cropping) { const r = stage.current!.getBoundingClientRect(); zoomAt(scaleNow() * (e.key === '-' ? 1 / 1.25 : 1.25), r.left + r.width / 2, r.top + r.height / 2); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === '\\') setBypass(false); };
    addEventListener('keydown', down); addEventListener('keyup', up);
    return () => { removeEventListener('keydown', down); removeEventListener('keyup', up); };
  });

  const canvasStyle = zoom === 'fit' || !cur ? undefined : { width: ((view.current?.width ?? cur.w) * zoom) / devicePixelRatio, maxWidth: 'none', maxHeight: 'none' };
  useEffect(() => { if (cropping) setZoom('fit'); }, [cropping]);
  const list = photos.filter(p => FILTERS[filter][1](p) && inAlbum(album)(p)).sort(byDate); // Library order, also used by Cull + filmstrip
  const loading = mode === 'develop' && !!cur && loadedId !== cur.id;
  const activePreset = cur && PRESETS.find(p => same(cur.v, { ...base(cur), ...p.v }))?.name;

  return (
    <div className={'app' + (mode !== 'develop' ? ' lib' : '') + (focus && mode === 'develop' ? ' focus' : '') + (mobile ? ' mobile' : '')} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
      {mobile ? (
        <header className="top m-top">
          {mode === 'develop' ? <>
            <button className="icon" aria-label="Back to library" onClick={() => { setMode('library'); setFocus(false); }}><Icon d="M15 18l-6-6 6-6" /></button>
            <div className="m-title">
              <div>{cur?.name.replace(/\.[^.]+$/, '')}</div>
              <div className="m-sub">{busy || [cur?.raw ? 'RAW' : cur?.name.split('.').pop()?.toUpperCase(), cur?.exif.aperture && `ƒ/${+cur.exif.aperture.toFixed(1)}`, cur?.exif.shutter && fmtShutter(cur.exif.shutter), cur?.exif.iso && `ISO ${cur.exif.iso}`].filter(Boolean).join(' · ')}</div>
            </div>
            <button className="icon" aria-label="Undo" onClick={undo} disabled={!cur || cur.hi === 0}><Icon d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></button>
            <button className="icon accent" aria-label="Export" onClick={exportJpeg} disabled={!cur}><Icon d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" /></button>
          </> : <h1 className="m-h1">Library</h1>}
          {locked.map(f => <button key={f.key} className="ghost bordered" onClick={() => reconnect(f)}>Reconnect</button>)}
        </header>
      ) : (
      <header className="top">
        <div className="logo"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.75" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.5" /></svg>Heirloom</div>
        <nav aria-label="Modules">
          <button className={mode === 'library' ? 'on' : ''} aria-current={mode === 'library' ? 'page' : undefined} onClick={() => setMode('library')}>Library</button>
          <button className={mode === 'cull' ? 'on' : ''} aria-current={mode === 'cull' ? 'page' : undefined} onClick={() => { if (!cur && list.length) setCurId(list[0].id); setMode('cull'); }} disabled={!photos.length} title="Fast culling (keyboard)">Cull</button>
          <button className={mode === 'develop' ? 'on' : ''} aria-current={mode === 'develop' ? 'page' : undefined} onClick={() => setMode('develop')} disabled={!cur}>Develop</button>
        </nav>
        <div className="title">{busy || (mode === 'develop' && cur ? `${cur.name} · ${cur.w} × ${cur.h}` : '')}</div>
        {locked.map(f => <button key={f.key} className="ghost bordered" onClick={() => reconnect(f)} title="The browser asks for folder access again after a reload">Reconnect “{f.handle.name}”</button>)}
        <button className="icon" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!cur || cur.hi === 0}><Icon d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></button>
        <button className="icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!cur || cur.hi === cur.hist.length - 1}><Icon d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></button>
        <button className="icon" aria-label="Settings" title="Settings" onClick={() => setDialog({ kind: 'settings', ids: [] })}><Icon d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></button>
        <button className="primary" onClick={exportJpeg} disabled={!cur}>Export</button>
      </header>
      )}

      {mode === 'library' && (
        <Library photos={photos} filter={filter} setFilter={setFilter} onOpen={id => { setCurId(id); setMode('develop'); }}
          onImport={() => fileIn.current!.click()} onOpenFolder={canOpenFolders() ? openFolder : undefined}
          albums={albumsOf(photos)} album={album} setAlbum={setAlbum} onMove={moveTo} onClear={clearLibrary} onBackup={backup} onRestore={restore}
          onExport={ids => setDialog({ kind: 'export', ids })} onSync={ids => setDialog({ kind: 'sync', ids: ids.filter(id => id !== curId) })} syncSource={curId ?? undefined}
          importPreset={importPreset} setImportPreset={setImportPreset} importAuto={importAuto} setImportAuto={setImportAuto} />
      )}

      {mode === 'cull' && (
        <Cull photos={list} index={Math.max(0, list.findIndex(p => p.id === curId))} setIndex={i => setCurId(list[i].id)}
          update={updateId} onDevelop={() => setMode('develop')} onExit={() => setMode('library')} />
      )}

      <aside className="left scroll">
        <h4>Navigator</h4>
        <div className="navigator" onClick={e => {
          if (zoom === 'fit') return;
          const r = e.currentTarget.getBoundingClientRect(), s = stage.current!;
          s.scrollTo({ left: ((e.clientX - r.left) / r.width) * s.scrollWidth - s.clientWidth / 2, top: ((e.clientY - r.top) / r.height) * s.scrollHeight - s.clientHeight / 2 });
        }}>
          <canvas ref={navC} width={348} height={232} />
          {zoom !== 'fit' && <div className="navrect" style={{ left: `${nav.x * 100}%`, top: `${nav.y * 100}%`, width: `${nav.w * 100}%`, height: `${nav.h * 100}%` }} />}
        </div>
        <h4>Presets</h4>
        {PRESETS.map(p => (
          <button key={p.name} className={'preset' + (activePreset === p.name ? ' on' : '')} disabled={!cur}
            onClick={() => update(ph => push(ph, { ...base(ph), ...p.v }, `Preset: ${p.name}`))}>
            <span style={{ background: p.swatch }} />{p.name}
          </button>
        ))}
        <h4>History</h4>
        <ol className="history">
          {cur && [...cur.hist.keys()].reverse().map(i => (
            <li key={i}><button className={i === cur.hi ? 'on' : i > cur.hi ? 'future' : ''} onClick={() => jump(i)}>
              <span>{cur.hist[i].label}</span><span>{ago(cur.hist[i].t)}</span>
            </button></li>
          ))}
        </ol>
      </aside>

      <main className="center">
        <div className="stage scroll" ref={stage} onScroll={onScroll} data-zoom={zoom === 'fit' ? 'fit' : 'in'}
          onPointerDown={e => { if (zoom !== 'fit' && e.pointerType === 'mouse' && e.button === 0) { pan.current = { x: e.clientX, y: e.clientY }; e.currentTarget.setPointerCapture(e.pointerId); } }}
          onPointerMove={e => { const p = pan.current; if (!p) return; e.currentTarget.scrollBy(p.x - e.clientX, p.y - e.clientY); pan.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={() => { pan.current = null; }}
          onDoubleClick={e => { if (!cropping) zoom === 'fit' ? zoomAt(1, e.clientX, e.clientY) : setZoom('fit'); }}
          onTouchStart={e => { swipe.current = e.touches.length === 1 ? e.touches[0].clientY : null; }}
          onTouchEnd={e => { const y0 = swipe.current; swipe.current = null; if (y0 !== null && zoom === 'fit' && Math.abs(e.changedTouches[0].clientY - y0) > 80) setFocus(f => !f); }}>
          {!cur && <div className="empty">Drop photos anywhere or <button className="primary" onClick={() => fileIn.current!.click()}>Import…</button></div>}
          <canvas ref={view} hidden={!cur} style={canvasStyle} />
        </div>
        {/* Heavy decode (RAW demosaic, GPU upload) → animated field so the app never looks frozen */}
        <div className={'stage-loader' + (loading ? ' on' : '')} aria-hidden={!loading}>
          {cur?.url && <img className="ghost-preview" src={cur.url} alt="" />}
          <NoiseField active={loading} className="aurora" />
          <span className="shimmer-text" role="status">{busy || 'Developing…'}</span>
        </div>
        {masking && cur && view.current && loadedId === cur.id && (
          <MaskOverlay canvas={view.current} mode={mMode} pts={mMode.kind === 'pick' ? pick.pts : []} maskW={work?.img.width ?? mSize.w} maskH={work?.img.height ?? mSize.h} brushRef={mBrush}
            mask={mMode.kind === 'pick' ? pick.preview : mMode.kind === 'brush' ? work?.img : showMask ? maskImgs[maskSel] : undefined}
            onPoint={addPoint} onShape={onShape} onStrokeEnd={strokeEnd} />
        )}
        {removing && cur && view.current && loadedId === cur.id && <RemoveOverlay canvas={view.current} brushRef={brushRef} size={brush} />}
        {cropping && cur && view.current && loadedId === cur.id && (
          <CropOverlay canvas={view.current} rect={cur.v as Rect} ratio={ratioOf(aspect)} frameAspect={frameAspect(cur.w, cur.h, cur.v.angle)} onChange={setRect} onCommit={commitCrop} />
        )}
        {mobile && cur && <>
          <canvas className="mini-hist" ref={miniHist} width={192} height={64} aria-hidden="true" />
          <button className="pill m-compare" onClick={() => setBypass(b => !b)} aria-pressed={bypass}><Icon d="M3 4h18v16H3zM12 4v16" /> {bypass ? 'Before' : 'After'}</button>
        </>}
        {focus && cur && (
          <div className="focus-enc" role="group" aria-label="Focus mode">
            <Encoder s={lastTool === 'temp' ? { ...byKey.temp, def: cur.asShot } : byKey[lastTool] ?? byKey.exposure}
              value={cur.v[lastTool] ?? cur.v.exposure} onChange={x => setVal(byKey[lastTool] ? lastTool : 'exposure', x)} onCommit={commit} idPrefix="focus" />
            <button className="ghost" onClick={() => setFocus(false)} title="Exit Focus mode (F or Esc)">Exit</button>
          </div>
        )}
        <div className="bottom">
          <button className={'pill' + (bypass ? ' on' : '')} onClick={() => setBypass(b => !b)} disabled={!cur} title="Hold \ to peek">
            <Icon d="M3 4h18v16H3zM12 4v16" /> {bypass ? 'Before' : 'Before / After'}
          </button>
          {(['fit', 1, 2] as Zoom[]).map(z => (
            <button key={z} className={'pill' + (zoom === z ? ' on' : '')} onClick={() => { if (z === 'fit') setZoom('fit'); else { const r = stage.current!.getBoundingClientRect(); zoomAt(z, r.left + r.width / 2, r.top + r.height / 2); } }} disabled={!cur || cropping}>{z === 'fit' ? 'Fit' : `${z * 100}%`}</button>
          ))}
          {cur && zoom !== 'fit' && <span className="zoom-pct" aria-live="polite">{Math.round(zoom * 100)}%</span>}
          <button className={'pill' + (focus ? ' on' : '')} onClick={() => setFocus(f => !f)} disabled={!cur} title="Focus mode (F)">Focus</button>
          <span className="grow" />
          <div className="stars" role="radiogroup" aria-label="Rating">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} role="radio" aria-checked={cur?.rating === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} disabled={!cur}
                className={cur && n <= cur.rating ? 'on' : ''} onClick={() => update(p => ({ ...p, rating: p.rating === n ? 0 : n }))}>★</button>
            ))}
          </div>
          <button className={'icon' + (cur?.flag ? ' accent' : '')} aria-label="Pick flag" aria-pressed={!!cur?.flag} disabled={!cur}
            onClick={() => update(p => ({ ...p, flag: !p.flag }))}><Icon d="M5 21V4h11l-2 4 2 4H5" /></button>
          <div className="labels" role="radiogroup" aria-label="Color label">
            {LABELS.slice(1).map((name, i) => (
              <button key={name} role="radio" aria-checked={cur?.label === i + 1} aria-label={name} title={name} disabled={!cur}
                style={{ background: LABEL_COLORS[i + 1] }} className={cur?.label === i + 1 ? 'on' : ''}
                onClick={() => update(p => ({ ...p, label: p.label === i + 1 ? 0 : i + 1 }))} />
            ))}
          </div>
        </div>
      </main>

      <aside className="right scroll">
        <canvas className="hist" ref={histC} width={448} height={156} />
        <div className="exif" title={cur?.exif.camera}>
          <span>ISO {cur?.exif.iso || '—'}</span><span>{cur?.exif.focal ? Math.round(cur.exif.focal) : '—'} mm</span>
          <span>ƒ/{cur?.exif.aperture ? +cur.exif.aperture.toFixed(1) : '—'}</span><span>{fmtShutter(cur?.exif.shutter)}</span>
        </div>
        <div className="tools" role="tablist">
          <ToolTab id="edit" tool={tool} setTool={setTool} label="Edit" d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M16 4v4M10 10v4M18 16v4" />
          <ToolTab id="crop" tool={tool} setTool={setTool} label="Crop & straighten (R)" d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" />
          {ai && <ToolTab id="denoise" tool={tool} setTool={setTool} label="AI Denoise (on-device)" d="M4 4h2v2H4zM10 4h2v2h-2zM16 4h2v2h-2zM7 10h2v2H7zM13 10h2v2h-2zM4 16h2v2H4zM10 16h2v2h-2zM16 16h2v2h-2zM19 10h2v2h-2z" />}
          {ai && <ToolTab id="remove" tool={tool} setTool={setTool} label="Remove (AI, on-device)" d="m3 21 12-12M15 4V2M15 10V8M19 6h2M11 6h2M17.5 3.5 19 2M17.5 8.5 19 10" />}
          <ToolTab id="mask" tool={tool} setTool={setTool} label="Masking" d="M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18" />
          <ToolTab id="info" tool={tool} setTool={setTool} label="Info (EXIF)" d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />
        </div>
        {masking && cur ? (
          <MaskPanel ai={ai} slots={slots} sel={maskSel} setSel={setMaskSel} mode={mMode} setMode={setMMode} busy={mkBusy} msg={mkMsg} v={cur.v} byKey={byKey}
            setVal={setVal} commit={commit} showMask={showMask} setShowMask={setShowMask}
            onAI={newMask} onFinishAI={finishMask} onCancel={() => { endMaskEdit(); setMkMsg(''); }}
            onLinear={() => setMMode({ kind: 'linear' })} onRadial={() => setMMode({ kind: 'radial' })}
            onBrushNew={() => startBrush(freeSlot, undefined, `Mask ${freeSlot + 1} (brush)`)} onRefine={() => startBrush(maskSel, maskImgs[maskSel], `Refine mask ${maskSel + 1}`)}
            onApplyBrush={() => work && commitMask(work.slot, work.img, work.label)}
            onDelete={deleteMask} done={() => { endMaskEdit(); setTool('edit'); }} />
        ) : tool === 'denoise' && ai && cur ? (
          <DenoisePanel strength={dnStrength} setStrength={setDnStrength} progress={dn} msg={dnMsg} pixels={cur.w * cur.h}
            onRun={runDenoise} onCancel={() => dnAbort.current?.abort()} done={() => setTool('edit')} />
        ) : removing && cur ? (
          <RemovePanel size={brush} setSize={setBrush} busy={rmBusy} msg={rmMsg} hasRetouch={!!cur.retouch} done={() => setTool('edit')}
            onRemove={runRemove} onClear={() => { const b = brushRef.current; b?.getContext('2d')!.clearRect(0, 0, b.width, b.height); }}
            onRevert={() => { update(p => syncLayers(pushStep(p, 'Revert removals', { rt: undefined }))); setRmMsg('Reverted. Undo with Ctrl+Z.'); }} />
        ) : cropping && cur ? (
          <CropPanel v={cur.v} aspect={aspect} setAspect={setAspect} angle={byKey.angle} setAngle={x => setVal('angle', x)} commit={commit}
            reset={() => resetKeys(GEOMETRY, 'Reset crop')} done={() => setTool('edit')} turn={turn} flip={flip} />
        ) : tool === 'info' && !mobile ? (
          <InfoPanel p={cur} />
        ) : mobile && tool === 'presets' ? (
          <div className="m-presets">
            {PRESETS.map(p => (
              <button key={p.name} className={'preset' + (activePreset === p.name ? ' on' : '')} disabled={!cur}
                onClick={() => update(ph => push(ph, { ...base(ph), ...p.v }, `Preset: ${p.name}`))}>
                <span style={{ background: p.swatch }} />{p.name}
              </button>
            ))}
          </div>
        ) : (
          <Adjustments cur={cur} mobile={mobile} setVal={setVal} commit={commit} resetKeys={resetKeys} auto={auto} />
        )}
      </aside>

      {mobile && mode === 'develop' && (
        <nav className="m-nav" aria-label="Edit tools">
          <MNav icon="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" label="Presets" on={tool === 'presets'} onClick={() => setTool('presets')} />
          <MNav icon="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" label="Crop" on={tool === 'crop'} onClick={() => setTool('crop')} />
          <MNav icon="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4" label="Edit" on={tool === 'edit' || tool === 'info'} onClick={() => setTool('edit')} />
          <MNav icon="M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18" label="Masking" on={tool === 'mask'} onClick={() => setTool('mask')} />
          {ai && <MNav icon="M4 4h2v2H4zM10 4h2v2h-2zM16 4h2v2h-2zM7 10h2v2H7zM13 10h2v2h-2zM4 16h2v2H4zM10 16h2v2h-2z" label="Denoise" on={tool === 'denoise'} onClick={() => setTool('denoise')} />}
          {ai && <MNav icon="m3 21 12-12M15 4V2M15 10V8M19 6h2M11 6h2" label="Remove" on={tool === 'remove'} onClick={() => setTool('remove')} />}
        </nav>
      )}
      {mobile && mode !== 'develop' && (
        <nav className="m-nav" aria-label="Sections">
          <MNav icon="M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21" label="Photos" on />
          <MNav icon="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" label="Albums" disabled />
          <MNav icon="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" label="Presets" disabled />
          <MNav icon="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" label="Settings" onClick={() => setDialog({ kind: 'settings', ids: [] })} />
        </nav>
      )}

      <footer className="film scroll" aria-label="Filmstrip">
        {list.map(p => (
          <button key={p.id} className={p.id === curId ? 'on' : ''} onClick={() => setCurId(p.id)} aria-label={p.name}>
            {p.url ? <ProceduralImageLoader src={p.url} alt="" className="fill" /> : <span className="noprev">RAW</span>}
          </button>
        ))}
        <button className="add" onClick={() => fileIn.current!.click()} aria-label="Import photos">+</button>
        <input ref={fileIn} type="file" multiple hidden onChange={e => { addFiles(e.target.files!); e.target.value = ''; }} />
      </footer>
      {dialog?.kind === 'settings' && <SettingsDialog ai={ai} setAi={setAiEnabled} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'export' && <ExportDialog photos={dialog.ids.map(id => photos.find(p => p.id === id)!).filter(Boolean)} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'sync' && cur && <SyncDialog source={cur} targets={dialog.ids.map(id => photos.find(p => p.id === id)!).filter(Boolean)} onApply={applySync} onClose={() => setDialog(null)} />}
      {toast && (
        <div className="toast" role="status">
          <div>{toast.msg}{toast.fails.length > 0 && <ul>{toast.fails.map(f => <li key={f}>{f}</li>)}</ul>}</div>
          <button className="ghost" onClick={() => setToast(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
    </div>
  );
}

function ToolTab({ id, tool, setTool, label, d }: { id: 'edit' | 'crop' | 'info' | 'remove' | 'denoise' | 'mask'; tool: string; setTool: (t: 'edit' | 'crop' | 'info' | 'remove' | 'denoise' | 'mask') => void; label: string; d: string }) {
  const on = tool === id || (id === 'edit' && tool === 'presets');
  return <button role="tab" aria-selected={on} className={on ? 'on' : ''} aria-label={label} title={label} onClick={() => setTool(id)}><Icon d={d} /></button>;
}

/** Full metadata panel (FIXER_IMPROVEMENTS §4). */
function InfoPanel({ p }: { p?: Photo }) {
  if (!p) return <section className="adjust"><p className="muted">No photo selected.</p></section>;
  const e = p.exif, size = p.src.kind === 'blob' ? p.src.blob.size : undefined;
  const rows: [string, string | number | undefined][] = [
    ['File', p.name], ['Format', p.raw ? `RAW (${p.name.split('.').pop()?.toUpperCase()})` : p.name.split('.').pop()?.toUpperCase()],
    ['Dimensions', `${p.w} × ${p.h}`], ['Megapixels', (p.w * p.h / 1e6).toFixed(1)],
    ['File size', size ? `${(size / 1048576).toFixed(1)} MB` : undefined],
    ['Captured', new Date(p.date).toLocaleString()], ['Camera', e.camera], ['Lens', e.lens],
    ['Focal length', e.focal ? `${Math.round(e.focal)} mm${e.focal35 ? ` (${e.focal35} mm eq.)` : ''}` : undefined],
    ['Aperture', e.aperture ? `ƒ/${+e.aperture.toFixed(1)}` : undefined], ['Shutter', e.shutter ? fmtShutter(e.shutter) : undefined],
    ['ISO', e.iso], ['As-shot WB', p.raw ? `${p.asShot} K` : undefined], ['Artist', e.artist],
    ['Rating', p.rating ? '★'.repeat(p.rating) : undefined], ['Label', p.label ? LABELS[p.label] : undefined],
    ['Edits', `${p.hi} step${p.hi === 1 ? '' : 's'}`],
  ];
  return (
    <section className="adjust info">
      <div className="sec-head"><h3>Info</h3></div>
      <dl>{rows.filter(([, val]) => val !== undefined && val !== '').map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>
      {!p.raw && <p className="muted small">Camera details for JPEG/PNG aren't read yet; RAW files show full metadata.</p>}
    </section>
  );
}

function MNav({ icon, label, on, disabled, onClick }: { icon: string; label: string; on?: boolean; disabled?: boolean; onClick?: () => void }) {
  return (
    <button className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} disabled={disabled} onClick={onClick} title={disabled ? 'Coming in a later phase' : undefined}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
      {label}
    </button>
  );
}

function Icon({ d }: { d: string }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

function drawHist(c: HTMLCanvasElement, h: Uint32Array[]) {
  const g = c.getContext('2d')!, W = c.width, H = c.height;
  // smooth each channel with a small box blur so it reads as soft hills like the design
  const sm = h.map(a => Array.from(a, (_, i) => { let s = 0; for (let j = -3; j <= 3; j++) s += a[Math.min(255, Math.max(0, i + j))]; return s / 7; }));
  const max = Math.max(...sm.flatMap(a => a.slice(2, 254))) || 1;
  g.clearRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  ['rgba(200,60,60,.55)', 'rgba(70,150,80,.55)', 'rgba(70,100,200,.55)'].forEach((col, k) => {
    g.beginPath(); g.moveTo(0, H);
    sm[k].forEach((v, x) => g.lineTo((x / 255) * W, H - Math.min(1, v / max) * H * 0.95));
    g.lineTo(W, H); g.closePath(); g.fillStyle = col; g.fill();
  });
  g.globalCompositeOperation = 'source-over';
}
