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
