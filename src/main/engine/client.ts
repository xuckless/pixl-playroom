/**
 * Main-process side of the engine: owns one utility process hosting the
 * native addon, restarts it when it dies, and turns messages back into
 * promises. Playroom runs two: an interactive one for the develop view's
 * renders and a background one for thumbnails, exports and enhancement, so
 * a batch never queues in front of a slider and a crash in one never takes
 * the other down.
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import log from 'electron-log/main'
import { join } from 'path'
import type {
  AnalyzeRequest,
  ConvertReport,
  ConvertRequest,
  EngineErrorShape,
  EngineMethod,
  GradeSpace,
  HostToMain,
  ImageStats,
  LensCorrection,
  LensReport,
  Framing,
  MaskBounds,
  Rgb,
  SourceInfo,
  Transform,
  WhiteBalance
} from '../../shared/engine-types'
import type { EngineStatus } from '../../shared/ipc'

export class EngineError extends Error {
  code: string
  detail?: EngineErrorShape['detail']
  constructor(shape: EngineErrorShape) {
    super(shape.message)
    this.name = 'EngineError'
    this.code = shape.code
    this.detail = shape.detail
  }

  /** A stop the caller asked for, not a failure: nothing to report. */
  get cancelled(): boolean {
    return this.code === 'Cancelled'
  }

  /** The request field the engine named, for `InvalidRequest`. */
  get field(): string | undefined {
    const d = this.detail?.['InvalidRequest']
    return d && typeof d['field'] === 'string' ? (d['field'] as string) : undefined
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  method: EngineMethod
}

/** A call that can be stopped: the engine returns `Cancelled` at its next stage boundary. */
export interface CallOptions {
  signal?: AbortSignal
}

/** True for an error that only says the call was stopped. */
export function isCancelled(err: unknown): boolean {
  return err instanceof EngineError && err.cancelled
}

const MAX_RESTARTS = 5

export class EngineClient {
  private child: UtilityProcess | undefined
  private nextId = 1
  private inflight = new Map<number, Pending>()
  private status: EngineStatus = { status: 'starting', restarts: 0 }
  private stopped = false
  private readyWaiters: (() => void)[] = []

  constructor(
    private readonly name: string,
    private readonly libuvThreads: number
  ) {}

  start(): void {
    this.stopped = false
    this.spawn()
  }

  stop(): void {
    this.stopped = true
    this.child?.kill()
    this.child = undefined
  }

  /**
   * Kill the host mid-call (a cancelled job): what it was doing fails as
   * Cancelled, and a fresh host starts. Not a crash: it does not count
   * towards giving up.
   */
  restart(): void {
    const child = this.child
    if (!child) return
    this.child = undefined
    for (const [id, p] of this.inflight) {
      this.inflight.delete(id)
      p.reject(new EngineError({ message: `${p.method}: cancelled`, code: 'Cancelled' }))
    }
    child.kill()
    if (!this.stopped) this.spawn()
  }

  getStatus(): EngineStatus {
    return this.status
  }

  /** Resolves once the host has said hello (ready or not). */
  whenStarted(): Promise<void> {
    if (this.status.status !== 'starting') return Promise.resolve()
    return new Promise((r) => this.readyWaiters.push(r))
  }

  probe(path: string): Promise<SourceInfo> {
    return this.call('probe', [path]) as Promise<SourceInfo>
  }
  convert(request: ConvertRequest, opts: CallOptions = {}): Promise<ConvertReport> {
    return this.call('convert', [request], opts.signal) as Promise<ConvertReport>
  }
  analyze(request: AnalyzeRequest, opts: CallOptions = {}): Promise<ImageStats> {
    return this.call('analyze', [request], opts.signal) as Promise<ImageStats>
  }
  /** What a lens correction does to a `width × height` frame, without pixels. */
  lensFrame(lens: LensCorrection, width: number, height: number): Promise<LensReport> {
    return this.call('lensFrame', [lens, width, height, 2]) as Promise<LensReport>
  }
  /** The rectangle a framing keeps of a `width × height` frame (after `Outside::Crop`). */
  framingCrop(framing: Framing, width: number, height: number): Promise<MaskBounds> {
    return this.call('framingCrop', [framing, width, height]) as Promise<MaskBounds>
  }
  /** Measure a photo's lines and suggest an Upright (see `upright.rs`). */
  suggestUpright(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('suggestUpright', [request]) as Promise<Record<string, unknown>>
  }
  /** The Upright that makes guide lines vertical or horizontal (Guided). */
  uprightFromLines(
    lines: { from: { x: number; y: number }; to: { x: number; y: number } }[],
    width: number,
    height: number,
    focal: number
  ): Promise<Transform> {
    return this.call('uprightFromLines', [lines, width, height, focal]) as Promise<Transform>
  }
  /** Run a segmentation model on a photo (`segment`); each plane's PNG is a Buffer. */
  segment(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('segment', [request]) as Promise<Record<string, unknown>>
  }
  /** Time models on providers (`benchmark`). */
  benchmark(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('benchmark', [request]) as Promise<Record<string, unknown>>
  }
  /** Where a heal or clone should copy from (see `retouch/suggest.rs`). */
  suggestHealSource(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('suggestHealSource', [request]) as Promise<Record<string, unknown>>
  }
  /** Measure a photo's lateral chromatic aberration (see `lateral_ca.rs`). */
  suggestLateralCa(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.call('suggestLateralCa', [request]) as Promise<Record<string, unknown>>
  }
  /** The white that makes a linear sample neutral, as the `WhiteBalance` op names it. */
  whiteBalanceFromPixel(rgb: Rgb, space: GradeSpace): Promise<WhiteBalance> {
    return this.call('whiteBalanceFromPixel', [rgb, space]) as Promise<WhiteBalance>
  }

