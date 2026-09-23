/**
 * White balance, in exactly the model the engine's `WhiteBalance` grade
 * operation uses (pixl-engine/src/color/grade_run.rs): the CIE daylight locus
 * from 4000 K up, the Planckian locus below it shifted to meet it without a
 * step, a tint that is the illuminant's CIE 1960 Δuv (positive toward green),
 * and a Bradford adaptation from that white to the locus white at 6504 K.
 *
 * The engine op says "the picture's neutral was lit by this white; adapt it
 * to D65". Everything the app shows on its sliders is translated into that
 * one statement here:
 *
 * - a RAW is developed already balanced for the camera's as-shot white, so an
 *   absolute setting (say 5500 K) becomes the op white that 5500 K appears as
 *   after that balance;
 * - any other file gets relative sliders, a mired offset and a Δuv offset
 *   from the identity;
 * - auto and the eyedropper measure a colour that should be neutral and ask
 *   which op white would neutralise it.
 */

export type Vec3 = [number, number, number]
export type Mat3 = [Vec3, Vec3, Vec3]
export type Xy = [number, number]

export const KELVIN_MIN = 1667
export const KELVIN_MAX = 25000
export const TINT_MAX_DUV = 0.1
/** Slider units per Δuv: ±150 on the tint slider is ±0.05 Δuv. */
export const TINT_UNITS_PER_DUV = 3000
export const REFERENCE_KELVIN = 6504

function planckianXy(t: number): Xy {
  const x =
    t <= 4000
      ? -0.2661239e9 / t ** 3 - 0.2343589e6 / t ** 2 + 0.8776956e3 / t + 0.17991
      : -3.0258469e9 / t ** 3 + 2.1070379e6 / t ** 2 + 0.2226347e3 / t + 0.24039
  const y =
    t <= 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : t <= 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483
  return [x, y]
}

function daylightXy(t: number): Xy {
  const x =
    t <= 7000
      ? 0.244063 + 0.09911e3 / t + 2.9678e6 / t ** 2 - 4.607e9 / t ** 3
      : 0.23704 + 0.24748e3 / t + 1.9018e6 / t ** 2 - 2.0064e9 / t ** 3
  const y = -3.0 * x * x + 2.87 * x - 0.275
  return [x, y]
}

export function xyToUv([x, y]: Xy): Xy {
  const d = -2 * x + 12 * y + 3
  return [(4 * x) / d, (6 * y) / d]
}

export function uvToXy([u, v]: Xy): Xy {
  const d = 2 * u - 8 * v + 4
  return [(3 * u) / d, (2 * v) / d]
}

function locusUv(t: number): Xy {
  if (t >= 4000) return xyToUv(daylightXy(t))
  const joinD = xyToUv(daylightXy(4000))
  const joinP = xyToUv(planckianXy(4000))
  const p = xyToUv(planckianXy(t))
  return [p[0] + joinD[0] - joinP[0], p[1] + joinD[1] - joinP[1]]
}

/** The unit normal to the locus at `t`, oriented toward positive Δuv. */
function locusNormal(t: number): Xy {
  const a = locusUv(Math.max(t - 1, KELVIN_MIN))
  const b = locusUv(Math.min(t + 1, KELVIN_MAX))
  const tangent = [b[0] - a[0], b[1] - a[1]]
  let n: Xy = [-tangent[1], tangent[0]]
  const len = Math.hypot(n[0], n[1])
  if (len > 0) n = [n[0] / len, n[1] / len]
  if (n[1] < 0) n = [-n[0], -n[1]]
  return n
}

/** The white a temperature and tint name, as xy. */
export function whiteXy(kelvin: number, tint: number): Xy {
  const uv = locusUv(kelvin)
  const n = locusNormal(kelvin)
  return uvToXy([uv[0] + tint * n[0], uv[1] + tint * n[1]])
}

/** The same, as XYZ with Y = 1. */
export function whiteXyz(kelvin: number, tint: number): Vec3 {
  return xyToXyz(whiteXy(kelvin, tint))
}

export function xyToXyz([x, y]: Xy): Vec3 {
  return [x / y, 1, (1 - x - y) / y]
}

export function xyzToXy([X, Y, Z]: Vec3): Xy {
  const s = X + Y + Z
  return s > 0 ? [X / s, Y / s] : [0.3127, 0.329]
}

