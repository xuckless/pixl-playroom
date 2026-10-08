/**
 * A Depth range in the sliders' words (0 the nearest thing in the photo, 100
 * the farthest) against its map's grey (disparity, 255 the nearest). Pure,
 * for tests/depth.test.ts.
 */

/** A grey value of the map as the sliders' depth: 0 the nearest, 100 the farthest. */
export function depthOf(grey: number): number {
  return Math.round((1 - grey / 255) * 100)
}

/**
 * How much of a depth (0…100) the range takes, as the engine keys it: whole
 * between `near` and `far`, fading over `softness` past them (a smoothstep).
 */
export function coverage(depth: number, near: number, far: number, soft: number): number {
  const lo = Math.min(near, far)
  const hi = Math.max(near, far)
  const d = depth < lo ? lo - depth : depth > hi ? depth - hi : 0
  if (d === 0) return 1
  if (soft <= 0 || d >= soft) return 0
  const t = 1 - d / soft
  return t * t * (3 - 2 * t)
}
