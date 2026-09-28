/**
 * The "Auto" buttons. The engine measures (`analyze`) and never decides;
 * these are Playroom's rules for turning its numbers into slider positions,
 * written down so they can be tuned and explained.
 */
import type { ImageStats, WhitePoint } from './engine-types'
import type { BasicSetting } from './recipe'
import { absoluteFromOp, opNeutralising, relativeFromOp, TINT_UNITS_PER_DUV, type Vec3 } from './wb'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** Percentile `p` of the stats' luma, read from the reported list (nearest). */
function pct(stats: ImageStats, p: number): number {
  let best = stats.luma_percentiles[0]
  for (const q of stats.luma_percentiles) {
    if (Math.abs(q.percentile - p) < Math.abs(best.percentile - p)) best = q
  }
  return best?.value ?? 0.5
}

/** The percentiles `autoTone` reads; ask `analyze` for these. */
export const AUTO_PERCENTILES = [0.5, 2, 10, 50, 90, 95, 99.5]

/** Where the median is put: display mid-grey, a little lower or higher for a low- or high-key frame. */
const TARGET_MEDIAN = 0.46
const TARGET_LOW_KEY = 0.4
const TARGET_HIGH_KEY = 0.5
/** Exposure goes most of the way to the target, never all of it: the median is only a guess at intent. */
const EXPOSURE_SHARE = 0.85
/** The spread (σ of encoded luma) of a frame that reads as neither flat nor punchy. */
const TARGET_SPREAD = 0.21

/**
 * Auto tone, from encoded-domain statistics of the photo as the base
 * profile renders it (no tone sliders yet). Gentle on purpose: it should
 * land a frame somewhere good to start from, never flatten it into an HDR
 * look. Two readings of the scene decide how far it goes:
 *
 * - **flat** — the 0.5…99.5 percentile span is under 0.55, or σ is under
 *   0.12: overcast, fog, haze, a grey wall. A flat frame wants contrast, not
 *   highlight recovery (a dull sky is not a hot one), and no shadow lift;
 * - **hot** — more than 0.3% of pixels clip, or the 99.5th percentile lands
 *   above 0.985 once exposure has moved: only then is there something for
 *   Highlights to recover.
 *
 * The sliders, each capped well short of its range:
 *
 * - exposure moves the median most of the way (×0.85) toward 0.46, 0.40
 *   for a low-key frame (the 90th percentile below 0.5: it is dark by
 *   intent) and 0.50 for a flat high-key one (the 10th above 0.45: snow,
 *   fog, a bright overcast), within ±2 stops;
 * - highlights pull down by how far the 95th percentile sits above 0.80,
 *   at most −50, and only for a hot frame or one whose 99.5th reaches 0.95;
 * - whites stretch the 99.5th toward 0.97 (to +40), or back off by the
 *   clipped fraction (to −30);
 * - blacks deepen a lifted 0.5th percentile (to −35) unless the shadows
 *   already clip, and lift (to +25) only when they clip; on a flat frame
 *   both ends stretch at most half as far, since contrast is doing that work too;
 * - shadows lift a dark 10th percentile (to +40), never on a flat frame;
 * - contrast nudges σ toward 0.21 (−20…+30); a flat frame always gains some.
 */
