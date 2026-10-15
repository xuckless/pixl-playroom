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
 * lift and gain (`lift + o`, `gain + o`). Temp and Tint are a gain on the
 * graded colour beside them (the engine's `GainBalance`, E75), as Resolve's.
 */
import type { GradeOp, HslKey, Primary } from './engine-types'
import { tk } from './i18n'
import { apply, invert, opFromRelative, rgbToXyz, whiteXyz, type Xy } from './wb'

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
  /**
   * 0…100, how much the wheels' Y rings move luminance alone (Resolve's Lum
   * Mix): 0 moves each channel alike (YRGB, which desaturates a lifted
   * black), 100 keeps hue and saturation. 0 by default, as every photo and
   * look was made (Resolve's own default is 100).
   */
  lumMix: number
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
    tint: 0,
    lumMix: 0
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
    tint: clamp(num(o.tint, 0), -100, 100),
    lumMix: clamp(num(o.lumMix, 0), 0, 100)
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

const isIdentity = (p: Primary): boolean =>
  CH.every((c) => p.lift[c] === 0 && p.gamma[c] === 1 && p.gain[c] === 1) &&
  p.contrast === 1 &&
  p.saturation === 1 &&
  p.hue_shift === 0

/** A gamma number (−1…1, 0 untouched) as `Primary`'s exponent. */
const gammaOf = (v: number): number => r4(Math.pow(2, v * GAMMA_STOPS * 0.5))

/**
 * The primaries as engine ops for the look stage, none when they change
 * nothing (Temp and Tint are `primariesBalance`'s). With Lum Mix at 0 (as
 * every photo and look was made) one `Primary`, the Y rings folded into
 * each channel. Above 0 and with a Y ring moved, the Y rings are their own
 * `LumaPrimary` (engine 0.21, E78) between the wheels' `Primary` and one
 * holding Contrast, Saturation and Hue, so the order is the folded one's
 * and Lum Mix just above 0 renders as at 0. Offset is not part of Lum Mix:
 * it stays with the wheels.
 */
export function primariesOp(p: PrimariesSetting): GradeOp[] {
  const split = p.lumMix > 0 && (p.lift.y !== 0 || p.gamma.y !== 0 || p.gain.y !== 1)
  const lift = { r: 0, g: 0, b: 0 }
  const gamma = { r: 1, g: 1, b: 1 }
  const gain = { r: 1, g: 1, b: 1 }
  for (const c of CH) {
    const o = p.offset.y + p.offset[c]
    const l = (split ? 0 : p.lift.y) + p.lift[c]
    const g = (split ? 1 : p.gain.y) * p.gain[c]
    // Offset after lift and gain: (l + v(g − l)) + o = (l + o) + v((g + o) − (l + o)).
    lift[c] = r4(l + o)
    gain[c] = r4(g + o)
    gamma[c] = gammaOf((split ? 0 : p.gamma.y) + p.gamma[c])
  }
  const look = {
    contrast: r4(p.contrast),
    contrast_pivot: r4(p.pivot),
    saturation: r4(p.saturation / 50),
    hue_shift: r4((p.hue - 50) * 3.6)
  }
  if (!split) {
    const op: Primary = { ...IDENTITY, lift, gamma, gain, ...look }
    return isIdentity(op) ? [] : [{ Primary: op }]
  }
  const wheels: Primary = { ...IDENTITY, lift, gamma, gain }
  const after: Primary = { ...IDENTITY, ...look }
  return [
    ...(isIdentity(wheels) ? [] : [{ Primary: wheels }]),
    {
      LumaPrimary: {
        lift: r4(p.lift.y),
        gamma: gammaOf(p.gamma.y),
        gain: r4(p.gain.y),
        mix: r4(p.lumMix / 100)
      }
    },
    ...(isIdentity(after) ? [] : [{ Primary: after }])
  ]
}

/** Display P3's primaries: the look stage's, where Temp and Tint run. */
const P3_PRIMARIES: [Xy, Xy, Xy] = [
  [0.68, 0.32],
  [0.265, 0.69],
  [0.15, 0.06]
]
const XYZ_TO_P3 = invert(rgbToXyz(P3_PRIMARIES))

/**
 * Whether a white lies inside Display P3, with a little room: the engine
 * refuses one with a channel at or below 0 (no gain balances it), and a
 * strong Tint at a mask's Amount of 200 reaches past it.
 */
function inP3(kelvin: number, tint: number): boolean {
  return apply(XYZ_TO_P3, whiteXyz(kelvin, tint)).every((c) => c > 0.005)
}

/**
 * Temp and Tint (−100…100 each, Resolve's) as the engine's gain balance on
 * the look stage's graded values, a grey kept as bright as it was (as
 * Resolve's, so warming never fights the Gain ring), or null when untouched.
 * The white is the white balance's own (`opFromRelative`), pulled toward
 * neutral as little as keeps it inside Display P3: Tint first, then Temp.
 */
export function primariesBalance(p: PrimariesSetting): GradeOp | null {
  if (p.temp === 0 && p.tint === 0) return null
  const w = opFromRelative(p.temp, p.tint)
  let mired = 1e6 / w.kelvin
  let tint = w.tint
  const neutral = 1e6 / 6504
  /** The largest share of `v`'s way from neutral that stays inside. */
  const fit = (inside: (f: number) => boolean): number => {
    if (inside(1)) return 1
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const f = (lo + hi) / 2
      if (inside(f)) lo = f
      else hi = f
    }
    return lo
  }
  if (!inP3(1e6 / mired, 0)) {
    const m0 = mired
    mired = neutral + (m0 - neutral) * fit((f) => inP3(1e6 / (neutral + (m0 - neutral) * f), 0))
  }
  const t0 = tint
  tint = t0 * fit((f) => inP3(1e6 / mired, t0 * f))
  // Toward neutral in the last place too, so rounding never steps outside.
  const toward = (v: number): number => Math.trunc(v * 1e4) / 1e4
  return {
    GainBalance: {
      temperature_kelvin: r4(1e6 / mired),
      tint: toward(tint),
      hold_luminance: true
    }
  }
}