/**
 * The temperature and tint whose white is `xy` — the inverse of `whiteXy`.
 * The foot of the perpendicular from `xy` (in uv) to the locus is found by
 * bisection in mired, where the locus is smooth; the tint is the signed
 * distance along the normal there. Out-of-range results are clamped to what
 * the engine accepts, and the flag says so.
 */
export function temperatureTintOf(xy: Xy): { kelvin: number; tint: number; clamped: boolean } {
  const uv = xyToUv(xy)
  const along = (t: number): number => {
    const p = locusUv(t)
    const a = locusUv(Math.max(t - 1, KELVIN_MIN))
    const b = locusUv(Math.min(t + 1, KELVIN_MAX))
    return (uv[0] - p[0]) * (b[0] - a[0]) + (uv[1] - p[1]) * (b[1] - a[1])
  }
  // along() is positive when uv lies "hotter" than t along the tangent.
  let lo = 1e6 / KELVIN_MAX // mired
  let hi = 1e6 / KELVIN_MIN
  const fLo = along(1e6 / lo)
  const fHi = along(1e6 / hi)
  let kelvin: number
  let clamped = false
  if (Math.sign(fLo) === Math.sign(fHi)) {
    // The foot lies beyond an end of the range.
    kelvin = Math.abs(fLo) < Math.abs(fHi) ? KELVIN_MAX : KELVIN_MIN
    clamped = true
  } else {
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2
      const f = along(1e6 / mid)
      if (Math.sign(f) === Math.sign(fLo)) lo = mid
      else hi = mid
    }
    kelvin = 1e6 / ((lo + hi) / 2)
  }
  const p = locusUv(kelvin)
  const n = locusNormal(kelvin)
  let tint = (uv[0] - p[0]) * n[0] + (uv[1] - p[1]) * n[1]
  if (Math.abs(tint) > TINT_MAX_DUV) {
    tint = Math.sign(tint) * TINT_MAX_DUV
    clamped = true
  }
  return { kelvin, tint, clamped }
}

// ── Matrices ─────────────────────────────────────────────────────────────────

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r: Mat3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ]
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]
  return r
}

export function apply(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ]
}

export function invert(m: Mat3): Mat3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  const k = 1 / det
  return [
    [A * k, -(b * i - c * h) * k, (b * f - c * e) * k],
    [B * k, (a * i - c * g) * k, -(a * f - c * d) * k],
    [C * k, -(a * h - b * g) * k, (a * e - b * d) * k]
  ]
}

const BRADFORD: Mat3 = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296]
]

/** The Bradford adaptation from white `from` to white `to`, in XYZ. */
export function bradford(from: Vec3, to: Vec3): Mat3 {
  const s = apply(BRADFORD, from)
  const d = apply(BRADFORD, to)
  const scale: Mat3 = [
    [d[0] / s[0], 0, 0],
    [0, d[1] / s[1], 0],
    [0, 0, d[2] / s[2]]
  ]
  return mul(invert(BRADFORD), mul(scale, BRADFORD))
}

/** RGB → XYZ for primaries given as xy, with a D65 white. */
export function rgbToXyz(p: [Xy, Xy, Xy], white: Xy = [0.3127, 0.329]): Mat3 {
  const cols = p.map(xyToXyz) as [Vec3, Vec3, Vec3]
  const m: Mat3 = [
    [cols[0][0], cols[1][0], cols[2][0]],
    [cols[0][1], cols[1][1], cols[2][1]],
    [cols[0][2], cols[1][2], cols[2][2]]
  ]
  const s = apply(invert(m), xyToXyz(white))
  return [
    [m[0][0] * s[0], m[0][1] * s[1], m[0][2] * s[2]],
    [m[1][0] * s[0], m[1][1] * s[1], m[1][2] * s[2]],
    [m[2][0] * s[0], m[2][1] * s[1], m[2][2] * s[2]]
  ]
}

export const REC709_PRIMARIES: [Xy, Xy, Xy] = [
  [0.64, 0.33],
  [0.3, 0.6],
  [0.15, 0.06]
]
export const REC2020_PRIMARIES: [Xy, Xy, Xy] = [
  [0.708, 0.292],
  [0.17, 0.797],
  [0.131, 0.046]
]

export const REC2020_TO_XYZ = rgbToXyz(REC2020_PRIMARIES)
export const SRGB_TO_XYZ = rgbToXyz(REC709_PRIMARIES)
export const XYZ_TO_REC2020 = invert(REC2020_TO_XYZ)
export const SRGB_TO_REC2020 = mul(XYZ_TO_REC2020, SRGB_TO_XYZ)

