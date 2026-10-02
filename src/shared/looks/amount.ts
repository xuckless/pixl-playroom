/**
 * A look's Amount: the photo as it was before the look (`before`), the look
 * at full strength (`after`), and the fields the look moved. At `t` 0 the
 * photo is as it was, at 1 the look is whole; between, every field the look
 * moved is taken that far from the one to the other. Nothing else is touched.
 *
 * Numbers blend straight (clamped to the slider's range); a grading wheel's
 * hue turns the short way round, or takes the look's hue outright where the
 * wheel had no colour before; a point curve blends as the curve it draws.
 * What cannot be in between (black and white, a mask) is the look's once
 * there is any of it.
 */
import { monotone } from '../curves'
import type { CurvePointSetting, Recipe } from '../recipe'
import { rangeOf } from './ranges'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The most points a blended curve keeps (a look's curves have far fewer). */
const MAX_CURVE_POINTS = 16

const round = (v: number): number => Math.round(v * 1e4) / 1e4

function at(root: unknown, path: string[]): unknown {
  let node = root
  for (const k of path) node = isObj(node) ? node[k] : undefined
  return node
}

const isCurve = (v: unknown): v is CurvePointSetting[] =>
  Array.isArray(v) && v.every((p) => isObj(p) && typeof p.x === 'number' && typeof p.y === 'number')

function blendCurve(
  a: CurvePointSetting[],
  b: CurvePointSetting[],
  t: number
): CurvePointSetting[] {
  const fa = monotone(a)
  const fb = monotone(b)
  let xs = [...new Set([...a, ...b].map((p) => round(p.x)))].sort((x, y) => x - y)
  if (xs.length > MAX_CURVE_POINTS)
    xs = Array.from({ length: MAX_CURVE_POINTS }, (_, i) => round(i / (MAX_CURVE_POINTS - 1)))
  return xs.map((x) => ({ x, y: round(fa(x) + (fb(x) - fa(x)) * t) }))
}

/** A hue (0…360) `t` of the way from `a` to `b`, the short way round. */
function blendHue(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180
  return round((((a + d * t) % 360) + 360) % 360)
}

function blendValue(path: string[], a: unknown, b: unknown, t: number, before: Recipe): unknown {
  if (typeof a === 'number' && typeof b === 'number') {
    const range = rangeOf(path)
    if (path[path.length - 1] === 'hue' && range?.[1] === 360) {
      // A wheel with no colour before has no hue of its own to start from.
      const sat = at(before, [...path.slice(0, -1), 'saturation'])
      if (sat === 0) return b
      return blendHue(a, b, t)
    }
    const v = round(a + (b - a) * t)
    return range ? Math.min(range[1], Math.max(range[0], v)) : v
  }
  if (isCurve(a) && isCurve(b)) return blendCurve(a, b, t)
  // The parametric curve's splits: each moves on its own.
  if (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((v) => typeof v === 'number') &&
    b.every((v) => typeof v === 'number')
  )
    return a.map((v: number, i) => round(v + ((b[i] as number) - v) * t))
  // Steps, not slides: the look's once there is any of it.
  return structuredClone(t > 0 ? b : a)
}

/** `before` with each of `fields` taken `t` (0…1) of the way to `after`. */
export function blendLook(before: Recipe, after: Recipe, fields: string[][], t: number): Recipe {
  const k = Math.min(1, Math.max(0, t))
  // The ends are exact: none of the look, or all of it as applied.
  if (k === 0) return structuredClone(before)
  const out = structuredClone(before) as unknown as Obj
  for (const path of fields) {
    if (path.length === 0) continue
    const parent = at(out, path.slice(0, -1))
    const last = path[path.length - 1]
    if (!isObj(parent) || !(last in parent)) continue
    const a = at(before, path)
    const b = at(after, path)
    if (b === undefined) continue
    parent[last] = k === 1 ? structuredClone(b) : blendValue(path, a, b, k, before)
  }
  return out as unknown as Recipe
}
