/**
 * An engine development kit (`scripts/engine-dev.mjs`, `pnpm dev:kit`;
 * README, "Running against a development kit"): an engine built from a
 * branch and PIXL's own unreleased models, tried in a development run.
 * `PLAYROOM_DEV_KIT` names its folder; unset (every packaged build),
 * nothing here does anything.
 *
 * With it set, every full-size RAW master says on the console what
 * developed it, where its model ran and how long it took, and the 1:1 view
 * says the same in a line when the master lands: a trial is judged by what
 * ran, never by what was planned.
 */
import type { ExecutionProvider } from '../shared/engine-types'

/** The kit's folder, or null without one. */
export const DEV_KIT = process.env.PLAYROOM_DEV_KIT || null

/** Where a model ran, in a word or two: `CoreMl (CpuAndGpu, static shapes)`, `Cpu`. */
export function providerName(p: ExecutionProvider | null | undefined): string {
  if (!p) return 'no model'
  if (typeof p === 'string') return p
  if ('CoreMl' in p)
    return `CoreMl (${p.CoreMl.units}${p.CoreMl.static_shapes ? ', static shapes' : ''})`
  return Object.keys(p)[0] ?? 'unknown'
}

/** A full-size develop as it ran. */
export interface Developed {
  /** The develop the plan asked for, by tag (`pd`: the PIXL demosaic). */
  planned: string
  /** The develop that made the master: the same, or the one that stood in. */
  ran: string
  provider: string
  ms: number
  /** Why the planned one did not run, in the engine's words. */
  refused?: string | undefined
}

const NAMES: Record<string, string> = {
  pd: 'PIXL demosaic',
  dn: 'DemosaicNet',
  'dn-pm': 'DemosaicNet after PMRID',
  ahd: 'AHD',
  'ahd-pm': 'AHD after PMRID',
  ppg: 'classic demosaic',
  'ppg-pm': 'classic demosaic after PMRID'
}

/** The console's line for a master: its tag, its provider, its wall time. */
export function developedLine(d: Developed): string {
  const stoodIn = d.ran === d.planned ? '' : ` (planned ${d.planned}: ${d.refused ?? 'refused'})`
  return `[dev kit] RAW master ${d.ran}${stoodIn} · ${d.provider} · ${d.ms} ms`
}

/** The 1:1 view's line: "PIXL demosaic · 8.4 s", or what stood in for it. */
export function developedNote(d: Developed): string {
  const took = `${(d.ms / 1000).toFixed(1)} s`
  const ran = NAMES[d.ran] ?? d.ran
  return d.ran === d.planned
    ? `${ran} · ${took}`
    : `${NAMES[d.planned] ?? d.planned} refused: ${ran} instead · ${took}`
}

const last = new Map<number, Developed>()

/** A photo's master was developed just now (said on the console, kept for its note). */
export function noteDeveloped(photoId: number, d: Developed): void {
  if (!DEV_KIT) return
  console.log(developedLine(d))
  last.set(photoId, d)
}

/** The note for a photo's master developed since the last ask, once. */
export function takeDevelopedNote(photoId: number): string | null {
  const d = last.get(photoId)
  if (!d) return null
  last.delete(photoId)
  return developedNote(d)
}
