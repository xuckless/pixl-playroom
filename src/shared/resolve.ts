/**
 * DaVinci Resolve's colour tools, as Playroom's recipe holds them and the
 * engine runs them (Settings → Interface → Colour tools: Resolve).
 *
 * Primaries: Lift, Gamma, Gain and Offset, each a wheel (the disc moves the
 * colour balance at constant luma, the ring the master, Y) with its YRGB
 * numbers, and Contrast, Pivot, Saturation, Hue, Temp and Tint. They compile
 * to the engine's `Primary` (`v = lift + v·(gain − lift)`, then `v^(1/γ)`,
 * contrast about the pivot, saturation, hue) in the display-referred look
 * stage, after Colour grading: Offset adds to every value, so it folds into
 * lift and gain (`lift + o`, `gain + o`). Temp and Tint are a relative white
 * balance in linear light until the engine has them with the primaries (E75).
 */
import type { GradeOp, Primary } from './engine-types'

/** A wheel's four numbers: Y moves all three channels, R/G/B each its own. */
export interface Yrgb {
  y: number
  r: number
  g: number
  b: number
}

export interface PrimariesSetting {
  /** −1…1 each, 0 untouched: raises (or lowers) the blacks, white held. */
  lift: Yrgb
  /** −1…1 each, 0 untouched: bends the midtones, black and white held. */
  gamma: Yrgb
  /** 0…4 each, 1 untouched: scales toward white, black held. */
  gain: Yrgb
  /** −1…1 each, 0 untouched: shifts every value alike. Shown as Resolve's 25 + 100·o. */
  offset: Yrgb
  /** 0…2, 1 untouched. */
  contrast: number
  /** 0…1, encoded: where contrast turns. Resolve's 0.435. */
  pivot: number
  /** 0…100, 50 untouched (Resolve's scale: 0 is grey, 100 twice the colour). */
  saturation: number
  /** 0…100, 50 untouched: the whole wheel turned, 0 and 100 half a turn either way. */
  hue: number
  /** −100…100 each, 0 untouched: Resolve's Temp and Tint. */
  temp: number
  tint: number
}

const zero = (): Yrgb => ({ y: 0, r: 0, g: 0, b: 0 })
const one = (): Yrgb => ({ y: 1, r: 1, g: 1, b: 1 })

/** Resolve's default pivot (its 0.435). */
export const DEFAULT_PIVOT = 0.435

export function defaultPrimaries(): PrimariesSetting {
  return {
    lift: zero(),
    gamma: zero(),
    gain: one(),
    offset: zero(),
    contrast: 1,
    pivot: DEFAULT_PIVOT,
    saturation: 50,
    hue: 50,
    temp: 0,
    tint: 0
  }
}

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function yrgbOf(v: unknown, d: Yrgb, lo: number, hi: number): Yrgb {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Yrgb, unknown>>
  return {
    y: clamp(num(o.y, d.y), lo, hi),
    r: clamp(num(o.r, d.r), lo, hi),
    g: clamp(num(o.g, d.g), lo, hi),
    b: clamp(num(o.b, d.b), lo, hi)
  }
}

/** Saved primaries made whole and in range. */
export function normalisePrimaries(v: unknown): PrimariesSetting {
  const d = defaultPrimaries()
  const o = (v && typeof v === 'object' ? v : {}) as Partial<
    Record<keyof PrimariesSetting, unknown>
  >
  return {
    lift: yrgbOf(o.lift, d.lift, -1, 1),
    gamma: yrgbOf(o.gamma, d.gamma, -1, 1),
    gain: yrgbOf(o.gain, d.gain, 0, 4),
    offset: yrgbOf(o.offset, d.offset, -1, 1),
    contrast: clamp(num(o.contrast, 1), 0, 2),
    pivot: clamp(num(o.pivot, DEFAULT_PIVOT), 0, 1),
    saturation: clamp(num(o.saturation, 50), 0, 100),
    hue: clamp(num(o.hue, 50), 0, 100),
    temp: clamp(num(o.temp, 0), -100, 100),
    tint: clamp(num(o.tint, 0), -100, 100)
  }
}

// ── The wheel's disc: a colour balance at constant luma ────────────────────

/** Display P3's luma weights (the look stage's values are P3). */
const KR = 0.2289746
const KG = 0.6917385
const KB = 0.0792869

/**
 * The R, G, B a point on the disc moves, with no change to luma: `x` along
 * Cb (blue to the right), `y` along Cr (red up), as the vectorscope draws
 * them, so a wheel pushed toward a colour moves the picture toward it there.
 */