export function autoTone(stats: ImageStats): BasicSetting {
  const p005 = pct(stats, 0.5)
  const p10 = pct(stats, 10)
  const p50 = pct(stats, 50)
  const p90 = pct(stats, 90)
  const p95 = pct(stats, 95)
  const p995 = pct(stats, 99.5)
  const sigma = stats.luma_stddev
  const clippedHigh = Math.max(...stats.clipped_high, 0)
  const clippedLow = Math.max(...stats.clipped_low, 0)
  const flat = p995 - p005 < 0.55 || sigma < 0.12

  const target =
    p90 < 0.5 ? TARGET_LOW_KEY : flat && p10 > 0.45 ? TARGET_HIGH_KEY : TARGET_MEDIAN
  const toTarget = Math.log2(
    srgbToLinear(target) / Math.max(srgbToLinear(Math.max(p50, 0.01)), 1e-4)
  )
  const exposure = clamp(toTarget * EXPOSURE_SHARE, -2, 2)

  // After the exposure, the percentiles move roughly by the same factor in
  // linear light; estimate where they land before placing the other sliders.
  const gain = 2 ** exposure
  const shifted = (v: number): number => {
    const lin = srgbToLinear(v) * gain
    return lin <= 0.0031308 ? lin * 12.92 : Math.min(1, 1.055 * lin ** (1 / 2.4) - 0.055)
  }
  const s10 = shifted(p10)
  const s95 = shifted(p95)
  const s995 = shifted(p995)
  const s005 = shifted(p005)
  const hot = clippedHigh > 0.003 || s995 > 0.985

  // Overcast is flat, not hot: pulling its highlights only greys the sky.
  const highlights =
    hot || (!flat && s995 >= 0.95) ? -clamp(((s95 - 0.8) / 0.2) * 60, 0, 50) : 0
  // A flat frame's contrast already stretches it; the ends go at most half
  // as far so the three together do not wring it out.
  const stretch = flat ? 0.5 : 1
  const whites =
    clippedHigh > 0.005
      ? clamp(-clippedHigh * 2000, -30, 0)
      : clamp(((0.97 - s995) / 0.2) * 100, 0, 40 * stretch)
  // Blacks deepen a milky floor, but not one that already clips; they lift
  // only to rescue clipped shadows.
  const blacks =
    clippedLow > 0.002
      ? clamp(clippedLow * 2000, 0, 25)
      : s005 > 0.04
        ? -clamp(((s005 - 0.02) / 0.15) * 100, 0, 35 * stretch)
        : 0
  // Lifting a flat frame's shadows would only flatten it further.
  const shadows = !flat && s10 < 0.12 ? clamp(((0.12 - s10) / 0.12) * 50, 0, 40) : 0
  const contrast = flat
    ? clamp(((TARGET_SPREAD - sigma) / TARGET_SPREAD) * 40, 5, 30)
    : clamp(((TARGET_SPREAD - sigma) / TARGET_SPREAD) * 30, -20, 30)
  const round = (v: number): number => Math.round(v) || 0
  return {
    exposure: Math.round(exposure * 100) / 100 || 0,
    contrast: round(contrast),
    highlights: round(highlights),
    shadows: round(shadows),
    whites: round(whites),
    blacks: round(blacks)
  }
}

/**
 * The white-balance sliders that neutralise a colour measured in linear
 * Rec.2020 before the white balance runs — a grey-pixel mean for Auto, the
 * eyedropper's sample for a click. Absolute for a RAW with an as-shot white,
 * relative otherwise. Null when the colour cannot be neutralised (a channel
 * at zero).
 */
export function wbSliders(
  linearRec2020: Vec3,
  isRaw: boolean,
  asShot: WhitePoint | null
): { temperature: number; tint: number; clamped: boolean } | null {
  const op = opNeutralising(linearRec2020)
  if (!op) return null
  if (isRaw && asShot) {
    const abs = absoluteFromOp(op, asShot)
    return {
      temperature: Math.round(abs.kelvin),
      tint: Math.round(abs.tint * TINT_UNITS_PER_DUV),
      clamped: op.clamped || abs.clamped
    }
  }
  const rel = relativeFromOp(op)
  return {
    temperature: Math.round(clamp(rel.temperature, -100, 100)),
    tint: Math.round(clamp(rel.tint, -100, 100)),
    clamped: op.clamped || Math.abs(rel.temperature) > 100 || Math.abs(rel.tint) > 100
  }
}

/** Linear sRGB (what the engine writes as `LinearSrgb`) → linear Rec.2020. */
export function linearSrgbToRec2020([r, g, b]: Vec3): Vec3 {
  return [
    0.6274 * r + 0.3293 * g + 0.0433 * b,
    0.0691 * r + 0.9195 * g + 0.0114 * b,
    0.0164 * r + 0.088 * g + 0.8956 * b
  ]
}