/**
 * A mask's Amount on its primaries: every change scaled by `k` (0…2) from
 * untouched, gain in stops so it never goes negative; the pivot and Lum
 * Mix, which say where and how rather than how much, stay.
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
    tint: p.tint * k,
    lumMix: p.lumMix
  }
}

// ── Curves: the vs curves (the Custom curve is the tone curve's own) ─────────

/** Resolve's vs curves: what the curve's x reads, and what its y changes. */
export const VS_CURVES = ['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat'] as const
export type VsCurve = (typeof VS_CURVES)[number]

/** Each a list of points, `y` 0.5 untouched; an empty list is a flat curve. */
export type CurvesVsSetting = Record<VsCurve, { x: number; y: number }[]>

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

/** How far Hue vs Lum reaches at the top and bottom of its graph: a stop either way. */
export const HUE_LUM_STOPS = 1

/**
 * The vs curves as one engine `Curves` op, or null when every one is flat:
 * Hue vs Hue in degrees (±180); Hue vs Sat, Lum vs Sat and Sat vs Sat as
 * multipliers (0 to 2, as Resolve's); Hue vs Lum in stops (±1, a gain of ½
 * to 2 on a full colour, greys untouched). The engine keys the four hue and
 * saturation curves on the colour as it comes, so Hue vs Lum follows the hue
 * a colour had before Hue vs Hue turned it.
 */
