import { SLIDERS, fmt, type Values } from './sliders.ts';

/** rt: AI layer (Remove/Denoise) in effect at this step; mk: mask image id per mask slot ('' = empty). */
export type Step = { label: string; v: Values; t: number; rt?: string; mk?: string[] };
export type Edits = { v: Values; hist: Step[]; hi: number };

export const same = (a: Values, b: Values) => SLIDERS.every(s => a[s.k] === b[s.k]);

/** Push a history step if v changed since the current step; drops any redo branch. */
export function push<P extends Edits>(p: P, v: Values, label?: string): P {
  if (same(v, p.hist[p.hi].v)) return { ...p, v };
  const prev = p.hist[p.hi].v;
  const changed = SLIDERS.filter(s => v[s.k] !== prev[s.k]);
  label ??= changed.length === 1 ? `${changed[0].label} ${fmt(changed[0], v[changed[0].k])}` : 'Multiple edits';
  const hist = [...p.hist.slice(0, p.hi + 1), { label, v, t: Date.now(), rt: p.hist[p.hi].rt, mk: p.hist[p.hi].mk }];
  return { ...p, v, hist, hi: hist.length - 1 };
}

/** Push a step even when settings didn't change (new AI layer or mask). Fields not given are inherited. Drops any redo branch. */
export function pushStep<P extends Edits>(p: P, label: string, ch: { rt?: string; mk?: string[]; v?: Values }): P {
  const cur = p.hist[p.hi], v = ch.v ?? p.v;
  const hist = [...p.hist.slice(0, p.hi + 1), { label, v, t: Date.now(), rt: 'rt' in ch ? ch.rt : cur.rt, mk: 'mk' in ch ? ch.mk : cur.mk }];
  return { ...p, v, hist, hi: hist.length - 1 };
}
/** Move to step i (undo / redo / click in History). */
export const goto = <P extends Edits>(p: P, i: number): P => (i < 0 || i >= p.hist.length ? p : { ...p, hi: i, v: p.hist[i].v });
