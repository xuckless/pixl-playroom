/**
 * Everything working in the background, as one list for the top bar's
 * indicator: AI jobs on any photo (naming, denoise, enhance, masks, a look's
 * batch), exports (queued, running, and the receipts of those just done),
 * the app's global jobs, and model downloads. Work the user waits on in
 * place (a click-to-select, a loupe job) keeps its own feedback and isn't
 * here.
 */
import type { AiJobEvent } from '../../../shared/ai'
import type { ExportProgress, ModelInfo } from '../../../shared/ipc'
import type { Job } from '../state/busy'
// Straight from shared (not ./i18n): tested in Node, without the preload's bridge.
import { t, tp } from '../../../shared/i18n'

/** How long a finished export says how it went in the pill, before it is only a dot. */
export const RECEIPT_SHOWN_MS = 8000

/** How a finished export went: all written, some failed, none written. */
export type Outcome = 'ok' | 'partial' | 'failed'

export interface Activity {
  id: string
  /** What runs: "Enhancing ×2", "Downloading NAFNet". */
  title: string
  /** Which photo, for an AI job. */
  name?: string
  /** 0…1 when known. */
  progress: number | null
  /** Waiting its turn behind another. */
  queued: boolean
  /** An AI job's photo, to go to it. */
  key?: string
  /** How to stop it, when it can be. */
  stop?: { ai: string } | { export: string } | { job: () => void } | null
  /** A finished export (its receipt): how it went. Absent while the work runs. */
  done?: Outcome
  /** An export's id: its receipt shows its files and retries its failures. */
  exportId?: string
}

/** Failures, not the files written without all their metadata. */
export const failures = (p: ExportProgress): ExportProgress['errors'] =>
  p.errors.filter((e) => !e.warning)

/** How a finished export went. */
export function outcome(p: ExportProgress): Outcome {
  if (failures(p).length === 0 && !p.diskFull) return 'ok'
  return p.outputs.length > 0 ? 'partial' : 'failed'
}

/** A finished export in a few words: "12 written", "10 written · 2 failed". */
export function receiptTitle(p: ExportProgress): string {
  const count = p.outputs.length
  const failed = failures(p).length
  const parts = [
    p.diskFull
      ? t('Disk full · {{count}} written', { count })
      : p.stopped
        ? t('Stopped · {{count}} written', { count })
        : t('{{count}} written', { count })
  ]
  if (failed > 0 && !p.diskFull) parts.push(t('{{count}} failed', { count: failed }))
  if (p.skipped.length > 0) parts.push(t('{{count}} offline', { count: p.skipped.length }))
  return parts.join(' · ')
}

/**
 * What a receipt lists under its title: each failure by name, the photos
 * passed over offline, then what was written short of the settings (no
 * XMP, another develop stood in), each said once however many photos it was.
 */
export function receiptLines(p: ExportProgress): string[] {
  const noted = new Map<string, string[]>()
  for (const e of p.errors)
    if (e.warning) noted.set(e.message, [...(noted.get(e.message) ?? []), e.name])
  return [
    ...failures(p).map((e) => `${e.name}: ${e.message}`),
    ...p.skipped.map((name) => t('{{name}}: skipped, offline', { name })),
    ...[...noted].map(([message, names]) =>
      names.length === 1
        ? `${names[0]}: ${message}`
        : tp('{{message}} · {{count}} photo', '{{message}} · {{count}} photos', names.length, {
            message
          })
    )
  ]
}

/** An export as the list shows it: running, waiting its turn, or its receipt. */
export function exportActivity(p: ExportProgress): Activity {
  const label = p.label ? ` · ${p.label}` : ''
  if (p.finished)
    return {
      id: `export:${p.jobId}`,
      title: receiptTitle(p),
      name: p.label ?? undefined,
      progress: 1,
      queued: false,
      stop: null,
      done: outcome(p),
      exportId: p.jobId
    }
  const count = `${p.done}/${p.total}`
  return {
    id: `export:${p.jobId}`,
    title: p.queued
      ? `${t('Export')}${label}`
      : p.paused
        ? `${t('Paused while you edit')} · ${count}`
        : `${t('Exporting {{progress}}', { progress: count })}${label}`,
    name: p.queued ? undefined : (p.current ?? undefined),
    progress: p.queued ? null : p.total > 0 ? p.done / p.total : null,
    queued: p.queued,
    stop: { export: p.jobId },
    exportId: p.jobId
  }
}

