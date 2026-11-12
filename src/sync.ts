import { GEOMETRY, SLIDERS, type Values } from './sliders.ts';

/** Setting groups for Sync (FIXER_IMPROVEMENTS §5). Geometry is off by default: crops rarely transfer. */
const keysFrom = (a: string, b?: string) => { const i = SLIDERS.findIndex(s => s.k === a), j = b ? SLIDERS.findIndex(s => s.k === b) : SLIDERS.length; return SLIDERS.slice(i, j).map(s => s.k); };
export const GROUPS: { id: string; label: string; keys: string[]; on: boolean }[] = [
  { id: 'wb', label: 'White balance', keys: ['temp', 'tint'], on: true },
  { id: 'tone', label: 'Tone', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'], on: true },
  { id: 'presence', label: 'Presence', keys: ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'], on: true },
  { id: 'curve', label: 'Tone curve', keys: keysFrom('curveHighlights', 'hue_red'), on: true },
  { id: 'mixer', label: 'Color mixer', keys: keysFrom('hue_red', 'gradeShadowHue'), on: true },
  { id: 'grade', label: 'Color grading', keys: keysFrom('gradeShadowHue', 'vignette'), on: true },
  { id: 'effects', label: 'Effects', keys: ['vignette', 'vignetteMid', 'grain'], on: true },
  { id: 'detail', label: 'Detail', keys: ['sharpen', 'nrLuma', 'nrColor'], on: true },
  { id: 'optics', label: 'Optics', keys: ['distortion', 'ca'], on: true },
  { id: 'geometry', label: 'Crop & straighten', keys: GEOMETRY, on: false },
  { id: 'calib', label: 'Calibration', keys: keysFrom('shadowTint'), on: true },
];

export type SyncOpts = { groups: Set<string>; autoExposure: boolean };
export type Target = { v: Values; asShot: number; w: number; h: number; raw: boolean };
export type Plan = { v: Values; notes: string[] };

/**
 * Merge the source's chosen groups into a target. Pure, so it's testable.
 * - Temp is copied as an offset from each photo's own as-shot WB (a +500 K warm-up stays +500 K on every camera).
 * - Auto exposure is computed per photo (`auto`), never copied (§5).
 * - A crop is skipped (and noted) when the target's orientation differs.
 */
export function planSync(src: Target, dst: Target, o: SyncOpts, auto?: () => number): Plan {
  const v = { ...dst.v }, notes: string[] = [];
  for (const g of GROUPS) {
    if (!o.groups.has(g.id)) continue;
    if (g.id === 'geometry' && (src.w > src.h) !== (dst.w > dst.h)) { notes.push('crop skipped: different orientation'); continue; }
    for (const k of g.keys) v[k] = src.v[k];
  }
  if (o.groups.has('wb')) {
    const t = SLIDERS.find(s => s.k === 'temp')!;
    const next = dst.asShot + (src.v.temp - src.asShot);
    v.temp = Math.min(t.max, Math.max(t.min, Math.round(next / 50) * 50));
    if (next !== v.temp) notes.push('temp clamped');
    if (src.raw !== dst.raw) notes.push('WB copied across RAW/JPEG: check it');
  }
  if (o.autoExposure && auto) { v.exposure = +auto().toFixed(2); notes.push('auto exposure'); }
  return { v, notes };
}
