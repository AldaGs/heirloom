import { useEffect, useRef, useState } from 'react';
import { Encoder } from './Encoder.tsx';
import type { Slider, Values } from './sliders.ts';

import { ASPECTS, clamp, MIN, type Rect } from './crop-geom.ts';
export { ASPECTS, fitAspect, turnRect, flipRect, type Rect } from './crop-geom.ts';

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** Draggable crop box over the (uncropped, straightened) canvas. Fractions of the frame. */
export function CropOverlay({ canvas, rect, ratio, frameAspect, onChange, onCommit }: {
  canvas: HTMLCanvasElement; rect: Rect; ratio: number | null; frameAspect: number;
  onChange: (r: Rect) => void; onCommit: () => void;
}) {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const drag = useRef<{ h: Handle; x: number; y: number; r: Rect } | null>(null);

  useEffect(() => {
    const measure = () => {
      const c = canvas.getBoundingClientRect(), p = (canvas.closest('.center') as HTMLElement).getBoundingClientRect();
      setBox({ left: c.left - p.left, top: c.top - p.top, width: c.width, height: c.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [canvas]);

  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d || !box.width) return;
    const dx = (e.clientX - d.x) / box.width, dy = (e.clientY - d.y) / box.height;
    let { cropX: x, cropY: y, cropW: w, cropH: h } = d.r;
    if (d.h === 'move') { onChange({ cropX: clamp(x + dx, 0, 1 - w), cropY: clamp(y + dy, 0, 1 - h), cropW: w, cropH: h }); return; }
    let x2 = x + w, y2 = y + h;
    if (d.h.includes('w')) x = clamp(x + dx, 0, x2 - MIN);
    if (d.h.includes('e')) x2 = clamp(x2 + dx, x + MIN, 1);
    if (d.h.includes('n')) y = clamp(y + dy, 0, y2 - MIN);
    if (d.h.includes('s')) y2 = clamp(y2 + dy, y + MIN, 1);
    w = x2 - x; h = y2 - y;
    if (ratio) {
      // width drives (height for pure n/s); anchor the opposite side, then shrink to stay in frame
      if (d.h === 'n' || d.h === 's') w = (h * ratio) / frameAspect; else h = (w * frameAspect) / ratio;
      if (d.h.includes('n')) y = y2 - h;
      if (d.h.includes('w')) x = x2 - w;
      const k = Math.min(1, x < 0 ? (x2) / w : 1, y < 0 ? y2 / h : 1, x + w > 1 ? (1 - x) / w : 1, y + h > 1 ? (1 - y) / h : 1);
      if (k < 1) { const nw = w * k, nh = h * k; if (d.h.includes('w')) x = x2 - nw; if (d.h.includes('n')) y = y2 - nh; w = nw; h = nh; }
      x = clamp(x, 0, 1 - w); y = clamp(y, 0, 1 - h);
    }
    onChange({ cropX: x, cropY: y, cropW: w, cropH: h });
  };

  const handle = (h: Handle) => (
    <span key={h} className={`crop-h ${h}`} onPointerDown={e => {
      e.stopPropagation();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      drag.current = { h, x: e.clientX, y: e.clientY, r: rect };
    }} onPointerMove={move} onPointerUp={() => { drag.current = null; onCommit(); }} />
  );

  return (
    <div className="crop-layer" style={box}>
      <div className="crop-box" role="group" aria-label="Crop area — drag to move, drag corners to resize"
        style={{ left: `${rect.cropX * 100}%`, top: `${rect.cropY * 100}%`, width: `${rect.cropW * 100}%`, height: `${rect.cropH * 100}%` }}
        onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic */ } drag.current = { h: 'move', x: e.clientX, y: e.clientY, r: rect }; }}
        onPointerMove={move} onPointerUp={() => { if (drag.current) { drag.current = null; onCommit(); } }}>
        <i className="third v1" /><i className="third v2" /><i className="third h1" /><i className="third h2" />
        {(['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'] as Handle[]).map(handle)}
      </div>
    </div>
  );
}

/** Right-hand panel while cropping: aspect, straighten, reset, done. */
export function CropPanel({ v, aspect, setAspect, angle, setAngle, commit, reset, done, turn, flip }: {
  v: Values; aspect: string; setAspect: (a: string) => void; angle: Slider;
  setAngle: (x: number) => void; commit: () => void; reset: () => void; done: () => void;
  turn: (dir: 1 | -1) => void; flip: (axis: 'h' | 'v') => void;
}) {
  const I = ({ d }: { d: string }) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
  return (
    <section className="adjust crop-panel">
      <div className="sec-head"><h3>Crop &amp; straighten</h3><button className="ghost" onClick={reset}>Reset</button><button className="primary" onClick={done}>Done</button></div>
      <h4>Aspect</h4>
      <div className="aspects">
        {ASPECTS.map(([name]) => <button key={name} className={'pill' + (aspect === name ? ' on' : '')} onClick={() => setAspect(name)}>{name}</button>)}
      </div>
      <h4>Rotate &amp; flip</h4>
      <div className="aspects">
        <button className="pill" onClick={() => turn(-1)} title="Rotate 90° left ([)" aria-label="Rotate 90° left"><I d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></button>
        <button className="pill" onClick={() => turn(1)} title="Rotate 90° right (])" aria-label="Rotate 90° right"><I d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" /></button>
        <button className={'pill' + (v.flipH ? ' on' : '')} aria-pressed={!!v.flipH} onClick={() => flip('h')} title="Flip horizontal" aria-label="Flip horizontal"><I d="M12 3v18M8 7l-5 5 5 5M16 7l5 5-5 5" /></button>
        <button className={'pill' + (v.flipV ? ' on' : '')} aria-pressed={!!v.flipV} onClick={() => flip('v')} title="Flip vertical" aria-label="Flip vertical"><I d="M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5" /></button>
      </div>
      <Encoder s={angle} value={v.angle} onChange={setAngle} onCommit={commit} />
      <p className="muted small">Any angle from −180° to 180°; past ±45° the frame turns with it.</p>
      <p className="muted small">Drag the box to move it, corners and edges to resize. Enter or Done to finish.</p>
    </section>
  );
}
