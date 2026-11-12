export type Slider = { k: string; label: string; min: number; max: number; step: number; def: number; track?: string; unit?: string; hidden?: boolean };
export type Values = Record<string, number>;

const s = (k: string, label: string, min = -100, max = 100, extra: Partial<Slider> = {}): Slider =>
  ({ k, label, min, max, step: 1, def: 0, ...extra });

// Color-mixer bands (FIXER_IMPROVEMENTS §4: HSL); hues in degrees, matched in the shader
export const BANDS: [string, string, number][] = [
  ['red', '#E0453A', 0], ['orange', '#EE8A2E', 30], ['yellow', '#E9CF3A', 60], ['green', '#4CB050', 120],
  ['aqua', '#36BFC4', 180], ['blue', '#3E6FE0', 240], ['purple', '#8A55D9', 270], ['magenta', '#D24FB4', 300],
];
const RAINBOW = 'linear-gradient(90deg,#E0453A,#E9CF3A,#4CB050,#36BFC4,#3E6FE0,#D24FB4,#E0453A)';
const cap = (x: string) => x[0].toUpperCase() + x.slice(1);
const hueTrack = (i: number) => {
  const prev = BANDS[(i + BANDS.length - 1) % BANDS.length][1], next = BANDS[(i + 1) % BANDS.length][1];
  return `linear-gradient(90deg,${prev},${BANDS[i][1]},${next})`;
};

// Point curve: 7 points at fixed x = i/6, y draggable (0..100).
// ponytail: fixed-x control points keep every setting a plain number (history/sidecar/presets for free);
// free-x points would need a non-numeric setting type.
export const CURVE_POINTS = 7;

export const SLIDERS: Slider[] = [
  // Basic
  s('temp', 'Temp', 2000, 12000, { step: 50, def: 5500, track: 'linear-gradient(90deg,#3C7BE0,#D9D3C7,#E8A03A)' }),
  s('tint', 'Tint', -150, 150, { track: 'linear-gradient(90deg,#3FA45B,#D9D3C7,#C44FB5)' }),
  s('exposure', 'Exposure', -5, 5, { step: 0.001 }), // thousandths of a stop
  s('contrast', 'Contrast'), s('highlights', 'Highlights'), s('shadows', 'Shadows'), s('whites', 'Whites'), s('blacks', 'Blacks'),
  s('texture', 'Texture'), s('clarity', 'Clarity'), s('dehaze', 'Dehaze'), s('vibrance', 'Vibrance'), s('saturation', 'Saturation'),
  // Tone curve: parametric regions + point curve
  s('curveHighlights', 'Highlights'), s('curveLights', 'Lights'), s('curveDarks', 'Darks'), s('curveShadows', 'Shadows'),
  ...Array.from({ length: CURVE_POINTS }, (_, i) => s(`pc${i}`, `Point ${i + 1}`, 0, 100, { step: 0.5, def: +(i * 100 / 6).toFixed(2), hidden: true })),
  // Color mixer
  ...BANDS.flatMap(([b, , ], i) => [
    s(`hue_${b}`, cap(b), -100, 100, { track: hueTrack(i) }),
    s(`sat_${b}`, cap(b), -100, 100, { track: `linear-gradient(90deg,#808080,${BANDS[i][1]})` }),
    s(`lum_${b}`, cap(b), -100, 100, { track: `linear-gradient(90deg,#000,${BANDS[i][1]},#fff)` }),
  ]),
  // Color grading
  s('gradeShadowHue', 'Shadows hue', 0, 360, { track: RAINBOW, unit: '°' }), s('gradeShadowSat', 'Shadows sat', 0, 100),
  s('gradeMidHue', 'Midtones hue', 0, 360, { track: RAINBOW, unit: '°' }), s('gradeMidSat', 'Midtones sat', 0, 100),
  s('gradeHighHue', 'Highlights hue', 0, 360, { track: RAINBOW, unit: '°' }), s('gradeHighSat', 'Highlights sat', 0, 100),
  s('gradeBalance', 'Balance'),
  // Effects
  s('vignette', 'Vignette'), s('vignetteMid', 'Midpoint', 0, 100, { def: 50 }), s('grain', 'Grain', 0, 100),
  // Detail
  s('sharpen', 'Sharpening', 0, 150), s('nrLuma', 'Noise reduction', 0, 100), s('nrColor', 'Color noise', 0, 100),
  // Optics
  s('distortion', 'Distortion'), s('ca', 'Chromatic aberr.'),
  // Geometry (crop rect is a fraction of the straightened frame)
  s('angle', 'Rotate', -180, 180, { step: 0.01, unit: '°' }), // any angle: quarter turns + a ±45° straighten (see orient())
  s('flipH', 'Flip horizontal', 0, 1, { hidden: true }), s('flipV', 'Flip vertical', 0, 1, { hidden: true }),
  s('cropX', 'Crop X', 0, 1, { step: 0.0001, hidden: true }), s('cropY', 'Crop Y', 0, 1, { step: 0.0001, hidden: true }),
  s('cropW', 'Crop W', 0.02, 1, { step: 0.0001, def: 1, hidden: true }), s('cropH', 'Crop H', 0.02, 1, { step: 0.0001, def: 1, hidden: true }),
  // Calibration
  s('shadowTint', 'Shadows tint', -100, 100, { track: 'linear-gradient(90deg,#3FA45B,#808080,#C44FB5)' }),
  s('redHue', 'Red hue'), s('redSat', 'Red sat'), s('greenHue', 'Green hue'), s('greenSat', 'Green sat'), s('blueHue', 'Blue hue'), s('blueSat', 'Blue sat'),
];

