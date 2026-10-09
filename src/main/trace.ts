/**
 * An opt-in trace of what Playroom asks the engine for a 1:1 view
 * (`PLAYROOM_TRACE_REGION=1`): one JSON line per step, appended to
 * `<userData>/region-trace.jsonl`, for the engine's own measurements (the
 * owner, 2026-10-09: the first 1:1 of a RAW took 14.8 s). Off, nothing is
 * written and nothing is measured.
 */
import { appendFile } from 'fs/promises'
import { join } from 'path'

export const TRACE_REGION = process.env.PLAYROOM_TRACE_REGION === '1'

/** Large pixel buffers and the like left out: what the request and report say, not their bytes. */
function slim(_k: string, v: unknown): unknown {
  if (v && typeof v === 'object' && ArrayBuffer.isView(v)) return `<${v.byteLength} bytes>`
  return v
}

export function traceRegion(event: Record<string, unknown>): void {
  if (!TRACE_REGION) return
  const line = JSON.stringify({ at: new Date().toISOString(), ...event }, slim)
  // Electron only when tracing: the modules that trace are loaded by plain Node in tests.
  void import('electron')
    .then(({ app }) => appendFile(join(app.getPath('userData'), 'region-trace.jsonl'), `${line}\n`))
    .catch(() => undefined)
}
