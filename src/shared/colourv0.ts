/**
 * Engine 0.20's colour maths, as Playroom compiled it before 0.21: only for
 * `scripts/look-delta.mjs --maths`, which renders the same looks both ways
 * to measure what the new maths moved (`CompileContext.colourForm: 'v0'`).
 * Never a photo's: delete this file and the `v0` branches in compile.ts once
 * the catalog is retuned on 0.21.
 *
 * - The region sliders as a 17-point raised-cosine curve (not E19's).
 * - Tone and the Color Mixer unsmoothed (E63, E53's stopgaps).
 * - Temp and Tint as a second white balance in linear light (not E75's).
 * - The Log wheels as luma-keyed Qualifiers and an offset Primary on
 *   display values (not E74's), their ranges read as display-encoded luma.
 * - Hue vs Lum and Sat vs Sat not applied (E71, E72), Lum Mix at 0 (E78).
 */
import type { GradeOp, Primary } from './engine-types'
import type { CurvePointSetting, Recipe } from './recipe'
import { curvesVsOp, type CurvesVsSetting, type LogWheelsSetting, type Yrgb } from './resolve'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4

/** The region sliders as control points: up to a quarter of the range, a smooth bump a region. */
export function regionCurveV0(tc: Recipe['toneCurve']): CurvePointSetting[] | null {
  const amounts = [tc.shadows, tc.darks, tc.lights, tc.highlights]
  if (amounts.every((a) => a === 0)) return null
  const [s1, s2, s3] = tc.splits.map((s) => clamp(s, 5, 95) / 100)
  const edges = [0, s1, s2, s3, 1]
  const bump = (x: number, a: number, b: number): number => {
    // A raised cosine over [a − w, b + w], flat-topped over [a, b].
    const w = (b - a) * 0.5
    if (x <= a - w || x >= b + w) return 0
    if (x < a) return 0.5 - 0.5 * Math.cos((Math.PI * (x - (a - w))) / w)
    if (x > b) return 0.5 + 0.5 * Math.cos((Math.PI * (x - b)) / w)
    return 1
  }
  const pts: CurvePointSetting[] = []
  for (let i = 0; i <= 16; i++) {
    const x = i / 16
    let y = x
    for (let r = 0; r < 4; r++) y += (amounts[r] / 100) * 0.25 * bump(x, edges[r], edges[r + 1])
    // Pin the ends: a region slider bends the curve, it does not move black or white.
    if (i === 0) y = 0
    if (i === 16) y = 1
    pts.push({ x, y: clamp(y, 0, 1) })
  }
  return pts
}

const PRIMARY: Primary = {
  exposure: 0,
  lift: { r: 0, g: 0, b: 0 },
  gamma: { r: 1, g: 1, b: 1 },
  gain: { r: 1, g: 1, b: 1 },
  contrast: 1,
  contrast_pivot: 0.5,
  saturation: 1,
  hue_shift: 0
}

/** A wheel's push as a Primary that adds it: `v + o` is `lift o, gain 1 + o`. */
function offsetPrimary(w: Yrgb): Primary {
  const lift = { r: 0, g: 0, b: 0 }
  const gain = { r: 1, g: 1, b: 1 }
  for (const c of ['r', 'g', 'b'] as const) {
    const o = w.y + w[c]
    lift[c] = r4(o)
    gain[c] = r4(1 + o)
  }
  return { ...PRIMARY, lift, gain }
}

/** How far past its range a part's push faded out. */
const LOG_SOFT = 0.12

/** The Log wheels as three luma-keyed Qualifiers and an offset Primary, for the look stage. */
export function logWheelsV0(l: LogWheelsSetting): GradeOp[] {
  const zero = (w: Yrgb): boolean => w.y === 0 && w.r === 0 && w.g === 0 && w.b === 0
  const band = (
    part: 'shadow' | 'midtone' | 'highlight'
  ): { centre: number; width: number; softness: number } =>
    part === 'shadow'
      ? { centre: 0, width: r4(2 * l.low), softness: LOG_SOFT }
      : part === 'highlight'
        ? { centre: 1, width: r4(2 * (1 - l.high)), softness: LOG_SOFT }
        : { centre: r4((l.low + l.high) / 2), width: r4(l.high - l.low), softness: LOG_SOFT }
  const out: GradeOp[] = []
  for (const part of ['shadow', 'midtone', 'highlight'] as const) {
    if (zero(l[part])) continue
    out.push({
      Qualifier: {
        key: { hue: null, saturation: null, luma: band(part), blur_radius: 0, invert: false },
        correction: offsetPrimary(l[part]),
        smoothing: null
      }
    })
  }
  if (!zero(l.offset)) out.push({ Primary: offsetPrimary(l.offset) })
  return out
}

/** The vs curves without the two 0.20 lacked. */
export function curvesVsV0(c: CurvesVsSetting): GradeOp | null {
  return curvesVsOp({ ...c, hueLum: [], satSat: [] })
}
