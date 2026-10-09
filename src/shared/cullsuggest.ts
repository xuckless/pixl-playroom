/**
 * Cull suggestions (Pass 115): which photos look like rejects, and why, in
 * words from a template ("Subject soft · focus 18% of the burst's best").
 * The engine measured (shared/cull.ts); Playroom decides here; Gemma never
 * judges. A suggestion is only that: it is shown, never acted on, and
 * nothing is ever deleted.
 *
 * - The user's word wins for good: a star (any), a pick or "Keep" means
 *   never suggested; a photo already rejected isn't suggested either.
 * - Focus is compared where it means something: within a burst (the same
 *   picture by its hash, so the same content), and the subject against its
 *   own background (a sharp background behind a soft subject). Absolute
 *   sharpness across different photos says little.
 * - The thresholds learn from the user's own keeps and rejects
 *   (`learnThresholds`), each kept within bounds.
 *
 * Pure, for tests/cullsuggest.test.ts.
 */
import { phashDistance, phashGroups, type CullSignals } from './cull'

export type CullReasonKind = 'soft' | 'motion' | 'dark' | 'bright' | 'eyes' | 'duplicate'

export interface CullReason {
  kind: CullReasonKind
  /** In the user's words, from the template. */
  text: string
}

export interface CullThresholds {
  /** In a burst: focus under this share of the burst's best is soft. */
  burstSoft: number
  /** The subject's focus under this share of the whole frame's: the subject is soft. */
  subjectSoft: number
  /** In a burst: coherence at or over this, with focus under `burstMotion` of the best, is motion blur. */
  motionCoherence: number
  burstMotion: number
  /** Median luma under this, or crushed blacks over `darkCrushed`: too dark. */
  darkMedian: number
  darkCrushed: number
  /** Blown highlights over this share of the frame: too bright. */
  brightBlown: number
  /** Both eyes' blink over this on a face: eyes closed? (a hint). */
  blink: number
  /** In a burst: this close by hash, and nearly as sharp as the best, is a duplicate of it. */
  duplicateBits: number
}

export const DEFAULT_THRESHOLDS: CullThresholds = {
  burstSoft: 0.35,
  subjectSoft: 0.2,
  motionCoherence: 0.6,
  burstMotion: 0.6,
  darkMedian: 0.05,
  darkCrushed: 0.3,
  brightBlown: 0.25,
  blink: 0.6,
  duplicateBits: 4
}

/** How far learning may move each threshold. */
export const THRESHOLD_BOUNDS: Record<
  'burstSoft' | 'subjectSoft' | 'darkMedian' | 'brightBlown' | 'blink',
  [number, number]
> = {
  burstSoft: [0.15, 0.7],
  subjectSoft: [0.08, 0.5],
  darkMedian: [0.02, 0.15],
  brightBlown: [0.08, 0.5],
  blink: [0.4, 0.9]
}

/** Each side needs this many of the user's decisions before a threshold moves. */
export const MIN_SAMPLES = 5

export interface CullInput {
  photoId: number
  name: string
  rating: number
  flag: 'pick' | 'reject' | null
  /** The user said Keep. */
  keep: boolean
  signals: CullSignals | null
}

/** The user has spoken for it: a star, a pick, Keep, or a reject already. */
export function decided(i: Pick<CullInput, 'rating' | 'flag' | 'keep'>): boolean {
  return i.rating > 0 || i.flag !== null || i.keep
}

/** The focus that counts: the subject's when there is one, else the frame's (Laplacian variance). */
export function focusScore(s: CullSignals): number {
  return (s.focus.subject ?? s.focus.whole).laplacian
}

const pct = (x: number): string => `${Math.round(x * 100)}%`

/**
 * The suggestions: each undecided photo that looks like a reject, with its
 * reasons, by photo id. Photos without signals are left out.
 */
export function suggestRejects(
  inputs: CullInput[],
  t: CullThresholds = DEFAULT_THRESHOLDS
): Map<number, CullReason[]> {
  const out = new Map<number, CullReason[]>()
  const add = (id: number, r: CullReason): void => {
    const list = out.get(id) ?? []
    if (!list.some((x) => x.kind === r.kind)) list.push(r)
    out.set(id, list)
  }
  const measured = inputs.filter((i) => i.signals)
  // Bursts: the same picture by its hash; the best is the one the user
  // starred or picked, else the sharpest.
  const groups = phashGroups(measured.map((i) => ({ ...i, phash: i.signals!.phash })))
  for (const g of groups) {
    // The user's choice (a star, a pick) is the best; Keep only says "not a
    // reject", so it chooses nothing.
    const chosen = (i: CullInput): number => Number(i.rating > 0 || i.flag === 'pick')
    const best = [...g].sort(
      (a, b) => chosen(b) - chosen(a) || focusScore(b.signals!) - focusScore(a.signals!)
    )[0]
    const top = Math.max(...g.map((i) => focusScore(i.signals!)))
    for (const i of g) {
      if (i === best || decided(i)) continue
      const s = i.signals!
      const share = top > 0 ? focusScore(s) / top : 1
      const where = s.focus.subject ? 'Subject soft' : 'Soft'
      if (share < t.burstSoft)
        add(i.photoId, { kind: 'soft', text: `${where} · focus ${pct(share)} of the burst’s best` })
      else if (s.focus.whole.coherence >= t.motionCoherence && share < t.burstMotion)
        add(i.photoId, {
          kind: 'motion',
          text: `Motion blur · focus ${pct(share)} of the burst’s best`
        })
      const d = phashDistance(s.phash, best.signals!.phash)
      if (d !== null && d <= t.duplicateBits && share >= 0.9)
        add(i.photoId, { kind: 'duplicate', text: `Duplicate of ${best.name}` })
    }
  }
  for (const i of measured) {
    if (decided(i)) continue
    const s = i.signals!
    const sub = s.focus.subject
    if (
      sub &&
      s.focus.whole.laplacian > 0 &&
      sub.laplacian / s.focus.whole.laplacian < t.subjectSoft
    )
      add(i.photoId, { kind: 'soft', text: 'Subject soft · the background is sharper' })
    const e = s.exposure
    if (e.p50 < t.darkMedian || e.clipLow > t.darkCrushed)
      add(i.photoId, { kind: 'dark', text: `Too dark · ${pct(e.clipLow)} crushed` })
    else if (e.clipHigh > t.brightBlown)
      add(i.photoId, { kind: 'bright', text: `Too bright · ${pct(e.clipHigh)} blown` })
    for (const f of s.faces ?? []) {
      const closed = Math.min(f.blinkLeft ?? 0, f.blinkRight ?? 0)
      if (closed >= t.blink) {
        add(i.photoId, { kind: 'eyes', text: `Eyes closed? (${closed.toFixed(2)})` })
        break
      }
    }
  }
  return out
}

