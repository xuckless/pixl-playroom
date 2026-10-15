/**
 * Moving the points of a curve (components/editors.tsx): by a drag, a key, or
 * putting one back. Pure, so it runs under `node --test`. Points are sorted
 * by x; a point stays between its neighbours, and on a tone curve (not a vs
 * curve) the first and last keep to the ends.
 */
import type { CurvePointSetting } from '../../../shared/recipe'
import { stepScale, type KeyMod } from './sliderDrag'

/** The closest two points may come, along x. */
const GAP = 0.01
/** How far an arrow key moves a point, as a share of the curve's width. */
export const POINT_KEY = 0.01

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4

/** Whether point `i` is a tone curve's end, which stays at its side. */
export const isEnd = (pts: CurvePointSetting[], i: number, vs: boolean): boolean =>
  !vs && (i === 0 || i === pts.length - 1)

/** The points with point `i` moved to (x, y): kept between its neighbours, an end at its side. */
export function placePoint(
  pts: CurvePointSetting[],
  i: number,
  x: number,
  y: number,
  vs: boolean
): CurvePointSetting[] {
  const lo = i === 0 ? 0 : pts[i - 1].x + GAP
  const hi = i === pts.length - 1 ? 1 : pts[i + 1].x - GAP
  const nx = isEnd(pts, i, vs) ? (i === 0 ? 0 : 1) : Math.min(hi, Math.max(lo, x))
  const next = [...pts]
  next[i] = { x: r4(clamp01(nx)), y: r4(clamp01(y)) }
  return next
}

/** The points after an arrow key on point `i`: ←→ along x, ↑↓ along y. */
export function nudgePoint(
  pts: CurvePointSetting[],
  i: number,
  axis: 'x' | 'y',
  dir: 1 | -1,
  mod: KeyMod,
  vs: boolean
): CurvePointSetting[] {
  const by = dir * POINT_KEY * stepScale(mod)
  const p = pts[i]
  return axis === 'x'
    ? placePoint(pts, i, p.x + by, p.y, vs)
    : placePoint(pts, i, p.x, p.y + by, vs)
}

/**
 * Point `i` put back: an inner point (any point of a vs curve) goes, which is
 * where the curve would be without it; a tone curve's end goes back to its
 * corner (black stays black, white white).
 */
export function resetPoint(pts: CurvePointSetting[], i: number, vs: boolean): CurvePointSetting[] {
  if (!isEnd(pts, i, vs)) return pts.filter((_, j) => j !== i)
  const next = [...pts]
  next[i] = i === 0 ? { x: 0, y: 0 } : { x: 1, y: 1 }
  return next
}

/**
 * A point added from the keys: in the middle of the widest gap, on the line
 * (so adding it bends nothing). Returns the points and where the new one is.
 */
export function addPoint(
  pts: CurvePointSetting[],
  at: (x: number) => number
): { points: CurvePointSetting[]; index: number } {
  const xs = [0, ...pts.map((p) => p.x), 1]
  let best = 0
  for (let k = 1; k < xs.length - 1; k++) if (xs[k + 1] - xs[k] > xs[best + 1] - xs[best]) best = k
  const x = r4((xs[best] + xs[best + 1]) / 2)
  const p = { x, y: r4(clamp01(at(x))) }
  const points = [...pts, p].sort((a, b) => a.x - b.x)
  return { points, index: points.indexOf(p) }
}