/** The engine's white-balance matrix in linear Rec.2020, for checking. */
export function whiteBalanceMatrix(kelvin: number, tint: number): Mat3 {
  const from = whiteXyz(kelvin, tint)
  const to = whiteXyz(REFERENCE_KELVIN, 0)
  return mul(XYZ_TO_REC2020, mul(bradford(from, to), REC2020_TO_XYZ))
}

// ── What the sliders mean ────────────────────────────────────────────────────

/** An engine `WhiteBalance` op's numbers. */
export interface OpWhite {
  kelvin: number
  tint: number
  clamped: boolean
}

export const IDENTITY_OP: OpWhite = { kelvin: REFERENCE_KELVIN, tint: 0, clamped: false }

/**
 * A RAW's absolute setting (the white the scene was lit by, as the user
 * states it) → the op white. The develop already balanced for `asShot`, which
 * the engine's Bradford model approximates as an adaptation `asShot → ref`;
 * the scene white the user names therefore appears as that adaptation of it.
 */
export function opFromAbsolute(
  userKelvin: number,
  userTintDuv: number,
  asShot: { temperature_kelvin: number; tint: number }
): OpWhite {
  const shot = whiteXyz(asShot.temperature_kelvin, asShot.tint)
  const ref = whiteXyz(REFERENCE_KELVIN, 0)
  const user = whiteXyz(userKelvin, userTintDuv)
  const seen = apply(bradford(shot, ref), user)
  return temperatureTintOf(xyzToXy(seen))
}

/** The inverse: the absolute setting an op white corresponds to on a RAW. */
export function absoluteFromOp(
  op: { kelvin: number; tint: number },
  asShot: { temperature_kelvin: number; tint: number }
): { kelvin: number; tint: number; clamped: boolean } {
  const shot = whiteXyz(asShot.temperature_kelvin, asShot.tint)
  const ref = whiteXyz(REFERENCE_KELVIN, 0)
  const seen = whiteXyz(op.kelvin, op.tint)
  const user = apply(bradford(ref, shot), seen)
  return temperatureTintOf(xyzToXy(user))
}

/** Mired per relative slider unit: ±100 spans the op's range around 6504 K. */
const MIRED_PER_UNIT = (1e6 / REFERENCE_KELVIN - 1e6 / KELVIN_MAX) / 100

/** A non-RAW's relative sliders (−100…100 each) → the op white. */
export function opFromRelative(temperature: number, tint: number): OpWhite {
  const mired = 1e6 / REFERENCE_KELVIN - temperature * MIRED_PER_UNIT
  let kelvin = 1e6 / mired
  let clamped = false
  if (kelvin > KELVIN_MAX || mired <= 0) {
    kelvin = KELVIN_MAX
    clamped = true
  }
  if (kelvin < KELVIN_MIN) {
    kelvin = KELVIN_MIN
    clamped = true
  }
  return { kelvin, tint: tint / TINT_UNITS_PER_DUV, clamped }
}

/** The relative sliders an op white corresponds to. */
export function relativeFromOp(op: { kelvin: number; tint: number }): {
  temperature: number
  tint: number
} {
  const mired = 1e6 / op.kelvin
  return {
    temperature: (1e6 / REFERENCE_KELVIN - mired) / MIRED_PER_UNIT,
    tint: op.tint * TINT_UNITS_PER_DUV
  }
}

/**
 * The op white that neutralises a colour measured in linear Rec.2020 before
 * the white balance runs: a grey-world mean, or the eyedropper's sample. The
 * colour *is* the illuminant as the picture recorded it.
 */
export function opNeutralising(linearRec2020: Vec3): OpWhite | null {
  const [r, g, b] = linearRec2020
  if (!(r > 0 && g > 0 && b > 0)) return null
  return temperatureTintOf(xyzToXy(apply(REC2020_TO_XYZ, linearRec2020)))
}

/** Standard light sources for the white-balance preset menu (RAW only). */
export const WB_PRESETS: { name: string; kelvin: number; tintUnits: number }[] = [
  { name: 'Daylight', kelvin: 5500, tintUnits: 10 },
  { name: 'Cloudy', kelvin: 6500, tintUnits: 10 },
  { name: 'Shade', kelvin: 7500, tintUnits: 10 },
  { name: 'Tungsten', kelvin: 2850, tintUnits: 0 },
  { name: 'Fluorescent', kelvin: 3800, tintUnits: 21 },
  { name: 'Flash', kelvin: 5500, tintUnits: 0 }
]
