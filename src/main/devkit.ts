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
 * ran, never by what was planned. Without it, only a develop that stood in
 * for the planned one is said (in every build).
 */
import type { ExecutionProvider } from '../shared/engine-types'
import { developedLine, standInNote } from '../shared/develops'
import { DEV_BUILD } from './build'

/**
 * The kit's folder, or null without one. A development build's only
 * (build.ts), and never in a packaged app (`defaultApp`: Electron started
 * on a folder or a script, which a packaged app never is), whatever its
 * environment says.
 */
export const DEV_KIT = (DEV_BUILD && process.defaultApp && process.env.PLAYROOM_DEV_KIT) || null

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
  /** The planned one was the user's no to the processor, not a refusal. */
  declined?: boolean | undefined
}

/** The console's line for a master: its tag, its provider, its wall time. */
export function developedConsoleLine(d: Developed): string {
  const stoodIn = d.ran === d.planned ? '' : ` (planned ${d.planned}: ${d.refused ?? 'declined'})`
  return `[dev kit] RAW master ${d.ran}${stoodIn} · ${d.provider} · ${d.ms} ms`
}

/** The 1:1 view's line: "PIXL demosaic · 8.4 s", or what stood in for it and why. */
export function developedNote(d: Developed): string {
  if (d.ran === d.planned) return developedLine(d.ran, d.ms)
  return standInNote(d.planned, d.ran, d.declined ? null : (d.refused ?? ''))
}

const last = new Map<number, Developed>()

/**
 * A photo's master was developed just now. Another develop standing in is
 * the user's to know, always (engine 0.20.0 guide §3); a develop as planned
 * is said only on a development kit's trial (and on its console).
 */
export function noteDeveloped(photoId: number, d: Developed): void {
  if (DEV_KIT) console.log(developedConsoleLine(d))
  if (DEV_KIT || d.ran !== d.planned) last.set(photoId, d)
}

/** The note for a photo's master developed since the last ask, once. */
export function takeDevelopedNote(photoId: number): string | null {
  const d = last.get(photoId)
  if (!d) return null
  last.delete(photoId)
  return developedNote(d)
}
