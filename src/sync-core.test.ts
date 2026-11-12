// Run: node src/sync-core.test.ts
import assert from 'node:assert/strict';
import { accept, changedGroups, inventory, stamp, syncKey, toSend } from './sync-core.ts';

const v0 = {}, h0: unknown[] = [];
const base = { name: 'a.jpg', date: 5, w: 4, h: 3, v: v0, hist: h0, hi: 0, rating: 0, flag: false, label: 0 };
assert.equal(syncKey(base), 'a.jpg|5|4x3');
assert.deepEqual(changedGroups(base, { ...base, rating: 3 }), ['rating']);
assert.deepEqual(changedGroups(base, { ...base, label: 1, flag: true }), ['flag', 'label']);
assert.deepEqual(changedGroups(base, { ...base, v: {}, album: 'x' }), ['edits', 'album']);
assert.deepEqual(changedGroups(undefined, base), [], 'a fresh import is not an edit');
assert.deepEqual(stamp(base, { ...base, rating: 3 }, 100), { rating: 100 });

const A = { ...base, mt: { edits: 10, rating: 50 } }, B = { ...base, mt: { edits: 20, rating: 50 } };
const other = { ...base, name: 'b.jpg', mt: { edits: 99 } };
assert.deepEqual(toSend(inventory([A, other]), inventory([B])), [], 'B newer edits, equal meta, b.jpg not on peer');
assert.deepEqual(toSend(inventory([B]), inventory([A])), [{ key: 'a.jpg|5|4x3', groups: ['edits'] }]);

const merged = accept(A, 'edits', 20, p => ({ ...p, hi: 7 }));
assert.equal(merged?.hi, 7); assert.equal(merged?.mt.edits, 20); assert.equal(merged?.mt.rating, 50);
assert.equal(accept(B, 'edits', 20, p => p), null, 'tie: keep ours');
assert.equal(accept(B, 'edits', 15, p => p), null, 'older: keep ours');
// convergence: whichever order, both end with the newest write
const m1 = accept(A, 'rating', 60, p => ({ ...p, rating: 2 }))!, x = accept(m1, 'rating', 55, p => ({ ...p, rating: 9 })) ?? m1;
assert.equal(x.rating, 2, 'older write after newer: newer stays');
const y0 = accept(A, 'rating', 55, p => ({ ...p, rating: 9 }))!, y = accept(y0, 'rating', 60, p => ({ ...p, rating: 2 })) ?? y0;
assert.equal(y.rating, 2, 'other order: same result');
assert.deepEqual(stamp({ ...base, mt: { rating: 1 } }, { ...base, rating: 4, mt: { rating: 77 } }, 100), { rating: 77 }, 'synced-in change keeps its time');
console.log('sync ok');
