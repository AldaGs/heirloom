import { useEffect, useMemo, useState } from 'react';
import { BUILTIN_EXPORTS, SHARPEN, encode, outName, type ExportPreset, type Format } from './export.ts';
import { GROUPS, planSync, type SyncOpts } from './sync.ts';
import { developFull, developPreview } from './render.ts';
import { usePref } from './prefs.ts';
import type { Photo } from './library.ts';
import type { Values } from './sliders.ts';

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
          r = { id: t.id, url, v, notes: planSync(source, t, { ...opts, autoExposure: false }).notes.concat(opts.autoExposure ? [`auto exposure ${v.exposure > 0 ? '+' : ''}${v.exposure.toFixed(2)}`] : []) };
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
