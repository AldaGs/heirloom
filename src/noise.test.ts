// Run: node src/noise.test.ts — simplex stays in range, is continuous and varies.
import assert from 'node:assert/strict';
import { simplex2 } from './simplex.ts';
let min = 1, max = -1;
for (let i = 0; i < 20000; i++) { const v = simplex2(Math.sin(i) * 50, Math.cos(i * 1.3) * 50); min = Math.min(min, v); max = Math.max(max, v); }
assert.ok(min >= -1.01 && max <= 1.01, `range ${min}..${max}`);
assert.ok(max - min > 1.2, 'spans a useful range');
assert.ok(Math.abs(simplex2(3.2, 7.1) - simplex2(3.2001, 7.1)) < 0.01, 'continuous');
console.log('noise ok');

// Tone curve LUT
import { buildLut, monotone } from './curve.ts';
import { defaults, round, SLIDERS } from './sliders.ts';
const id = buildLut(defaults());
assert.ok(id.every((y, i) => Math.abs(y - i / 255) < 1e-3), 'default curve is identity');
const lifted = buildLut({ ...defaults(), pc0: 20 });
assert.ok(Math.abs(lifted[0] - 0.2) < 1e-6 && Math.abs(lifted[255] - 1) < 1e-6, 'black point lift');
const s = buildLut({ ...defaults(), curveShadows: 100 });
assert.ok(s[32] > 32 / 255 + 0.02 && Math.abs(s[255] - 1) < 1e-6 && s[0] === 0, 'shadows region lifts only shadows');
const f = monotone([0, .5, 1], [0, .9, 1]);
for (let x = 0; x <= 1; x += .01) assert.ok(f(x) <= 1 + 1e-9, 'monotone: no overshoot');
const crop = SLIDERS.find(x => x.k === 'cropW')!;
assert.equal(round(crop, 0.123456), 0.1235, 'crop keeps 4 decimals');
console.log('curve ok');
