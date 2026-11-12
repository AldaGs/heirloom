import { useEffect, useRef, useState } from 'react';
import { Encoder } from './Encoder';
import { MASKS, MASK_ADJ, maskKey, type Slider, type Values } from './sliders.ts';
import type { Pt } from './sam-core.ts';

/** Click layer over the Develop canvas (full frame, unrotated): shows a mask tint + the clicked points. */
export function MaskOverlay({ canvas, mask, pts, picking, onPoint }: {
  canvas: HTMLCanvasElement; mask?: ImageData; pts: Pt[]; picking: boolean; onPoint: (p: Pt) => void;
}) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const tint = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const measure = () => {
      const c = canvas.getBoundingClientRect(), p = (canvas.closest('.center') as HTMLElement).getBoundingClientRect();
      setBox({ left: c.left - p.left, top: c.top - p.top, width: c.width, height: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvas]);
  useEffect(() => {
    const t = tint.current!; if (!mask) { t.width = t.height = 1; t.getContext('2d')!.clearRect(0, 0, 1, 1); return; }
    t.width = mask.width; t.height = mask.height;
    const im = new ImageData(mask.width, mask.height);
    for (let i = 0; i < mask.width * mask.height; i++) { im.data[i * 4] = 240; im.data[i * 4 + 1] = 90; im.data[i * 4 + 2] = 60; im.data[i * 4 + 3] = mask.data[i * 4] * 0.5; }
    t.getContext('2d')!.putImageData(im, 0, 0);
  }, [mask]);
  return (
    <div className="mask-layer" style={{ ...box, cursor: picking ? 'crosshair' : 'default', pointerEvents: picking ? 'auto' : 'none' }}
      onClick={e => {
        if (!picking) return;
        const r = e.currentTarget.getBoundingClientRect();
        onPoint({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, add: !(e.altKey || e.shiftKey) });
      }}>
      <canvas ref={tint} className="mask-tint" aria-hidden="true" />
      {pts.map((p, i) => <span key={i} className={'mask-pt' + (p.add ? '' : ' sub')} style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }} />)}
    </div>
  );
}

export function MaskPanel({ slots, sel, setSel, picking, busy, msg, v, byKey, setVal, commit, onNew, onFinish, onCancel, onDelete, done }: {
  slots: boolean[]; sel: number; setSel: (i: number) => void; picking: boolean; busy: boolean; msg: string;
  v: Values; byKey: Record<string, Slider>; setVal: (k: string, x: number) => void; commit: () => void;
  onNew: () => void; onFinish: () => void; onCancel: () => void; onDelete: (i: number) => void; done: () => void;
}) {
  const free = slots.indexOf(false);
  return (
    <section className="adjust remove-panel mask-panel">
      <div className="sec-head"><h3>Masking</h3><button className="primary" onClick={done} disabled={picking}>Done</button></div>
      {picking ? <>
        <p className="muted small">Click the subject to select it. Click more spots to add to it; <b>Alt-click</b> (or Shift-click) to remove an area. On-device AI (MobileSAM).</p>
        <div className="row"><button className="primary" onClick={onFinish} disabled={busy}>Use mask</button><button className="ghost bordered" onClick={onCancel}>Cancel</button></div>
      </> : <>
        <ul className="mask-list">
          {slots.map((on, i) => on && (
            <li key={i}><button className={sel === i ? 'on' : ''} onClick={() => setSel(i)} aria-pressed={sel === i}>Mask {i + 1}</button>
              <button className="ghost" onClick={() => onDelete(i)} aria-label={`Delete mask ${i + 1}`} title="Delete">✕</button></li>
          ))}
        </ul>
        <button className="ghost bordered" onClick={onNew} disabled={busy || free < 0}>{free < 0 ? `All ${MASKS} masks used` : '+ New mask'}</button>
        {slots[sel] && <>
          <label className="check"><input type="checkbox" checked={!!v[maskKey(sel, 'inv')]} onChange={e => { setVal(maskKey(sel, 'inv'), e.target.checked ? 1 : 0); commit(); }} /> Invert (adjust everything except the selection)</label>
          {MASK_ADJ.map(([k]) => {
            const key = maskKey(sel, k), s = byKey[key];
            return <Encoder key={key} s={{ ...s, label: s.label.replace(/^Mask \d+ /, '') }} value={v[key] ?? 0} onChange={x => setVal(key, x)} onCommit={commit} idPrefix="mask" />;
          })}
        </>}
      </>}
      {msg && <p className="small" role="status">{msg}</p>}
    </section>
  );
}
