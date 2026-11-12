import type { ReactNode } from 'react';
import { ColorMixer, CurveEditor } from './CurveEditor.tsx';
import { Encoder } from './Encoder.tsx';
import { base, type Photo } from './library.ts';
import { usePref } from './prefs.ts';
import { BANDS, CURVE_POINTS, GEOMETRY, SLIDERS, type Slider } from './sliders.ts';

const byKey = Object.fromEntries(SLIDERS.map(s => [s.k, s]));
const PC = Array.from({ length: CURVE_POINTS }, (_, i) => `pc${i}`);
const MIXER = BANDS.flatMap(([b]) => [`hue_${b}`, `sat_${b}`, `lum_${b}`]);

// A section = title + the keys it owns (for edited counts / reset) + what it renders.
// '#curve' and '#mixer' are custom editors; everything else is an encoder.
type Section = { title: string; keys: string[]; items: string[] };
const SECTIONS: Record<string, Section> = {
  wb: { title: 'White balance', keys: ['temp', 'tint'], items: ['temp', 'tint'] },
  tone: { title: 'Tone', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'], items: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  presence: { title: 'Presence', keys: ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'], items: ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'] },
  curve: { title: 'Tone curve', keys: [...PC, 'curveHighlights', 'curveLights', 'curveDarks', 'curveShadows'], items: ['#curve', 'curveHighlights', 'curveLights', 'curveDarks', 'curveShadows'] },
  mixer: { title: 'Color mixer', keys: MIXER, items: ['#mixer'] },
  grading: { title: 'Color grading', keys: ['gradeShadowHue', 'gradeShadowSat', 'gradeMidHue', 'gradeMidSat', 'gradeHighHue', 'gradeHighSat', 'gradeBalance'], items: ['gradeShadowHue', 'gradeShadowSat', 'gradeMidHue', 'gradeMidSat', 'gradeHighHue', 'gradeHighSat', 'gradeBalance'] },
  effects: { title: 'Effects', keys: ['vignette', 'vignetteMid', 'grain'], items: ['vignette', 'vignetteMid', 'grain'] },
  detail: { title: 'Detail', keys: ['sharpen', 'nrLuma', 'nrColor'], items: ['sharpen', 'nrLuma', 'nrColor'] },
  optics: { title: 'Optics', keys: ['distortion', 'ca'], items: ['distortion', 'ca'] },
  calibration: { title: 'Calibration', keys: ['shadowTint', 'redHue', 'redSat', 'greenHue', 'greenSat', 'blueHue', 'blueSat'], items: ['shadowTint', 'redHue', 'redSat', 'greenHue', 'greenSat', 'blueHue', 'blueSat'] },
};
// Mobile accordion groups (mobile-develop.png) built from the same sections
const MOBILE: Record<string, string[]> = {
  Light: ['tone', 'curve'], Color: ['wb', 'presence', 'mixer', 'grading'], Effects: ['effects'],
  Detail: ['detail'], Optics: ['optics'], Calibration: ['calibration'],
};
const MOBILE_PRESENCE = ['vibrance', 'saturation']; // texture/clarity/dehaze live in Effects on mobile
const MOBILE_EFFECTS_EXTRA = ['texture', 'clarity', 'dehaze'];
const NON_GEOMETRY = SLIDERS.map(s => s.k).filter(k => !GEOMETRY.includes(k));

type Props = {
  cur?: Photo; mobile: boolean;
  setVal: (k: string, x: number) => void; commit: () => void;
  resetKeys: (keys: string[], label: string) => void; auto: () => void;
};

