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

/** Camera → ISO → the noise measured there (the latest). */
export type NoiseBook = Record<string, Record<string, StatedNoise>>

const median = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * The frame's noise as one statement from its planes: the median of the
 * planes the engine fitted (a plane it could not fit, `fit: null`, is left
 * out), or null when none was fitted (a stated develop says nothing new).
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

/**
 * The noise to state for a frame of `shot` the engine cannot read: what this
 * camera was measured at this ISO; else at its nearest ISO, scaled (shot
 * noise grows with the gain, `k ∝ ISO`; the read noise as its square, `σ² ∝
 * ISO²`, to first order); else, from any camera's nearest ISO, scaled the
 * same way (sensors differ, but by far less than an unread frame costs).
 * Null with nothing measured yet, or no ISO to go by.
 */
export function statedNoiseFor(
  shot: Shot,
  from: NoiseBook
): { noise: StatedNoise; source: string } | null {
  if (!shot.iso || shot.iso <= 0) return null
  const iso = shot.iso
  const nearest = (
    entries: [string, StatedNoise][]
  ): { iso: number; noise: StatedNoise } | null => {
    let best: { iso: number; noise: StatedNoise } | null = null
    for (const [k, v] of entries) {
      const at = Number(k)
      if (!(at > 0)) continue
      if (!best || Math.abs(Math.log(at / iso)) < Math.abs(Math.log(best.iso / iso)))
        best = { iso: at, noise: v }
    }
    return best
  }
  const scaled = (at: { iso: number; noise: StatedNoise }): StatedNoise => {
    const r = iso / at.iso
    return { k: at.noise.k * r, sigma2: at.noise.sigma2 * r * r }
  }
  const own = shot.camera ? from[shot.camera] : undefined
  if (own) {
    const at = nearest(Object.entries(own))
    if (at)
      return {
        noise: scaled(at),
        source:
          at.iso === iso
            ? `${shot.camera} at ISO ${iso}`
            : `${shot.camera} at ISO ${at.iso}, scaled to ${iso}`
      }
  }
  const all: [string, StatedNoise][] = []
  const whose = new Map<string, string>()
  for (const [camera, isos] of Object.entries(from))
    for (const [k, v] of Object.entries(isos)) {
      all.push([k, v])
      whose.set(k, camera)
    }
  const any = nearest(all)
  if (!any) return null
  return {
    noise: scaled(any),
    source: `another camera (${whose.get(String(any.iso))}) at ISO ${any.iso}, scaled to ${iso}`
  }
}