export function curvesVsOp(c: CurvesVsSetting): GradeOp | null {
  const curve = (
    k: VsCurve,
    y: (v: number) => number
  ): { points: { x: number; y: number }[] } | null =>
    vsFlat(c[k])
      ? null
      : { points: vsPoints(c[k], vsPeriodic(k)).map((p) => ({ x: r4(p.x), y: r4(y(p.y)) })) }
  const hueHue = curve('hueHue', (v) => (v - 0.5) * 360)
  const hueSat = curve('hueSat', (v) => v * 2)
  const hueLum = curve('hueLum', (v) => (v - 0.5) * 2 * HUE_LUM_STOPS)
  const lumSat = curve('lumSat', (v) => v * 2)
  const satSat = curve('satSat', (v) => v * 2)
  if (!hueHue && !hueSat && !hueLum && !lumSat && !satSat) return null
  return {
    Curves: {
      master: null,
      red: null,
      green: null,
      blue: null,
      luma_vs_saturation: lumSat,
      hue_vs_saturation: hueSat,
      hue_vs_hue: hueHue,
      hue_vs_luma: hueLum,
      saturation_vs_saturation: satSat,
      refine_saturation: null
    }
  }
}

// ── Curves presets: starting points for each vs curve ───────────────────────

/** A vs curve under a name: a built-in, or one the user saved. */
export interface VsPreset {
  name: string
  points: { x: number; y: number }[]
}

/** Where each colour sits on a hue curve's x (red at both ends). */
const HUE_AT = { red: 0, orange: 1 / 12, yellow: 1 / 6, green: 1 / 3, aqua: 1 / 2, blue: 2 / 3 }
/** A Hue vs Hue point: a turn of `deg` degrees. */
const turn = (x: number, deg: number): { x: number; y: number } => ({
  x: r4(x),
  y: r4(0.5 + deg / 360)
})
/** A Hue vs Lum point: `d` brighter (or darker) on the curve's own scale (0.5 a stop), 0.5 untouched. */
const lift = (x: number, d: number): { x: number; y: number } => ({ x: r4(x), y: r4(0.5 + d) })
/** A saturation curve's point: `k` times as strong. */
const times = (x: number, k: number): { x: number; y: number } => ({ x: r4(x), y: r4(k / 2) })

/**
 * The built-in starting points of each vs curve, gentle as a colourist's
 * first moves, each a few points to drag from: Flat first (the curve put
 * back).
 */
export const VS_PRESETS: Record<VsCurve, VsPreset[]> = {
  hueHue: [
    { name: tk('Flat'), points: [] },
    {
      // Reds and yellows toward one orange: skin of one tone.
      name: tk('Even skin tones'),
      points: [turn(0, 8), turn(HUE_AT.orange, 0), turn(HUE_AT.yellow, -10), turn(0.25, 0)]
    },
    {
      name: tk('Autumn foliage'),
      points: [turn(0.25, 0), turn(HUE_AT.green, -20), turn(0.42, 0)]
    },
    {
      name: tk('Teal skies'),
      points: [turn(HUE_AT.aqua, 0), turn(0.6, -12), turn(0.72, 0)]
    }
  ],
  hueSat: [
    { name: tk('Flat'), points: [] },
    {
      name: tk('Richer blues'),
      points: [times(0.55, 1), times(HUE_AT.blue, 1.3), times(0.78, 1)]
    },
    {
      name: tk('Muted greens'),
      points: [times(0.25, 1), times(HUE_AT.green, 0.7), times(0.42, 1)]
    },
    {
      name: tk('Calmer skin'),
      points: [times(0, 1), times(HUE_AT.orange, 0.85), times(HUE_AT.yellow, 1)]
    },
    {
      name: tk('Teal & orange'),
      points: [
        times(0, 1),
        times(HUE_AT.orange, 1.2),
        times(0.2, 1),
        times(HUE_AT.green, 0.85),
        times(HUE_AT.aqua, 1.2),
        times(HUE_AT.blue, 1)
      ]
    }
  ],
  hueLum: [
    { name: tk('Flat'), points: [] },
    {
      name: tk('Deeper blue skies'),
      points: [lift(0.55, 0), lift(HUE_AT.blue, -0.08), lift(0.78, 0)]
    },
    {
      name: tk('Brighter skin'),
      points: [lift(0, 0), lift(HUE_AT.orange, 0.05), lift(HUE_AT.yellow, 0)]
    }
  ],
  lumSat: [
    { name: tk('Flat'), points: [] },
    { name: tk('Clean shadows'), points: [times(0, 0.7), times(0.25, 1)] },
    { name: tk('Clean highlights'), points: [times(0.75, 1), times(1, 0.7)] },
    {
      name: tk('Film: both ends'),
      points: [times(0, 0.8), times(0.25, 1), times(0.75, 1), times(1, 0.8)]
    }
  ],
  satSat: [
    { name: tk('Flat'), points: [] },
    { name: tk('Tame strong colour'), points: [times(0, 1), times(0.6, 1), times(1, 0.76)] },
    { name: tk('Lift muted colour'), points: [times(0, 1), times(0.25, 1.2), times(0.5, 1)] }
  ]
}