/**
 * The receipts the pill keeps: finished exports not dismissed, newest
 * first. `seen` ones lose their dot (the list was opened); a failed one
 * keeps it until it is dismissed.
 */
export function receiptDot(
  jobs: ExportProgress[],
  seen: Record<string, true>,
  dismissed: Record<string, true>
): Outcome | null {
  const kept = jobs.filter((p) => p.finished && !dismissed[p.jobId])
  const marked = kept.filter((p) => outcome(p) !== 'ok' || !seen[p.jobId])
  if (marked.length === 0) return null
  const all = marked.map(outcome)
  return all.includes('failed') ? 'failed' : all.includes('partial') ? 'partial' : 'ok'
}

/** The finished export to say in the pill, while it is fresh: the newest, for RECEIPT_SHOWN_MS. */
export function freshReceipt(
  jobs: ExportProgress[],
  dismissed: Record<string, true>,
  now: number
): ExportProgress | null {
  const done = jobs
    .filter((p) => p.finished && !p.stopped && !dismissed[p.jobId] && p.finishedAt !== null)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
  const newest = done[0]
  return newest && now - (newest.finishedAt ?? 0) < RECEIPT_SHOWN_MS ? newest : null
}

/**
 * The exports as the renderer keeps them, with `p` in: the running and the
 * queued first, in the order they came, then the receipts, newest first,
 * `kept` of them.
 */
export function withExport(jobs: ExportProgress[], p: ExportProgress, kept = 10): ExportProgress[] {
  const all = [...jobs.filter((j) => j.jobId !== p.jobId), p]
  const live = all.filter((j) => !j.finished)
  const running = [...live.filter((j) => !j.queued), ...live.filter((j) => j.queued)]
  const done = all
    .filter((j) => j.finished)
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))
    .slice(0, kept)
  return [...running, ...done]
}

/**
 * The list, running first, in the order each source gives; then what waits
 * its turn, then the receipts of exports just done (`exports` holds those
 * still to show: the dismissed left out).
 */
export function activities(
  ai: AiJobEvent[],
  jobs: Job[],
  models: ModelInfo[],
  exports: ExportProgress[] = []
): Activity[] {
  const list: Activity[] = [
    ...exports.filter((p) => !p.finished).map(exportActivity),
    ...ai.map((e): Activity => ({
      id: e.jobId,
      title: e.subject ? `${e.title} ${e.subject}` : e.title,
      name: e.name,
      progress: e.progress,
      queued: e.phase === 'queued',
      key: e.key,
      stop: { ai: e.jobId }
    })),
    ...jobs.map((j): Activity => ({
      id: j.id,
      title: j.title,
      name: j.detail,
      progress: j.progress,
      queued: false,
      stop: j.cancel ? { job: j.cancel } : null
    })),
    ...models
      .filter((m) => m.progress !== null)
      .map((m): Activity => ({
        id: `model:${m.id}`,
        title: t('Downloading {{model}}', { model: m.title }),
        progress: m.progress,
        queued: false,
        stop: null
      }))
  ]
  return [
    ...list.filter((a) => !a.queued),
    ...list.filter((a) => a.queued),
    ...exports.filter((p) => p.finished).map(exportActivity)
  ]
}

/**
 * How far the running work is, together: the mean of what runs, when every
 * one of them can say; null (a spinner) when any can't, or nothing runs.
 */
export function overall(list: Activity[]): number | null {
  const running = list.filter((a) => !a.queued && !a.done)
  if (running.length === 0 || running.some((a) => a.progress === null)) return null
  return running.reduce((n, a) => n + (a.progress ?? 0), 0) / running.length
}

/** The hover text: one line for each piece of work. */
export function activitySummary(list: Activity[]): string {
  return list
    .map((a) => {
      if (a.done) return `${a.name ? `${a.name}: ` : ''}${a.title}`
      const how = a.queued
        ? t('queued')
        : a.progress === null
          ? t('working')
          : `${Math.round(a.progress * 100)}%`
      return `${a.title}${a.name ? ` · ${a.name}` : ''}: ${how}`
    })
    .join('\n')
}
