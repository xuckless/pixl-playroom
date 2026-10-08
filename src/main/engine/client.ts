/**
 * Main-process side of the engine: owns one utility process hosting the
 * native addon, restarts it when it dies, and turns messages back into
 * promises. Playroom runs two: an interactive one for the develop view's
 * renders and a background one for thumbnails, exports and enhancement, so
 * a batch never queues in front of a slider and a crash in one never takes
 * the other down.
 */
import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron'
import log from 'electron-log/main'
import { constants, setPriority } from 'os'
import { join } from 'path'
import { MAIN_DIR } from '../dirs'
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
  SamOp,
  SamResult,
  SegmentReport,
  SourceInfo,
  Transform,
  WhiteBalance
} from '../../shared/engine-types'
import { describeEngineError, unsupportedRaw, type Grade } from '../../shared/engine-types'
import {
  describeInvariant,
  invariantDetail,
  invariantPlace,
  type InvariantPlace
} from '../../shared/invariant'
import { IPC, type EngineStatus } from '../../shared/ipc'
import type { MainToHost } from '../../shared/engine-types'

export class EngineError extends Error {
  code: string
  detail?: EngineErrorShape['detail']
  /** For `Invariant`, once named against the request (`nameInvariant`): the layer and op. */
  invariant?: InvariantPlace | null
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

  /**
   * For `Invariant` (engine 0.18, HR-0.18-9): name the adjustment against the
   * request that was sent, in the message and in `invariant`. The caller keeps
   * the edit and never renders again without the op.
   */
  nameInvariant(
    grade: Grade | null,
    sdrGrade: Grade | null,
    layerIndex: Record<string, number>
  ): this {
    if (this.code !== 'Invariant') return this
    const { stage, text } = invariantDetail(this.detail)
    this.invariant = invariantPlace(text, grade, sdrGrade, layerIndex)
    this.message = describeInvariant(this.invariant, stage)
    return this
  }

  /** What to tell the user: the engine's words, or plainer ones where it has them. */
  get userMessage(): string {
    return (
      unsupportedRaw(this.detail) ?? describeEngineError(this.code, this.detail) ?? this.message
    )
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  method: EngineMethod | 'sam'
}

/** A call that can be stopped: the engine returns `Cancelled` at its next stage boundary. */
export interface CallOptions {
  signal?: AbortSignal
  /** A `Bytes` convert whose output is a preview frame for the window (see `sendPreviewsTo`). */
  frame?: string
}

/** True for an error that only says the call was stopped. */
export function isCancelled(err: unknown): boolean {
  return err instanceof EngineError && err.cancelled
}

const MAX_RESTARTS = 5
/** The longest a background call is held while interactive renders run (exports still move). */
const HOLD_MAX_MS = 1500
/** The longest a new cancellable call waits for cancelled ones to let go of the cores. */
const DRAIN_MAX_MS = 250

/** A helper process put below normal priority (the OS may refuse: it then runs as it is). */
export function lowerPriority(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    setPriority(pid, constants.priority.PRIORITY_BELOW_NORMAL)
  } catch {
    // Not permitted here: nothing lost but the courtesy.
  }
}

/** What `faces` reports, as Playroom reads it. */
export interface FaceReport {
  faces: {
    /** `[x, y, width, height]` in frame pixels. */
    bounds: number[]
    score: number
    outlines: Record<string, { contours: { points: { x: number; y: number }[] }[] }> | null
  }[]
  frame_width: number
  frame_height: number
}

export class EngineClient {
  private child: UtilityProcess | undefined
  private nextId = 1
  private inflight = new Map<number, Pending>()
  /**
   * Calls the host is working on, whether or not their callers still wait
   * (a cancelled one runs on to its next stage boundary): what `quiet` and
   * `drained` watch.
   */
  private running = new Set<number>()
  /** The cancelled ones among them. */
  private draining = new Set<number>()
  private settleWaiters: (() => void)[] = []
  /** An engine whose work this one's new calls wait behind (see `holdFor`). */
  private yieldTo: EngineClient | undefined
  /** The window preview frames go to (see `sendPreviewsTo`). */
  private previewsTo: WebContents | undefined
  private status: EngineStatus = { status: 'starting', restarts: 0 }
  private stopped = false
  private readyWaiters: (() => void)[] = []

