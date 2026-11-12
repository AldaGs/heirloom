import { useEffect, useRef, useState } from 'react';
import type { Photo } from './library.ts';

// One object URL per preview blob, reused across renders (previews are immutable once built).
const urls = new WeakMap<Blob, string>();
const urlOf = (p: Photo) => {
  const b = p.preview ?? p.thumb;
  if (!b) return undefined;
  let u = urls.get(b);
  if (!u) { u = URL.createObjectURL(b); urls.set(b, u); }
  return u;
};

type View = { s: number; x: number; y: number }; // shared (linked) zoom/pan for every pane
const FIT: View = { s: 1, x: 0, y: 0 };

type Props = {
  photos: Photo[]; index: number; setIndex: (i: number) => void;
  update: (id: string, f: (p: Photo) => Photo) => void;
  onDevelop: () => void; onExit: () => void;
};

/**
 * Cull view (FIXER_IMPROVEMENTS §2): keyboard-first, one photo (or 2–4 to compare) at a time.
 * P pick · X reject · U unflag · 0–5 rate · ←/→ move · Z zoom · C compare · D/Enter develop · Esc library
 */
export function Cull({ photos, index, setIndex, update, onDevelop, onExit }: Props) {
  const [n, setN] = useState(1);          // panes shown
  const [active, setActive] = useState(0); // pane that keys act on
  const [view, setView] = useState(FIT);
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);
  const panes = photos.slice(index, index + n);
  const target = panes[Math.min(active, panes.length - 1)];

  // Preload + pre-decode the next two photos so stepping forward is instant
  useEffect(() => {
    for (const p of photos.slice(index + n, index + n + 2)) {
      const u = urlOf(p);
      if (u) { const im = new Image(); im.src = u; im.decode().catch(() => {}); }
    }
  }, [index, n, photos]);

  useEffect(() => setView(FIT), [index, n]);

  useEffect(() => {
    const go = (d: number) => setIndex(Math.max(0, Math.min(photos.length - 1, index + d)));
    const set = (f: (p: Photo) => Photo, advance = false) => {
      if (!target) return;
      update(target.id, f);
      if (advance && n === 1) go(1);
    };
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowright') go(1);
      else if (k === 'arrowleft') go(-1);
      else if (k === 'p') set(p => ({ ...p, flag: !p.flag, reject: false }), true);
      else if (k === 'x') set(p => ({ ...p, reject: !p.reject, flag: false }), true);
      else if (k === 'u') set(p => ({ ...p, flag: false, reject: false }));
      else if (/^[0-5]$/.test(k)) set(p => ({ ...p, rating: +k }));
      else if (k === 'z') setView(v => (v.s > 1 ? FIT : { s: 2, x: 0, y: 0 }));
      else if (k === 'c') { setN(m => (m === 1 ? 2 : 1)); setActive(0); }
      else if (k === 'd' || k === 'enter') onDevelop();
      else if (k === 'escape') onExit();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  // Linked zoom: wheel zooms toward the cursor, drag pans; every pane shares the same transform.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
    setView(v => {
      const s = Math.min(8, Math.max(1, v.s * Math.exp(-e.deltaY * 0.0015)));
      if (s === 1) return FIT;
      const k = s / v.s;
      return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  if (!photos.length) return <main className="cull empty-cull"><p className="muted">No photos match this filter.</p></main>;

  return (
    <main className="cull">
      <div className={`cull-panes n${panes.length}`}>
        {panes.map((p, k) => {
          const u = urlOf(p);
          return (
            <div key={p.id} className={'cull-pane' + (n > 1 && k === active ? ' active' : '') + (view.s > 1 ? ' zoomed' : '')}
              onClick={() => setActive(k)} onWheel={onWheel}
              onPointerDown={e => { if (view.s > 1) { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, v: view }; } }}
              onPointerMove={e => { const d = drag.current; if (d) setView({ ...d.v, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y }); }}
              onPointerUp={() => { drag.current = null; }}
              onDoubleClick={() => setView(v => (v.s > 1 ? FIT : { s: 2, x: 0, y: 0 }))}>
              {u ? <img src={u} alt={p.name} draggable={false} decoding="sync"
                style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }} />
                : <span className="muted">No preview yet</span>}
              <div className="cull-tag">
                {p.flag && <span className="pick">Pick</span>}
                {p.reject && <span className="reject">Rejected</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cull-bar">
        <span className="mono">{index + 1} / {photos.length}</span>
        <span className="cull-name">{target?.name}</span>
        <div className="stars" aria-label={`Rating ${target?.rating ?? 0} of 5`}>
          {[1, 2, 3, 4, 5].map(i => <span key={i} className={target && i <= target.rating ? 'on' : ''}>★</span>)}
        </div>
        <span className="grow" />
        <div className="seg" role="group" aria-label="Compare">
          {[1, 2, 3, 4].map(m => (
            <button key={m} className={'pill' + (n === m ? ' on' : '')} onClick={() => { setN(m); setActive(0); }}>{m === 1 ? 'Single' : `${m}-up`}</button>
          ))}
        </div>
        <span className="hint mono">P pick · X reject · 1–5 rate · ←/→ · Z zoom · C compare · D develop</span>
      </div>
    </main>
  );
}