export function Adjustments({ cur, mobile, setVal, commit, resetKeys, auto }: Props) {
  const [storedOrder, setOrder] = usePref('panelOrder', Object.keys(SECTIONS));
  const order = [...storedOrder.filter(id => SECTIONS[id]), ...Object.keys(SECTIONS).filter(id => !storedOrder.includes(id))];
  const [hidden, setHidden] = usePref<string[]>('panelHidden', []);
  const [collapsed, setCollapsed] = usePref<string[]>('panelCollapsed', ['mixer', 'grading', 'detail', 'optics', 'calibration']);
  const [openGroup, setOpenGroup] = usePref('openGroup', 'Light');
  const [mixTab, setMixTab] = usePref('mixerTab', 'hue');

  const b = cur ? base(cur) : undefined;
  const edited = (keys: string[]) => (cur && b ? keys.filter(k => cur.v[k] !== b[k]).length : 0);
  const slider = (k: string): Slider => (k === 'temp' && cur ? { ...byKey.temp, def: cur.asShot } : byKey[k]);
  const v = cur?.v ?? Object.fromEntries(SLIDERS.map(s => [s.k, s.def]));
  const item = (k: string): ReactNode =>
    k === '#curve' ? <CurveEditor key={k} v={v} setVal={setVal} commit={commit} />
      : k === '#mixer' ? <ColorMixer key={k} v={v} setVal={setVal} commit={commit} byKey={byKey} tab={mixTab} setTab={setMixTab} />
        : <Encoder key={k} s={slider(k)} value={v[k]} onChange={x => setVal(k, x)} onCommit={commit} />;

  const head = (
    <div className="sec-head">
      <h3>{mobile ? 'Adjustments' : 'Develop'}</h3>
      <button className="ghost bordered" onClick={auto} disabled={!cur}>Auto</button>
      <button className="ghost" onClick={() => resetKeys(NON_GEOMETRY, 'Reset (crop kept)')} disabled={!cur} title="Resets everything except crop and straighten">Reset</button>
    </div>
  );

  if (mobile) {
    return (
      <section className="adjust mobile">
        {head}
        {Object.entries(MOBILE).map(([name, ids]) => {
          let items = ids.flatMap(id => (id === 'presence' ? MOBILE_PRESENCE : SECTIONS[id].items));
          if (name === 'Effects') items = [...MOBILE_EFFECTS_EXTRA, ...items];
          const keys = [...new Set(ids.flatMap(id => SECTIONS[id].keys).concat(name === 'Effects' ? MOBILE_EFFECTS_EXTRA : []))];
          const open = openGroup === name, n = edited(keys);
          return (
            <section key={name} className="group">
              <button className="group-head" aria-expanded={open} aria-controls={`grp-${name}`} onClick={() => setOpenGroup(open ? '' : name)}>
                <span>{name}</span>
                {n > 0 && <span className="edited-count">{n} edited</span>}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : undefined }}><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {open && (
                <div id={`grp-${name}`} className="group-body">
                  {items.map(item)}
                  {n > 0 && <button className="ghost group-reset" onClick={() => resetKeys(keys, `Reset ${name}`)}>Reset {name}</button>}
                </div>
              )}
            </section>
          );
        })}
      </section>
    );
  }

  const move = (id: string, d: number) => setOrder(() => {
    const o = [...order], i = o.indexOf(id), j = i + d;
    if (j < 0 || j >= o.length) return o;
    [o[i], o[j]] = [o[j], o[i]]; return o;
  });
  const visible = order.filter(id => !hidden.includes(id));

  return (
    <section className="adjust">
      {head}
      {visible.map((id, i) => {
        const { title, keys, items } = SECTIONS[id], open = !collapsed.includes(id), n = edited(keys);
        const asShot = id === 'wb' && cur && cur.v.temp === cur.asShot && cur.v.tint === 0;
        return (
          <div key={id} className="panel">
            <div className="panel-head">
              <button className="panel-title" aria-expanded={open} onClick={() => setCollapsed(c => (open ? [...c, id] : c.filter(x => x !== id)))}>
                <span className="chev" aria-hidden="true">{open ? '▾' : '▸'}</span>{title}{asShot ? ' · As shot' : ''}{n > 0 && <span className="edited-count"> · {n}</span>}
              </button>
              {n > 0 && <button className="mini" title={`Reset ${title}`} aria-label={`Reset ${title}`} onClick={() => resetKeys(keys, `Reset ${title}`)}>↺</button>}
              <button className="mini" title="Move up" aria-label={`Move ${title} up`} disabled={i === 0} onClick={() => move(id, -1)}>↑</button>
              <button className="mini" title="Move down" aria-label={`Move ${title} down`} disabled={i === visible.length - 1} onClick={() => move(id, 1)}>↓</button>
              <button className="mini" title="Hide panel" aria-label={`Hide ${title}`} onClick={() => setHidden(h => [...h, id])}>✕</button>
            </div>
            {open && items.map(item)}
          </div>
        );
      })}
      {hidden.length > 0 && (
        <button className="ghost show-hidden" onClick={() => setHidden([])}>Show {hidden.length} hidden panel{hidden.length > 1 ? 's' : ''}</button>
      )}
    </section>
  );
}

export { byKey };
