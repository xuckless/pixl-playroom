/**
 * PIXL's own demosaic (engine 0.20.0): one model for the whole route from a
 * noisy mosaic to RGB, so nothing denoises the mosaic before it (PMRID is
 * never stacked on it). Offered by 0.20.0's roster, or before its release
 * a development kit's (`scripts/engine-dev.mjs`, `pnpm dev:kit`); a roster
 * with neither id reaches none of this.
 *
 * Pure, for tests/rawdevelop.test.ts.
 */
import type { RawCfa } from './engine-types'

export const PIXL_DEMOSAIC: Record<RawCfa, string> = {
  Bayer: 'pixl-demosaic-v1-bayer',
  XTrans: 'pixl-demosaic-v1-xtrans'
}

/** Whether a roster offers it at all: its switch shows in Settings only then. */
export function offersPixlDemosaic(models: readonly { id: string }[]): boolean {
  const ids = Object.values(PIXL_DEMOSAIC)
  return models.some((m) => ids.includes(m.id))
}

/**
 * Whether a RAW with this filter is developed at full size by the PIXL
 * demosaic now: offered for it, downloaded, and its switch on (Settings →
 * AI models, `AiSwitches.pixlDemosaic`). What main plans the same way
 * (`ai/rawdevelop.ts` `scenePlan`), for the panels.
 */
export function pixlDemosaicActive(
  cfa: RawCfa | null | undefined,
  models: readonly { id: string; installed: boolean }[],
  on: boolean
): boolean {
  if (!cfa || !on) return false
  return models.find((m) => m.id === PIXL_DEMOSAIC[cfa])?.installed === true
}
