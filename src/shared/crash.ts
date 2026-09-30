/**
 * Crash reports: what leaves the machine when the user has opted in. Pure, so
 * the scrubbing can be tested: a report never carries the user's home folder
 * (their name is usually in it) or the photo paths under it.
 */

/** Where reports go. The Worker behind it only acknowledges them for now (see pixl-web). */
export const CRASH_ENDPOINT = 'https://pixlfoundation.com/api/crash'

/** At most this many error reports per run: a loop that throws should not flood anyone. */
export const MAX_REPORTS_PER_RUN = 10

const MAX_TEXT = 8_000

export interface ErrorPayload {
  kind: 'main' | 'renderer' | 'rejection' | 'renderer-rejection' | 'process-gone'
  message: string
  stack?: string
  /** For a process that went: its type (renderer, utility…) and why. */
  process?: { type: string; reason: string; exitCode?: number; name?: string }
  version: string
  platform: string
  arch: string
  /** When, in ISO 8601. */
  at: string
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `text` with each of `homes` replaced by `~` (either slash direction, any
 * case on Windows), and any `file://` URL reduced to its file name.
 */
export function scrub(text: string, homes: string[]): string {
  let out = text
  for (const home of homes.filter((h) => h.length > 1)) {
    const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])
    for (const v of variants) out = out.replace(new RegExp(escape(v), 'gi'), '~')
  }
  out = out.replace(/file:\/\/\/?[^\s)'"]*[\\/]([^\\/\s)'"]+)/g, 'file://…/$1')
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}…` : out
}

/** A report ready to send: scrubbed, and trimmed to what it needs. */
export function errorPayload(
  p: Omit<ErrorPayload, 'at'> & { at?: string },
  homes: string[]
): ErrorPayload {
  return {
    ...p,
    message: scrub(p.message, homes),
    ...(p.stack ? { stack: scrub(p.stack, homes) } : {}),
    at: p.at ?? new Date().toISOString()
  }
}
