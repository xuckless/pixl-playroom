/**
 * The expanded scope's numbers, from the measurements the engine already
 * returns (`ImageStats`): dynamic range, contrast, clipping, colour cast,
 * and how a colour-vision deficiency would see the photo's hues. Pure, for
 * the Metrics tab and the tests. Gamut coverage and the u'v' cloud need the
 * engine to measure them (TODO.md, ENGINE REQUEST).
 */
import type { ImageStats } from './engine-types'
import { chromaDiff, hslToRgb, linearToSrgb, rgbToLab, srgbToLinear, type Rgb8 } from './palette'
import { t, tk } from './i18n'

export type VisionKind = 'protan' | 'deutan' | 'tritan'

export const VISION_LABEL: Record<VisionKind, string> = {
  protan: tk('Protanopia (no red)'),
  deutan: tk('Deuteranopia (no green)'),
  tritan: tk('Tritanopia (no blue)')
}

/** Machado, Oliveira & Fernandes (2009), full severity, on linear RGB. */
export const VISION_MATRIX: Record<VisionKind, number[][]> = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998]
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881]
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039]
  ]
}

/** The matrix as an SVG `feColorMatrix` `values` string (apply with linearRGB filters). */
export function visionFilterValues(kind: VisionKind): string {
  const m = VISION_MATRIX[kind]
  return [...m.map((row) => `${row.join(' ')} 0 0`), '0 0 0 1 0'].join(' ')
}

/** How a person with this deficiency sees an sRGB colour (0…255). */
export function simulateVision(rgb: Rgb8, kind: VisionKind): Rgb8 {
  const lin = rgb.map((v) => srgbToLinear(v / 255))
  const m = VISION_MATRIX[kind]
  return m.map((row) => {
    const v = row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]
    return Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)
  }) as Rgb8
}

export interface HueShare {
  start: number
  end: number
  share: number
  /** The bar's colour, as the hue chart paints it. */
  rgb: Rgb8
}

/** The photo's hue bins as shares of the picture, with the colour each is painted. */
export function hueShares(stats: ImageStats | null | undefined): HueShare[] {
  if (!stats || stats.hue_histogram.length === 0) return []
  const total = Math.max(
    1,
    stats.hue_histogram.reduce((a, b) => a + b.count, 0) + stats.neutral_pixels
  )
  return stats.hue_histogram.map((b) => {
    const mid = (b.hue_start + b.hue_end) / 2
    return {
      start: b.hue_start,
      end: b.hue_end,
      share: b.count / total,
      rgb: hslToRgb(mid, (35 + b.mean_saturation * 65) / 100, 0.52)
    }
  })
}

export interface Collision {
  a: HueShare
  b: HueShare
  /** How far apart the two look normally, and as this deficiency sees them (chroma difference). */
  normal: number
  seen: number
}

/**
 * Pairs of hues that are plainly different to most eyes (a chroma difference
 * of 40 or more) but nearly one colour to this deficiency (under 20), among
 * the hues that make up at least `minShare` of the picture. Lightness is left
 * out of it: the chart paints every hue at one lightness, which says nothing
 * about the photo, and a difference in lightness is a cue a person may use.
 * Most of the picture first.
 */
export function collidingHues(
  hues: HueShare[],
  kind: VisionKind,
  minShare = 0.02,
  limit = 4
): Collision[] {
  const present = hues
    .filter((h) => h.share >= minShare)
    .map((h) => ({
      h,
      normal: rgbToLab(h.rgb),
      seen: rgbToLab(simulateVision(h.rgb, kind))
    }))
  const out: Collision[] = []
  for (let i = 0; i < present.length; i++)
    for (let j = i + 1; j < present.length; j++) {
      const normal = chromaDiff(present[i].normal, present[j].normal)
      const seen = chromaDiff(present[i].seen, present[j].seen)
      if (normal >= 40 && seen < 20) out.push({ a: present[i].h, b: present[j].h, normal, seen })
    }
  return out.sort((x, y) => y.a.share + y.b.share - (x.a.share + x.b.share)).slice(0, limit)
}

export interface ScopeMetrics {
  /** Stops between the darkest and lightest 0.5% of the picture. */
  rangeStops: number | null
  /** WCAG contrast ratio between the 10% and 90% points of brightness. */
  contrast: number | null
  /** The fraction of pixels at the bottom and top of the range, worst channel. */
  lowClip: number
  highClip: number
  meanLuma: number
  spread: number
  meanSaturation: number
  channelMeans: number[]
  /** The grey-world cast: which way the picture leans, and by how much (percent). */
  cast: { label: 'warm' | 'cool' | 'neutral'; amount: number }
}

/** A luma percentile as relative luminance, or null when the measurement lacks it. */
function luminanceAt(stats: ImageStats, p: number): number | null {
  const hit = stats.luma_percentiles.find((x) => Math.abs(x.percentile - p) < 1e-6)
  if (!hit) return null
  // Encoded values are decoded; a linear measurement is relative luminance already.
  return stats.domain === 'Encoded' ? srgbToLinear(Math.max(0, Math.min(1, hit.value))) : hit.value
}

export function scopeMetrics(stats: ImageStats): ScopeMetrics {
  const lo = luminanceAt(stats, 0.5)
  const hi = luminanceAt(stats, 99.5)
  const p10 = luminanceAt(stats, 10)
  const p90 = luminanceAt(stats, 90)
  const floor = 1 / 1024
  const g = stats.grey_world_gain
  const gr = g[0] ?? null
  const gb = g[2] ?? null
  let cast: ScopeMetrics['cast'] = { label: 'neutral', amount: 0 }
  if (gr !== null && gb !== null && gr > 0 && gb > 0) {
    // A gain above 1 on red means the picture is short of red: it leans cool.
    const ratio = gb / gr
    const amount = Math.round(Math.abs(ratio - 1) * 100)
    cast = { label: amount < 3 ? 'neutral' : ratio > 1 ? 'warm' : 'cool', amount }
  }
  return {
    rangeStops: lo !== null && hi !== null ? Math.log2((hi + floor) / (lo + floor)) : null,
    contrast: p10 !== null && p90 !== null ? (p90 + 0.05) / (p10 + 0.05) : null,
    lowClip: Math.max(0, ...stats.clipped_low),
    highClip: Math.max(0, ...stats.clipped_high),
    meanLuma: stats.luma_mean,
    spread: stats.luma_stddev,
    meanSaturation: stats.mean_saturation,
    channelMeans: stats.channel_mean,
    cast
  }
}

/** What a contrast ratio means for reading detail: WCAG's own thresholds. */
export function contrastVerdict(ratio: number): string {
  if (ratio >= 7) return t('Strong')
  if (ratio >= 4.5) return t('Good')
  if (ratio >= 3) return t('Moderate')
  return t('Flat')
}