/** Whether two vs curves draw the same: their points, as normalised. */
export function sameVs(a: { x: number; y: number }[], b: { x: number; y: number }[]): boolean {
  if (vsFlat(a) && vsFlat(b)) return true
  return (
    a.length === b.length &&
    a.every((p, i) => Math.abs(p.x - b[i].x) < 1e-4 && Math.abs(p.y - b[i].y) < 1e-4)
  )
}

/** A mask's Amount on its vs curves: each point moved toward flat by `k`. */
export function scaleCurvesVs(c: CurvesVsSetting, k: number): CurvesVsSetting {
  const out = defaultCurvesVs()
  for (const v of VS_CURVES)
    out[v] = c[v].map((p) => ({ x: p.x, y: clamp(0.5 + (p.y - 0.5) * k, 0, 1) }))
  return out
}

// ── Log wheels ─────────────────────────────────────────────────────────────

/**
 * Resolve's Log wheels: Shadow, Midtone and Highlight each move only their
 * part of the tonal range (below Low, between, above High), Offset all of
 * it; each adds to the values, and in log an added value is an even number
 * of stops, so a small push stays small from the shadows to the highlights.
 * They compile to the engine's `LogWheels` (engine 0.21, E74) in a stage of
 * their own in PixlLog (E73): PixlRGB's primaries and the models' log curve,
 * 18% grey at 0.405 and white at 0.669. The parts hand over by smoothsteps
 * that always add up to one, so equal wheels are exactly an offset.
 */
export interface LogWheelsSetting {
  shadow: Yrgb
  midtone: Yrgb
  highlight: Yrgb
  offset: Yrgb
  /** PixlLog code value where the shadows end (Resolve's Low Range). */
  low: number
  /** PixlLog code value where the highlights begin (Resolve's High Range). */
  high: number
}

/** Linear light as a PixlLog code value: the models' log, gain 64, peak 8 (8× white is 1). */
export const toPixlLog = (x: number): number =>
  (Math.sign(x) * Math.log1p(64 * Math.abs(x))) / Math.log1p(64 * 8)

/** An ACEScct code value as linear light (above its toe, where Resolve's ranges sit). */
const fromAcesCct = (v: number): number => 2 ** (v * 17.52 - 9.72)

const r3 = (v: number): number => Math.round(v * 1e3) / 1e3

/**
 * Resolve's default ranges, 0.333 and 0.550 in ACEScct, at the same stops
 * from grey in PixlLog: Low about a stop and a half under grey (0.268),
 * High about two and a half over it, just under white (0.660).
 */
export const LOG_LOW = r3(toPixlLog(fromAcesCct(0.333)))
export const LOG_HIGH = r3(toPixlLog(fromAcesCct(0.55)))
/** How soft each handover is, either side of Low and High (fixed: Resolve shows none). */
export const LOG_TRANSITION = 0.05
/**
 * The least Low and High are apart: both handovers whole, and a hair more,
 * as the engine refuses a High whose handover starts before Low's ends.
 */
