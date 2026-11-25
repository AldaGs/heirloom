import { useRef, useState, type PointerEvent } from 'react';
import { fmt, round, type Slider } from './sliders.ts';

// px of drag for the full range (desktop / touch per FIXER_IMPROVEMENTS §1); ridge travel in px
const SENS = 320, SENS_TOUCH = 520, TRAVEL = 480, LONG_PRESS = 400;
// Touch smoothing: time-based low-pass on finger x (ms), and lift-off filter: the finger rolls/drifts in the
// last few frames before it leaves the glass, so on release we roll back to where it was LIFT_MS earlier.
const SMOOTH_MS = 28, LIFT_MS = 80;
const tick = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* iOS / desktop: no haptics */ } };

type Props = { s: Slider; value: number; onChange: (v: number) => void; onCommit: () => void; idPrefix?: string };

/**
 * Rotary-encoder control (FIXER_IMPROVEMENTS §1). Relative drag: touching never jumps the value.
 * Fine mode (5×): hold Shift, or on touch press-and-hold still for 400 ms before dragging.
 */
export function Encoder({ s, value, onChange, onCommit, idPrefix = 'v' }: Props) {
  type Drag = {
    x: number; v0: number; touch: boolean; fine: boolean; moved: boolean; timer: number; last: number;
    sx: number; st: number; hist: { t: number; v: number }[]; raf: number; pending: number | null;
  };
  const drag = useRef<Drag | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [fine, setFine] = useState(false);
  const span = s.max - s.min, norm = (value - s.min) / span, defN = (s.def - s.min) / span;
  const set = (x: number) => onChange(round(s, x));
  const id = `${idPrefix}-${s.k}`;
  const flush = (d: Drag) => { cancelAnimationFrame(d.raf); d.raf = 0; if (d.pending !== null) { onChange(d.pending); d.pending = null; } };
  const end = (e: PointerEvent, cancel = false) => {
    const d = drag.current; if (!d) return;
    clearTimeout(d.timer); drag.current = null;
    if (d.touch && d.moved) {
      // drop lift-off drift: value from LIFT_MS before release (or the start value if the whole drag was shorter)
      const t = (cancel ? performance.now() : e.timeStamp) - LIFT_MS;
      let v = d.v0;
      for (const h of d.hist) { if (h.t > t) break; v = h.v; }
      d.pending = v;
    }
    flush(d); setFine(false); onCommit();
  };
  const valueAt = (d: Drag, x: number, shift: boolean) => {
    const sens = (d.touch ? SENS_TOUCH : SENS) * (shift || d.fine ? 5 : 1);
    return round(s, d.v0 + (x - d.x) * span / sens);
  };

  return (
    <div className="enc-row">
      <label htmlFor={id}>{s.label}</label>
      <div className="enc-wrap">
        <div
          className={'enc' + (fine ? ' fine' : '')} aria-hidden="true" title="Drag to turn · Shift (or press-and-hold) for fine · double-click to reset"
          style={{ backgroundPosition: `0 0, 0 0, ${Math.round(norm * TRAVEL)}px 50%, 0 0` }}
          onPointerDown={e => {
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* unknown/synthetic pointer: drag still works while over the strip */ }
            const touch = e.pointerType !== 'mouse';
            const d: Drag = { x: e.clientX, v0: value, touch, fine: false, moved: false, last: value, timer: 0,
              sx: e.clientX, st: e.timeStamp, hist: [{ t: e.timeStamp, v: value }], raf: 0, pending: null };
            if (touch) d.timer = window.setTimeout(() => {
              if (!d.moved) { d.fine = true; setFine(true); tick(12); d.x = d.sx; d.v0 = d.last; }
            }, LONG_PRESS);
            drag.current = d;
          }}
          onPointerMove={e => {
            const d = drag.current; if (!d) return;
            const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []);
            for (const ev of evs.length ? evs : [e.nativeEvent]) {
              if (d.touch) {
                // exponential smoothing with a time constant, so jitter is filtered regardless of event rate
                const dt = Math.max(0, ev.timeStamp - d.st), a = 1 - Math.exp(-dt / SMOOTH_MS);
                d.sx += (ev.clientX - d.sx) * a; d.st = ev.timeStamp;
              } else d.sx = ev.clientX;
            }
            if (!d.moved) {
              if (Math.abs(e.clientX - d.x) <= 4) return;
              d.moved = true; if (!d.fine) clearTimeout(d.timer);
            }
            const nv = valueAt(d, d.sx, e.shiftKey);
            d.hist.push({ t: e.timeStamp, v: nv });
            if (d.hist.length > 64) d.hist.splice(0, d.hist.length - 64);
            if (nv === d.last) return;
            // light haptic tick every 10 steps on touch (Android; iOS needs the native shell)
            if (d.touch && Math.floor(nv / (s.step * 10)) !== Math.floor(d.last / (s.step * 10))) tick(4);
            d.last = nv; d.pending = nv;
            // one update per frame: re-rendering the pipeline per pointer event makes the drag stutter
            if (!d.raf) d.raf = requestAnimationFrame(() => { d.raf = 0; if (d.pending !== null) { onChange(d.pending); d.pending = null; } });
          }}
          onPointerUp={e => end(e)}
          onPointerCancel={e => end(e, true)}
          onDoubleClick={() => { set(s.def); onCommit(); }}
        />
        <div className="vbar" style={s.track ? { background: s.track } : undefined}>
          {!s.track && <i style={{ left: `${Math.min(norm, defN) * 100}%`, width: `${Math.abs(norm - defN) * 100}%` }} />}
          {s.track && <b style={{ left: `${norm * 100}%` }} />}
        </div>
      </div>
      <input
        id={id} className="num" type="text" inputMode="decimal"
        value={text ?? fmt(s, value)}
        onChange={e => { setText(e.target.value); const n = parseFloat(e.target.value); if (!isNaN(n)) set(n); }}
        onBlur={() => { setText(null); onCommit(); }}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault(); setText(null);
            set(value + (e.key === 'ArrowUp' ? 1 : -1) * s.step * (e.shiftKey ? 10 : 1)); onCommit();
          }
        }}
      />
    </div>
  );
}
