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

/**
 * Auto tone, from encoded-domain statistics of the photo as the base
 * profile renders it (no tone sliders yet):
 *
 * - exposure puts the median luma at display mid-grey (0.46), in stops of
 *   linear light, within ±3;
 * - highlights pull down when the 95th percentile sits above 0.88, shadows
 *   lift when the 10th sits below 0.10;
 * - whites/blacks stretch the 99.5th and 0.5th percentiles toward 0.97 and
 *   0.02, and back off when either end is already clipping;
 * - contrast nudges the spread (σ) toward 0.21.
 */
export function autoTone(stats: ImageStats): BasicSetting {
  const p005 = pct(stats, 0.5)
  const p10 = pct(stats, 10)
  const p50 = pct(stats, 50)
  const p95 = pct(stats, 95)
  const p995 = pct(stats, 99.5)
  const exposure = clamp(
    Math.log2(srgbToLinear(0.46) / Math.max(srgbToLinear(Math.max(p50, 0.01)), 1e-4)),
    -3,
    3
  )
  // After the exposure, the percentiles move roughly by the same factor in
  // linear light; estimate where they land before placing the other sliders.
  const gain = 2 ** exposure
  const shifted = (v: number): number => {
    const lin = srgbToLinear(v) * gain
    return lin <= 0.0031308 ? lin * 12.92 : Math.min(1, 1.055 * lin ** (1 / 2.4) - 0.055)
  }
  const s95 = shifted(p95)
  const s10 = shifted(p10)
  const s995 = shifted(p995)
  const s005 = shifted(p005)
  const clippedHigh = Math.max(...stats.clipped_high, 0)
  const clippedLow = Math.max(...stats.clipped_low, 0)
  const highlights = s95 > 0.88 ? clamp(-((s95 - 0.85) / 0.15) * 100, -80, 0) : 0
  const shadows = s10 < 0.1 ? clamp(((0.1 - s10) / 0.1) * 60, 0, 60) : 0
  const whites =
    clippedHigh > 0.005
      ? clamp(-clippedHigh * 2000, -40, 0)
      : clamp(((0.97 - s995) / 0.2) * 100, 0, 60)
  const blacks =
    clippedLow > 0.005
      ? clamp(clippedLow * 2000, 0, 30)
      : clamp(-((s005 - 0.02) / 0.15) * 100, -60, 0)
  const contrast = clamp(((0.21 - stats.luma_stddev) / 0.21) * 60, -30, 40)
  const round = (v: number): number => Math.round(v)
  return {
    exposure: Math.round(exposure * 100) / 100,
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