// Masks (AI Masking): 4 slots, each with local adjustments. Mask pixels live in the photo's layers (history step `mk`).
export const MASKS = 4;
export const MASK_ADJ: [string, string, number, number, number][] = [ // key, label, min, max, step
  ['exposure', 'Exposure', -4, 4, 0.001], ['temp', 'Temp', -100, 100, 1], ['tint', 'Tint', -100, 100, 1], ['contrast', 'Contrast', -100, 100, 1],
  ['highlights', 'Highlights', -100, 100, 1], ['shadows', 'Shadows', -100, 100, 1], ['clarity', 'Clarity', -100, 100, 1], ['saturation', 'Saturation', -100, 100, 1],
];
export const maskKey = (i: number, k: string) => `m${i}_${k}`;
SLIDERS.push(...Array.from({ length: MASKS }, (_, i) => [
  ...MASK_ADJ.map(([k, label, min, max, step]) => s(maskKey(i, k), `Mask ${i + 1} ${label}`, min, max, { step, hidden: true })),
  s(maskKey(i, 'inv'), `Mask ${i + 1} invert`, 0, 1, { hidden: true }),
  s(maskKey(i, 'feather'), `Mask ${i + 1} Feather`, 0, 100, { hidden: true }),
]).flat());

export const GEOMETRY = ['angle', 'flipH', 'flipV', 'cropX', 'cropY', 'cropW', 'cropH'];

/** Split a rotation into quarter turns (0..3, clockwise) + the remaining straighten angle in [-45°, 45°]. */
export function orient(angle: number) {
  const q = Math.round(angle / 90), quarter = ((q % 4) + 4) % 4;
  return { quarter, rest: angle - q * 90 };
}
/** Width/height of the rotated frame (a quarter turn swaps them). */
export const frameAspect = (w: number, h: number, angle: number) => (orient(angle).quarter % 2 ? h / w : w / h);
/** Wrap any angle into (-180, 180]. */
export const wrapAngle = (a: number) => { const x = ((a + 180) % 360 + 360) % 360 - 180; return x === -180 ? 180 : +x.toFixed(1); };

export const PRESETS: { name: string; swatch: string; v: Values }[] = [
  { name: 'Original', swatch: '#6B5B78', v: {} },
  { name: 'Warm Film', swatch: '#D9845E', v: { temp: 6800, exposure: 0.2, contrast: -10, shadows: 25, blacks: 15, vibrance: 15, grain: 20, gradeShadowHue: 200, gradeShadowSat: 15, gradeHighHue: 40, gradeHighSat: 20 } },
  { name: 'Cool Matte', swatch: '#4A7BA8', v: { temp: 4300, tint: 8, contrast: -25, blacks: 35, saturation: -15, pc0: 12 } },
  { name: 'Punchy', swatch: '#C44F5A', v: { contrast: 35, clarity: 25, dehaze: 15, vibrance: 30, highlights: -30, shadows: 20 } },
  { name: 'Mono', swatch: '#8A8A8A', v: { saturation: -100, contrast: 40, clarity: 20 } },
];

export const defaults = (): Values => Object.fromEntries(SLIDERS.map(s => [s.k, s.def]));

const decimals = (step: number) => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
export function round(s: Slider, x: number) {
  x = Math.min(s.max, Math.max(s.min, x));
  x = Math.round(x / s.step) * s.step;
  return parseFloat(x.toFixed(decimals(s.step)));
}

export function fmt(s: Slider, x: number) {
  if (s.k.endsWith('_inv') || s.k === 'flipH' || s.k === 'flipV') return x ? 'on' : 'off';
  if (s.k === 'temp') return String(x);
  if (s.k.endsWith('exposure')) return (x > 0 ? '+' : '') + x.toFixed(decimals(s.step));
  if (s.unit) return `${x}${s.unit}`;
  return (x > 0 && s.min < 0 ? '+' : '') + x;
}
