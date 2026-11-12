// Run: node src/denoise.test.ts
import assert from 'node:assert/strict';
import { composePixel, keepRange, readTile, tileStarts } from './denoise-core.ts';

assert.deepEqual(tileStarts(300), [0]);
assert.deepEqual(tileStarts(512), [0]);
for (const len of [513, 1000, 1200, 4000, 6000, 6001]) {
  const st = tileStarts(len), cover = new Uint8Array(len);
  assert.equal(st.at(-1), len - 512, 'last tile ends at the edge');
  for (const s of st) { const [a, b] = keepRange(s, len, 512, 48, st); for (let i = a; i < b; i++) cover[i]++; }
  assert.ok(cover.every(c => c === 1), `every pixel kept exactly once (len ${len})`);
  for (const s of st) { const [a, b] = keepRange(s, len, 512, 48, st); if (s > 0) assert.ok(a - s >= 48, 'seam ≥ margin from tile start'); if (s + 512 < len) assert.ok(s + 512 - b >= 48, 'seam ≥ margin from tile end'); }
}

const img = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]); // 2x1
const t = readTile(img, 2, 1, 0, 0, 3);
assert.equal(t[0], 1); assert.equal(t[1], 0); assert.equal(t[2], 0, 'clamped to last column'); assert.equal(t[9 + 1], 1);

let L = new Uint8ClampedArray([0, 0, 0, 0]); composePixel(L, 0, [1, 1, 1], 0.6);
assert.deepEqual([...L], [255, 255, 255, 153], 'empty layer: alpha = strength');
L = new Uint8ClampedArray([10, 20, 30, 255]); composePixel(L, 0, [1, 1, 1], 0.5);
assert.equal(L[3], 255, 'removed pixel stays fully covered'); assert.equal(L[0], Math.round((10 * .5 + 255 * .5)));
L = new Uint8ClampedArray([200, 200, 200, 255]); composePixel(L, 0, [0, 0, 0], 0);
assert.deepEqual([...L], [200, 200, 200, 255], 'strength 0 changes nothing');
console.log('denoise ok');