export function discToRgb(x: number, y: number): { r: number; g: number; b: number } {
  const r = y * 2 * (1 - KR)
  const b = x * 2 * (1 - KB)
  const g = -(KR * r + KB * b) / KG
  return { r, g, b }
}

/** Where R, G, B sit on the disc (their luma left out): `discToRgb`'s inverse. */
export function rgbToDisc(r: number, g: number, b: number): { x: number; y: number } {
  const l = KR * r + KG * g + KB * b
  return { x: (b - l) / (2 * (1 - KB)), y: (r - l) / (2 * (1 - KR)) }
}

// ── Compiled ───────────────────────────────────────────────────────────────

const CH = ['r', 'g', 'b'] as const
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4

/** How far a gamma number bends: ±1 is about a stop and a half of midtone either way. */
const GAMMA_STOPS = 1.5

const IDENTITY: Primary = {
  exposure: 0,
  lift: { r: 0, g: 0, b: 0 },
  gamma: { r: 1, g: 1, b: 1 },
  gain: { r: 1, g: 1, b: 1 },
  contrast: 1,
  contrast_pivot: 0.5,
  saturation: 1,
  hue_shift: 0
}

/**
 * The primaries as one engine `Primary` for the look stage, or null when
 * they change nothing (Temp and Tint are `primariesWhite`'s).
 */
export function primariesOp(p: PrimariesSetting): GradeOp | null {
  const lift = { r: 0, g: 0, b: 0 }
  const gamma = { r: 1, g: 1, b: 1 }
  const gain = { r: 1, g: 1, b: 1 }
  for (const c of CH) {
    const o = p.offset.y + p.offset[c]
    const l = p.lift.y + p.lift[c]
    const g = p.gain.y * p.gain[c]
    // Offset after lift and gain: (l + v(g − l)) + o = (l + o) + v((g + o) − (l + o)).
    lift[c] = r4(l + o)
    gain[c] = r4(g + o)
    gamma[c] = r4(Math.pow(2, (p.gamma.y + p.gamma[c]) * GAMMA_STOPS * 0.5))
  }
  const op: Primary = {
    ...IDENTITY,
    lift,
    gamma,
    gain,
    contrast: r4(p.contrast),
    contrast_pivot: r4(p.pivot),
    saturation: r4(p.saturation / 50),
    hue_shift: r4((p.hue - 50) * 3.6)
  }
  const same =
    CH.every((c) => lift[c] === 0 && gamma[c] === 1 && gain[c] === 1) &&
    op.contrast === 1 &&
    op.saturation === 1 &&
    op.hue_shift === 0
  return same ? null : { Primary: op }
}

/** Temp and Tint as the relative white-balance sliders (−100…100), or null when untouched. */
export function primariesWhite(p: PrimariesSetting): { temperature: number; tint: number } | null {
  return p.temp === 0 && p.tint === 0 ? null : { temperature: p.temp, tint: p.tint }
}

/**
 * A mask's Amount on its primaries: every change scaled by `k` (0…2) from
 * untouched, gain in stops so it never goes negative; the pivot, which says
 * where rather than how much, stays.
 */
export function scalePrimaries(p: PrimariesSetting, k: number): PrimariesSetting {
  const lin = (w: Yrgb): Yrgb => ({ y: w.y * k, r: w.r * k, g: w.g * k, b: w.b * k })
  const pow = (v: number): number => (v > 0 ? Math.pow(v, k) : 0)
  return {
    lift: lin(p.lift),
    gamma: lin(p.gamma),
    gain: { y: pow(p.gain.y), r: pow(p.gain.r), g: pow(p.gain.g), b: pow(p.gain.b) },
    offset: lin(p.offset),
    contrast: 1 + (p.contrast - 1) * k,
    pivot: p.pivot,
    saturation: 50 + (p.saturation - 50) * k,
    hue: 50 + (p.hue - 50) * k,
    temp: p.temp * k,
    tint: p.tint * k
  }
}

// ── Curves: the vs curves (the Custom curve is the tone curve's own) ─────────

/** Resolve's vs curves: what the curve's x reads, and what its y changes. */
export const VS_CURVES = ['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat'] as const
export type VsCurve = (typeof VS_CURVES)[number]

/** Each a list of points, `y` 0.5 untouched; an empty list is a flat curve. */
export type CurvesVsSetting = Record<VsCurve, { x: number; y: number }[]>

/** The vs curves the engine has no op for yet: kept, shown as waiting, not compiled (E71, E72). */
export const VS_WAITING: Partial<Record<VsCurve, string>> = { hueLum: 'E71', satSat: 'E72' }