/**
 * The threshold that best tells the user's keeps from their rejects on one
 * measure (`rejectBelow`: a reject has the smaller value), or null when there
 * are too few of either. Balanced accuracy over the measured values, the cut
 * halfway between neighbours, kept within `bounds`.
 */
export function fitThreshold(
  kept: number[],
  rejected: number[],
  rejectBelow: boolean,
  bounds: [number, number]
): number | null {
  if (kept.length < MIN_SAMPLES || rejected.length < MIN_SAMPLES) return null
  const values = [...new Set([...kept, ...rejected])].sort((a, b) => a - b)
  let best: { cut: number; score: number } | null = null
  for (let k = 0; k + 1 < values.length; k++) {
    const cut = (values[k] + values[k + 1]) / 2
    const isReject = (v: number): boolean => (rejectBelow ? v < cut : v > cut)
    const tpr = rejected.filter(isReject).length / rejected.length
    const tnr = kept.filter((v) => !isReject(v)).length / kept.length
    const score = (tpr + tnr) / 2
    if (!best || score > best.score) best = { cut, score }
  }
  if (!best || best.score <= 0.5) return null
  return Math.min(bounds[1], Math.max(bounds[0], best.cut))
}

/** The user's decided photos, as samples: kept (a star, a pick, Keep) or rejected. */
export interface CullSample {
  rejected: boolean
  signals: CullSignals
  /** Its share of its burst's best focus, when it is in one. */
  burstShare: number | null
}

/** The samples from the user's decided photos: who in a burst, and how sharp against its best. */
export function samplesOf(inputs: CullInput[]): CullSample[] {
  const measured = inputs.filter((i) => i.signals)
  const share = new Map<number, number>()
  for (const g of phashGroups(measured.map((i) => ({ ...i, phash: i.signals!.phash })))) {
    const top = Math.max(...g.map((i) => focusScore(i.signals!)))
    for (const i of g) share.set(i.photoId, top > 0 ? focusScore(i.signals!) / top : 1)
  }
  return measured
    .filter((i) => decided(i))
    .map((i) => ({
      rejected: i.flag === 'reject',
      signals: i.signals!,
      burstShare: share.get(i.photoId) ?? null
    }))
}

/** The thresholds, moved where the user's own keeps and rejects say (the rest as they were). */
export function learnThresholds(
  samples: CullSample[],
  base: CullThresholds = DEFAULT_THRESHOLDS
): CullThresholds {
  const side = (f: (s: CullSample) => number | null): { kept: number[]; rejected: number[] } => {
    const kept: number[] = []
    const rejected: number[] = []
    for (const s of samples) {
      const v = f(s)
      if (v === null || !Number.isFinite(v)) continue
      ;(s.rejected ? rejected : kept).push(v)
    }
    return { kept, rejected }
  }
  const fit = (
    key: keyof typeof THRESHOLD_BOUNDS,
    f: (s: CullSample) => number | null,
    rejectBelow: boolean
  ): number => {
    const { kept, rejected } = side(f)
    return fitThreshold(kept, rejected, rejectBelow, THRESHOLD_BOUNDS[key]) ?? base[key]
  }
  return {
    ...base,
    burstSoft: fit('burstSoft', (s) => s.burstShare, true),
    subjectSoft: fit(
      'subjectSoft',
      (s) =>
        s.signals.focus.subject && s.signals.focus.whole.laplacian > 0
          ? s.signals.focus.subject.laplacian / s.signals.focus.whole.laplacian
          : null,
      true
    ),
    darkMedian: fit('darkMedian', (s) => s.signals.exposure.p50, true),
    brightBlown: fit('brightBlown', (s) => s.signals.exposure.clipHigh, false),
    blink: fit(
      'blink',
      (s) =>
        s.signals.faces && s.signals.faces.length
          ? Math.max(...s.signals.faces.map((f) => Math.min(f.blinkLeft ?? 0, f.blinkRight ?? 0)))
          : null,
      false
    )
  }
}
