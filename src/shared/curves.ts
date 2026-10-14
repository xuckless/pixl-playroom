/**
 * Tone curves outside the compiler: the interpolation the engine applies to a
 * point curve (so the editor draws, and the targeted tool reads, the curve the
 * picture gets) and the built-in curve presets.
 */
import type { CurvePointSetting, ToneCurveSetting } from './recipe'
import { tk } from './i18n'

/** Monotone cubic (Fritsch–Carlson), the interpolation the engine uses — so the drawn curve is the applied curve. */
export function monotone(points: CurvePointSetting[]): (x: number) => number {
  const p = [...points].sort((a, b) => a.x - b.x)
  const n = p.length
  if (n < 2) return (x) => x
  const d: number[] = []
  for (let i = 0; i < n - 1; i++)
    d.push((p[i + 1].y - p[i].y) / Math.max(1e-9, p[i + 1].x - p[i].x))
  const m: number[] = [d[0]]
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  return (x) => {
    if (x <= p[0].x) return p[0].y
    if (x >= p[n - 1].x) return p[n - 1].y
    let i = 0
    while (i < n - 2 && x > p[i + 1].x) i++
    const h = p[i + 1].x - p[i].x
    const t = (x - p[i].x) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * p[i].y +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * p[i + 1].y +
      (t3 - t2) * h * m[i + 1]
    )
  }
}

const IDENTITY = (): CurvePointSetting[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
]

/** The untouched tone curve: what a preset's missing fields fall back to. */
export function defaultToneCurve(): ToneCurveSetting {
  return {
    highlights: 0,
    lights: 0,
    darks: 0,
    shadows: 0,
    splits: [25, 50, 75],
    master: IDENTITY(),
    red: IDENTITY(),
    green: IDENTITY(),
    blue: IDENTITY(),
    refineSaturation: 100
  }
}

/** A curve preset replaces the whole tone curve: what it leaves out is reset. */
export interface CurvePreset {
  name: string
  curve: Partial<ToneCurveSetting>
}

/** Points given on Lightroom's 0…255 scale, as its point-curve presets are written. */
const at255 = (...p: [number, number][]): CurvePointSetting[] =>
  p.map(([x, y]) => ({
    x: Math.round((x / 255) * 1e4) / 1e4,
    y: Math.round((y / 255) * 1e4) / 1e4
  }))

/**
 * The curves every photo can start from, on the RGB point curve. Medium and
 * Strong contrast are Lightroom's own points (the curve runs per channel on
 * the same sRGB-tone values Lightroom's does), so they do what someone coming
 * from it expects; the earlier ones were about twice as strong and crushed a
 * darker photo's shadows (the owner, 2026-10-14). The rest are as gentle.
 * A curve made with an earlier preset keeps its points, and its look.
 */
export const BUILTIN_CURVES: CurvePreset[] = [
  { name: tk('Linear'), curve: {} },
  {
    name: tk('Medium contrast'),
    curve: { master: at255([0, 0], [32, 22], [64, 56], [128, 128], [192, 196], [255, 255]) }
  },
  {
    name: tk('Strong contrast'),
    curve: { master: at255([0, 0], [32, 16], [64, 50], [128, 128], [192, 202], [255, 255]) }
  },
  {
    // Half of Medium: a touch of snap that leaves the shadows open.
    name: tk('Soft film S'),
    curve: { master: at255([0, 4], [32, 28], [64, 60], [128, 128], [192, 194], [255, 251]) }
  },
  {
    // Lifted blacks and a slightly dimmed white: the faded print look.
    name: tk('Matte'),
    curve: { master: at255([0, 20], [48, 54], [128, 128], [204, 204], [255, 246]) }
  },
  {
    // Shadows opened, the rest as it was.
    name: tk('Lifted shadows'),
    curve: { master: at255([0, 0], [40, 52], [100, 108], [180, 182], [255, 255]) }
  }
]

const samePoints = (a: CurvePointSetting[], b: CurvePointSetting[]): boolean =>
  a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y)

/** Whether two tone curves draw the same: every region, split and point. */
export function sameCurve(a: ToneCurveSetting, b: ToneCurveSetting): boolean {
  return (
    a.highlights === b.highlights &&
    a.lights === b.lights &&
    a.darks === b.darks &&
    a.shadows === b.shadows &&
    a.splits.length === b.splits.length &&
    a.splits.every((v, i) => v === b.splits[i]) &&
    samePoints(a.master, b.master) &&
    samePoints(a.red, b.red) &&
    samePoints(a.green, b.green) &&
    samePoints(a.blue, b.blue)
  )
}

/** The whole tone curve a preset makes, what it leaves out reset: a copy, never the preset's own points. */
export function presetCurve(p: CurvePreset): ToneCurveSetting {
  return { ...defaultToneCurve(), ...structuredClone(p.curve) }
}

/** The first preset that makes exactly `curve`, if any: what the preset menu shows. */
export function matchingPreset<T extends CurvePreset>(
  curve: ToneCurveSetting,
  presets: readonly T[]
): T | undefined {
  return presets.find((p) => sameCurve(presetCurve(p), curve))
}
