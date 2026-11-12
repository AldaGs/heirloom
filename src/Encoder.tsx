import { useRef, useState } from 'react';
import { fmt, round, type Slider } from './sliders.ts';

// px of drag for the full range (desktop / touch per FIXER_IMPROVEMENTS §1); ridge travel in px
const SENS = 320, SENS_TOUCH = 520, TRAVEL = 480, LONG_PRESS = 400;
const tick = (ms: number) => { try { navigator.vibrate?.(ms); } catch { /* iOS / desktop: no haptics */ } };

type Props = { s: Slider; value: number; onChange: (v: number) => void; onCommit: () => void; idPrefix?: string };

/**
 * Rotary-encoder control (FIXER_IMPROVEMENTS §1). Relative drag: touching never jumps the value.
 * Fine mode (5×): hold Shift, or on touch press-and-hold still for 400 ms before dragging.
 */
export function Encoder({ s, value, onChange, onCommit, idPrefix = 'v' }: Props) {
  const drag = useRef<{ x: number; v0: number; touch: boolean; fine: boolean; moved: boolean; timer: number; last: number } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [fine, setFine] = useState(false);
  const span = s.max - s.min, norm = (value - s.min) / span, defN = (s.def - s.min) / span;
  const set = (x: number) => onChange(round(s, x));
  const id = `${idPrefix}-${s.k}`;
  const end = () => { const d = drag.current; if (!d) return; clearTimeout(d.timer); drag.current = null; setFine(false); onCommit(); };

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
            const d = { x: e.clientX, v0: value, touch, fine: false, moved: false, last: value, timer: 0 };
            if (touch) d.timer = window.setTimeout(() => { if (!d.moved) { d.fine = true; setFine(true); tick(12); } }, LONG_PRESS);
            drag.current = d;
          }}
          onPointerMove={e => {
            const d = drag.current; if (!d) return;
            if (Math.abs(e.clientX - d.x) > 4 && !d.moved) { d.moved = true; if (!d.fine) clearTimeout(d.timer); }
            const sens = (d.touch ? SENS_TOUCH : SENS) * (e.shiftKey || d.fine ? 5 : 1);
            const nv = round(s, d.v0 + (e.clientX - d.x) * span / sens);
            // light haptic tick every 10 steps on touch (Android; iOS needs the native shell)
            if (d.touch && Math.floor(nv / (s.step * 10)) !== Math.floor(d.last / (s.step * 10))) tick(4);
            d.last = nv; onChange(nv);
          }}
          onPointerUp={end}
          onPointerCancel={end}
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
