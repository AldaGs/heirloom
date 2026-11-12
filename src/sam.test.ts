// Run: node src/sam.test.ts
import assert from 'node:assert/strict';
import { decoderPoints, encoderInput, logitsToCoverage, maskSize, samScale } from './sam-core.ts';
import { maskUniforms } from './pipeline-uniforms.ts';
import { defaults, maskKey } from './sliders.ts';

assert.equal(samScale(6000, 4000), 1024 / 6000);
assert.deepEqual(maskSize(6000, 4000), { w: 2048, h: 1365 });
assert.deepEqual(maskSize(800, 600), { w: 800, h: 600 });
const inp = encoderInput(new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]), 2, 1);
assert.equal(inp[0], 10); assert.equal(inp[1], 40); assert.equal(inp[1024 * 1024], 20); assert.equal(inp[2 * 1024 * 1024 + 1], 60); assert.equal(inp[1024], 0, 'padding is zero');
const p = decoderPoints([{ x: .5, y: .5, add: true }, { x: 0, y: 1, add: false }], 2000, 1000);
assert.equal(p.n, 3); assert.deepEqual([...p.coords], [512, 256, 0, 512, 0, 0]); assert.deepEqual([...p.labels], [1, 0, -1]);
const cov = logitsToCoverage(new Float32Array([-20, 0, 20]));
assert.equal(cov[0], 0); assert.equal(cov[4], 128); assert.equal(cov[8], 255); assert.equal(cov[11], 255);
const v = { ...defaults(), [maskKey(1, 'exposure')]: 1.5, [maskKey(1, 'contrast')]: 50, [maskKey(0, 'temp')]: 100 };
const u = maskUniforms(v);
assert.equal(u.length, 32); assert.equal(u[8], 1.5); assert.equal(u[11], 0.5); assert.ok(Math.abs(u[1] - 0.6) < 1e-9);
console.log('sam ok');

// procedural masks + brush
const { linearMask, radialMask, applyBrush, emptyMask } = await import('./mask-shapes.ts');
const at = (m: any, x: number, y: number) => m.data[(y * m.width + x) * 4];
const lin = linearMask(100, 10, { x: .2, y: .5 }, { x: .8, y: .5 });
assert.equal(at(lin, 5, 5), 255, 'before start: full'); assert.equal(at(lin, 95, 5), 0, 'past end: none');
assert.ok(Math.abs(at(lin, 50, 5) - 127) < 6, 'halfway ≈ 50%');
const rad = radialMask(100, 100, { x: .5, y: .5 }, { x: .9, y: .5 }, .5);
assert.equal(at(rad, 50, 50), 255); assert.equal(at(rad, 99, 50), 0); assert.equal(at(rad, 60, 50), 255, 'inside inner radius'); 
const br = { data: new Uint8ClampedArray(4 * 4), width: 2, height: 2 }; br.data[3] = 255; br.data[7] = 128;
const m0 = emptyMask(2, 2); const added = applyBrush(m0, br, true);
assert.deepEqual([added.data[0], added.data[4], added.data[8]], [255, 128, 0]);
const sub = applyBrush(added, br, false);
assert.deepEqual([sub.data[0], sub.data[4]], [0, 127]);
console.log('mask shapes ok');
