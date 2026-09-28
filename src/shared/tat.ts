/**
 * The targeted adjustment tool: press on the picture and drag up or down to
 * move whatever controls that colour or tone — the HSL bands its hue falls
 * between, or the point curve at its level. Pure: the loupe samples the
 * pixel and applies these to the recipe the drag started from.
 */
import { monotone } from './curves'
import {
  HSL_BANDS,
  HSL_BAND_CENTRES,
  type BandSetting,
  type CurvePointSetting,
  type HslBand
} from './recipe'

/** The HSL bands in hue order, as the engine centres them. */
const BY_HUE = [...HSL_BANDS].sort((a, b) => HSL_BAND_CENTRES[a] - HSL_BAND_CENTRES[b])

/**
 * How much each HSL band owns a hue: linear between the two band centres the
 * hue falls between (so 15° is half red, half orange), wrapping at 360°.
 * The weights sum to 1.
 */
export function bandWeights(hue: number): Record<HslBand, number> {
  const h = ((hue % 360) + 360) % 360
  const w = Object.fromEntries(HSL_BANDS.map((b) => [b, 0])) as Record<HslBand, number>
  for (let i = 0; i < BY_HUE.length; i++) {
    const a = BY_HUE[i]
    const b = BY_HUE[(i + 1) % BY_HUE.length]
    const from = HSL_BAND_CENTRES[a]
    // The last span runs from the top band back round to red at 360°.
    const to = i === BY_HUE.length - 1 ? HSL_BAND_CENTRES[b] + 360 : HSL_BAND_CENTRES[b]
    if (h < from || h >= to) continue
    const t = (h - from) / (to - from)
    w[a] = 1 - t
    w[b] += t
    return w
  }
  // Below the first centre (none: red sits at 0°), kept for safety.
  w[BY_HUE[0]] = 1
  return w
}

export type TatAxis = 'hue' | 'saturation' | 'luminance' | 'all'

/**
 * The HSL bands with `delta` (slider units) shared out by `weights` on one
 * axis. "All" moves saturation, the axis a drag on a colour most often means.
 */
export function applyHslDelta(
  hsl: Record<HslBand, BandSetting>,
  weights: Record<HslBand, number>,
  axis: TatAxis,
  delta: number
): Record<HslBand, BandSetting> {
  const key = axis === 'all' ? 'saturation' : axis
  const out = { ...hsl }
  for (const b of HSL_BANDS) {
    const w = weights[b] ?? 0
    if (w <= 0) continue
    const v = Math.round(hsl[b][key] + delta * w)
    out[b] = { ...hsl[b], [key]: Math.min(100, Math.max(-100, v)) }
  }
  return out
}

/** The band that owns most of a hue (for the history's label). */
export function mainBand(weights: Record<HslBand, number>): HslBand {
  return HSL_BANDS.reduce((best, b) => (weights[b] > weights[best] ? b : best), HSL_BANDS[0])
}

/** How near (in x) a curve point must be to be the one a drag moves. */
const CATCH = 0.04

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4

/**
 * The point curve with the level `x` raised by `dy`: the nearest point within
 * ±0.04 of `x` moves, else a point is inserted on the curve at `x` and moves.
 * Only y moves, clamped to 0…1, so the xs stay strictly increasing and the
 * end points stay at 0 and 1.
 */
export function nudgeCurve(
  points: CurvePointSetting[],
  x: number,
  dy: number
): CurvePointSetting[] {
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const at = Math.min(1, Math.max(0, x))
  let hit = -1
  let best = CATCH
  sorted.forEach((p, i) => {
    const d = Math.abs(p.x - at)
    if (d <= best) {
      best = d
      hit = i
    }
  })
  const clampY = (y: number): number => round4(Math.min(1, Math.max(0, y)))
  if (hit >= 0) {
    return sorted.map((p, i) => (i === hit ? { x: p.x, y: clampY(p.y + dy) } : p))
  }
  const y = monotone(sorted)(at)
  return [...sorted, { x: round4(at), y: clampY(y + dy) }].sort((a, b) => a.x - b.x)
}

/**
 * The level on the curve's input that gives `y` out: where a sampled pixel
 * sat before the curve moved it (bisection; the curve is non-decreasing).
 */
export function curveInput(points: CurvePointSetting[], y: number): number {
  const f = monotone(points)
  let lo = 0
  let hi = 1
  if (f(hi) < f(lo)) return Math.min(1, Math.max(0, y))
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < y) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}
