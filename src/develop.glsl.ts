// Scalar slider uniforms (u_<key>, already normalized by uniforms()).
export const SCALARS = ['temp', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation',
  'vignette', 'vignetteMid', 'grain', 'sharpen', 'nrLuma', 'nrColor', 'distortion', 'ca', 'shadowTint', 'gradeBalance'];

const DEVELOP = `#version 300 es
precision highp float;
uniform sampler2D L, LUT; uniform bool isRaw;
uniform float lodTex, lodClar, lodHaze, lodSharp;
uniform vec4 crop; uniform float angle, rotScale, aspect; uniform vec2 outSize;
uniform float ${SCALARS.map(n => 'u_' + n).join(',')};
uniform float hueA[8], satA[8], lumA[8];
uniform mat3 calib; uniform vec3 gShadow, gMid, gHigh;
in vec2 uv; out vec4 o;

vec3 toSrgb(vec3 c){ c=clamp(c,0.,1.); return mix(c*12.92, 1.055*pow(c, vec3(1./2.4))-.055, step(.0031308, c)); }
float luma(vec3 c){ return dot(c, vec3(.2126,.7152,.0722)); }
vec3 rgb2hsv(vec3 c){ vec4 K=vec4(0.,-1./3.,2./3.,-1.); vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));
  vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r)); float d=q.x-min(q.w,q.y);
  return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)), d/(q.x+1e-10), q.x); }
vec3 hsv2rgb(vec3 c){ vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.); return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y); }

// output uv → source uv: crop, straighten (auto-scaled so no empty corners), lens distortion
vec2 mapUV(vec2 q){
  vec2 p = crop.xy + q * crop.zw;
  vec2 c = (p - .5) * vec2(aspect, 1.);
  float s = sin(angle), k = cos(angle);
  c = mat2(k, s, -s, k) * c / rotScale;
  c *= 1. + u_distortion * .25 * dot(c, c) / (.25 * aspect * aspect + .25);
  return c / vec2(aspect, 1.) + .5;
}
float band(float arr[8], float h){ // piecewise-linear across band centres (partition of unity)
  float C[9] = float[9](0.,30.,60.,120.,180.,240.,270.,300.,360.);
  float H = h * 360.;
  for (int i = 0; i < 8; i++) if (H < C[i+1]) return mix(arr[i], arr[(i+1)%8], (H - C[i]) / (C[i+1] - C[i]));
  return arr[0];
}

void main(){
  vec2 u = mapUV(uv);
  if (any(lessThan(u, vec2(0.))) || any(greaterThan(u, vec2(1.)))) { o = vec4(0,0,0,1); return; }

  // Lateral chromatic aberration: scale red/blue planes around the optical centre
  vec2 dc = u - .5;
  vec3 c = vec3(textureLod(L, .5 + dc * (1. + u_ca * .004), 0.).r, textureLod(L, u, 0.).g, textureLod(L, .5 + dc * (1. - u_ca * .004), 0.).b);

  // Detail: edge-aware luma NR, chroma NR, unsharp-mask sharpening (mip levels as blurs)
  float y = max(luma(c), 1e-5);
  vec3 bl = textureLod(L, u, lodSharp + .5).rgb;
  float yb = max(luma(bl), 1e-5);
  float wN = u_nrLuma * (1. - smoothstep(.05, .45, abs(log2(y / yb))));
  c *= mix(y, yb, wN) / y;
  vec3 bc = textureLod(L, u, lodSharp + 2.).rgb;
  c = mix(c, bc * (luma(c) / max(luma(bc), 1e-5)), u_nrColor);
  y = max(luma(c), 1e-5);
  float ys = max(luma(textureLod(L, u, lodSharp).rgb), 1e-5);
  c *= exp2(clamp(log2(y / ys) * u_sharpen * 1.2, -1., 1.));

  // Texture / Clarity: log-luma deviation from blurred versions
  float ev = exp2(u_exposure);
  y = max(luma(c), 1e-5);
  float dT = log2(y / max(luma(textureLod(L, u, lodTex).rgb), 1e-5));
  float dC = log2(y / max(luma(textureLod(L, u, lodClar).rgb), 1e-5));
  float mid = clamp(1. - abs(log2(y * ev) + 2.5) / 4., 0., 1.);
  c *= exp2(clamp(dT * u_texture * .8 + dC * u_clarity * .6 * mid, -2., 2.));

  // Calibration (primaries hue/sat) + shadow tint, in linear light
  c = max(calib * c, 0.);
  c.g *= 1. - u_shadowTint * .25 * (1. - smoothstep(0., .2, luma(c)));

  c *= vec3(1.+u_temp*.4, 1.-u_tint*.3, 1.-u_temp*.4) * ev;

  vec3 hz = textureLod(L, u, lodHaze).rgb * ev;
  float t = clamp(1. - u_dehaze * .6 * clamp(min(hz.r, min(hz.g, hz.b)), 0., 1.), .4, 2.);
  c = max((c - (1. - t)) / t, 0.);

  if (isRaw) {
    c *= exp2(.35);
    float yl = luma(c), yS = yl < .8 ? yl : .8 + .2 * (1. - exp(-(yl - .8) / .2));
    c *= yS / max(yl, 1e-5);
  }
  vec3 g = toSrgb(c);
  if (isRaw) {
    float l0 = luma(g);
    g *= mix(l0, l0 * l0 * (3. - 2. * l0), .35) / max(l0, 1e-4);
    g = mix(vec3(luma(g)), g, 1.1);
  }

  // Basic tone on luminance, hue preserved
  float l = luma(g), l2 = l;
  l2 += u_shadows * .3 * (1.-smoothstep(0., .6, l)) * smoothstep(0., .1, l);
  l2 += u_highlights * .3 * smoothstep(.4, 1., l);
  float lo = -u_blacks*.15, hi = 1. - u_whites*.15;
  l2 = (l2 - lo) / (hi - lo);
  l2 = .5 + (l2 - .5) * (1. + u_contrast);
  g = clamp(g * max(l2, 0.) / max(l, 1e-4), 0., 1.);

  // Tone curve LUT (parametric ∘ point), per channel
  g = vec3(texture(LUT, vec2(g.r * 255. / 256. + .5 / 256., .5)).r,
           texture(LUT, vec2(g.g * 255. / 256. + .5 / 256., .5)).r,
           texture(LUT, vec2(g.b * 255. / 256. + .5 / 256., .5)).r);

  // Color mixer (HSL by hue band); weighted by saturation so greys stay untouched
  vec3 hsv = rgb2hsv(g);
  float w = smoothstep(0., .15, hsv.y);
  hsv.x = fract(hsv.x + band(hueA, hsv.x) * w * (30. / 360.));
  hsv.y = clamp(hsv.y * (1. + band(satA, hsv.x) * w), 0., 1.);
  g = hsv2rgb(hsv) * exp2(band(lumA, hsv.x) * w * hsv.y);

  // Color grading: tint shadows / midtones / highlights, pivot moved by Balance
  l = luma(g);
  float pv = .5 + u_gradeBalance * .25;
  float wS = 1. - smoothstep(0., pv + .3, l), wH = smoothstep(pv - .3, 1., l); // broad, overlapping zones like LR
  g += gShadow * wS + gMid * max(0., 1. - wS - wH) + gHigh * wH;

  float gray = luma(g), sat = max(g.r, max(g.g, g.b)) - min(g.r, min(g.g, g.b));
  g = mix(vec3(gray), g, 1. + u_saturation);
  g = mix(vec3(gray), g, 1. + u_vibrance * (1. - clamp(sat, 0., 1.)));

  // Post-crop vignette + grain
  vec2 dv = (uv - .5) * vec2(outSize.x / outSize.y, 1.);
  float r = length(dv) / length(vec2(outSize.x / outSize.y, 1.) * .5);
  float m = smoothstep(u_vignetteMid * .9, 1.15, r);
  g = u_vignette < 0. ? g * (1. + u_vignette * m) : mix(g, vec3(1.), u_vignette * m);
  float n = fract(sin(dot(floor(uv * outSize / 1.5), vec2(12.9898, 78.233))) * 43758.5453) - .5;
  g += n * u_grain * .18 * (1. - abs(luma(g) - .5));

  o = vec4(clamp(g, 0., 1.), 1);
}`;
export default DEVELOP;
