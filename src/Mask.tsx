import { useEffect, useRef, useState } from 'react';
import { Encoder } from './Encoder';
import { MASKS, MASK_ADJ, maskKey, type Slider, type Values } from './sliders.ts';
import { linearMask, radialMask, type Pt2 } from './mask-shapes.ts';
import type { Pt } from './sam-core.ts';

/** What the overlay is doing: nothing, AI clicks, dragging a gradient, or painting. */
export type MaskMode = { kind: 'idle' } | { kind: 'pick' } | { kind: 'linear' } | { kind: 'radial' } | { kind: 'brush'; add: boolean; size: number };

function useCanvasBox(canvas: HTMLCanvasElement) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  useEffect(() => {
    const measure = () => {
      const c = canvas.getBoundingClientRect(), p = (canvas.closest('.center') as HTMLElement).getBoundingClientRect();
      setBox({ left: c.left - p.left, top: c.top - p.top, width: c.width, height: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(canvas);
    const st = canvas.closest('.stage'); st?.addEventListener('scroll', measure); // follow the image when zoomed in
    return () => { ro.disconnect(); st?.removeEventListener('scroll', measure); };
  }, [canvas]);
  return box;
}

const TINT = [240, 90, 60];
function drawTint(t: HTMLCanvasElement, m?: { data: Uint8ClampedArray; width: number; height: number }) {
  if (!m) { t.width = t.height = 1; t.getContext('2d')!.clearRect(0, 0, 1, 1); return; }
  t.width = m.width; t.height = m.height;
  const im = new ImageData(m.width, m.height);
  for (let i = 0; i < m.width * m.height; i++) { im.data[i * 4] = TINT[0]; im.data[i * 4 + 1] = TINT[1]; im.data[i * 4 + 2] = TINT[2]; im.data[i * 4 + 3] = m.data[i * 4] * 0.5; }
  t.getContext('2d')!.putImageData(im, 0, 0);
}

/**
 * Layer over the Develop canvas (full frame, unrotated).
 * Shows a mask tint, takes AI clicks, gradient drags (onShape on release) or brush strokes (painted into brushRef at mask size).
 */
export function MaskOverlay({ canvas, mask, pts, mode, maskW, maskH, brushRef, onPoint, onShape, onStrokeEnd }: {
  canvas: HTMLCanvasElement; mask?: ImageData; pts: Pt[]; mode: MaskMode; maskW: number; maskH: number;
  brushRef: React.MutableRefObject<HTMLCanvasElement | null>;
  onPoint: (p: Pt) => void; onShape: (kind: 'linear' | 'radial', a: Pt2, b: Pt2) => void; onStrokeEnd: () => void;
}) {
  const box = useCanvasBox(canvas);
  const tint = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ a: Pt2; b: Pt2 } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { drawTint(tint.current!, mask); }, [mask]);
  // live gradient preview at low resolution while dragging
  useEffect(() => {
    if (!drag || (mode.kind !== 'linear' && mode.kind !== 'radial')) return;
    const k = 256 / Math.max(maskW, maskH), w = Math.max(1, Math.round(maskW * k)), h = Math.max(1, Math.round(maskH * k));
    drawTint(tint.current!, mode.kind === 'linear' ? linearMask(w, h, drag.a, drag.b) : radialMask(w, h, drag.a, drag.b));
  }, [drag, mode.kind, maskW, maskH]);
  useEffect(() => {
    const b = brushRef.current; if (!b || mode.kind !== 'brush') return;
    if (b.width !== maskW || b.height !== maskH) { b.width = maskW; b.height = maskH; }
  }, [mode.kind, maskW, maskH, brushRef]);

  const frac = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
  const paint = (p: Pt2) => {
    if (mode.kind !== 'brush') return;
    const b = brushRef.current!, g = b.getContext('2d')!, q = { x: p.x * b.width, y: p.y * b.height };
    const lw = (Math.min(b.width, b.height) * mode.size) / 100;
    g.strokeStyle = g.fillStyle = mode.add ? '#3fa45b' : '#d9534f'; g.lineWidth = lw; g.lineCap = g.lineJoin = 'round';
    g.beginPath();
    if (last.current) { g.moveTo(last.current.x, last.current.y); g.lineTo(q.x, q.y); g.stroke(); } else { g.arc(q.x, q.y, lw / 2, 0, 7); g.fill(); }
    last.current = q;
  };
  const active = mode.kind !== 'idle';
  return (
    <div className="mask-layer" style={{ ...box, cursor: active ? 'crosshair' : 'default', pointerEvents: active ? 'auto' : 'none', touchAction: active ? 'none' : 'auto' }}
      onPointerDown={e => {
        if (!active) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = frac(e);
        if (mode.kind === 'pick') onPoint({ ...p, add: !(e.altKey || e.shiftKey) });
        else if (mode.kind === 'brush') { last.current = null; paint(p); }
        else setDrag({ a: p, b: p });
      }}
      onPointerMove={e => {
        if (!e.buttons) return;
        if (mode.kind === 'brush') paint(frac(e));
        else if (drag) setDrag({ ...drag, b: frac(e) });
      }}
      onPointerUp={() => {
        if (mode.kind === 'brush' && last.current) onStrokeEnd();
        last.current = null;
        if (drag && (mode.kind === 'linear' || mode.kind === 'radial') && Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) > 0.01) onShape(mode.kind, drag.a, drag.b);
        setDrag(null);
      }}>
      <canvas ref={tint} className="mask-tint" aria-hidden="true" />
      {mode.kind === 'brush' && <canvas ref={brushRef} className="mask-brush" aria-label="Paint to refine the mask" />}
      {drag && (
        <svg className="mask-guide" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
          {mode.kind === 'linear'
            ? <line x1={drag.a.x} y1={drag.a.y} x2={drag.b.x} y2={drag.b.y} />
            : <ellipse cx={drag.a.x} cy={drag.a.y} rx={Math.hypot((drag.b.x - drag.a.x) * box.width, (drag.b.y - drag.a.y) * box.height) / (box.width || 1)} ry={Math.hypot((drag.b.x - drag.a.x) * box.width, (drag.b.y - drag.a.y) * box.height) / (box.height || 1)} />}
        </svg>
      )}
      {pts.map((p, i) => <span key={i} className={'mask-pt' + (p.add ? '' : ' sub')} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />)}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = { pick: 'Click the subject to select it. Click more spots to add; Alt/Shift-click to remove an area. On-device AI (MobileSAM).',
  linear: 'Drag across the photo: full effect where you start, fading out where you release.',
  radial: 'Drag from the centre outwards: full effect inside, fading out at the edge.',
  brush: 'Paint over the photo to change the mask.' };

export function MaskPanel({ ai, slots, sel, setSel, mode, setMode, busy, msg, v, byKey, setVal, commit, showMask, setShowMask,
  onAI, onFinishAI, onCancel, onLinear, onRadial, onBrushNew, onRefine, onApplyBrush, onDelete, done }: {
  ai: boolean; slots: boolean[]; sel: number; setSel: (i: number) => void; mode: MaskMode; setMode: (m: MaskMode) => void; busy: boolean; msg: string;
  v: Values; byKey: Record<string, Slider>; setVal: (k: string, x: number) => void; commit: () => void; showMask: boolean; setShowMask: (b: boolean) => void;
  onAI: () => void; onFinishAI: () => void; onCancel: () => void; onLinear: () => void; onRadial: () => void; onBrushNew: () => void;
  onRefine: () => void; onApplyBrush: () => void; onDelete: (i: number) => void; done: () => void;
}) {
  const free = slots.indexOf(false), full = free < 0, editing = mode.kind !== 'idle';
  return (
    <section className="adjust remove-panel mask-panel">
      <div className="sec-head"><h3>Masking</h3><button className="primary" onClick={done} disabled={editing}>Done</button></div>
      {editing ? <>
        <p className="muted small">{KIND_LABEL[mode.kind]}</p>
        {mode.kind === 'brush' && <>
          <div className="row" role="radiogroup" aria-label="Brush mode">
            <button className={'pill' + (mode.add ? ' on' : '')} role="radio" aria-checked={mode.add} onClick={() => setMode({ ...mode, add: true })}>Add</button>
            <button className={'pill' + (!mode.add ? ' on' : '')} role="radio" aria-checked={!mode.add} onClick={() => setMode({ ...mode, add: false })}>Subtract</button>
          </div>
          <label className="brush-size">Size <input type="range" min={0.5} max={20} step={0.5} value={mode.size} onChange={e => setMode({ ...mode, size: +e.target.value })} /> <span>{mode.size}%</span></label>
        </>}
        <div className="row">
          {mode.kind === 'pick' && <button className="primary" onClick={onFinishAI} disabled={busy}>Use mask</button>}
          {mode.kind === 'brush' && <button className="primary" onClick={onApplyBrush} disabled={busy}>Apply</button>}
          <button className="ghost bordered" onClick={onCancel}>Cancel</button>
        </div>
      </> : <>
        <ul className="mask-list">
          {slots.map((on, i) => on && (
            <li key={i}><button className={sel === i ? 'on' : ''} onClick={() => setSel(i)} aria-pressed={sel === i}>Mask {i + 1}</button>
              <button className="ghost" onClick={() => onDelete(i)} aria-label={`Delete mask ${i + 1}`} title="Delete">✕</button></li>
          ))}
        </ul>
        <div className="mask-new">
          {ai && <button className="ghost bordered" onClick={onAI} disabled={busy || full}>Select subject (AI)</button>}
          <button className="ghost bordered" onClick={onLinear} disabled={busy || full}>Linear gradient</button>
          <button className="ghost bordered" onClick={onRadial} disabled={busy || full}>Radial gradient</button>
          <button className="ghost bordered" onClick={onBrushNew} disabled={busy || full}>Brush</button>
        </div>
        {full && <p className="muted small">All {MASKS} masks are in use; delete one to add another.</p>}
        {slots[sel] && <>
          <div className="row">
            <button className="ghost bordered" onClick={onRefine}>Refine with brush</button>
            <label className="check"><input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)} /> Show mask</label>
          </div>
          <label className="check"><input type="checkbox" checked={!!v[maskKey(sel, 'inv')]} onChange={e => { setVal(maskKey(sel, 'inv'), e.target.checked ? 1 : 0); commit(); }} /> Invert</label>
          {[...MASK_ADJ.map(([k]) => k), 'feather'].map(k => {
            const key = maskKey(sel, k), s = byKey[key];
            return <Encoder key={key} s={{ ...s, label: s.label.replace(/^Mask \d+ /, '') }} value={v[key] ?? 0} onChange={x => setVal(key, x)} onCommit={commit} idPrefix="mask" />;
          })}
        </>}
      </>}
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}
