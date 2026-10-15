/**
 * The arithmetic of the Resolve wheels (components/grading/GradeWheel.tsx):
 * where a value sits on the disc, the value at a place on it, and the steps
 * the keys take. Pure, so it runs under `node --test`.
 */
import { discToRgb, rgbToDisc, type Yrgb } from '../../../shared/resolve'
import { stepScale, type KeyMod } from './sliderDrag'

export interface WheelScale {
  /** The untouched value of every channel (0 for Lift, Gamma, Offset; 1 for Gain). */
  neutral: number
  /** The colour change at the disc's edge. */
  reach: number
  /** The master's change per pixel of a drag along the ring. */
  ringStep: number
  min: number
  max: number
  /** The number shown for a value (Offset's 25 + 100·o), and back. */
  show?: (v: number) => number
  read?: (n: number) => number
}

/** How far an arrow key moves the ring or a number: as far as this many pixels of drag. */
export const KEY_PX = 2.5

/** How far an arrow key moves the puck, as a share of the disc's radius. */
export const DISC_KEY = 0.02

/** Where the value's colour balance sits on the disc: −1…1 each way, inside the circle. */
export function discPoint(v: Yrgb, s: WheelScale): { x: number; y: number } {
  const n = s.neutral
  const at = rgbToDisc(v.r - n, v.g - n, v.b - n)
  const x = Math.max(-1, Math.min(1, at.x / s.reach))
  const y = Math.max(-1, Math.min(1, at.y / s.reach))
  const len = Math.hypot(x, y)
  return len > 1 ? { x: x / len, y: y / len } : { x, y }
}

/** The value with its balance at (x, y) on the disc (kept inside the circle); its master kept. */
export function atDisc(v: Yrgb, s: WheelScale, x: number, y: number): Yrgb {
  const d = Math.hypot(x, y)
  if (d > 1) {
    x /= d
    y /= d
  }
  const c = discToRgb(x * s.reach, y * s.reach)
  const n = s.neutral
  return { ...v, r: n + c.r, g: n + c.g, b: n + c.b }
}

/** The value after an arrow key on the disc: the puck moves along x (←→) or y (↑↓). */
export function nudgeDisc(v: Yrgb, s: WheelScale, axis: 'x' | 'y', dir: 1 | -1, mod: KeyMod): Yrgb {
  const p = discPoint(v, s)
  const by = dir * DISC_KEY * stepScale(mod)
  return axis === 'x' ? atDisc(v, s, p.x + by, p.y) : atDisc(v, s, p.x, p.y + by)
}

/** A channel (the ring's master, or one of the YRGB numbers) after an arrow key. */
export function nudgeChannel(value: number, s: WheelScale, dir: 1 | -1, mod: KeyMod): number {
  const next = value + dir * s.ringStep * KEY_PX * stepScale(mod)
  return Math.min(s.max, Math.max(s.min, Number(next.toFixed(6))))
}

/** The wheel put back: every channel at its neutral value. */
export const neutralOf = (s: WheelScale): Yrgb => ({
  y: s.neutral,
  r: s.neutral,
  g: s.neutral,
  b: s.neutral
})
