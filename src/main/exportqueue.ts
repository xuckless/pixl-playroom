/**
 * The export queue: one export at a time, in the order they were asked for,
 * each made from what there was when Export was pressed (every photo's recipe,
 * and where exports go), so an edit or another folder chosen meanwhile never
 * reaches a queued file. The last few that finished stay, as receipts. The
 * rendering is the exporter's (main/exporter.ts); this is the order, the
 * snapshot and the bookkeeping, with nothing of Electron in it.
 */
import type { ExportSettings } from '../shared/export'
import type { ExportProgress } from '../shared/ipc'
import { t, tp } from '../shared/i18n'

/** Finished exports kept for their receipts. */
export const RECEIPTS_KEPT = 10
/** Photos snapshotted at once when an export is queued. */
const SNAPSHOT_AT_ONCE = 8

/** What a photo is exported from, taken when Export is pressed. */
export interface PhotoSnapshot<R> {
  recipe: R
  name: string
  /** Its original is not where the index last saw it: passed over, and listed. */
  offline: boolean
}

export interface QueuedExport<R, D> {
  progress: ExportProgress
  settings: ExportSettings
  keys: string[]
  photos: Map<string, PhotoSnapshot<R>>
  /** Where exports go, as it was when Export was pressed. */
  dest: D
  abort: AbortController
  /** What Retry exports again: the photos that failed, and those a full disk never reached. */
  failed: string[]
}

export interface QueueHost<R, D> {
  /** The photo as it is now: its pending edits saved first, then its recipe read. */
  snapshot(key: string): Promise<PhotoSnapshot<R>>
  destination(): Promise<D>
  /** Write one photo: its path, or null when it was skipped (a file of its name there already). */
  render(
    job: QueuedExport<R, D>,
    key: string,
    seq: number,
    warn: (message: string) => void
  ): Promise<string | null>
  /** The state an export was made from, kept as a Version: once per photo per export. */
  version(key: string, recipe: R): void
  send(p: ExportProgress): void
  isCancelled(err: unknown): boolean
  /** An export ended, by itself or stopped while it ran. */
  finished?(p: ExportProgress, settings: ExportSettings): void
  /** Nothing is running or queued any more. */
  idle?(): void
  failed?(key: string, err: unknown): void
}

/** A write the disk had no room for: the engine's words, or Node's code. */
export function isDiskFull(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null
  if (e?.code === 'ENOSPC') return true
  return /ENOSPC|no space left on device|os error 28|disk is full|not enough space/i.test(
    String(e?.message ?? '')
  )
}

/**
 * What quitting asks while exports are running or queued (they would stop
 * part-way), or null when none are.
 */
export function quitQuestion(jobs: ExportProgress[]): { message: string; detail: string } | null {
  const open = jobs.filter((j) => !j.finished)
  if (open.length === 0) return null
  const left = open.reduce((n, j) => n + Math.max(0, j.total - j.done), 0)
  return {
    message: t('Quit while exporting?'),
    detail: tp(
      '{{count}} photo is still to export. Quitting stops the export; the files written so far stay.',
      '{{count}} photos are still to export. Quitting stops the export; the files written so far stay.',
      left
    )
  }
}

