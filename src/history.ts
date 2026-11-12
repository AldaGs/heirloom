import { SLIDERS, fmt, type Values } from './sliders.ts';

export type Step = { label: string; v: Values; t: number };
export type Edits = { v: Values; hist: Step[]; hi: number };

export const same = (a: Values, b: Values) => SLIDERS.every(s => a[s.k] === b[s.k]);

/** Push a history step if v changed since the current step; drops any redo branch. */
export function push<P extends Edits>(p: P, v: Values, label?: string): P {
  if (same(v, p.hist[p.hi].v)) return { ...p, v };
  const prev = p.hist[p.hi].v;
  const changed = SLIDERS.filter(s => v[s.k] !== prev[s.k]);
  label ??= changed.length === 1 ? `${changed[0].label} ${fmt(changed[0], v[changed[0].k])}` : 'Multiple edits';
  const hist = [...p.hist.slice(0, p.hi + 1), { label, v, t: Date.now() }];
  return { ...p, v, hist, hi: hist.length - 1 };
}
