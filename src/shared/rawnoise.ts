/**
 * A RAW frame's noise as the engine states it to PIXL's demosaic, and what
 * a frame the engine cannot read is stated (E64): the pure part of
 * main/ai/noisebook.ts, which keeps the measurements.
 */
/** A frame's noise as the engine states it: `variance = k·x + σ²`, x in 0…1. */
export interface StatedNoise {
  k: number
  sigma2: number
}

/** One of a develop's `raw.demosaic_model.noise_planes`, as far as it is read here. */
export interface NoisePlane {
  plane: string
  k: number
  sigma2: number
  fit: unknown
}

/** What a frame is known by: its camera and ISO (the index's row). */
export interface Shot {
  camera: string | null
  iso: number | null
}

/**
 * Camera → ISO → the noise measured there: the last few measurements, newest
 * last (a book kept before 0.21 holds one statement per ISO, read as one).
 */
export type NoiseBook = Record<string, Record<string, StatedNoise | StatedNoise[]>>

/** How many measurements are kept per camera and ISO. */
export const KEPT_PER_ISO = 7

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The frame's noise as one statement from its planes: the median of the
 * planes the engine fitted (a plane it could not fit, `fit: null`, is left
 * out: under 0.21.0's `MeasuredGreenFloor` a Bayer frame's red and blue),
 * or null when none was fitted (a stated develop says nothing new).
 */
export function noiseOfPlanes(
  planes: readonly NoisePlane[] | null | undefined
): StatedNoise | null {
  const fitted = (planes ?? []).filter(
    (p) => p.fit !== null && Number.isFinite(p.k) && Number.isFinite(p.sigma2) && p.k > 0
  )
  if (fitted.length === 0) return null
  return {
    k: median(fitted.map((p) => p.k)),
    sigma2: Math.max(0, median(fitted.map((p) => p.sigma2)))
  }
}

/** What the book holds for one camera at one ISO, as a list. */
export function measuredAt(entry: StatedNoise | StatedNoise[] | undefined): StatedNoise[] {
  if (!entry) return []
  return (Array.isArray(entry) ? entry : [entry]).filter(
    (n) => Number.isFinite(n?.k) && Number.isFinite(n?.sigma2) && n.k > 0
  )
}

/** A measurement added to what the book holds at one ISO: the last `KEPT_PER_ISO`. */
export function withMeasurement(
  entry: StatedNoise | StatedNoise[] | undefined,
  n: StatedNoise
): StatedNoise[] {
  return [...measuredAt(entry), n].slice(-KEPT_PER_ISO)
}

/** The median statement of several measurements at one ISO. */
function medianOf(list: StatedNoise[]): StatedNoise {
  return { k: median(list.map((n) => n.k)), sigma2: median(list.map((n) => n.sigma2)) }
}

/**
 * The noise over ISO from a camera's measurements at two ISOs or more
 * (each ISO its median): shot noise grows with the gain, `k = c·ISO`
 * (least squares through 0); the read noise has a part before the
 * amplifier that grows with its square and a part after it that does not,
 * `σ² = a·ISO² + b` (least squares, `a` and `b` never below 0). A sensor
 * whose read noise is mostly the converter's (not ISO-invariant) is then
 * not given its low ISO's σ² times ISO² at a high one, which smooths its
 * shadows away (the engine's review, 2026-10).
 */
export function fitOverIso(
  points: { iso: number; noise: StatedNoise }[],
  iso: number
): StatedNoise {
  const c =
    points.reduce((s, p) => s + p.noise.k * p.iso, 0) /
    points.reduce((s, p) => s + p.iso * p.iso, 0)
  const xs = points.map((p) => p.iso * p.iso)
  const ys = points.map((p) => p.noise.sigma2)
  const n = points.length
  const mx = xs.reduce((s, x) => s + x, 0) / n
  const my = ys.reduce((s, y) => s + y, 0) / n
  const sxx = xs.reduce((s, x) => s + (x - mx) * (x - mx), 0)
  const sxy = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
  let a = sxx > 0 ? sxy / sxx : 0
  let b = my - a * mx
  if (a < 0) {
    a = 0
    b = my
  }
  if (b < 0) {
    b = 0
    a = xs.reduce((s, x, i) => s + x * ys[i], 0) / xs.reduce((s, x) => s + x * x, 0)
  }
  return { k: c * iso, sigma2: Math.max(0, a * iso * iso + b) }
}

/** Why a frame's noise could not be stated: what the photo lacks, or what was never measured. */
export type Unstated = 'no-shot' | 'not-measured'

/**
 * The noise to state for a frame of `shot` the engine cannot read, from
 * what its own camera was measured to have here (since 0.21.0's roster
 * only a Bayer frame whose greens have no line comes this way): at its
 * ISO, the median of the measurements there, unscaled; else, measured at
 * two ISOs or more, fitted over ISO (`fitOverIso`). Never another camera's:
 * a guess from another sensor is the silent second-best the owner ruled
 * out (2026-10-14); the photo is then developed by the released develop,
 * and told why (`why`).
 */
export function statedNoiseFor(
  shot: Shot,
  from: NoiseBook
): { noise: StatedNoise; source: string } | { why: Unstated } {
  if (!shot.iso || shot.iso <= 0 || !shot.camera) return { why: 'no-shot' }
  const iso = Math.round(shot.iso)
  const own = from[shot.camera] ?? {}
  const here = measuredAt(own[String(iso)])
  if (here.length > 0) return { noise: medianOf(here), source: `${shot.camera} at ISO ${iso}` }
  const points = Object.entries(own)
    .map(([k, v]) => ({ iso: Number(k), list: measuredAt(v) }))
    .filter((p) => p.iso > 0 && p.list.length > 0)
    .map((p) => ({ iso: p.iso, noise: medianOf(p.list) }))
    .sort((a, b) => a.iso - b.iso)
  if (points.length < 2) return { why: 'not-measured' }
  return {
    noise: fitOverIso(points, iso),
    source: `${shot.camera}, fitted over ISO ${points.map((p) => p.iso).join(', ')}`
  }
}
