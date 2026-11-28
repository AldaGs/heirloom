import { useEffect, useRef, type ComponentType, type ReactNode } from 'react';
import {
  Aperture, ArrowClockwise, ArrowCounterClockwise, ArrowLineDown, ArrowLineUp, ArrowsInSimple, ArrowsOutSimple, Bandaids, BezierCurve,
  ChartLine, Circle, CircleHalf, CircleHalfTilt, CirclesThree, Cloud, Crop, Diamond, DotsNine, Drop, DropHalf, Faders, Fingerprint,
  FlipHorizontal, FlipVertical, FrameCorners, MagicWand, MagnifyingGlassPlus, Moon, MoonStars, Palette, PlusMinus, Rainbow, Scales,
  Sparkle, SquaresFour, Sun, SunHorizon, Thermometer, Triangle, Waveform, Waves, type IconProps,
} from '@phosphor-icons/react';
import { CurveEditor } from './CurveEditor.tsx';
import { ASPECTS } from './Crop.tsx';
import { Encoder } from './Encoder.tsx';
import { base, type Photo } from './library.ts';
import { usePref } from './prefs.ts';
import { BANDS, CURVE_POINTS, GEOMETRY, PRESETS, SLIDERS, type Slider } from './sliders.ts';

// Phone develop layout (the pattern most mobile editors use): the photo gets the screen, and a dock at the bottom holds
//   row 3 (top):   the selected control — one encoder, or a bigger editor for special controls (curve, H/S/L, crop)
//   row 2:         the controls of the selected category
//   row 1 (bottom): the categories
// Tool categories (masking, AI denoise/remove) put their own panel in the work area instead.

type Tool = 'edit' | 'presets' | 'crop' | 'info' | 'remove' | 'denoise' | 'mask';
type Icon = ComponentType<IconProps>;
/** A control: one or more settings edited together (e.g. a mixer band = hue + sat + lum). */
type Ctl = { id: string; label: string; icon?: Icon; dot?: string; keys: string[]; sub?: string[]; curve?: boolean };
type Cat = { id: string; label: string; icon: Icon; ctls?: Ctl[]; tool?: Tool; ai?: boolean };

const byKey = Object.fromEntries(SLIDERS.map(s => [s.k, s]));
const one = (k: string, icon: Icon, label = byKey[k].label): Ctl => ({ id: k, label, icon, keys: [k] });
const PC = Array.from({ length: CURVE_POINTS }, (_, i) => `pc${i}`);
const HS = ['Hue', 'Saturation'];
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);