  private spawn(): void {
    const entry = join(__dirname, 'engine-host.js')
    const child = utilityProcess.fork(entry, [], {
      serviceName: `pixl-engine-${this.name}`,
      stdio: 'pipe',
      env: { ...process.env, UV_THREADPOOL_SIZE: String(this.libuvThreads) }
    })
    this.child = child
    this.status = { ...this.status, status: 'starting', reason: undefined }

    child.stdout?.on('data', (d: Buffer) =>
      log.info(`[engine:${this.name}]`, d.toString().trimEnd())
    )
    child.stderr?.on('data', (d: Buffer) =>
      log.warn(`[engine:${this.name}]`, d.toString().trimEnd())
    )

    child.on('message', (msg: HostToMain) => this.onMessage(msg))
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      const reason = `engine host ${this.name} exited with code ${code}`
      log.error(reason)
      for (const [id, p] of this.inflight) {
        this.inflight.delete(id)
        p.reject(new EngineError({ message: `${p.method}: ${reason}`, code: 'EngineCrashed' }))
      }
      if (this.stopped) return
      const restarts = this.status.restarts + 1
      if (restarts > MAX_RESTARTS) {
        this.status = { status: 'crashed', restarts, reason: `${reason}; gave up restarting` }
        return
      }
      this.status = { status: 'crashed', restarts, reason }
      setTimeout(
        () => {
          if (!this.stopped && !this.child) this.spawn()
        },
        Math.min(500 * restarts, 5000)
      )
    })
  }

  private onMessage(msg: HostToMain): void {
    if (msg.kind === 'hello') {
      this.status =
        msg.status === 'ready'
          ? {
              status: 'ready',
              version: msg.version,
              enhance: msg.enhance,
              runtime: msg.runtime,
              restarts: this.status.restarts
            }
          : {
              status: 'unavailable',
              reason: msg.reason,
              code: msg.code,
              restarts: this.status.restarts
            }
      log.info(`engine ${this.name}`, this.status)
      for (const w of this.readyWaiters.splice(0)) w()
      return
    }
    if (msg.kind === 'response') {
      const p = this.inflight.get(msg.id)
      if (!p) return
      this.inflight.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new EngineError(msg.error ?? { message: 'unknown error', code: 'Unknown' }))
    }
  }

  /**
   * One call to the host. With a signal, aborting it tells the host to stop
   * and settles the call at once as `Cancelled`; the engine lets go of the
   * work at its next stage boundary, and its late answer is dropped.
   */
  private call(method: EngineMethod, args: unknown[], signal?: AbortSignal): Promise<unknown> {
    const cancelled = (): EngineError =>
      new EngineError({ message: `${method}: cancelled`, code: 'Cancelled' })
    if (signal?.aborted) return Promise.reject(cancelled())
    const child = this.child
    if (!child) {
      return Promise.reject(
        new EngineError({
          message: this.status.reason ?? 'engine host is not running',
          code: 'EngineUnavailable'
        })
      )
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        if (!this.inflight.delete(id)) return
        this.child?.postMessage({ kind: 'cancel', id })
        reject(cancelled())
      }
      const done =
        <T>(settle: (v: T) => void) =>
        (v: T): void => {
          signal?.removeEventListener('abort', onAbort)
          settle(v)
        }
      this.inflight.set(id, { resolve: done(resolve), reject: done(reject), method })
      signal?.addEventListener('abort', onAbort, { once: true })
      child.postMessage({ kind: 'request', id, method, args, cancellable: signal !== undefined })
    })
  }
}
