// Run: node src/history.test.ts
import assert from 'node:assert/strict';
import { push } from './history.ts';
import { SLIDERS, defaults, round } from './sliders.ts';

const v0 = defaults();
let p = { v: v0, hist: [{ label: 'Import', v: v0, t: 0 }], hi: 0 };
p = push(p, { ...v0, exposure: 0.35 });
assert.equal(p.hist.at(-1)!.label, 'Exposure +0.350');
assert.equal(push(p, p.v).hist.length, 2);
p = { ...p, hi: 0, v: v0 };                       // undo
p = push(p, { ...v0, contrast: 10 });            // new edit drops redo branch
assert.deepEqual(p.hist.map(s => s.label), ['Import', 'Contrast +10']);

const temp = SLIDERS.find(s => s.k === 'temp')!, exp = SLIDERS.find(s => s.k === 'exposure')!;
assert.equal(round(temp, 99999), 12000);
assert.equal(round(temp, 5524), 5500);
assert.equal(round(exp, 0.3334), 0.333, 'thousandths of a stop');
console.log('ok');

// RAW helpers
import { asShotKelvin, fmtShutter } from './raw.ts';
assert.equal(asShotKelvin([2, 1, 1.5, 1], [2, 1, 1.5, 0]), 5500, 'daylight multipliers = 5500K');
assert.ok(asShotKelvin([1.4, 1, 2.4, 1], [2, 1, 1.5, 0]) < 4000, 'tungsten (less red gain, more blue) reads cooler');
assert.equal(asShotKelvin(undefined, undefined), 5500);
assert.equal(fmtShutter(1 / 125), '1/125');
assert.equal(fmtShutter(2), '2s');
console.log('raw ok');

// Sidecar round-trip (FIXER_IMPROVEMENTS §7: edits readable without the app)
import { applySidecar, base, toSidecar, type Photo } from './library.ts';
const ph: Photo = { id: 'a', name: 'IMG.CR2', src: { kind: 'blob', blob: new Blob() }, raw: true, exif: {}, asShot: 4400, date: 0, w: 1, h: 1,
  v: { ...base({ asShot: 4400 }), exposure: 0.5 }, hist: [{ label: 'Import', v: base({ asShot: 4400 }), t: 1 }, { label: 'Exposure +0.500', v: { ...base({ asShot: 4400 }), exposure: 0.5 }, t: 2 }],
  hi: 1, rating: 4, flag: true, label: 2 };
const json = toSidecar(ph);
assert.equal(JSON.parse(json).settings.exposure, 0.5, 'plain JSON, readable on disk');
const fresh = { ...ph, v: base(ph), hist: [{ label: 'Import', v: base(ph), t: 9 }], hi: 0, rating: 0, flag: false, label: 0 };
const back = applySidecar(fresh, json);
assert.deepEqual([back.v.exposure, back.v.temp, back.rating, back.flag, back.label, back.hi, back.hist[1].label], [0.5, 4400, 4, true, 2, 1, 'Exposure +0.500']);
assert.equal(applySidecar(fresh, '{"app":"other"}'), fresh, 'foreign JSON ignored');
console.log('sidecar ok');