const CATS: Cat[] = [
  { id: 'presets', label: 'Presets', icon: SquaresFour, tool: 'presets' },
  { id: 'crop', label: 'Crop', icon: Crop, tool: 'crop' },
  { id: 'light', label: 'Light', icon: Sun, ctls: [
    one('exposure', PlusMinus), one('contrast', CircleHalf), one('highlights', SunHorizon), one('shadows', MoonStars),
    one('whites', ArrowLineUp), one('blacks', ArrowLineDown),
  ] },
  { id: 'curve', label: 'Curve', icon: ChartLine, ctls: [
    { id: 'points', label: 'Points', icon: BezierCurve, keys: PC, curve: true },
    one('curveHighlights', SunHorizon), one('curveLights', Sun), one('curveDarks', Moon), one('curveShadows', MoonStars),
  ] },
  { id: 'color', label: 'Color', icon: Thermometer, ctls: [
    one('temp', Thermometer), one('tint', Drop), one('vibrance', Rainbow), one('saturation', DropHalf),
  ] },
  { id: 'mixer', label: 'Mixer', icon: Palette, ctls: BANDS.map(([b, dot]) => ({ id: b, label: cap(b), dot, keys: [`hue_${b}`, `sat_${b}`, `lum_${b}`], sub: ['Hue', 'Saturation', 'Luminance'] })) },
  { id: 'grading', label: 'Grading', icon: CircleHalfTilt, ctls: [
    { id: 'gs', label: 'Shadows', icon: MoonStars, keys: ['gradeShadowHue', 'gradeShadowSat'], sub: HS },
    { id: 'gm', label: 'Midtones', icon: CircleHalf, keys: ['gradeMidHue', 'gradeMidSat'], sub: HS },
    { id: 'gh', label: 'Highlights', icon: SunHorizon, keys: ['gradeHighHue', 'gradeHighSat'], sub: HS },
    one('gradeBalance', Scales),
  ] },
  { id: 'effects', label: 'Effects', icon: Sparkle, ctls: [
    one('texture', Fingerprint), one('clarity', Diamond), one('dehaze', Cloud), one('vignette', Circle, 'Vignette'),
    one('vignetteMid', ArrowsInSimple, 'Midpoint'), one('grain', DotsNine), one('grainSize', ArrowsOutSimple, 'Grain size'), one('grainRough', Waveform),
  ] },
  { id: 'detail', label: 'Detail', icon: MagnifyingGlassPlus, ctls: [
    one('sharpen', Triangle, 'Sharpen'), one('nrLuma', Waves, 'Noise'), one('nrColor', Palette, 'Color noise'),
  ] },
  { id: 'optics', label: 'Optics', icon: Aperture, ctls: [one('distortion', FrameCorners), one('ca', CirclesThree, 'Fringing')] },
  { id: 'calibration', label: 'Calibrate', icon: Faders, ctls: [
    one('shadowTint', MoonStars, 'Shadow tint'),
    { id: 'red', label: 'Red', dot: '#E0453A', keys: ['redHue', 'redSat'], sub: HS },
    { id: 'green', label: 'Green', dot: '#4CB050', keys: ['greenHue', 'greenSat'], sub: HS },
    { id: 'blue', label: 'Blue', dot: '#3E6FE0', keys: ['blueHue', 'blueSat'], sub: HS },
  ] },
  { id: 'mask', label: 'Masking', icon: CircleHalf, tool: 'mask' },
  { id: 'denoise', label: 'Denoise', icon: DotsNine, tool: 'denoise', ai: true },
  { id: 'remove', label: 'Remove', icon: Bandaids, tool: 'remove', ai: true },
];
const NON_GEOMETRY = SLIDERS.map(s => s.k).filter(k => !GEOMETRY.includes(k));

type Props = {
  cur?: Photo; ai: boolean; tool: Tool; setTool: (t: Tool) => void;
  setVal: (k: string, x: number) => void; commit: () => void; resetKeys: (keys: string[], label: string) => void; auto: () => void;
  /** Panel for tool categories (masking, denoise, remove), built by the app. */
  sheet: ReactNode;
  presets: { active?: string; apply: (name: string) => void };
  crop: { aspect: string; setAspect: (a: string) => void; turn: (d: 1 | -1) => void; flip: (a: 'h' | 'v') => void; reset: () => void };
};

