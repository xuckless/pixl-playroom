/**
 * How big a picture to decode for a small one (engine 0.21, OBS-1): a RAW's
 * embedded preview is sized from the preview itself (`raw_previews`), not
 * from the sensor, and a camera JPEG is decoded at a half, a quarter or an
 * eighth per side by libjpeg-turbo's scaled IDCT (`decode_reduce`) when even
 * that leaves the edge wanted. The resize then starts from the reduced frame.
 *
 * Pure, for tests/thumbsize.test.ts.
 */
import type { DecodeReduce, Orientation, SourceInfo } from './engine-types'
import { swapsAxes } from './orientation'

/** Each reduction and the divisor it decodes at, the largest first. */
const REDUCTIONS: [DecodeReduce, number][] = [
  ['Eighth', 8],
  ['Quarter', 4],
  ['Half', 2]
]

/** The divisor a reduction decodes at (1 for none). */
export function divisorOf(reduce: DecodeReduce | null): number {
  return REDUCTIONS.find(([r]) => r === reduce)?.[1] ?? 1
}

/** A side decoded at `reduce`: `⌈side / d⌉`, as the engine makes it. */
export function reducedSide(side: number, reduce: DecodeReduce | null): number {
  return Math.ceil(side / divisorOf(reduce))
}

/**
 * The largest reduction that still leaves `edge` on a long side of `long`
 * (`⌈long / d⌉ ≥ edge`), no further than `most`; null when even a half is
 * too small.
 */
export function reduceFor(long: number, edge: number, most: number = 8): DecodeReduce | null {
  for (const [r, d] of REDUCTIONS) if (d <= most && Math.ceil(long / d) >= edge) return r
  return null
}

/** What to ask for a small picture: the decode's reduction and the resize after it. */
export interface PreviewPlan {
  reduce: DecodeReduce | null
  /** The long side of the picture decoded whole. */
  long: number
  /** `Scale`'s factor, from the reduced frame (1: no resize). */
  factor: number
}

/**
 * The picture of a photo unedited at most `edge` on its long side: a RAW's
 * embedded preview (`raw`), anything else its own pixels. `'develop'`: a RAW
 * whose probe lists no preview the engine can decode, so the caller develops
 * at once instead of trying one first. A probe from before 0.21 (no
 * `raw_previews`) sizes from the sensor, as before.
 */
export function previewPlan(
  info: Pick<SourceInfo, 'input' | 'width' | 'height' | 'raw_previews' | 'gain_map'>,
  raw: boolean,
  edge: number
): PreviewPlan | 'develop' {
  const plan = (long: number, reducible: boolean): PreviewPlan => {
    const reduce = reducible ? reduceFor(long, edge) : null
    return { reduce, long, factor: Math.min(1, edge / reducedSide(long, reduce)) }
  }
  if (raw) {
    if (info.raw_previews === undefined) return plan(Math.max(info.width, info.height), false)
    const p = info.raw_previews.find((p) => p.decodable)
    if (!p) return 'develop'
    return plan(Math.max(p.width, p.height), p.reducible)
  }
  // A plain JPEG's own pixels (a gain-map one reads its base, which reduces too).
  return plan(Math.max(info.width, info.height), info.input === 'Jpeg')
}

/**
 * A JPEG proxy's decode (the owner, 2026-10-14): at half size when the JPEG
 * is at least twice the proxy's edge, so a 24 MP one decodes 3000 px across
 * and Lanczos takes it to 2560; never smaller (the scaled IDCT averages in
 * gamma, the proxy's own downscale in linear light). HDR JPEGs read whole.
 */
export function proxyReduce(
  info: Pick<SourceInfo, 'input' | 'width' | 'height' | 'is_hdr'>,
  proxyEdge: number
): DecodeReduce | null {
  if (info.input !== 'Jpeg' || info.is_hdr) return null
  return reduceFor(Math.max(info.width, info.height), proxyEdge, 2)
}

/**
 * The upright full-size frame of a source decoded with `orientation`: what
 * masks and every normalised size are fractions of, from the probe (a reduced
 * decode's report states the reduced frame, off by up to `d − 1` pixels).
 */
export function uprightSize(
  info: Pick<SourceInfo, 'width' | 'height'>,
  orientation: Orientation
): { width: number; height: number } {
  return swapsAxes(orientation)
    ? { width: info.height, height: info.width }
    : { width: info.width, height: info.height }
}
