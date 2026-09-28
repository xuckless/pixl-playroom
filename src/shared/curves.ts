/**
 * Tone curves outside the compiler: the interpolation the engine applies to a
 * point curve (so the editor draws, and the targeted tool reads, the curve the
 * picture gets) and the built-in curve presets.
 */
import type { CurvePointSetting, ToneCurveSetting } from './recipe'

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
    blue: IDENTITY()
  }
}

/** A curve preset replaces the whole tone curve: what it leaves out is reset. */
export interface CurvePreset {
  name: string
  curve: Partial<ToneCurveSetting>
}

/** The curves every photo can start from, on the RGB point curve. */
export const BUILTIN_CURVES: CurvePreset[] = [
  { name: 'Linear', curve: {} },
  {
    name: 'Medium contrast',
    curve: {
      master: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.21 },
        { x: 0.5, y: 0.5 },
        { x: 0.75, y: 0.79 },
        { x: 1, y: 1 }
      ]
    }
  },
  {
    name: 'Strong contrast',
    curve: {
      master: [
        { x: 0, y: 0 },
        { x: 0.25, y: 0.17 },
        { x: 0.5, y: 0.5 },
        { x: 0.75, y: 0.84 },
        { x: 1, y: 1 }
      ]
    }
  },
  {
    // Lifted blacks and a slightly dimmed white: the faded print look.
    name: 'Matte',
    curve: {
      master: [
        { x: 0, y: 0.09 },
        { x: 0.22, y: 0.24 },
        { x: 0.5, y: 0.5 },
        { x: 0.8, y: 0.8 },
        { x: 1, y: 0.96 }
      ]
    }
  },
  {
    // A gentle S with both ends eased off, as a film stock's toe and shoulder.
    name: 'Soft film S',
    curve: {
      master: [
        { x: 0, y: 0.04 },
        { x: 0.2, y: 0.17 },
        { x: 0.5, y: 0.5 },
        { x: 0.8, y: 0.83 },
        { x: 1, y: 0.97 }
      ]
    }
  },
  {
    name: 'Lifted shadows',
    curve: {
      master: [
        { x: 0, y: 0 },
        { x: 0.15, y: 0.22 },
        { x: 0.4, y: 0.46 },
        { x: 0.7, y: 0.72 },
        { x: 1, y: 1 }
      ]
    }
  }
]
