/**
 * Crash reports: what leaves the machine when the user has opted in. Pure, so
 * the scrubbing can be tested: a report never carries the user's home folder
 * (their name is usually in it) or the photo paths under it.
 */

/** Where crash reports go: kept in R2 for the privacy policy's period (pixl-web worker/api.ts). */
export const CRASH_ENDPOINT = 'https://pixlfoundation.com/api/crash'
/** Where problem reports the user writes (Settings → Report a problem) go. */
export const PROBLEM_ENDPOINT = 'https://pixlfoundation.com/api/report'

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
export function scrub(text: string, homes: string[], max = MAX_TEXT): string {
  let out = text
  for (const home of homes.filter((h) => h.length > 1)) {
    const variants = new Set([home, home.replace(/\\/g, '/'), home.replace(/\//g, '\\')])
    for (const v of variants) out = out.replace(new RegExp(escape(v), 'gi'), '~')
  }
  out = out.replace(/file:\/\/\/?[^\s)'"]*[\\/]([^\\/\s)'"]+)/g, 'file://…/$1')
  return out.length > max ? `${out.slice(0, max)}…` : out
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

/** The longest problem description accepted (the Worker refuses more). */
export const MAX_PROBLEM_TEXT = 5_000
/** How much of the log's end a problem report carries. */
export const MAX_PROBLEM_LOG = 200_000

/** What the user fills in. */
export interface ProblemInput {
  message: string
  /** For a reply; optional. */
  email?: string
  /** Send the end of the app's log too. */
  includeLog: boolean
}

export interface ProblemPayload {
  app: 'playroom'
  message: string
  email?: string
  log?: string
  version: string
  engine?: string
  platform: string
  arch: string
  /** The OS release (Darwin, Windows NT version). */
  os: string
  at: string
}

/**
 * A problem report ready to send: the user's words as written (they chose
 * them) but trimmed, and the log's end scrubbed of the home folder, starting
 * at a whole line.
 */
export function problemPayload(
  input: ProblemInput,
  about: Pick<ProblemPayload, 'version' | 'engine' | 'platform' | 'arch' | 'os'>,
  log: string | null,
  homes: string[],
  at = new Date().toISOString()
): ProblemPayload {
  const message = input.message.trim().slice(0, MAX_PROBLEM_TEXT)
  const email = input.email?.trim()
  let tail: string | undefined
  if (input.includeLog && log) {
    const cut = log.length > MAX_PROBLEM_LOG ? log.slice(-MAX_PROBLEM_LOG) : log
    const start = log.length > MAX_PROBLEM_LOG ? cut.indexOf('\n') + 1 : 0
    tail = scrub(cut.slice(start), homes, MAX_PROBLEM_LOG)
  }
  return {
    app: 'playroom',
    message,
    ...(email ? { email } : {}),
    ...(tail ? { log: tail } : {}),
    ...about,
    at
  }
}
