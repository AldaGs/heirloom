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

// library backup round-trip
const { exportLibrary, importLibrary } = await import('./library.ts');
const mk = (id: string, name: string, w = 600, h = 400) => ({ id, name, w, h, asShot: 5500, date: 0, raw: false, exif: {}, src: { kind: 'blob' }, v: defaults(), hist: [{ label: 'Import', v: defaults(), t: 0 }], hi: 0, rating: 0, flag: false, label: 0 }) as any;
const edited = { ...mk('a', 'x.jpg'), v: { ...defaults(), exposure: 1.5 }, rating: 4, album: 'Trip' };
const file = exportLibrary([edited, mk('b', 'y.jpg')]);
const res = importLibrary([mk('1', 'x.jpg'), mk('2', 'z.jpg')], file);
assert.equal(res.matched, 1); assert.deepEqual(res.missing, ['y.jpg']);
assert.equal(res.photos[0].v.exposure, 1.5); assert.equal(res.photos[0].rating, 4); assert.equal(res.photos[0].album, 'Trip');
console.log('library backup ok');

// rotation / flip geometry
const { orient, frameAspect, wrapAngle } = await import('./sliders.ts');
const { turnRect, flipRect } = await import('./crop-geom.ts');
assert.deepEqual(orient(0), { quarter: 0, rest: 0 }); assert.deepEqual(orient(30), { quarter: 0, rest: 30 });
assert.deepEqual(orient(90), { quarter: 1, rest: 0 }); assert.deepEqual(orient(100), { quarter: 1, rest: 10 });
assert.deepEqual(orient(-90), { quarter: 3, rest: 0 }); assert.deepEqual(orient(180), { quarter: 2, rest: 0 }); assert.deepEqual(orient(-170), { quarter: 2, rest: 10 });
assert.equal(frameAspect(6000, 4000, 90), 4000 / 6000); assert.equal(frameAspect(6000, 4000, 30), 1.5);
assert.equal(wrapAngle(180 + 90), -90); assert.equal(wrapAngle(-180 - 90), 90); assert.equal(wrapAngle(90 + 90), 180);
const rc = { cropX: .1, cropY: .2, cropW: .3, cropH: .4 };
const near = (a: any, b: any) => Object.keys(b).forEach(k => assert.ok(Math.abs(a[k] - b[k]) < 1e-9, k));
near(turnRect(rc, 1), { cropX: .4, cropY: .1, cropW: .4, cropH: .3 });
near(turnRect(turnRect(rc, 1), -1), rc); near(turnRect(turnRect(turnRect(turnRect(rc, 1), 1), 1), 1), rc);
near(flipRect(rc, 'h'), { ...rc, cropX: .6 }); near(flipRect(flipRect(rc, 'v'), 'v'), rc);
console.log('geometry ok');
