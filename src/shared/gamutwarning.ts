/**
 * The gamut warning (soft proofing's first part, engine 0.21's E22): where
 * the picture holds colours the export's space cannot, by the engine's
 * per-pixel ΔE2000 between the picture and what that space makes of it.
 * The space is the one the Export dialog starts with (its last settings,
 * else the default), so the warning answers "what will my export lose?".
 * Pure, for main, the loupe's overlay and the tests.
 */
import type { RenderingIntent } from './engine-types'
import { normaliseExportSettings, type ExportSettings } from './export'

/** What the plane's full scale stands for, in ΔE2000: room to show how far past the threshold. */
export const GAMUT_SCALE = 4
/** A colour this far (ΔE2000) or more from its rendition in the export's space is marked. */
export const GAMUT_THRESHOLD = 2

/** The space the warning proofs against, with how the export would reach it. */
export interface SoftProofTarget {
  to: ExportSettings['colorSpace']
  intent: RenderingIntent
  black_point_compensation: boolean
}

/** The Export dialog's starting settings (`export.last`, or the default): the space proofed against. */
export function softProofTarget(last: unknown): SoftProofTarget {
  const s = normaliseExportSettings((last ?? null) as Partial<ExportSettings> | null)
  return {
    to: s.colorSpace,
    intent: s.intent,
    black_point_compensation: s.blackPointCompensation
  }
}

/** A space's name as the Export dialog shows it (a proper name, never translated). */
export const SPACE_NAME: Record<ExportSettings['colorSpace'], string> = {
  Srgb: 'sRGB',
  DisplayP3: 'Display P3',
  AdobeRgb: 'Adobe RGB',
  Rec2020: 'Rec.2020'
}

/**
 * How strongly the overlay marks a pixel from the plane's value `v` (0…1 of
 * `GAMUT_SCALE`): nothing under the threshold, then a clear mark that
 * deepens to the scale's end, so a colour far outside reads stronger than
 * one just past it.
 */
export function gamutAlpha(v: number): number {
  const dE = v * GAMUT_SCALE
  if (!(dE >= GAMUT_THRESHOLD)) return 0
  const k = Math.min(1, (dE - GAMUT_THRESHOLD) / (GAMUT_SCALE - GAMUT_THRESHOLD))
  return 0.55 + 0.35 * k
}

/** The warning's colour: a green no other overlay uses (clipping is red and blue, headroom amber). */
export const GAMUT_COLOUR: readonly [number, number, number] = [40, 230, 150]
