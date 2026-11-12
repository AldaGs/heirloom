import { BANDS, MASKS, maskKey, orient, type Values } from './sliders.ts';
import { maskUniforms } from './pipeline-uniforms.ts';
import { buildLut } from './curve.ts';
import DEVELOP, { SCALARS } from './develop.glsl.ts';

/*
 * Two stages:
 *  1. prep (once per photo): source (8-bit sRGB bitmap or 16-bit linear RAW) → linear RGBA16F texture + mip chain.
 *  2. develop (every frame): reads the linear texture; mip levels act as cheap blurs for Texture/Clarity/Dehaze.
 * ponytail: mip pyramid = box-ish blur with halo risk at high Clarity; swap for separable Gaussian/guided filter passes if it shows.
 */

const VERT = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = vec2(p.x*.5+.5, .5-p.y*.5); gl_Position = vec4(p,0,1); }`;

// Prep renders into an FBO (row 0 = bottom), so it must NOT flip y; the screen pass flips once.
const VERT_PREP = VERT.replace('.5-p.y*.5', 'p.y*.5+.5');

const PREP_SRGB = `#version 300 es
precision highp float;
uniform sampler2D src; in vec2 uv; out vec4 o;
void main(){ vec3 c = texture(src, uv).rgb; o = vec4(mix(c/12.92, pow((c+.055)/1.055, vec3(2.4)), step(.04045, c)), 1); }`;

const PREP_RAW = `#version 300 es
precision highp float; precision highp usampler2D;
uniform usampler2D src; in vec2 uv; out vec4 o;
void main(){ ivec2 s = textureSize(src, 0); o = vec4(vec3(texelFetch(src, ivec2(uv * vec2(s)), 0).rgb) / 65535., 1); }`;

// Retouch layer (AI Remove): sRGB-encoded patch, alpha = where it replaces the source. Blended over the linear texture.
const PREP_PATCH = `#version 300 es
precision highp float;
uniform sampler2D src; in vec2 uv; out vec4 o;
void main(){ vec4 t = texture(src, uv); vec3 c = t.rgb; o = vec4(mix(c/12.92, pow((c+.055)/1.055, vec3(2.4)), step(.04045, c)), t.a); }`;

// Read-back of the unedited linear image as 8-bit sRGB encoding (exact inverse of the decode above), for AI input.
const ENCODE = `#version 300 es
precision highp float;
uniform sampler2D src; in vec2 uv; out vec4 o;
void main(){ vec3 c = clamp(textureLod(src, uv, 0.).rgb, 0., 1.); o = vec4(mix(c*12.92, 1.055*pow(c, vec3(1./2.4))-.055, step(.0031308, c)), 1); }`;

export type Source = { kind: 'bitmap'; bmp: ImageBitmap } | { kind: 'raw'; w: number; h: number; data: Uint16Array };

export function createPipeline(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 is required');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('GPU lacks float render targets (EXT_color_buffer_float)');

  const program = (frag: string, vert = VERT) => {
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vert], [gl.FRAGMENT_SHADER, frag]] as const) {
      const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    return p;
  };
  const prepSrgb = program(PREP_SRGB, VERT_PREP), prepRaw = program(PREP_RAW, VERT_PREP), prepPatch = program(PREP_PATCH, VERT_PREP), encode = program(ENCODE, VERT_PREP), dev = program(DEVELOP);
  const locs = new Map<string, WebGLUniformLocation | null>();
  const loc = (n: string) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(dev, n)); return locs.get(n)!; };
  gl.useProgram(dev); gl.uniform1i(loc('L'), 0); gl.uniform1i(loc('LUT'), 1); gl.uniform1i(loc('M'), 2);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const maxTex: number = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const fbo = gl.createFramebuffer();
  const lut = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lut);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R16F, 256, 1);
  // Mask texture: channel i = mask slot i (1×1 empty until masks are set)
  const maskTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, maskTex);
  for (const [k, x] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, x);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  let maskOn = [0, 0, 0, 0], maskLevels = 0;
  gl.activeTexture(gl.TEXTURE0);
  let lin: WebGLTexture | null = null, isRaw = false, srcW = 1, srcH = 1, lods = { lodTex: 0, lodClar: 0, lodHaze: 0, lodSharp: 0 };

  const tex = (filter: number) => {
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  return {
    /** patch: optional retouch layer (same aspect as the source), composited in linear light. */
    async load(s: Source, patch?: ImageBitmap) {
      // Upload the source
      const src = tex(gl.NEAREST);
      let w: number, h: number;
      if (s.kind === 'bitmap') {
        const k = Math.min(1, maxTex / Math.max(s.bmp.width, s.bmp.height));
        w = Math.round(s.bmp.width * k); h = Math.round(s.bmp.height * k);
        const b = k < 1 ? await createImageBitmap(s.bmp, { resizeWidth: w, resizeHeight: h }) : s.bmp;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, b);
      } else {
        // ponytail: RAW larger than MAX_TEXTURE_SIZE (≥16k px on most GPUs) isn't downscaled; tile it if a camera ever needs it
        w = s.w; h = s.h;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); // integer textures are incomplete with LINEAR
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16UI, w, h, 0, gl.RGB_INTEGER, gl.UNSIGNED_SHORT, s.data);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      }

      // Prep pass → linear RGBA16F with full mip chain
      if (lin) gl.deleteTexture(lin);
      lin = tex(gl.LINEAR_MIPMAP_LINEAR);
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(w, h))) + 1, gl.RGBA16F, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lin, 0);
      gl.viewport(0, 0, w, h);
      gl.useProgram(s.kind === 'raw' ? prepRaw : prepSrgb);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.deleteTexture(src);
      if (patch) {
        const pt = tex(gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, patch);
        gl.useProgram(prepPatch);
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.disable(gl.BLEND); gl.deleteTexture(pt);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, lin); gl.generateMipmap(gl.TEXTURE_2D);

      // Blur radii scale with resolution (~4 px / ~60 px / ~250 px at 6000 px wide)
      const base = Math.max(0, Math.log2(Math.max(w, h) / 1500));
      lods = { lodTex: base + 1, lodClar: base + 4, lodHaze: base + 6, lodSharp: Math.max(0.5, base - 0.5) };
      canvas.width = srcW = w; canvas.height = srcH = h; isRaw = s.kind === 'raw';
    },
    /** Mask slots as 8-bit coverage (R channel used), all the same size; undefined = empty slot. */
    setMasks(masks: (ImageData | undefined)[]) {
      const first = masks.find(Boolean);
      maskOn = Array.from({ length: MASKS }, (_, i) => (masks[i] ? 1 : 0));
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, maskTex);
      if (!first) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); }
      else {
        const { width: w, height: h } = first, px = new Uint8Array(w * h * 4);
        masks.forEach((m, i) => { if (m) for (let j = 0; j < w * h; j++) px[j * 4 + i] = m.data[j * 4]; });
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
      }
      gl.generateMipmap(gl.TEXTURE_2D); // mip levels = feathered versions
      maskLevels = Math.floor(Math.log2(Math.max(first?.width ?? 1, first?.height ?? 1)));
      gl.activeTexture(gl.TEXTURE0);
    },
    /** The loaded image before any edits (retouch included), 8-bit sRGB, full loaded resolution, top row first. */
    baseImage(): ImageData {
      if (!lin) throw new Error('nothing loaded');
      const t = tex(gl.NEAREST); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, srcW, srcH);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.viewport(0, 0, srcW, srcH);
      gl.useProgram(encode); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lin);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      const px = new Uint8ClampedArray(srcW * srcH * 4);
      gl.readPixels(0, 0, srcW, srcH, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteTexture(t);
      return new ImageData(px, srcW, srcH);
    },
    /** fullFrame: ignore the crop (used while the crop tool is open). */
    render(v: Values, asShot = 5500, fullFrame = false) {
      if (!lin) return;
      const cr = fullFrame ? [0, 0, 1, 1] : [v.cropX, v.cropY, v.cropW, v.cropH];
      const turned = orient(v.angle ?? 0).quarter % 2 === 1, fw = turned ? srcH : srcW, fh = turned ? srcW : srcH;
      const cw = Math.max(1, Math.round(cr[2] * fw)), ch = Math.max(1, Math.round(cr[3] * fh));
      if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
      gl.useProgram(dev);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lut);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RED, gl.FLOAT, buildLut(v));
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, lin);
      gl.viewport(0, 0, cw, ch);
      for (const [k, x] of Object.entries(uniforms(v, asShot))) gl.uniform1f(loc('u_' + k), x);
      for (const [k, x] of Object.entries(lods)) gl.uniform1f(loc(k), x);
      gl.uniform1i(loc('isRaw'), +isRaw);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1fv(loc('mkA[0]'), maskUniforms(v));
      gl.uniform4fv(loc('mkInv'), Array.from({ length: MASKS }, (_, i) => (v[maskKey(i, 'inv')] ? 1 : 0)));
      gl.uniform4fv(loc('mkOn'), maskOn);
      // Feather 100 ≈ 1/16 of the frame's long side (mask is ≤2048 px, so ~5 levels down)
      gl.uniform4fv(loc('mkLod'), Array.from({ length: MASKS }, (_, i) => ((v[maskKey(i, 'feather')] ?? 0) / 100) * Math.max(0, maskLevels - 4)));
      const { quarter, rest } = orient(v.angle ?? 0), a = (rest * Math.PI) / 180, asp = quarter % 2 ? srcH / srcW : srcW / srcH;
      gl.uniform1i(loc('quarter'), quarter); gl.uniform2f(loc('flip'), v.flipH ? 1 : 0, v.flipV ? 1 : 0);
      gl.uniform4f(loc('crop'), cr[0], cr[1], cr[2], cr[3]);
      gl.uniform1f(loc('angle'), a); gl.uniform1f(loc('aspect'), asp);
      gl.uniform1f(loc('rotScale'), Math.cos(Math.abs(a)) + Math.sin(Math.abs(a)) * Math.max(asp, 1 / asp));
      gl.uniform2f(loc('outSize'), cw, ch);
      for (const p of ['hue', 'sat', 'lum'] as const) gl.uniform1fv(loc(p + 'A'), BANDS.map(([b]) => v[`${p}_${b}`] / 100));
      gl.uniformMatrix3fv(loc('calib'), false, calibration(v));
      gl.uniform3fv(loc('gShadow'), gradeTint(v.gradeShadowHue, v.gradeShadowSat));
      gl.uniform3fv(loc('gMid'), gradeTint(v.gradeMidHue, v.gradeMidSat));
      gl.uniform3fv(loc('gHigh'), gradeTint(v.gradeHighHue, v.gradeHighSat));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
}

/** Slider units → shader units. */
function uniforms(v: Values, asShot: number): Record<string, number> {
  const u: Record<string, number> = { temp: Math.log2(v.temp / asShot), tint: v.tint / 150, exposure: v.exposure };
  for (const k of SCALARS.slice(3)) u[k] = v[k] / 100;
  return u;
}

/** Calibration: rotate/saturate each primary (luminance-preserving hue rotation, ±30°). Column-major mat3. */
export function calibration(v: Values) {
  const out: number[] = [];
  ([['redHue', 'redSat'], ['greenHue', 'greenSat'], ['blueHue', 'blueSat']] as const).forEach(([hk, sk], i) => {
    const t = (v[hk] * 0.3 * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    const m = [
      [.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928],
      [.213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283],
      [.213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072],
    ];
    const col = [m[0][i], m[1][i], m[2][i]];
    const l = col[0] * .2126 + col[1] * .7152 + col[2] * .0722, k = 1 + v[sk] / 100;
    out.push(...col.map(x => l + (x - l) * k));
  });
  return out;
}

/** Grading tint for one zone: chroma of the hue at full value, scaled by saturation (no luminance shift). */
export function gradeTint(hue: number, sat: number) {
  const f = (n: number) => { const k = (n + hue / 60) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
  const rgb = [f(5), f(3), f(1)], l = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  return rgb.map(x => (x - l) * (sat / 100) * 0.45);
}

/** RGB histograms (256 bins) from a GPU-downscaled copy of the canvas. */
const small = new OffscreenCanvas(256, 256).getContext('2d', { willReadFrequently: true })!;
export function histogram(src: CanvasImageSource) {
  small.drawImage(src, 0, 0, 256, 256);
  const d = small.getImageData(0, 0, 256, 256).data;
  const h = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < d.length; i += 4) { h[0][d[i]]++; h[1][d[i + 1]]++; h[2][d[i + 2]]++; }
  return h;
}

/** Per-photo auto exposure: push mean luma toward middle grey (from the *unedited* histogram). */
export function autoExposure(h: Uint32Array[]) {
  let sum = 0, n = 0;
  for (let x = 0; x < 256; x++) { const c = h[0][x] * .2126 + h[1][x] * .7152 + h[2][x] * .0722; sum += c * ((x / 255) ** 2.2); n += c; }
  const mean = sum / (n || 1);
  return Math.max(-5, Math.min(5, Math.log2(0.18 / Math.max(mean, 1e-4))));
}
