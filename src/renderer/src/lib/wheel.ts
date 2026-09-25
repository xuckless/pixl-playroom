/**
 * The thumb-wheel's geometry: tool names on a drum that turns past a fixed
 * pointer. Pure numbers, so it can be tested and the component stays thin.
 *
 * `off` is how many places an item sits from the pointer (fractional while
 * the drum is dragged). The drum is small — a radius of 54px — and names
 * fade and frost as they roll away, until three places out they vanish.
 */
export const WHEEL = {
  /** Drum radius, px. */
  radius: 54,
  /** Angle between neighbouring names, radians. */
  step: 0.5,
  /** Tilt per place, degrees (the name turning away over the drum). */
  tilt: 28,
  /** Opacity lost per place. */
  fade: 0.26,
  /** Blur gained per place, px. */
  blur: 0.7,
  /** Places either side that are drawn at all. */
  visible: 3,
  /** Pointer travel per place when dragging, px. */
  dragPx: 22,
  /** Wheel delta per place. */
  wheelThreshold: 34
} as const

export interface WheelItemPose {
  y: number
  rx: number
  opacity: number
  blur: number
  scale: number
  hidden: boolean
}

export function wheelItem(off: number, w: typeof WHEEL = WHEEL): WheelItemPose {
  const a = Math.min(Math.PI / 2, Math.abs(off) * w.step) * Math.sign(off)
  const d = Math.abs(off)
  return {
    y: w.radius * Math.sin(a),
    rx: -off * w.tilt,
    opacity: Math.max(0, 1 - d * w.fade),
    blur: d * w.blur,
    scale: 1 - Math.min(0.25, d * 0.07),
    hidden: d > w.visible
  }
}

/** An item's place relative to the pointer on a drum of `n` names that wraps around. */
export function cyclicOffset(i: number, at: number, n: number): number {
  if (n <= 0) return 0
  let d = (i - at) % n
  if (d > n / 2) d -= n
  if (d < -n / 2) d += n
  return d
}

/** Wrap an index onto 0…n-1. */
export function wrapIndex(i: number, n: number): number {
  return n > 0 ? ((Math.round(i) % n) + n) % n : 0
}

/**
 * Mouse-wheel deltas accumulate until they make a whole place; returns the
 * remainder to keep and the step to take (-1, 0 or 1).
 */
export function wheelStep(
  acc: number,
  deltaY: number,
  threshold: number = WHEEL.wheelThreshold
): { acc: number; step: -1 | 0 | 1 } {
  const next = acc + deltaY
  if (next >= threshold) return { acc: 0, step: 1 }
  if (next <= -threshold) return { acc: 0, step: -1 }
  return { acc: next, step: 0 }
}

/** Places a vertical drag of `dy` px turns the drum (dragging up brings later names). */
export function dragPlaces(dy: number, px: number = WHEEL.dragPx): number {
  return -dy / px
}