  constructor(
    private readonly name: string,
    private readonly libuvThreads: number,
    /** Below the interactive engine and the window, so background work yields to editing. */
    private readonly background = false
  ) {}

  private spawned = false
  /**
   * How many hosts this client has started: what a host holds (SAM's
   * sessions and embeddings) is gone when this moves on.
   */
  private generationCount = 0
  private spawnListeners = new Set<(generation: number) => void>()

  get generation(): number {
    return this.generationCount
  }

  /** Hear each new host (after a crash, a restart or a sleep). */
  onSpawn(listener: (generation: number) => void): () => void {
    this.spawnListeners.add(listener)
    return () => this.spawnListeners.delete(listener)
  }

  /**
   * Let the host go while nothing runs, to give back what it holds (SAM's
   * models are hundreds of megabytes); the next call starts a new one.
   * Not a crash: nothing is counted, and no call fails.
   */
  sleep(): boolean {
    const child = this.child
    if (!child || this.running.size > 0 || this.inflight.size > 0) return false
    this.child = undefined
    this.spawned = false
    // Its status stands (a resting engine is still ready): the next call
    // starts a host, and that says 'starting' until it is up.
    child.kill()
    return true
  }

  start(): void {
    this.stopped = false
    this.spawned = true
    this.spawn()
  }

  /** Start it if it never was (one held back from the launch's path). */
  ensureStarted(): void {
    if (!this.spawned && !this.stopped) this.start()
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
    this.ended()
    if (!this.stopped) this.spawn()
  }

  /**
   * Hold this engine's new calls while `other` (the interactive engine) has
   * work in flight, for at most HOLD_MAX_MS each: thumbnails and exports
   * start between renders, not on top of them. What is already running here
   * goes on.
   */
  holdFor(other: EngineClient): void {
    this.yieldTo = other
  }

  /**
   * Send preview frames (`convert` with `frame`) straight from the host to
   * this window, over a channel of their own: the pixels never pass through
   * main. Called again when the window loads anew (its old port is gone).
   */
  sendPreviewsTo(wc: WebContents): void {
    this.previewsTo = wc
    this.connectPreviews()
  }

  private connectPreviews(): void {
    const child = this.child
    const wc = this.previewsTo
    if (!child || !wc || wc.isDestroyed()) return
    const { port1, port2 } = new MessageChannelMain()
    child.postMessage({ kind: 'port' }, [port1])
    wc.postMessage(IPC.develop.previewPort, null, [port2])
  }

  /** Resolves when no call is running here, or after `maxMs`. */
  quiet(maxMs: number): Promise<void> {
    return this.until(() => this.running.size === 0, maxMs)
  }

  /** Resolves when no cancelled call is still running here, or after `maxMs`. */
  private drained(maxMs: number): Promise<void> {
    return this.until(() => this.draining.size === 0, maxMs)
  }

