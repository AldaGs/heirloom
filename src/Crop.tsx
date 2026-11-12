import { useEffect, useRef, useState } from 'react';
import { Encoder } from './Encoder.tsx';
import type { Slider, Values } from './sliders.ts';

export type Rect = { cropX: number; cropY: number; cropW: number; cropH: number };
export const ASPECTS: [string, number | 'orig' | null][] = [['Free', null], ['Original', 'orig'], ['1:1', 1], ['4:5', 4 / 5], ['3:2', 3 / 2], ['16:9', 16 / 9]];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const MIN = 0.05;

/**
 * Fit a rect to a pixel aspect ratio r (w/h) inside the frame. A = frame pixel aspect.
 * In fractions: (w·A)/h = r → h = w·A/r. Keeps the centre, shrinks to fit.
 */
export function fitAspect(c: Rect, r: number, A: number): Rect {
  let w = c.cropW, h = (w * A) / r;
  if (h > c.cropH) { h = c.cropH; w = (h * r) / A; }
  const cx = c.cropX + c.cropW / 2, cy = c.cropY + c.cropH / 2;
  return { cropX: clamp(cx - w / 2, 0, 1 - w), cropY: clamp(cy - h / 2, 0, 1 - h), cropW: w, cropH: h };
}

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
export function CropPanel({ v, aspect, setAspect, angle, setAngle, commit, reset, done }: {
  v: Values; aspect: string; setAspect: (a: string) => void; angle: Slider;
  setAngle: (x: number) => void; commit: () => void; reset: () => void; done: () => void;
}) {
  return (
    <section className="adjust crop-panel">
      <div className="sec-head"><h3>Crop &amp; straighten</h3><button className="ghost" onClick={reset}>Reset</button><button className="primary" onClick={done}>Done</button></div>
      <h4>Aspect</h4>
      <div className="aspects">
        {ASPECTS.map(([name]) => <button key={name} className={'pill' + (aspect === name ? ' on' : '')} onClick={() => setAspect(name)}>{name}</button>)}
      </div>
      <h4>Straighten</h4>
      <Encoder s={angle} value={v.angle} onChange={setAngle} onCommit={commit} />
      <p className="muted small">Drag the box to move it, corners and edges to resize. Enter or Done to finish.</p>
    </section>
  );
}
