/**
 * Cull signals (engine 0.19's guide §1c): what the engine measures of each
 * photo, kept so Playroom can suggest rejects (Pass 115). The engine
 * measures; Playroom decides; Gemma never judges.
 *
 * - Exposure: `analyze`'s luma percentiles and clipped fractions.
 * - Focus: `analyze`'s `focus` (Laplacian variance, gradient energy) over
 *   the whole frame and inside the subject (U²-Netp's plane as the region):
 *   a sharp background behind a soft subject is the case that matters.
 * - Motion blur: the same report's coherence and angle (high coherence with
 *   low energy: the picture smeared one way).
 * - Blink: Face Mesh's `eyeBlinkLeft`/`Right` per face, **a hint only**
 *   (unmeasured; which eye "Left" is, unverified).
 * - Duplicates: `analyze`'s `phash`, compared by Hamming distance.
 *
 * Pure, for tests/cull.test.ts.
 */
import type { FocusRegionReport, ImageStats } from './engine-types'

/** Bumped when what is measured changes: older signals are measured again. */
export const CULL_VERSION = 1

/** The picture measured: the photo unedited, upright, this long on its long side. */
export const CULL_EDGE = 2048

/** Orientation histogram bins asked of `focus`. */
export const FOCUS_BINS = 8

/** Hamming distance on the 64-bit phash: the same photo at most this (the guide's test pictures). */
export const SAME_PHOTO_BITS = 10
/** Distinct photos measured at least this far apart; between the two, near (a burst). */
export const DISTINCT_BITS = 12

export interface FocusSignal {
  /** Laplacian variance: fine detail. */
  laplacian: number
  /** Gradient energy: edges of any size. */
  energy: number
  /** The structure tensor's coherence, 0..1: one direction dominating. */
  coherence: number
  /** The dominant gradient's angle, degrees (a motion blur runs perpendicular to it). */
  angle: number
}

export interface FaceSignal {
  /** `[x, y, width, height]` as fractions of the frame. */
  bounds: [number, number, number, number]
  /** `eyeBlinkLeft` / `eyeBlinkRight`, 0..1: a hint only. */
  blinkLeft: number | null
  blinkRight: number | null
}

export interface CullSignals {
  v: typeof CULL_VERSION
  /** ISO time measured. */
  at: string
  exposure: {
    mean: number
    /** Luma percentiles 1, 5, 50, 95, 99 (encoded, 0..1). */
    p1: number
    p5: number
    p50: number
    p95: number
    p99: number
    /** Fractions of pixels at the floor and at the ceiling (any channel's luma). */
    clipLow: number
    clipHigh: number
  }
  focus: {
    whole: FocusSignal
    /** Inside the subject, when the subject model is here and found one. */
    subject: FocusSignal | null
    /** The subject's share of the frame, 0..1 (null: not looked for). */
    subjectShare: number | null
  }
  /** Null: the face models aren't here (or AI is off); [] none found. */
  faces: FaceSignal[] | null
  /** 16 hex digits. */
  phash: string | null
  /** Milliseconds it took, for the benchmarks. */
  ms: number
}

/** The luma percentiles asked of `analyze`, in `exposure`'s order. */
export const CULL_PERCENTILES = [1, 5, 50, 95, 99]

/** A luma at or under this counts as crushed, at or over the other as blown (encoded 8-bit steps). */
export const CLIP_LOW = 1 / 255
export const CLIP_HIGH = 254 / 255

export function focusOf(r: FocusRegionReport | undefined | null): FocusSignal | null {
  if (!r) return null
  return {
    laplacian: r.laplacian_variance,
    energy: r.gradient_energy,
    coherence: r.coherence,
    angle: r.gradient_angle_deg
  }
}

/** `analyze`'s report as the exposure signal. */
export function exposureOf(s: ImageStats): CullSignals['exposure'] {
  const at = (p: number): number => {
    const hit = s.luma_percentiles.find((x) => Math.abs(x.percentile - p) < 1e-6)
    return hit ? hit.value / (s.range_max || 1) : NaN
  }
  // The clipped fractions are per channel: the worst channel says it.
  const worst = (xs: number[]): number => xs.reduce((m, x) => Math.max(m, x), 0)
  return {
    mean: s.luma_mean / (s.range_max || 1),
    p1: at(1),
    p5: at(5),
    p50: at(50),
    p95: at(95),
    p99: at(99),
    clipLow: worst(s.clipped_low),
    clipHigh: worst(s.clipped_high)
  }
}

/** One face's blink scores from its blendshapes (null when the graph gave none). */
export function blinkOf(
  blendshapes: { name: string; score: number }[] | null | undefined
): Pick<FaceSignal, 'blinkLeft' | 'blinkRight'> {
  const score = (name: string): number | null =>
    blendshapes?.find((b) => b.name === name)?.score ?? null
  return { blinkLeft: score('eyeBlinkLeft'), blinkRight: score('eyeBlinkRight') }
}

/** Bits that differ between two 16-hex-digit hashes; null when either is missing or malformed. */
export function phashDistance(a: string | null, b: string | null): number | null {
  if (!a || !b || !/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) return null
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let n = 0
  while (x) {
    n += Number(x & 1n)
    x >>= 1n
  }
  return n
}

/**
 * Photos that are the same picture (a burst, a copy): groups of two or more
 * whose hashes are each within `bits` of another in the group (single
 * linkage), in the order given. Photos without a hash are left out.
 */
export function phashGroups<T extends { phash: string | null }>(
  photos: T[],
  bits = SAME_PHOTO_BITS
): T[][] {
  const n = photos.length
  const parent = photos.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = phashDistance(photos[i].phash, photos[j].phash)
      if (d !== null && d <= bits) parent[find(j)] = find(i)
    }
  const groups = new Map<number, T[]>()
  photos.forEach((p, i) => {
    if (!p.phash) return
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), p])
  })
  return [...groups.values()].filter((g) => g.length > 1)
}

/** Which models a measurement could use: one that arrives later (or AI turned on) measures it again. */
export interface CullModels {
  subject: boolean
  faces: boolean
}

/** What a measurement is current for: the file's version, what is measured, and with which models. */
export function cullKey(mtime: number, size: number, models: CullModels): string {
  return `${mtime}:${size}:v${CULL_VERSION}:${models.subject ? 's' : ''}${models.faces ? 'f' : ''}`
}

/** Signals read back from the index: anything odd is none. */
export function readCull(v: string | null | undefined): CullSignals | null {
  if (!v) return null
  try {
    const o = JSON.parse(v) as CullSignals
    return o && o.v === CULL_VERSION && o.exposure && o.focus ? o : null
  } catch {
    return null
  }
}