  private until(done: () => boolean, maxMs: number): Promise<void> {
    if (done()) return Promise.resolve()
    return new Promise((resolve) => {
      let over = false
      const finish = (): void => {
        over = true
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(finish, maxMs)
      const check = (): void => {
        if (over) return
        if (done()) finish()
        else this.settleWaiters.push(check)
      }
      this.settleWaiters.push(check)
    })
  }

  /** A call the host was working on has ended (answered, or the host gone). */
  private ended(id?: number): void {
    if (id === undefined) {
      this.running.clear()
      this.draining.clear()
    } else {
      this.running.delete(id)
      this.draining.delete(id)
    }
    for (const w of this.settleWaiters.splice(0)) w()
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
    return this.call('convert', [request], opts.signal, opts.frame) as Promise<ConvertReport>
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
  /**
   * Run a segmentation model on a photo (`segment`); each plane's PNG is a
   * Buffer. A signal stops the model mid-run (0.16).
   */
  segment(request: Record<string, unknown>, opts: CallOptions = {}): Promise<SegmentReport> {
    return this.call('segment', [request], opts.signal) as Promise<SegmentReport>
  }
  /**
   * Faces and their parts (engine 0.19, `faces`): YuNet's boxes, and with a
   * landmarker each face's outlines as polygons (fractions of the frame).
   */
  faces(request: Record<string, unknown>, opts: CallOptions = {}): Promise<FaceReport> {
    return this.call('faces', [request], opts.signal) as Promise<FaceReport>
  }
  /** Time models on providers (`benchmark`). */
  benchmark(
    request: Record<string, unknown>,
    opts: CallOptions = {}
  ): Promise<Record<string, unknown>> {
    return this.call('benchmark', [request], opts.signal) as Promise<Record<string, unknown>>
  }
  /**
   * One of SAM 2.1's calls (`SamOp`): its sessions, embeddings and logits
   * stay in the host, named by id. A signal stops the model mid-run.
   */
  sam(call: SamOp, opts: CallOptions = {}): Promise<SamResult> {
    const run = (): Promise<unknown> =>
      this.post('sam', (id, cancellable) => ({ kind: 'sam', id, call, cancellable }), opts.signal)
    return run() as Promise<SamResult>
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
    this.generationCount++
    for (const l of this.spawnListeners) l(this.generationCount)
    const entry = join(MAIN_DIR, 'engine-host.js')
    const child = utilityProcess.fork(entry, [], {
      serviceName: `pixl-engine-${this.name}`,
      stdio: 'pipe',
      env: { ...process.env, UV_THREADPOOL_SIZE: String(this.libuvThreads) }
    })
    this.child = child
    this.status = { ...this.status, status: 'starting', reason: undefined }
    if (this.background) child.once('spawn', () => lowerPriority(child.pid))
    // A host started again (after a crash) gets a fresh preview channel.
    child.once('spawn', () => this.connectPreviews())

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
      this.ended()
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
              prompt: msg.prompt,
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
      // A cancelled call's late answer still says the host has let go of it.
      this.ended(msg.id)
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
   * work at its next stage boundary, and its late answer is dropped. Before
   * it starts, a call waits (briefly) behind the interactive engine's work
   * (`holdFor`), and a cancellable one behind cancelled calls still letting
   * go: two renders never fight over the cores.
   */
  private call(
    method: EngineMethod,
    args: unknown[],
    signal?: AbortSignal,
    frame?: string
  ): Promise<unknown> {
    const hold = this.yieldTo && this.yieldTo.running.size > 0
    const drain = signal !== undefined && this.draining.size > 0
    const message = (id: number, cancellable: boolean): MainToHost => ({
      kind: 'request',
      id,
      method,
      args,
      cancellable,
      ...(frame ? { frame } : {})
    })
    if (!hold && !drain) return this.post(method, message, signal)
    return (async () => {
      if (hold) await this.yieldTo!.quiet(HOLD_MAX_MS)
      if (drain) await this.drained(DRAIN_MAX_MS)
      return this.post(method, message, signal)
    })()
  }

  private post(
    method: EngineMethod | 'sam',
    message: (id: number, cancellable: boolean) => MainToHost,
    signal?: AbortSignal
  ): Promise<unknown> {
    const cancelled = (): EngineError =>
      new EngineError({ message: `${method}: cancelled`, code: 'Cancelled' })
    if (signal?.aborted) return Promise.reject(cancelled())
    // Held back from the launch (or put to sleep): started by the first call that wants it.
    if (!this.spawned && !this.stopped) {
      this.start()
      return this.whenStarted().then(() => this.post(method, message, signal))
    }
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
        // Still running in the host until its answer comes.
        if (this.running.has(id)) this.draining.add(id)
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
      this.running.add(id)
      child.postMessage(message(id, signal !== undefined))
    })
  }
}
