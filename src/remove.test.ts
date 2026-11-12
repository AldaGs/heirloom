// Run: node src/remove.test.ts
import assert from 'node:assert/strict';
import { dilate, mergeIntoLayer, toCHW, toMask } from './remove-core.ts';

const px = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
assert.deepEqual([...toCHW(px, 2, 1)], [1, 4, 2, 5, 3, 6]);

const d = dilate(Uint8Array.from([0, 0, 1, 0, 0, 0]), 6, 1, 1);
assert.deepEqual([...d], [0, 1, 1, 1, 0, 0]);

const brush = new Uint8ClampedArray(4 * 4); brush[1 * 4 + 3] = 200; // pixel 1 painted
const { mask, hole, any } = toMask(brush, 4, 1, 4, 0);
assert.ok(any); assert.deepEqual([...mask], [255, 0, 255, 255]); assert.deepEqual([...hole], [0, 1, 0, 0]);
assert.equal(toMask(new Uint8ClampedArray(16), 4, 1, 4).any, false);

const layer = new Uint8ClampedArray(4 * 4); layer.set([9, 9, 9, 255], 12); // earlier removal at pixel 3 survives
mergeIntoLayer(layer, Uint8Array.from([10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33]), hole, 4, 1);
assert.deepEqual([...layer.slice(4, 8)], [11, 21, 31, 255]);
assert.deepEqual([...layer.slice(12, 16)], [9, 9, 9, 255]);
assert.deepEqual([...layer.slice(0, 4)], [0, 0, 0, 0]);
console.log('remove ok');

// Remove layers in history + sidecars
const { pushStep, goto, push } = await import('./history.ts');
const { syncLayers, toSidecar, applySidecar, sidecarLayers, retouchFile } = await import('./library.ts');
const { defaults } = await import('./sliders.ts');
const B = (s: string) => new Blob([s]);
let p: any = { id: 'p', name: 'a.jpg', w: 4, h: 4, asShot: 5500, date: 0, raw: false, exif: {}, src: { kind: 'blob' }, rating: 0, flag: false, label: 0,
  v: defaults(), hist: [{ label: 'Import', v: defaults(), t: 0 }], hi: 0 };
p = syncLayers(pushStep({ ...p, layers: { r1: B('one') } }, 'Remove', { rt: 'r1' }));
assert.equal(p.hi, 1); assert.equal(p.retouch, p.layers.r1);
p = push(p, { ...p.v, exposure: 1 });                       // slider edit keeps the layer
assert.equal(p.hist[2].rt, 'r1');
p = syncLayers(goto(p, 0)); assert.equal(p.retouch, undefined, 'undo past Remove drops the layer');
p = syncLayers(goto(p, 2)); assert.equal(await p.retouch.text(), 'one', 'redo brings it back');
p = syncLayers(pushStep(p, 'Revert removals', { rt: undefined })); assert.equal(p.retouch, undefined);
p = syncLayers(goto(p, 2)); assert.ok(p.retouch, 'revert is undoable');
p = syncLayers(goto(p, 0)); p = syncLayers(pushStep(p, 'Remove', { rt: 'r2' })); // new branch: r1 unreferenced → pruned
assert.deepEqual(Object.keys(p.layers ?? {}), [], 'layers no step references are dropped (r2 had no blob)');

let q: any = syncLayers(pushStep({ ...p, hist: p.hist.slice(0, 1), hi: 0, layers: { r3: B('three') } }, 'Remove', { rt: 'r3' }));
const sc = toSidecar(q);
assert.deepEqual(sidecarLayers(sc), [retouchFile('a.jpg', 'r3')]);
const fresh = { ...q, hist: [q.hist[0]], hi: 0, layers: undefined, retouch: undefined };
assert.equal(applySidecar({ ...fresh, layers: { r3: B('three') } }, sc).retouch && 'ok', 'ok', 'sidecar restores the layer');
assert.equal(applySidecar(fresh, sc).retouch, undefined, 'missing layer file → step kept without it');
console.log('remove history ok');