export const LOG_MIN_GAP = 0.11
/** How far the ranges reach: about a 500th of white up to 7× it. */
export const LOG_FLOOR = 0.02
export const LOG_TOP = 0.98

export function defaultLogWheels(): LogWheelsSetting {
  return {
    shadow: zero(),
    midtone: zero(),
    highlight: zero(),
    offset: zero(),
    low: LOG_LOW,
    high: LOG_HIGH
  }
}

/** Low and High in range, High at least `LOG_MIN_GAP` above Low. */
export function logRange(low: number, high: number): { low: number; high: number } {
  const l = clamp(low, LOG_FLOOR, LOG_TOP - LOG_MIN_GAP)
  return { low: l, high: clamp(high, l + LOG_MIN_GAP, LOG_TOP) }
}

export function normaliseLogWheels(v: unknown): LogWheelsSetting {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<
    Record<keyof LogWheelsSetting, unknown>
  >
  return {
    shadow: yrgbOf(o.shadow, zero(), -1, 1),
    midtone: yrgbOf(o.midtone, zero(), -1, 1),
    highlight: yrgbOf(o.highlight, zero(), -1, 1),
    offset: yrgbOf(o.offset, zero(), -1, 1),
    ...logRange(num(o.low, LOG_LOW), num(o.high, LOG_HIGH))
  }
}

/**
 * A recipe's Low and High from before engine 0.21 (the qualifier form's, on
 * display-encoded luma) as PixlLog code values at the same tones; left at
 * Resolve's defaults there (0.333, 0.550), the defaults here. Null when the
 * recipe held none.
 */
export function logRangeBefore021(saved: unknown): { low: number; high: number } | null {
  const o = (saved && typeof saved === 'object' ? saved : {}) as { low?: unknown; high?: unknown }
  if (typeof o.low !== 'number' || typeof o.high !== 'number') return null
  if (Math.abs(o.low - 0.333) < 1e-6 && Math.abs(o.high - 0.55) < 1e-6)
    return { low: LOG_LOW, high: LOG_HIGH }
  const decode = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return logRange(r3(toPixlLog(decode(o.low))), r3(toPixlLog(decode(o.high))))
}

const isZero = (w: Yrgb): boolean => w.y === 0 && w.r === 0 && w.g === 0 && w.b === 0

/** A wheel's push per channel: Y moves all three. */
const rgbOf = (w: Yrgb): { r: number; g: number; b: number } => ({
  r: r4(w.y + w.r),
  g: r4(w.y + w.g),
  b: r4(w.y + w.b)
})

/**
 * The log wheels as the engine's `LogWheels`, for the log stage (none when
 * untouched, so no log stage is made: one that changes nothing is not
 * bit-identical).
 */
export function logWheelsOps(l: LogWheelsSetting): GradeOp[] {
  if ([l.shadow, l.midtone, l.highlight, l.offset].every(isZero)) return []
  // A mask's settings are filled, not normalised: held here too.
  const { low, high } = logRange(l.low, l.high)
  return [
    {
      LogWheels: {
        shadow: rgbOf(l.shadow),
        midtone: rgbOf(l.midtone),
        highlight: rgbOf(l.highlight),
        offset: rgbOf(l.offset),
        low_range: r4(low),
        high_range: r4(high),
        transition: LOG_TRANSITION,
        smoothing: null
      }
    }
  ]
}

export function scaleLogWheels(l: LogWheelsSetting, k: number): LogWheelsSetting {
  const lin = (w: Yrgb): Yrgb => ({ y: w.y * k, r: w.r * k, g: w.g * k, b: w.b * k })
  return {
    ...l,
    shadow: lin(l.shadow),
    midtone: lin(l.midtone),
    highlight: lin(l.highlight),
    offset: lin(l.offset)
  }
}

// ── Qualifiers ─────────────────────────────────────────────────────────────

