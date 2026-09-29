/**
 * The mask preview's shaders. Every texture is stored the GL way up (row 0
 * at the bottom); `S()` samples one at a top-down point, so display and base
 * coordinates read as they do everywhere else (0,0 top left). The formulas
 * follow shared/maskpreview.ts and shared/gradients.ts.
 */

export const VS = `#version 300 es
in vec2 aPos;
void main() {
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`

const HEAD = `#version 300 es
precision highp float;
uniform vec2 uSize;
out vec4 o;
vec2 here() { vec2 t = gl_FragCoord.xy / uSize; return vec2(t.x, 1.0 - t.y); }
float S(sampler2D t, vec2 p) { return texture(t, vec2(p.x, 1.0 - p.y)).r; }
float smooth01(float e0, float e1, float x) {
  if (e1 <= e0) return x < e0 ? 0.0 : 1.0;
  float t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
`

/** A linear or radial gradient's plane, in the base frame (see gradients.ts). */
export const SHAPE_FS = `${HEAD}
uniform int uKind;        // 0 linear, 1 radial
uniform vec2 uPlane;      // the component's plane size, its own pixels
uniform vec4 uLine;       // linear: sx, sy, dx, dy (plane pixels)
uniform vec4 uEllipse;    // radial: cx, cy, rx, ry (plane pixels)
uniform vec3 uTurn;       // radial: cos, sin of −angle, inner
void main() {
  vec2 p = here() * uPlane;
  float v;
  if (uKind == 0) {
    float len2 = dot(uLine.zw, uLine.zw);
    float t = dot(p - uLine.xy, uLine.zw);
    v = len2 < 1e-9 ? (t <= 0.0 ? 1.0 : 0.0) : 1.0 - smooth01(0.0, 1.0, t / len2);
  } else {
    vec2 q = p - uEllipse.xy;
    float u = (q.x * uTurn.x - q.y * uTurn.y) / uEllipse.z;
    float w = (q.x * uTurn.y + q.y * uTurn.x) / uEllipse.w;
    v = 1.0 - smooth01(uTurn.z, 1.0, sqrt(u * u + w * w));
  }
  o = vec4(v, 0.0, 0.0, 1.0);
}`

/** One direction of a Gaussian; outside the plane counts as nothing (the engine's edge: Zero). */
export const BLUR_FS = `${HEAD}
uniform sampler2D uSrc;
uniform vec2 uStep;       // one texel along the blur's direction, top-down uv
uniform float uSigma;     // texels
void main() {
  vec2 p = here();
  int r = int(ceil(uSigma * 3.0));
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = -64; i <= 64; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-0.5 * float(i * i) / (uSigma * uSigma));
    vec2 q = p + uStep * float(i);
    float v = (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? 0.0 : S(uSrc, q);
    sum += v * w;
    wsum += w;
  }
  o = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`

/** A range key on the picture as shown (see maskpreview.ts `rangeWeight`). */
export const RANGE_FS = `${HEAD}
uniform sampler2D uPicture;
uniform vec4 uHue;        // centre, width, softness, on
uniform vec4 uSat;
uniform vec4 uLuma;
float band(vec4 b, float x, float period) {
  if (b.w < 0.5) return 1.0;
  float d = abs(x - b.x);
  if (period > 0.0) { d = mod(d, period); d = min(d, period - d); }
  float inner = b.y * 0.5;
  if (d <= inner) return 1.0;
  if (b.z <= 0.0) return 0.0;
  float t = min(1.0, (d - inner) / b.z);
  return 1.0 - t * t * (3.0 - 2.0 * t);
}
void main() {
  vec2 p = here();
  vec3 c = texture(uPicture, vec2(p.x, 1.0 - p.y)).rgb;
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float ch = mx - mn;
  float h = 0.0;
  if (ch > 0.0) {
    if (mx == c.r) h = 60.0 * mod((c.g - c.b) / ch + 6.0, 6.0);
    else if (mx == c.g) h = 60.0 * ((c.b - c.r) / ch + 2.0);
    else h = 60.0 * ((c.r - c.g) / ch + 4.0);
  }
  float s = mx > 0.0 ? ch / mx : 0.0;
  float l = dot(c, vec3(0.2289, 0.6917, 0.0793));
  o = vec4(band(uHue, h, 360.0) * band(uSat, s, 0.0) * band(uLuma, l, 0.0), 0.0, 0.0, 1.0);
}`

