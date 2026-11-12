import { useEffect, useMemo, useRef, useState } from 'react';
import type { Link } from './p2p.ts';
import type { Summary } from './sync-run.ts';
import { BUILTIN_EXPORTS, SHARPEN, encode, outName, type ExportPreset, type Format } from './export.ts';
import { GROUPS, planSync, type SyncOpts } from './sync.ts';
import { developFull, developPreview } from './render.ts';
import { usePref } from './prefs.ts';
import type { Photo } from './library.ts';
import type { Values } from './sliders.ts';
import { AI_MODULES, MODELS, modelInstalled, removeAiData, storedAiData, type StoredItem } from './ai.ts';

type Result = { id: string; name: string; ok: boolean; why?: string };

function Modal({ title, onClose, children, foot }: { title: string; onClose: () => void; children: React.ReactNode; foot: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="modal-bg" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><h3>{title}</h3><button className="icon" aria-label="Close" onClick={onClose}>✕</button></div>
        <div className="modal-body scroll">{children}</div>
        <div className="modal-foot">{foot}</div>
      </div>
    </div>
  );
}

/** Lists exactly which photos failed and why (§5 acceptance). */
function Report({ results, verb }: { results: Result[]; verb: string }) {
  const bad = results.filter(r => !r.ok);
  return (
    <div className="report" role="status">
      <p><b>{results.length - bad.length} of {results.length}</b> photo{results.length === 1 ? '' : 's'} {verb}.</p>
      {bad.length > 0 && <ul className="fails">{bad.map(r => <li key={r.id}><b>{r.name}</b> — {r.why}</li>)}</ul>}
    </div>
  );
}

// ---------------- Export ----------------
export function ExportDialog({ photos, onClose }: { photos: Photo[]; onClose: () => void }) {
  const [mine, setMine] = usePref<ExportPreset[]>('exportPresets', []);
  const all = [...BUILTIN_EXPORTS, ...mine];
  const [pick, setPick] = usePref('exportPick', BUILTIN_EXPORTS[0].name);
  const [p, setP] = useState<ExportPreset>(() => all.find(x => x.name === pick) ?? all[0]);
  const [prog, setProg] = useState<string>(''), [results, setResults] = useState<Result[] | null>(null);
  const set = <K extends keyof ExportPreset>(k: K, x: ExportPreset[K]) => setP(o => ({ ...o, [k]: x }));
  const choose = (name: string) => { const x = all.find(a => a.name === name); if (x) { setP(x); setPick(name); } };
  const save = () => {
    const name = prompt('Preset name', p.name.endsWith('(copy)') || mine.some(m => m.name === p.name) ? p.name : `${p.name} (copy)`)?.trim();
    if (!name || BUILTIN_EXPORTS.some(b => b.name === name)) return;
    setMine(m => [...m.filter(x => x.name !== name), { ...p, name }]); setP(o => ({ ...o, name })); setPick(name);
  };
  const remove = () => { setMine(m => m.filter(x => x.name !== p.name)); choose(BUILTIN_EXPORTS[0].name); };

  const run = async () => {
    // Many files: write into one chosen folder where possible instead of a download per photo
    let dir: FileSystemDirectoryHandle | undefined;
    if (photos.length > 1 && 'showDirectoryPicker' in window) {
      try { dir = await window.showDirectoryPicker!({ mode: 'readwrite' }); } catch (e) { if ((e as Error).name === 'AbortError') return; }
    }
    const out: Result[] = [];
    for (const [i, ph] of photos.entries()) {
      setProg(`Exporting ${i + 1} / ${photos.length}: ${ph.name}`);
      try {
        const blob = await developFull(ph, ph.v, c => encode(c, p));
        const name = outName(ph.name, p);
        if (dir) { const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); await w.write(blob); await w.close(); }
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
        out.push({ id: ph.id, name: ph.name, ok: true });
      } catch (e) { out.push({ id: ph.id, name: ph.name, ok: false, why: (e as Error).message || String(e) }); }
    }
    setProg(''); setResults(out);
  };
  const builtin = BUILTIN_EXPORTS.some(b => b.name === p.name);

  return (
    <Modal title={`Export ${photos.length} photo${photos.length === 1 ? '' : 's'}`} onClose={onClose} foot={<>
      {prog && <span className="muted grow">{prog}</span>}
      {!prog && <span className="grow" />}
      <button className="ghost bordered" onClick={onClose}>{results ? 'Close' : 'Cancel'}</button>
      <button className="primary" onClick={run} disabled={!!prog || !photos.length}>Export</button>
    </>}>
      <div className="form">
        <label>Preset<select value={all.some(a => a.name === p.name) ? p.name : ''} onChange={e => choose(e.target.value)}>
          {!all.some(a => a.name === p.name) && <option value="">{p.name} (unsaved)</option>}
          {all.map(a => <option key={a.name} value={a.name}>{a.name}</option>)}
        </select></label>
        <div className="row"><button className="ghost bordered" onClick={save}>Save as preset…</button>{!builtin && mine.some(m => m.name === p.name) && <button className="ghost bordered" onClick={remove}>Delete preset</button>}</div>
        <label>Format<select value={p.format} onChange={e => set('format', e.target.value as Format)}>
          <option value="jpeg">JPEG</option><option value="webp">WebP</option><option value="avif">AVIF</option><option value="tiff">TIFF (8-bit, uncompressed)</option>
        </select></label>
        {p.format !== 'tiff' && <label>Quality<input type="number" min={1} max={100} value={p.quality} onChange={e => set('quality', Math.min(100, Math.max(1, +e.target.value || 1)))} /></label>}
        <label>Long edge (px, 0 = full)<input type="number" min={0} step={1} value={p.long} onChange={e => set('long', Math.max(0, Math.round(+e.target.value || 0)))} /></label>
        <label>Output sharpening<select value={p.sharpen} onChange={e => set('sharpen', +e.target.value as ExportPreset['sharpen'])}>
          {SHARPEN.map((s, i) => <option key={s} value={i}>{s}</option>)}
        </select></label>
        <label>Watermark<input type="text" placeholder="None" value={p.watermark} onChange={e => set('watermark', e.target.value)} /></label>
        <label>File suffix<input type="text" value={p.suffix} onChange={e => set('suffix', e.target.value)} /></label>
        <p className="muted small">e.g. {photos[0] ? outName(photos[0].name, p) : '—'}</p>
      </div>
      {results && <Report results={results} verb="exported" />}
    </Modal>
  );
}