/** One band of a qualifier's key: on or off, where, how wide, how soft its edge. */
export interface KeyBandSetting {
  on: boolean
  centre: number
  width: number
  soft: number
}

/**
 * Resolve's qualifier as a tool: a key on hue, saturation and luminance
 * (an HSL key, as the eyedropper samples it), blurred and perhaps inverted,
 * and the correction it lets through: a Gain wheel, Sat and Hue. Each is the
 * engine's own Qualifier op where it sits in the grade (0.21.0, E77): the
 * photo's after its primaries and curves and before its effects, a mask's
 * in the mask's own layer, so it keys only inside the mask. The key view is
 * the engine's key there (`Inspect::QualifierKey`).
 */
export interface QualifierSetting {
  id: string
  enabled: boolean
  /** Hue in degrees: centre 0…360, width and soft 0…180. */
  keyHue: KeyBandSetting
  /** Saturation and luminance 0…1. */
  keySat: KeyBandSetting
  keyLum: KeyBandSetting
  /** 0…100: the key's edge softened, up to 1% of the shorter side (as a range mask's smoothness). */
  blur: number
  invert: boolean
  gain: Yrgb
  /** 0…100, 50 untouched. */
  sat: number
  /** 0…100, 50 untouched. */
  hue: number
  /**
   * The colour the eyedropper keyed on (hue in degrees, saturation and luma
   * 0…1): the bands rest there, so a reset puts a band back where the pick
   * put it. Absent from qualifiers keyed before it was kept.
   */
  picked?: QualifierSample
}

export interface QualifierSample {
  hue: number
  saturation: number
  luminance: number
}

export const MAX_QUALIFIERS = 8

/** A new band's colour when there is no pick to go back to. */
const NO_PICK: QualifierSample = { hue: 0, saturation: 0.5, luminance: 0.5 }

const band = (on: boolean, centre: number, width: number, soft: number): KeyBandSetting => ({
  on,
  centre,
  width,
  soft
})

/** A qualifier keyed around a sampled colour (hue in degrees, saturation and luma 0…1). */
export function qualifierFromSample(id: string, s: QualifierSample): QualifierSetting {
  return {
    id,
    enabled: true,
    // A grey has no hue to key on.
    keyHue: band(s.saturation >= 0.08, ((s.hue % 360) + 360) % 360, 30, 20),
    keySat: band(true, clamp(s.saturation, 0, 1), 0.5, 0.2),
    keyLum: band(true, clamp(s.luminance, 0, 1), 0.6, 0.2),
    blur: 20,
    invert: false,
    gain: one(),
    sat: 50,
    hue: 50,
    picked: { hue: r4(s.hue), saturation: r4(s.saturation), luminance: r4(s.luminance) }
  }
}

/** Where a qualifier's bands rest (their reset): as its pick keyed them, else a new band's. */
export function qualifierRest(
  q: QualifierSetting
): Pick<QualifierSetting, 'keyHue' | 'keySat' | 'keyLum'> {
  const { keyHue, keySat, keyLum } = qualifierFromSample(q.id, q.picked ?? NO_PICK)
  return { keyHue, keySat, keyLum }
}

function sampleOf(v: unknown): QualifierSample | undefined {
  const o = (v && typeof v === 'object' ? v : null) as Partial<
    Record<keyof QualifierSample, unknown>
  > | null
  if (!o || ![o.hue, o.saturation, o.luminance].every((n) => typeof n === 'number' && isFinite(n)))
    return undefined
  return {
    hue: clamp(o.hue as number, 0, 360),
    saturation: clamp(o.saturation as number, 0, 1),
    luminance: clamp(o.luminance as number, 0, 1)
  }
}

function bandOf(v: unknown, d: KeyBandSetting, top: number, half: number): KeyBandSetting {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof KeyBandSetting, unknown>>
  return {
    on: typeof o.on === 'boolean' ? o.on : d.on,
    centre: clamp(num(o.centre, d.centre), 0, top),
    width: clamp(num(o.width, d.width), 0, 2 * half),
    soft: clamp(num(o.soft, d.soft), 0, half)
  }
}

