import { useRef, useState } from 'react';
import { buildLut, pointXs } from './curve.ts';
import { BANDS, CURVE_POINTS, type Values } from './sliders.ts';
import { Encoder } from './Encoder.tsx';
import type { Slider } from './sliders.ts';

const SIZE = 240;

type Props = { v: Values; setVal: (k: string, x: number) => void; commit: () => void };

/** Point curve (7 points, drag vertically; arrow keys nudge; double-click resets a point). */
export function CurveEditor({ v, setVal, commit }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const lut = buildLut(v);
  const path = Array.from(lut, (y, i) => `${i ? 'L' : 'M'}${(i / 255) * SIZE},${(1 - y) * SIZE}`).join('');
  const toY = (clientY: number) => {
    const r = svg.current!.getBoundingClientRect();
    return Math.round(Math.min(100, Math.max(0, (1 - (clientY - r.top) / r.height) * 100)) * 2) / 2;
  };
  const def = (i: number) => +(i * 100 / (CURVE_POINTS - 1)).toFixed(2);

  return (
    <svg ref={svg} className="curve" viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label="Point curve"
      onPointerMove={e => { if (drag !== null) setVal(`pc${drag}`, toY(e.clientY)); }}
      onPointerUp={() => { if (drag !== null) { setDrag(null); commit(); } }}>
      {[1, 2, 3].map(i => <g key={i} stroke="#2A2A2F"><line x1={i * SIZE / 4} y1="0" x2={i * SIZE / 4} y2={SIZE} /><line y1={i * SIZE / 4} x1="0" y2={i * SIZE / 4} x2={SIZE} /></g>)}
      <line x1="0" y1={SIZE} x2={SIZE} y2="0" stroke="#3A3A40" strokeDasharray="3 4" />
      <path d={path} fill="none" stroke="#ECEAE6" strokeWidth="1.75" />
      {pointXs.map((x, i) => (
        <circle key={i} cx={x * SIZE} cy={(1 - v[`pc${i}`] / 100) * SIZE} r={drag === i ? 7 : 5.5}
          className="curve-pt" tabIndex={0} role="slider" aria-label={`Curve point ${i + 1}`}
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={v[`pc${i}`]}
          onPointerDown={e => { try { (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId); } catch { /* synthetic */ } setDrag(i); }}
          onDoubleClick={() => { setVal(`pc${i}`, def(i)); commit(); }}
          onKeyDown={e => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            setVal(`pc${i}`, Math.min(100, Math.max(0, v[`pc${i}`] + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 0.5))));
            commit();
          }} />
      ))}
    </svg>
  );
}

/** Color mixer: one attribute (Hue/Saturation/Luminance) at a time across the 8 bands. */
export function ColorMixer({ v, setVal, commit, byKey, tab, setTab }: Props & { byKey: Record<string, Slider>; tab: string; setTab: (t: string) => void }) {
  return (
    <div className="mixer">
      <div className="seg" role="tablist" aria-label="Mixer attribute">
        {[['hue', 'Hue'], ['sat', 'Saturation'], ['lum', 'Luminance']].map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={'pill' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {BANDS.map(([b]) => {
        const k = `${tab}_${b}`;
        return <Encoder key={k} s={byKey[k]} value={v[k]} onChange={x => setVal(k, x)} onCommit={commit} />;
      })}
    </div>
  );
}