export function MobileDock({ cur, ai, tool, setTool, setVal, commit, resetKeys, auto, sheet, presets, crop }: Props) {
  const [catPref, setCat] = usePref('mobileCat', 'light');
  const [selPref, setSel] = usePref<Record<string, string>>('mobileCtl', {});
  const cats = CATS.filter(c => !c.ai || ai);
  const toolCat = cats.find(c => c.tool && c.tool === tool);
  const cat = toolCat ?? cats.find(c => c.id === catPref && !c.tool) ?? cats.find(c => c.id === 'light')!;
  const ctl = cat.ctls && (cat.ctls.find(c => c.id === selPref[cat.id]) ?? cat.ctls[0]);

  const b = cur ? base(cur) : undefined;
  const v = cur?.v ?? Object.fromEntries(SLIDERS.map(s => [s.k, s.def]));
  const edited = (keys: string[]) => !!cur && !!b && keys.some(k => cur.v[k] !== b[k]);
  const keysOf = (c: Cat) => c.ctls?.flatMap(x => x.keys) ?? (c.id === 'crop' ? GEOMETRY : []);
  const slider = (k: string): Slider => (k === 'temp' && cur ? { ...byKey.temp, def: cur.asShot } : byKey[k]);

  const pick = (c: Cat) => { if (c.tool) setTool(c.tool); else { setTool('edit'); setCat(c.id); } };

  // keep the selected buttons in view when the rows scroll
  const catRow = useRef<HTMLDivElement>(null), ctlRow = useRef<HTMLDivElement>(null);
  useEffect(() => { catRow.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [cat.id]);
  useEffect(() => { ctlRow.current?.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }); }, [cat.id, ctl?.id]);

  let work: ReactNode = null, row: ReactNode = null;
  if (cat.ctls && ctl) {
    work = ctl.curve
      ? <div className="dock-curve"><CurveEditor v={v} setVal={setVal} commit={commit} /><p className="muted small">Drag a point up or down · double-tap to reset it</p></div>
      : ctl.keys.map((k, i) => {
        const s = slider(k);
        return <Encoder key={k} s={ctl.sub ? { ...s, label: ctl.keys.length > 1 ? `${ctl.label} · ${ctl.sub[i]}` : s.label } : s} value={v[k]} onChange={x => setVal(k, x)} onCommit={commit} idPrefix="dock" />;
      });
    const n = edited(keysOf(cat));
    row = <>
      {cat.id === 'light' && <DockBtn label="Auto" icon={MagicWand} onClick={auto} disabled={!cur} />}
      {cat.ctls.map(c => <DockBtn key={c.id} label={c.label} icon={c.icon} dot={c.dot} on={c.id === ctl.id} edited={edited(c.keys)} disabled={!cur}
        onClick={() => setSel(s => ({ ...s, [cat.id]: c.id }))} />)}
      {n && <DockBtn label="Reset" icon={ArrowCounterClockwise} onClick={() => resetKeys(keysOf(cat), `Reset ${cat.label}`)} />}
    </>;
  } else if (cat.id === 'presets') {
    row = <>
      {PRESETS.map(p => (
        <button key={p.name} className={'dock-btn preset-btn' + (presets.active === p.name ? ' on' : '')} aria-pressed={presets.active === p.name} disabled={!cur} onClick={() => presets.apply(p.name)}>
          <span className="dock-label">{p.name}</span><span className="dock-swatch" style={{ background: p.swatch }} />
        </button>
      ))}
      <DockBtn label="Reset all" icon={ArrowCounterClockwise} disabled={!edited(NON_GEOMETRY)} onClick={() => resetKeys(NON_GEOMETRY, 'Reset (crop kept)')} />
    </>;
  } else if (cat.id === 'crop' && cur) {
    work = <>
      <div className="dock-chips" role="radiogroup" aria-label="Aspect ratio">
        {ASPECTS.map(([name]) => <button key={name} role="radio" aria-checked={crop.aspect === name} className={'pill' + (crop.aspect === name ? ' on' : '')} onClick={() => crop.setAspect(name)}>{name}</button>)}
      </div>
      <Encoder s={{ ...byKey.angle, label: 'Straighten' }} value={v.angle} onChange={x => setVal('angle', x)} onCommit={commit} idPrefix="dock" />
    </>;
    row = <>
      <DockBtn label="Rotate left" icon={ArrowCounterClockwise} onClick={() => crop.turn(-1)} />
      <DockBtn label="Rotate right" icon={ArrowClockwise} onClick={() => crop.turn(1)} />
      <DockBtn label="Flip H" icon={FlipHorizontal} on={!!v.flipH} onClick={() => crop.flip('h')} />
      <DockBtn label="Flip V" icon={FlipVertical} on={!!v.flipV} onClick={() => crop.flip('v')} />
      <DockBtn label="Reset" icon={ArrowCounterClockwise} disabled={!edited(GEOMETRY)} onClick={crop.reset} />
    </>;
  } else work = <div className="dock-sheet scroll">{sheet}</div>;

  return (
    <div className="dock">
      {work && <div className="dock-work">{work}</div>}
      {row && <div className="dock-row ctl-row scroll" ref={ctlRow} role="group" aria-label={`${cat.label} controls`}>{row}</div>}
      <nav className="dock-row cat-row scroll" ref={catRow} aria-label="Edit categories">
        {cats.map(c => <DockBtn key={c.id} label={c.label} icon={c.icon} on={c.id === cat.id} edited={edited(keysOf(c))} current onClick={() => pick(c)} />)}
      </nav>
    </div>
  );
}

function DockBtn({ label, icon: I, dot, on, edited, current, disabled, onClick }: {
  label: string; icon?: Icon; dot?: string; on?: boolean; edited?: boolean; current?: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button className={'dock-btn' + (on ? ' on' : '')} disabled={disabled} onClick={onClick}
      {...(current ? { 'aria-current': on ? 'true' : undefined } : { 'aria-pressed': !!on })}>
      <span className="dock-label">{label}</span>
      {I ? <I size={22} weight={on ? 'fill' : 'regular'} aria-hidden="true" /> : <span className="dock-swatch round" style={{ background: dot }} />}
      {edited && <i className="dock-edited" aria-label="edited" />}
    </button>
  );
}
