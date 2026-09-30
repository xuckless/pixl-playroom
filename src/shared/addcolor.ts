/**
 * Additive colour: light of a chosen colour added to the picture (the
 * engine's `AddColor`, `v + amount × c`). Three places use it, each with its
 * own meaning of "adding":
 *
 * - **Colour grading → Add colour**, and a **mask's Add colour**, add *light*
 *   in the linear working stage — a coloured light on the scene. The colour
 *   is stated in linear sRGB.
 * - **Effects → Colour wash** adds to the look's *code values* (Display P3
 *   encoded), late in the look — a lift toward the colour that raises the
 *   blacks as much as the whites: a wash, a light leak.
 *
 * The two pickers work out a colour from the picture as it is shown: the
 * complement that turns a picked colour white (neutral), and the colour that
 * turns one picked colour into another. A complement only neutralises when
 * it is worked out where the op adds — linear light for the first two, code
 * values for the wash — so a sample is taken in the rendered Display P3 and
 * moved into that space first. Light can only be added: where the target is
 * darker than the source in some channel, the difference is lifted by a
 * neutral grey until every channel is ≥ 0 (the hue moves as asked; the
 * brightness rises a little).
 */
import type { ColorSpaceRef, GradeOp } from './engine-types'

export type Vec3 = [number, number, number]

/** A colour to add: hue 0…360 and saturation 0…100 at full value; amount 0…100. */
export interface AddColourSetting {
  hue: number
  saturation: number
  amount: number
}

export const NO_ADD: AddColourSetting = { hue: 0, saturation: 0, amount: 0 }

/** Where the colour is added, which decides the space its numbers are in. */
export type AddKind = 'light' | 'wash'

/** The engine amount a slider at 100 stands for, per kind. */
export const ADD_MAX: Record<AddKind, number> = { light: 0.5, wash: 0.5 }

/** The space a kind's colour is stated in (see the module comment). */
export const ADD_SPACE: Record<AddKind, ColorSpaceRef> = { light: 'LinearSrgb', wash: 'DisplayP3' }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4

/** HSV at full value → RGB, each 0…1. */
export function hsvToRgb(hue: number, saturation: number): Vec3 {
  const h = (((hue % 360) + 360) % 360) / 60
  const s = clamp(saturation, 0, 1)
  const f = (n: number): number => {
    const k = (n + h) % 6
    return 1 - s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}

/** RGB (≥ 0) → hue 0…360, saturation 0…1, value (the largest channel). */
export function rgbToHsv([r, g, b]: Vec3): { hue: number; saturation: number; value: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let hue = 0
  if (d > 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6)
    else if (max === g) hue = 60 * ((b - r) / d + 2)
    else hue = 60 * ((r - g) / d + 4)
  }
  return { hue: (hue + 360) % 360, saturation: max > 0 ? d / max : 0, value: max }
}

/** The colour a setting adds, as the engine adds it: `c × amount`. */
export function addVector(s: AddColourSetting, kind: AddKind): Vec3 {
  const k = (clamp(s.amount, 0, 100) / 100) * ADD_MAX[kind]
  const c = hsvToRgb(s.hue, s.saturation / 100)
  return [c[0] * k, c[1] * k, c[2] * k]
}

/**
 * The setting that adds `v` (≥ 0 per channel). `clamped` when it asks for
 * more than the slider's end reaches.
 */
export function settingFromVector(v: Vec3, kind: AddKind): AddColourSetting & { clamped: boolean } {
  const c: Vec3 = [Math.max(0, v[0]), Math.max(0, v[1]), Math.max(0, v[2])]
  const { hue, saturation, value } = rgbToHsv(c)
  const amount = (value / ADD_MAX[kind]) * 100
  return {
    hue: Math.round(hue),
    saturation: Math.round(saturation * 1000) / 10,
    amount: Math.round(clamp(amount, 0, 100) * 10) / 10,
    clamped: amount > 100
  }
}

/** The engine op for a setting, or null when it adds nothing. */
export function addColorOp(s: AddColourSetting, kind: AddKind): GradeOp | null {
  if (!(s.amount > 0)) return null
  const [r, g, b] = hsvToRgb(s.hue, s.saturation / 100)
  return {
    AddColor: {
      color: { r: round4(r), g: round4(g), b: round4(b) },
      space: ADD_SPACE[kind],
      amount: round4((clamp(s.amount, 0, 100) / 100) * ADD_MAX[kind])
    }
  }
}

// ── Picking ──────────────────────────────────────────────────────────────────

/** sRGB's (and Display P3's) transfer curve, decoded. */
function decode(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** Linear Display P3 → linear sRGB (both D65). */
const P3_TO_SRGB = [
  [1.2249, -0.2247, 0],
  [-0.042, 1.0419, 0],
  [-0.0197, -0.0786, 1.0979]
]

/**
 * A sample of the shown picture (Display P3 code values, 0…1) in the space
 * `kind` adds in: linear sRGB for light (out-of-sRGB colours keep a negative
 * component), the code values themselves for a wash.
 */
export function sampleIn(p3: Vec3, kind: AddKind): Vec3 {
  if (kind === 'wash') return p3
  const lin = p3.map(decode) as Vec3
  return P3_TO_SRGB.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]) as Vec3
}

/** What to add so `a` becomes neutral at its brightest channel. */
export function complementToWhite(a: Vec3): Vec3 {
  const m = Math.max(a[0], a[1], a[2])
  return [m - a[0], m - a[1], m - a[2]]
}

/**
 * What to add so `a` takes `b`'s colour: `b − a`, lifted by a neutral grey
 * until no channel is negative (light cannot be taken away).
 */
export function complementTo(a: Vec3, b: Vec3): Vec3 {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const lift = Math.max(0, -Math.min(d[0], d[1], d[2]))
  return [d[0] + lift, d[1] + lift, d[2] + lift]
}

/**
 * The setting after a pick: what was already added plus what the pick asks
 * for. The shown picture already carries the old colour, so a second pick
 * refines the first rather than starting again.
 */
export function afterPick(
  old: AddColourSetting,
  add: Vec3,
  kind: AddKind
): AddColourSetting & { clamped: boolean } {
  const o = addVector(old, kind)
  return settingFromVector([o[0] + add[0], o[1] + add[1], o[2] + add[2]], kind)
}

/** A CSS colour for a setting's swatch (its hue at full value, as sRGB). */
export function swatchCss(s: Pick<AddColourSetting, 'hue' | 'saturation'>): string {
  const [r, g, b] = hsvToRgb(s.hue, s.saturation / 100).map((v) => Math.round(v * 255))
  return `rgb(${r} ${g} ${b})`
}
