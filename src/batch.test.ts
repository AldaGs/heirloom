// Run: node src/batch.test.ts
import assert from 'node:assert/strict';
import { planSync, GROUPS } from './sync.ts';
import { encodeTiff, fitLong, outName, sharpenRGBA, BUILTIN_EXPORTS } from './export.ts';
import { SLIDERS, defaults } from './sliders.ts';

// every slider belongs to exactly one sync group
const all = GROUPS.flatMap(g => g.keys);
assert.equal(new Set(all).size, all.length);
assert.deepEqual([...all].sort(), SLIDERS.map(s => s.k).sort());

const src = { v: { ...defaults(), temp: 6000, exposure: 1, cropW: 0.5, angle: 3 }, asShot: 5500, w: 6000, h: 4000, raw: true };
const dst = { v: { ...defaults(), temp: 4000 }, asShot: 4000, w: 4000, h: 6000, raw: true };
const on = (ids: string[], autoExposure = false) => ({ groups: new Set(ids), autoExposure });

let r = planSync(src, dst, on(['wb', 'tone']));
assert.equal(r.v.temp, 4500, 'temp copied as an offset from as-shot');
assert.equal(r.v.exposure, 1);
assert.equal(r.v.cropW, 1, 'geometry not copied unless chosen');

r = planSync(src, dst, on(['geometry']));
assert.equal(r.v.cropW, 1); assert.match(r.notes.join(), /orientation/);
r = planSync(src, { ...dst, w: 6000, h: 4000 }, on(['geometry']));
assert.equal(r.v.cropW, 0.5); assert.equal(r.v.angle, 3);

r = planSync(src, dst, on(['tone'], true), () => -0.65);
assert.equal(r.v.exposure, -0.65, 'auto exposure computed per photo, not copied');

assert.deepEqual(fitLong(6000, 4000, 2048), { w: 2048, h: 1365 });
assert.deepEqual(fitLong(800, 600, 2048), { w: 800, h: 600 }, 'never upscales');
assert.equal(outName('DSC_01.NEF', BUILTIN_EXPORTS[1]), 'DSC_01-web.jpg');

const px = new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]);
const t = encodeTiff(px, 2, 1), dv = new DataView(t.buffer);
assert.equal(String.fromCharCode(t[0], t[1]), 'II'); assert.equal(dv.getUint16(2, true), 42);
assert.deepEqual([...t.slice(-6)], [10, 20, 30, 40, 50, 60]);

const flat = new Uint8ClampedArray(3 * 3 * 4).fill(100); sharpenRGBA(flat, 3, 3, 3);
assert.ok(flat.every(x => x === 100), 'sharpening leaves flat areas alone');
console.log('batch ok');