/** One component joins the mask so far (see maskpreview.ts `combine`), in display space. */
export const JOIN_FS = `${HEAD}
uniform sampler2D uAcc;
uniform sampler2D uComp;
uniform bool uFirst;
uniform bool uBase;       // the component's plane is in the base frame
uniform mat3 uToBase;     // display → base, normalised
uniform int uMode;        // 0 add, 1 subtract, 2 intersect
uniform bool uInvert;
uniform float uOpacity;
void main() {
  vec2 d = here();
  vec2 q = uBase ? (uToBase * vec3(d, 1.0)).xy : d;
  float shape = (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) ? 0.0 : S(uComp, q);
  float v = (uInvert ? 1.0 - shape : shape) * uOpacity;
  float prev = uFirst ? 0.0 : S(uAcc, d);
  float m = uMode == 0 ? prev + v - prev * v : uMode == 1 ? prev * (1.0 - v) : prev * v;
  o = vec4(m, 0.0, 0.0, 1.0);
}`

/**
 * The overlay: the loupe's mask and the engine's, crossfaded, shown as the
 * chosen view. Premultiplied alpha out.
 */
export const SHADE_FS = `${HEAD}
uniform sampler2D uAcc;
uniform sampler2D uEngine;
uniform bool uHaveAcc;
uniform bool uHaveEngine;
uniform bool uLayerInvert;
uniform float uLive;      // 1: the loupe's mask, 0: the engine's
uniform int uView;        // 0 colour, 1 image on black, 2 image on white, 3 white on black, 4 outline
uniform vec3 uTint;
uniform float uAlpha;
uniform float uReveal;    // 0…1: a wipe from the top (a mask arriving from a model)
void main() {
  vec2 d = here();
  float live = 0.0;
  if (uHaveAcc) { live = S(uAcc, d); if (uLayerInvert) live = 1.0 - live; }
  float engine = uHaveEngine ? S(uEngine, d) : live;
  float m = uHaveAcc ? mix(engine, live, uLive) : engine;
  // A mask arriving from a model is wiped in from the top behind a lit edge.
  float front = uReveal < 1.0 ? 1.0 - smoothstep(0.0, 0.008, abs(d.y - uReveal)) : 0.0;
  if (d.y > uReveal + 0.008) { o = vec4(0.0); return; }
  if (d.y > uReveal) { o = vec4(vec3(0.62, 0.55, 0.92) * front, front); return; }
  if (uView == 0) {
    float a = uAlpha * m;
    o = vec4(uTint * a, a);
  } else if (uView == 1 || uView == 2) {
    float a = max(uAlpha, 0.85) * (1.0 - m);
    vec3 c = uView == 1 ? vec3(0.0) : vec3(1.0);
    o = vec4(c * a, a);
  } else if (uView == 3) {
    o = vec4(vec3(m), 1.0);
  } else {
    float w = max(fwidth(m), 1e-4);
    float line = 1.0 - smoothstep(0.0, 1.6 * w, abs(m - 0.5));
    float faint = max(1.0 - smoothstep(0.0, 1.2 * w, abs(m - 0.12)),
                      1.0 - smoothstep(0.0, 1.2 * w, abs(m - 0.88)));
    float fill = 0.10 * m;
    float a = clamp(max(line, faint * 0.35) + fill, 0.0, 1.0) * uAlpha;
    o = vec4(mix(uTint, vec3(1.0), line * 0.5) * a, a);
  }
  o = max(o, vec4(vec3(0.62, 0.55, 0.92) * front, front));
}`