export function normaliseQualifiers(v: unknown): QualifierSetting[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<string>()
  const out: QualifierSetting[] = []
  for (const x of v) {
    if (!x || typeof x !== 'object') continue
    const o = x as Partial<Record<keyof QualifierSetting, unknown>>
    const id = typeof o.id === 'string' && o.id && !seen.has(o.id) ? o.id : null
    if (!id) continue
    seen.add(id)
    const d = qualifierFromSample(id, NO_PICK)
    const picked = sampleOf(o.picked)
    out.push({
      id,
      enabled: o.enabled !== false,
      keyHue: bandOf(o.keyHue, d.keyHue, 360, 180),
      keySat: bandOf(o.keySat, d.keySat, 1, 0.5),
      keyLum: bandOf(o.keyLum, d.keyLum, 1, 0.5),
      blur: clamp(num(o.blur, d.blur), 0, 100),
      invert: o.invert === true,
      gain: yrgbOf(o.gain, one(), 0, 4),
      sat: clamp(num(o.sat, 50), 0, 100),
      hue: clamp(num(o.hue, 50), 0, 100),
      ...(picked ? { picked } : {})
    })
    if (out.length >= MAX_QUALIFIERS) break
  }
  return out
}

/** A qualifier's key as the engine's HSL key, or null when no band is on (it keys nothing). */
export function qualifierKey(q: QualifierSetting): HslKey | null {
  const b = (k: KeyBandSetting): { centre: number; width: number; softness: number } | null =>
    k.on ? { centre: r4(k.centre), width: r4(k.width), softness: r4(k.soft) } : null
  const hue = b(q.keyHue)
  const saturation = b(q.keySat)
  const luma = b(q.keyLum)
  if (!hue && !saturation && !luma) return null
  return { hue, saturation, luma, blur_radius: 0, invert: false }
}

/** What a qualifier lets through: its Gain wheel, Sat and Hue as a Primary (null when untouched). */
export function qualifierCorrection(q: QualifierSetting): Primary | null {
  const gain = { r: 1, g: 1, b: 1 }
  for (const c of CH) gain[c] = r4(q.gain.y * q.gain[c])
  const p: Primary = {
    ...IDENTITY,
    gain,
    saturation: r4(q.sat / 50),
    hue_shift: r4((q.hue - 50) * 3.6)
  }
  const same = CH.every((c) => gain[c] === 1) && p.saturation === 1 && p.hue_shift === 0
  return same ? null : p
}

/** A qualifier's key view, by name: what `Compiled.qualifierIndex` finds its op by. */
export const qualifierLayerId = (id: string): string => `q:${id}`

/** A mask's Amount on a qualifier's correction: the key stays, the change scales by `k`. */
export function scaleQualifier(q: QualifierSetting, k: number): QualifierSetting {
  if (k === 1) return q
  const pow = (v: number): number => (v > 0 ? Math.pow(v, k) : 0)
  return {
    ...q,
    gain: { y: pow(q.gain.y), r: pow(q.gain.r), g: pow(q.gain.g), b: pow(q.gain.b) },
    sat: 50 + (q.sat - 50) * k,
    hue: 50 + (q.hue - 50) * k
  }
}

/**
 * The disc push toward a hue (degrees, as a colour wheel names them: 0 red,
 * 120 green, 240 blue), `amount` along the disc: the R, G, B it moves.
 */
export function discToward(hue: number, amount: number): { r: number; g: number; b: number } {
  const f = (n: number): number => {
    const k = (n + hue / 60) % 6
    return 1 - Math.max(0, Math.min(k, 4 - k, 1))
  }
  const d = rgbToDisc(f(5), f(3), f(1))
  const n = Math.hypot(d.x, d.y) || 1
  return discToRgb((d.x / n) * amount, (d.y / n) * amount)
}
