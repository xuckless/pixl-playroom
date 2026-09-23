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
  HostToMain,
  ImageStats,
  SourceInfo
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
  convert(request: ConvertRequest): Promise<ConvertReport> {
    return this.call('convert', [request]) as Promise<ConvertReport>
  }
  analyze(request: AnalyzeRequest): Promise<ImageStats> {
    return this.call('analyze', [request]) as Promise<ImageStats>
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
              restarts: this.status.restarts
            }
          : { status: 'unavailable', reason: msg.reason, restarts: this.status.restarts }
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

  private call(method: EngineMethod, args: unknown[]): Promise<unknown> {
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
      this.inflight.set(id, { resolve, reject, method })
      child.postMessage({ kind: 'request', id, method, args })
    })
  }
}
