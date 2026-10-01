/**
 * Opt-in crash reporting. Native crashes (any process) go through Electron's
 * crashReporter as minidumps; JavaScript errors, unhandled rejections and
 * processes that die abnormally go as small JSON reports, scrubbed of the home
 * folder (shared/crash.ts). Everything is logged locally either way; nothing
 * leaves the machine until the user says yes (settings.json `crashReports`,
 * asked once at first launch, changeable in Settings). Problem reports are
 * the user's own, sent when they press Send (Settings → Report a problem).
 */
import { app, crashReporter, dialog } from 'electron'
import log from 'electron-log/main'
import { open } from 'fs/promises'
import { homedir, release } from 'os'
import {
  CRASH_ENDPOINT,
  errorPayload,
  MAX_PROBLEM_LOG,
  MAX_REPORTS_PER_RUN,
  PROBLEM_ENDPOINT,
  problemPayload,
  type ErrorPayload,
  type ProblemInput
} from '../shared/crash'
import type { CrashConsent, ErrorReport } from '../shared/ipc'
import { readSettings, writeSettings } from './settings'

/** Automation runs never report. */
const hidden = process.env['PLAYROOM_HIDDEN'] === '1'
let consent: CrashConsent = 'unset'
let sent = 0

/** Reasons a process ends that are not a fault: a clean exit, or one we killed (an AI job cancelled). */
const BENIGN = new Set(['clean-exit', 'killed'])

function homes(): string[] {
  return [...new Set([homedir(), app.getPath('home')])]
}

function send(p: Omit<ErrorPayload, 'at' | 'version' | 'platform' | 'arch'>): void {
  if (consent !== 'on' || hidden || sent >= MAX_REPORTS_PER_RUN) return
  sent++
  const body = errorPayload(
    { ...p, version: app.getVersion(), platform: process.platform, arch: process.arch },
    homes()
  )
  fetch(CRASH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  }).catch((err) => log.warn('crash report not sent', err))
}

/** Automation reads as a no: it never reports, and never asks (the question would be in every screenshot). */
export function crashConsent(): CrashConsent {
  return hidden ? 'off' : consent
}

export function setCrashConsent(next: CrashConsent): CrashConsent {
  if (next !== 'on' && next !== 'off') return consent
  consent = writeSettings({ crashReports: next }).crashReports
  crashReporter.setUploadToServer(consent === 'on' && !hidden)
  log.info(`crash reports ${consent}`)
  return consent
}

/** The end of the main log (electron-log's file), or null when it can't be read. */
async function logTail(): Promise<string | null> {
  const path = log.transports.file.getFile()?.path
  if (!path) return null
  try {
    const f = await open(path, 'r')
    try {
      const { size } = await f.stat()
      // Bytes, not characters: a little more than the payload keeps, so it
      // can still start at a whole line.
      const length = Math.min(size, Math.round(MAX_PROBLEM_LOG * 1.1))
      const buf = Buffer.alloc(length)
      await f.read(buf, 0, length, size - length)
      return buf.toString('utf8')
    } finally {
      await f.close()
    }
  } catch (err) {
    log.warn('problem report: the log could not be read', err)
    return null
  }
}

/** Send a problem report the user wrote; resolves to the reference the server gives it. */
export async function sendProblemReport(
  input: ProblemInput,
  engineVersion?: string
): Promise<string> {
  if (!input.message?.trim()) throw new Error('Describe the problem first.')
  const body = problemPayload(
    input,
    {
      version: app.getVersion(),
      ...(engineVersion ? { engine: engineVersion } : {}),
      platform: process.platform,
      arch: process.arch,
      os: release()
    },
    input.includeLog ? await logTail() : null,
    homes()
  )
  let res: Response
  try {
    res = await fetch(PROBLEM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    })
  } catch (err) {
    log.warn('problem report not sent', err)
    throw new Error("Couldn't send the report. Check your connection and try again.")
  }
  if (res.status === 429) throw new Error('Too many reports just now. Try again in a minute.')
  const answer = (await res.json().catch(() => null)) as { reference?: string } | null
  if (!res.ok || !answer?.reference) {
    throw new Error(`The report server answered ${res.status}. Try again later.`)
  }
  log.info(`problem report sent: ${answer.reference}`)
  return answer.reference
}

/** An uncaught error in the renderer (it sends them over IPC). */
export function reportRendererError(e: ErrorReport): void {
  log.error(`renderer ${e.kind}: ${e.message}${e.stack ? `\n${e.stack}` : ''}`)
  send({
    kind: e.kind === 'rejection' ? 'renderer-rejection' : 'renderer',
    message: String(e.message),
    stack: e.stack
  })
}

/**
 * Start crash reporting. Call as early as possible, before ready and after
 * userData is settled, so the crash reporter covers every process from the start.
 */
export function startCrashReporting(): void {
  consent = readSettings().crashReports
  crashReporter.start({
    submitURL: CRASH_ENDPOINT,
    uploadToServer: consent === 'on' && !hidden,
    compress: true,
    globalExtra: { _productName: 'Pixl Playroom', _version: app.getVersion() }
  })

  process.on('uncaughtException', (err) => {
    log.error('uncaught exception in main', err)
    send({ kind: 'main', message: err.message, stack: err.stack })
    // What Electron shows without a handler, so a fault is still visible.
    if (!hidden)
      dialog.showErrorBox(
        'A JavaScript error occurred in the main process',
        err.stack ?? err.message
      )
  })
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason))
    log.error('unhandled rejection in main', err)
    send({ kind: 'rejection', message: err.message, stack: err.stack })
  })
  app.on('render-process-gone', (_e, _wc, d) => {
    if (BENIGN.has(d.reason)) return
    log.error(`renderer gone: ${d.reason} (${d.exitCode})`)
    send({
      kind: 'process-gone',
      message: `renderer ${d.reason}`,
      process: { type: 'renderer', reason: d.reason, exitCode: d.exitCode }
    })
  })
  app.on('child-process-gone', (_e, d) => {
    if (BENIGN.has(d.reason)) return
    log.error(`${d.type} process gone: ${d.reason} (${d.exitCode})${d.name ? ` ${d.name}` : ''}`)
    send({
      kind: 'process-gone',
      message: `${d.type} ${d.reason}`,
      process: { type: d.type, reason: d.reason, exitCode: d.exitCode, name: d.name }
    })
  })
}
