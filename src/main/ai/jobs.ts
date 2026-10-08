/**
 * The AI job queue: segmenting, denoising and enhancing each take seconds
 * and all the machine's threads, so jobs run one at a time, oldest first,
 * in their lane: a prompt (SAM 2.1, on its own engine host) has a lane of
 * its own, so a click never waits behind a minutes-long denoise.
 * Each belongs to a photo and says how it is getting on (its stage, its
 * progress, real or estimated) to every window; cancelling one aborts its
 * signal, which the runner answers by stopping its model (killing the
 * process it runs in, where that is the only way).
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import {
  overallProgress,
  toStart,
  type AiJobEvent,
  type AiResult,
  type AiStage,
  type AiStartRequest,
  type AiTask
} from '../../shared/ai'
import { IPC } from '../../shared/ipc'

export interface AiContext {
  jobId: string
  key: string
  signal: AbortSignal
  /** Move to a stage, at `p` (0…1) of its own way. */
  stage(id: string, p?: number, message?: string): void
  /** How far the current stage is (0…1); `estimated` when it is a guess from time. */
  progress(p: number, estimated?: boolean): void
  /**
   * The result is about to be kept (a step added to the photo): throws
   * `Cancelled` if the job was stopped, and after it a Cancel no longer
   * stops it — the job ends done, as what it made is the photo's now.
   */
  commit(): void
}

export interface AiRunner<R extends AiStartRequest = AiStartRequest> {
  task: R['task']
  /** The queue it waits in (one job at a time each): 'model' unless it says. */
  lane?: 'model' | 'select'
  stages(req: R): AiStage[]
  /** The words over the scan: "Segmenting" · "Subject". */
  title(req: R): { title: string; subject?: string }
  run(ctx: AiContext, req: R): Promise<AiResult>
}

/** A job the user cancelled: runners throw this (or anything, once the signal is aborted). */
export class Cancelled extends Error {
  constructor() {
    super('cancelled')
    this.name = 'Cancelled'
  }
}

interface Job {
  event: AiJobEvent
  req: AiStartRequest
  control: AbortController
  at: number
}

/** Finished jobs are listed this long, so a window opened late still hears how they ended. */
const KEEP_FINISHED_MS = 30_000
/** Progress is sent at most this often. */
const SEND_MS = 80

let nextId = 1

export class AiJobs {
  private readonly jobs = new Map<string, Job>()
  /** The job running in each lane. */
  private readonly running = new Map<string, string>()
  private readonly ended = new Set<(e: AiJobEvent) => void>()

  constructor(
    private readonly runners: Partial<Record<AiTask, AiRunner>>,
    private readonly names: (key: string) => Promise<string>,
    /** A finished job's result, applied to its photo before the renderer hears. */
    private readonly onResult: (e: AiJobEvent) => Promise<void>
  ) {}

  private send(e: AiJobEvent): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.ai.event, e)
  }

  async start(req: AiStartRequest): Promise<string> {
    const runner = this.runners[req.task]
    if (!runner) throw new Error(`${req.task} is not available in this build`)
    const jobId = `ai-${nextId++}`
    const stages = runner.stages(req as never)
    const { title, subject } = runner.title(req as never)
    const event: AiJobEvent = {
      jobId,
      task: req.task,
      key: req.key,
      name: await this.names(req.key).catch(() => req.key),
      title,
      subject,
      stages,
      stage: stages[0]?.id ?? '',
      progress: 0,
      phase: 'queued',
      ...(req.group ? { group: req.group } : {})
    }
    this.jobs.set(jobId, { event, req, control: new AbortController(), at: Date.now() })
    this.send(event)
    this.pump()
    return jobId
  }

  cancel(jobId: string): void {
    const job = this.jobs.get(jobId)
    if (!job) return
    if (job.event.phase === 'queued') {
      this.finish(job, { phase: 'cancelled', message: 'Cancelled' })
      return
    }
    if (job.event.phase === 'running') job.control.abort()
  }

  /** Hear every job that ends (done, failed or cancelled), after its result is applied. */
  onEnded(listener: (e: AiJobEvent) => void): () => void {
    this.ended.add(listener)
    return () => this.ended.delete(listener)
  }

  /** Whether a job is queued or running. */
  get busy(): boolean {
    return [...this.jobs.values()].some(
      (j) => j.event.phase === 'queued' || j.event.phase === 'running'
    )
  }

  list(): AiJobEvent[] {
    return [...this.jobs.values()].map((j) => j.event)
  }

  private finish(job: Job, patch: Partial<AiJobEvent>): void {
    job.event = { ...job.event, ...patch }
    this.send(job.event)
    for (const l of this.ended) l(job.event)
    setTimeout(() => this.jobs.delete(job.event.jobId), KEEP_FINISHED_MS)
  }

  private laneOf(req: AiStartRequest): string {
    return this.runners[req.task]?.lane ?? 'model'
  }

  private pump(): void {
    const ready = toStart(
      [...this.jobs.values()].map((j) => ({ ...j, phase: j.event.phase })),
      new Set(this.running.keys()),
      (j) => this.laneOf(j.req)
    )
    for (const next of ready) {
      const lane = this.laneOf(next.req)
      const job = this.jobs.get(next.event.jobId)!
      this.running.set(lane, job.event.jobId)
      void this.run(job).finally(() => {
        this.running.delete(lane)
        this.pump()
      })
    }
  }

  private async run(job: Job): Promise<void> {
    const runner = this.runners[job.req.task]!
    const stages = job.event.stages
    let stage = job.event.stage
    let stageP = 0
    let lastSent = 0
    const update = (patch: Partial<AiJobEvent>, force = false): void => {
      job.event = { ...job.event, ...patch }
      const now = Date.now()
      if (force || now - lastSent >= SEND_MS) {
        lastSent = now
        this.send(job.event)
      }
    }
    update({ phase: 'running' }, true)
    let committed = false
    const ctx: AiContext = {
      jobId: job.event.jobId,
      key: job.event.key,
      signal: job.control.signal,
      stage: (id, p = 0, message) => {
        stage = id
        stageP = p
        update(
          { stage, progress: overallProgress(stages, stage, stageP), estimated: false, message },
          true
        )
      },
      progress: (p, estimated = false) => {
        stageP = p
        update({ progress: overallProgress(stages, stage, stageP), estimated })
      },
      commit: () => {
        if (job.control.signal.aborted) throw new Cancelled()
        committed = true
      }
    }
    try {
      const result = await runner.run(ctx, job.req as never)
      if (job.control.signal.aborted && !committed) throw new Cancelled()
      job.event = { ...job.event, result, progress: 1, stage: stages.at(-1)?.id ?? stage }
      await this.onResult(job.event)
      this.finish(job, { phase: 'done' })
    } catch (err) {
      if (!committed && (job.control.signal.aborted || err instanceof Cancelled)) {
        this.finish(job, { phase: 'cancelled', message: 'Cancelled' })
        return
      }
      log.warn(`ai ${job.req.task} failed`, err)
      this.finish(job, { phase: 'error', message: (err as Error).message })
    }
  }
}

/** Wait `ms`, or throw `Cancelled` as soon as `signal` is aborted. */
export function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Cancelled())
    const t = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, ms)
    const stop = (): void => {
      clearTimeout(t)
      reject(new Cancelled())
    }
    signal.addEventListener('abort', stop, { once: true })
  })
}