// ---------------- Sync with batch preview ----------------
type Prev = { id: string; url?: string; v?: Values; notes: string[]; err?: string };

export function SyncDialog({ source, targets, onApply, onClose }: { source: Photo; targets: Photo[]; onApply: (vs: Map<string, Values>, label: string) => void; onClose: () => void }) {
  const [groups, setGroups] = usePref<string[]>('syncGroups', GROUPS.filter(g => g.on).map(g => g.id));
  const [autoExp, setAutoExp] = usePref('syncAuto', false);
  const opts: SyncOpts = useMemo(() => ({ groups: new Set(groups), autoExposure: autoExp }), [groups, autoExp]);
  const [prev, setPrev] = useState<Prev[]>([]);
  const [done, setDone] = useState<Result[] | null>(null);

  useEffect(() => {
    let live = true; const urls: string[] = [];
    setPrev(targets.map(t => ({ id: t.id, notes: [] })));
    (async () => {
      for (const t of targets) {
        let r: Prev;
        try {
          const { v, blob } = await developPreview(t, auto => planSync(source, t, opts, auto).v);
          const url = URL.createObjectURL(blob); urls.push(url);
          r = { id: t.id, url, v, notes: planSync(source, t, { ...opts, autoExposure: false }).notes.concat(opts.autoExposure ? [`auto exposure ${v.exposure > 0 ? '+' : ''}${v.exposure.toFixed(3)}`] : []) };
        } catch (e) {
          // Preview failed: still apply if the settings themselves merge fine, but say why there's no preview
          r = { id: t.id, notes: [], err: (e as Error).message };
        }
        if (!live) return;
        setPrev(ps => ps.map(x => (x.id === t.id ? r : x)));
      }
    })();
    return () => { live = false; urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [opts, source.id, targets.map(t => t.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = prev.every(p => p.v || p.err);
  const apply = () => {
    const vs = new Map<string, Values>(), res: Result[] = [];
    for (const t of targets) {
      const p = prev.find(x => x.id === t.id);
      if (p?.v) { vs.set(t.id, p.v); res.push({ id: t.id, name: t.name, ok: true }); }
      else if (!opts.autoExposure) { vs.set(t.id, planSync(source, t, opts).v); res.push({ id: t.id, name: t.name, ok: true }); }
      else res.push({ id: t.id, name: t.name, ok: false, why: `auto exposure needs a preview: ${p?.err ?? 'not rendered'}` });
    }
    onApply(vs, `Sync from ${source.name}`); setDone(res);
  };
  const toggle = (id: string) => setGroups(g => (g.includes(id) ? g.filter(x => x !== id) : [...g, id]));

  return (
    <Modal title={`Sync settings from ${source.name} → ${targets.length} photo${targets.length === 1 ? '' : 's'}`} onClose={onClose} foot={<>
      <span className="muted grow">{ready ? 'Preview from stored previews; full quality on export.' : 'Rendering previews…'}</span>
      <button className="ghost bordered" onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
      {!done && <button className="primary" onClick={apply} disabled={!ready || !groups.length}>Apply to {targets.length}</button>}
    </>}>
      <div className="chips wrap">
        {GROUPS.map(g => <button key={g.id} className={groups.includes(g.id) ? 'on' : ''} aria-pressed={groups.includes(g.id)} onClick={() => toggle(g.id)}>{g.label}</button>)}
        <label className="check"><input type="checkbox" checked={autoExp} onChange={e => setAutoExp(e.target.checked)} /> Auto exposure per photo</label>
      </div>
      {done ? <Report results={done} verb="synced" /> : (
        <div className="bgrid">
          {targets.map(t => { const p = prev.find(x => x.id === t.id); return (
            <figure key={t.id} className={p?.err ? 'warn' : ''}>
              {p?.url ? <img src={p.url} alt="" /> : <div className="ph">{p?.err ? '!' : '…'}</div>}
              <figcaption title={t.name}>{t.name}</figcaption>
              {p?.err && <small className="bad">No preview: {p.err}</small>}
              {p?.notes.map(n => <small key={n}>{n}</small>)}
            </figure>
          ); })}
        </div>
      )}
    </Modal>
  );
}

// ---------------- Settings (Phase 8: global AI switch + downloaded AI data) ----------------
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const label = (url: string) => Object.values(MODELS).find(m => url.endsWith(m.file))?.name ?? (/ort.*\.wasm$/.test(url) ? 'AI runtime (ONNX Runtime)' : url.split('/').pop());

export function SettingsDialog({ ai, setAi, onClose, onDevices }: { ai: boolean; setAi: (on: boolean) => void; onClose: () => void; onDevices: () => void }) {
  const [items, setItems] = useState<StoredItem[] | null>(null);
  const refresh = () => {
    storedAiData().then(setItems).catch(() => setItems([]));
  };
  useEffect(refresh, []);
  // Which modules have their model files on this server (a deploy may skip models it couldn't fetch)
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  useEffect(() => {
    Promise.all(AI_MODULES.map(async m => {
      const files = Object.values(MODELS).filter(x => x.module === m.id).map(x => x.file);
      return [m.id, (await Promise.all(files.map(modelInstalled))).every(Boolean)] as const;
    })).then(r => setInstalled(Object.fromEntries(r)));
  }, []);
  const remove = async (path?: string) => {
    const what = path ? label(path) : 'all downloaded AI data';
    if (!confirm(`Remove ${what}? It downloads again the next time an AI tool needs it.`)) return;
    await removeAiData(path);
    (await import('./remove.ts')).unloadRemove();
    refresh();
  };
  const total = items?.reduce((n, i) => n + i.bytes, 0) ?? 0;
  const toggle = async (on: boolean) => { setAi(on); if (!on) (await import('./remove.ts')).unloadRemove(); };
  return (
    <Modal title="Settings" onClose={onClose} foot={<><span className="grow" /><button className="primary" onClick={onClose}>Done</button></>}>
      <section className="setting">
        <label className="switch-row">
          <span><b>AI features</b><br /><span className="muted">Off by default. When off, no AI model is downloaded or run, and AI tools are hidden. When on, models run on this device only — photos never leave it.</span></span>
          <input type="checkbox" role="switch" aria-checked={ai} checked={ai} onChange={e => toggle(e.target.checked)} />
        </label>
        <ul className="ai-mods">
          {AI_MODULES.map(m => <li key={m.id}><b>{m.name}</b> — {m.what} <span className="muted">· {!ai ? 'off' : installed[m.id] === undefined ? 'checking…' : installed[m.id] ? 'available' : 'not installed on this server'}</span></li>)}
        </ul>
        <p className="muted small">This setting is per device.</p>
        <p className="muted small">Model licenses: {Object.values(MODELS).map(m => <a key={m.file} href={m.file.replace(/\.onnx$/, '.LICENSE.txt')} target="_blank" rel="noreferrer">{m.name} ({m.license})</a>)}</p>
      </section>
      <section className="setting">
        <h4>Devices</h4>
        <p className="muted small">Sync edits directly with your other devices — no account, no server, end-to-end encrypted.</p>
        <button className="ghost bordered" onClick={onDevices}>Sync with another device…</button>
      </section>
      <section className="setting">
        <h4>Downloaded AI data</h4>
        {items === null ? <p className="muted small">Checking…</p> : !items.length ? <p className="muted small">Nothing downloaded.</p> : <>
          <ul className="ai-data">
            {items.map(i => <li key={i.url}><span>{label(i.url)}</span><span className="muted">{mb(i.bytes)}</span><button className="ghost bordered" onClick={() => remove(i.url)}>Remove</button></li>)}
          </ul>
          <div className="row"><span className="muted">Total {mb(total)}</span><span className="grow" /><button className="ghost bordered danger" onClick={() => remove()}>Remove all AI data</button></div>
        </>}
      </section>
    </Modal>
  );
}

// ---------------- Device-to-device sync (Phase 8) ----------------
function QR({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { import('qrcode').then(q => q.toDataURL(text, { errorCorrectionLevel: 'L', margin: 1, width: 320 })).then(setSrc).catch(() => setSrc('')); }, [text]);
  return src ? <img className="qr" src={src} alt="Pairing QR code" width={240} height={240} /> : null;
}

/** Paste box + optional camera scan (where the browser has BarcodeDetector). */
function CodeInput({ label, onCode }: { label: string; onCode: (c: string) => void }) {
  const [val, setVal] = useState(''), [scan, setScan] = useState(false), video = useRef<HTMLVideoElement>(null);
  const canScan = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  useEffect(() => {
    if (!scan) return;
    let stop = false, stream: MediaStream | undefined;
    (async () => {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.current!.srcObject = stream; await video.current!.play();
      const det = new (window as unknown as { BarcodeDetector: new (o: object) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector({ formats: ['qr_code'] });
      while (!stop) {
        const r = await det.detect(video.current!).catch(() => []);
        const hit = r.find(x => /^HL[OA]\./.test(x.rawValue));
        if (hit) { setScan(false); onCode(hit.rawValue); break; }
        await new Promise(res => setTimeout(res, 250));
      }
    })().catch(() => setScan(false));
    return () => { stop = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [scan]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="code-in">
      <label>{label}<textarea rows={3} value={val} onChange={e => setVal(e.target.value)} placeholder="HLO.… or HLA.…" spellCheck={false} /></label>
      <div className="row">
        <button className="primary" disabled={!val.trim()} onClick={() => onCode(val)}>Continue</button>
        {canScan && <button className="ghost bordered" onClick={() => setScan(s => !s)}>{scan ? 'Stop camera' : 'Scan QR'}</button>}
      </div>
      {scan && <video ref={video} className="qr-video" muted playsInline />}
    </div>
  );
}

type Stage = { s: 'choose' } | { s: 'busy'; msg: string } | { s: 'host'; code: string; finish: (a: string) => Promise<Link> }
  | { s: 'joinCode' } | { s: 'joinWait'; code: string } | { s: 'done'; sum: Summary } | { s: 'error'; msg: string };

export function DevicesDialog({ photos, commit, onClose }: { photos: () => Photo[]; commit: (ps: Photo[]) => void; onClose: () => void }) {
  const [st, setSt] = useState<Stage>({ s: 'choose' });
  const conns = useRef<{ close(): void }[]>([]);
  useEffect(() => () => conns.current.forEach(c => c.close()), []);
  const fail = (e: unknown) => setSt({ s: 'error', msg: (e as Error).message || String(e) });
  const run = async (link: Link) => {
    conns.current.push(link);
    setSt({ s: 'busy', msg: 'Connected. Syncing…' });
    const { runSync } = await import('./sync-run.ts');
    const sum = await runSync(link, photos, commit, msg => setSt({ s: 'busy', msg }));
    setSt({ s: 'done', sum }); setTimeout(() => link.close(), 1500);
  };
  const start = async () => {
    setSt({ s: 'busy', msg: 'Preparing a pairing code…' });
    try { const { host } = await import('./p2p.ts'); const h = await host(); conns.current.push(h.pc); setSt({ s: 'host', code: h.code, finish: h.finish }); } catch (e) { fail(e); }
  };
  const joinWith = async (offer: string) => {
    setSt({ s: 'busy', msg: 'Reading code…' });
    try {
      const { join } = await import('./p2p.ts'); const j = await join(offer); conns.current.push(j.pc);
      setSt({ s: 'joinWait', code: j.code });
      run(await j.link).catch(fail);
    } catch (e) { fail(e); }
  };
  return (
    <Modal title="Sync with another device" onClose={onClose} foot={<><span className="grow" /><button className="ghost bordered" onClick={onClose}>{st.s === 'done' ? 'Close' : 'Cancel'}</button></>}>
      <div className="devices">
        {st.s === 'choose' && <>
          <p className="muted">Syncs edits, history, masks, ratings, labels and albums for photos both devices have (matched by file name, date and size). Photos themselves are never sent. The link is direct and end-to-end encrypted; both devices must be open.</p>
          <div className="row"><button className="primary" onClick={start}>Start pairing here</button><button className="ghost bordered" onClick={() => setSt({ s: 'joinCode' })}>I have a code</button></div>
        </>}
        {st.s === 'busy' && <p role="status">{st.msg}</p>}
        {st.s === 'host' && <>
          <p><b>1.</b> On the other device: Settings → Sync with another device → <b>I have a code</b>, then scan or paste this:</p>
          <QR text={st.code} /><CopyCode code={st.code} />
          <p><b>2.</b> It shows a reply code. Enter it here:</p>
          <CodeInput label="Reply code" onCode={async a => { setSt({ s: 'busy', msg: 'Connecting…' }); try { await run(await st.finish(a)); } catch (e) { fail(e); } }} />
        </>}
        {st.s === 'joinCode' && <CodeInput label="Code from the other device" onCode={joinWith} />}
        {st.s === 'joinWait' && <>
          <p>Scan or paste this reply code on the device that started pairing:</p>
          <QR text={st.code} /><CopyCode code={st.code} />
          <p className="muted small" role="status">Waiting for the other device…</p>
        </>}
        {st.s === 'done' && <div className="report" role="status">
          <p><b>Synced.</b> Received {st.sum.received} change{st.sum.received === 1 ? '' : 's'}, sent {st.sum.sent}.</p>
          {st.sum.keptOurs > 0 && <p className="muted small">{st.sum.keptOurs} incoming change{st.sum.keptOurs === 1 ? ' was' : 's were'} older than this device's and kept as is.</p>}
          {(st.sum.onlyHere > 0 || st.sum.onlyThere > 0) && <p className="muted small">Not synced: {st.sum.onlyHere} photo{st.sum.onlyHere === 1 ? '' : 's'} only on this device, {st.sum.onlyThere} only on the other. Import the same files on both to sync their edits.</p>}
        </div>}
        {st.s === 'error' && <div className="report"><p className="fails">{st.msg}</p><button className="ghost bordered" onClick={() => setSt({ s: 'choose' })}>Try again</button></div>}
      </div>
    </Modal>
  );
}

function CopyCode({ code }: { code: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="code-out" data-code={code}><code>{code.length > 48 ? code.slice(0, 24) + '…' + code.slice(-16) : code}</code>
      <button className="ghost bordered" onClick={() => navigator.clipboard.writeText(code).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}>{ok ? 'Copied' : 'Copy code'}</button></div>
  );
}