/** Whether a vs curve's x is a hue (it wraps at red). */
export const vsPeriodic = (c: VsCurve): boolean => c.startsWith('hue')

/** At most this many points a curve. */
export const MAX_VS_POINTS = 16

export function defaultCurvesVs(): CurvesVsSetting {
  return { hueHue: [], hueSat: [], hueLum: [], lumSat: [], satSat: [] }
}

/** Saved vs curves made whole: points in range, sorted, one per x. */
export function normaliseCurvesVs(v: unknown): CurvesVsSetting {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<VsCurve, unknown>>
  const out = defaultCurvesVs()
  for (const c of VS_CURVES) {
    const pts = Array.isArray(o[c]) ? (o[c] as unknown[]) : []
    const clean = pts
      .filter((p): p is { x: number; y: number } => {
        const q = p as { x?: unknown; y?: unknown }
        return !!q && Number.isFinite(q.x) && Number.isFinite(q.y)
      })
      .map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) }))
      .sort((a, b) => a.x - b.x)
      .filter((p, i, all) => i === 0 || p.x - all[i - 1].x > 1e-4)
      .slice(0, MAX_VS_POINTS)
    out[c] = clean
  }
  return out
}

/** Whether a vs curve changes nothing (no points, or all at 0.5). */
export const vsFlat = (pts: { x: number; y: number }[]): boolean =>
  pts.every((p) => Math.abs(p.y - 0.5) < 1e-4)

/**
 * A vs curve's points as the engine takes them, over the whole 0…1: a hue
 * curve wrapped across red (its ends meet at the value between the last
 * point and the first, so there is no seam); the others held level past
 * their ends.
 */
export function vsPoints(
  pts: { x: number; y: number }[],
  periodic: boolean
): { x: number; y: number }[] {
  if (pts.length === 0)
    return [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 }
    ]
  // A point at either end is kept just inside it (red sits at both ends of a hue curve).
  const inner = pts
    .map((p) => ({ x: clamp(p.x, 1e-3, 1 - 1e-3), y: p.y }))
    .filter((p, i, all) => i === 0 || p.x - all[i - 1].x > 1e-4)
  if (!periodic) {
    const first = pts[0]
    const last = pts[pts.length - 1]
    return [{ x: 0, y: first.y }, ...inner, { x: 1, y: last.y }]
  }
  if (inner.length === 0) {
    const y = pts[0].y
    return [
      { x: 0, y },
      { x: 1, y }
    ]
  }
  const a = inner[inner.length - 1]
  const b = inner[0]
  // Across the seam: from the last point to the first, one hue turn on.
  const span = b.x + 1 - a.x
  const y = a.y + ((b.y - a.y) * (1 - a.x)) / span
  return [{ x: 0, y }, ...inner, { x: 1, y }]
}

/**
 * The vs curves as one engine `Curves` op (Hue vs Hue in degrees, ±180;
 * the saturation curves as multipliers, 0 to 2), and the ones that wait.
 */
export function curvesVsOp(c: CurvesVsSetting): { op: GradeOp | null; waiting: VsCurve[] } {
  const waiting = VS_CURVES.filter((k) => VS_WAITING[k] && !vsFlat(c[k]))
  const curve = (
    k: VsCurve,
    y: (v: number) => number
  ): { points: { x: number; y: number }[] } | null =>
    vsFlat(c[k])
      ? null
      : { points: vsPoints(c[k], vsPeriodic(k)).map((p) => ({ x: r4(p.x), y: r4(y(p.y)) })) }
  const hueHue = curve('hueHue', (v) => (v - 0.5) * 360)
  const hueSat = curve('hueSat', (v) => v * 2)
  const lumSat = curve('lumSat', (v) => v * 2)
  if (!hueHue && !hueSat && !lumSat) return { op: null, waiting }
  return {
    op: {
      Curves: {
        master: null,
        red: null,
        green: null,
        blue: null,
        luma_vs_saturation: lumSat,
        hue_vs_saturation: hueSat,
        hue_vs_hue: hueHue,
        refine_saturation: null
      }
    },
    waiting
  }
}

/** A mask's Amount on its vs curves: each point moved toward flat by `k`. */
export function scaleCurvesVs(c: CurvesVsSetting, k: number): CurvesVsSetting {
  const out = defaultCurvesVs()
  for (const v of VS_CURVES)
    out[v] = c[v].map((p) => ({ x: p.x, y: clamp(0.5 + (p.y - 0.5) * k, 0, 1) }))
  return out
}