/** `fn` over `items`, `limit` at a time, the results in order. */
export async function mapLimit<T, U>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<U>
): Promise<U[]> {
  const out = new Array<U>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

export class ExportQueue<R, D> {
  private running: QueuedExport<R, D> | null = null
  private waiting: QueuedExport<R, D>[] = []
  /** Finished, newest first. */
  private done: QueuedExport<R, D>[] = []
  private seq = 0
  private readonly host: QueueHost<R, D>

  constructor(host: QueueHost<R, D>) {
    this.host = host
  }

  /** Whether an export is running or waiting its turn. */
  get busy(): boolean {
    return this.running !== null || this.waiting.length > 0
  }

  /** Every export: the one running, those waiting, then the receipts, newest first. */
  list(): ExportProgress[] {
    return [...(this.running ? [this.running] : []), ...this.waiting, ...this.done].map((j) => ({
      ...j.progress
    }))
  }

  /**
   * Queue an export of `keys`: each photo's recipe and where exports go are
   * read now, and are what it writes, whatever changes before its turn.
   */
  async enqueue(keys: string[], settings: ExportSettings, label: string | null): Promise<string> {
    const unique = [...new Set(keys)]
    const dest = await this.host.destination()
    const snaps = await mapLimit(unique, SNAPSHOT_AT_ONCE, (k) => this.host.snapshot(k))
    return this.push(unique, settings, label, new Map(unique.map((k, i) => [k, snaps[i]])), dest)
  }

  /**
   * An export's failures again, as an export of their own: the same settings
   * and folder, each photo as it is now (an adjustment that broke the picture
   * may have been mended). Null when there is nothing to retry.
   */
  async retry(id: string): Promise<string | null> {
    const job = this.done.find((j) => j.progress.jobId === id)
    if (!job || job.failed.length === 0) return null
    const keys = job.failed
    const snaps = await mapLimit(keys, SNAPSHOT_AT_ONCE, (k) => this.host.snapshot(k))
    // Its receipt says nothing is left to retry.
    job.failed = []
    job.progress.retryable = 0
    this.host.send({ ...job.progress })
    return this.push(
      keys,
      job.settings,
      job.progress.label,
      new Map(keys.map((k, i) => [k, snaps[i]])),
      job.dest
    )
  }

  /** Stop an export: the one running at the engine's next stage, one waiting before it begins. */
  stop(id: string): void {
    if (this.running?.progress.jobId === id) return this.running.abort.abort()
    const job = this.waiting.find((j) => j.progress.jobId === id)
    if (!job) return
    this.waiting = this.waiting.filter((j) => j !== job)
    Object.assign(job.progress, {
      queued: false,
      finished: true,
      stopped: true,
      finishedAt: Date.now()
    })
    this.keep(job)
    this.host.send({ ...job.progress })
  }

  /** Stop everything (quitting). */
  stopAll(): void {
    for (const j of [...this.waiting]) this.stop(j.progress.jobId)
    this.running?.abort.abort()
  }

  /** The background engine is (or is no longer) waiting for the editing to settle. */
  setPaused(on: boolean): void {
    const p = this.running?.progress
    if (!p || p.paused === on) return
    p.paused = on
    this.host.send({ ...p })
  }

  private push(
    keys: string[],
    settings: ExportSettings,
    label: string | null,
    photos: Map<string, PhotoSnapshot<R>>,
    dest: D
  ): string {
    const jobId = `export-${++this.seq}-${Math.random().toString(36).slice(2, 8)}`
    const job: QueuedExport<R, D> = {
      progress: {
        jobId,
        label,
        done: 0,
        total: keys.length,
        current: null,
        errors: [],
        finished: false,
        outputs: [],
        queued: true,
        startedAt: null,
        finishedAt: null,
        skipped: [],
        paused: false,
        stopped: false,
        diskFull: false,
        retryable: 0
      },
      settings,
      keys,
      photos,
      dest,
      abort: new AbortController(),
      failed: []
    }
    this.waiting.push(job)
    this.host.send({ ...job.progress })
    if (!this.running) void this.next()
    return jobId
  }

  private keep(job: QueuedExport<R, D>): void {
    this.done = [job, ...this.done].slice(0, RECEIPTS_KEPT)
  }

  private async next(): Promise<void> {
    while (!this.running && this.waiting.length > 0) {
      const job = this.waiting.shift()!
      this.running = job
      try {
        await this.run(job)
      } finally {
        this.running = null
        this.keep(job)
      }
    }
    if (!this.busy) this.host.idle?.()
  }

  private async run(job: QueuedExport<R, D>): Promise<void> {
    const p = job.progress
    const send = (): void => this.host.send({ ...p })
    p.queued = false
    p.startedAt = Date.now()
    const { signal } = job.abort
    for (const [i, key] of job.keys.entries()) {
      if (signal.aborted) break
      const photo = job.photos.get(key)!
      p.current = photo.name
      if (photo.offline) {
        p.skipped.push(photo.name)
        p.done = i + 1
        send()
        continue
      }
      send()
      try {
        const out = await this.host.render(job, key, i + 1, (message) =>
          p.errors.push({ name: photo.name, message, warning: true })
        )
        if (out) {
          p.outputs.push(out)
          this.host.version(key, photo.recipe)
        }
      } catch (err) {
        // Stopped: the file was never written, and nothing failed.
        if (this.host.isCancelled(err)) break
        this.host.failed?.(key, err)
        if (isDiskFull(err)) {
          // One clear error, not one for every file still to come.
          p.diskFull = true
          p.errors.push({
            name: photo.name,
            message: t('The disk is full: the export stopped here.')
          })
          job.failed.push(...job.keys.slice(i).filter((k) => !job.photos.get(k)?.offline))
          break
        }
        p.errors.push({ name: photo.name, message: (err as Error).message })
        job.failed.push(key)
      }
      p.done = i + 1
      send()
    }
    Object.assign(p, {
      stopped: signal.aborted,
      finished: true,
      current: null,
      paused: false,
      finishedAt: Date.now(),
      retryable: job.failed.length
    })
    send()
    this.host.finished?.({ ...p }, job.settings)
  }
}
