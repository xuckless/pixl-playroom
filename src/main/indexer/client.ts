/**
 * Main-process side of the index: owns the index host (a utilityProcess,
 * see host.ts), restarts it when it dies, and turns its methods into
 * promises. `openIndex()` returns an object with every public method of
 * `IndexService`, each async, plus the process's own controls.
 *
 * Unlike the engine client, calls made while the host is starting (or
 * restarting after a crash) wait for it rather than fail. Calls are sent in
 * the order they are made, and the host answers them in that order.
 */
import { app, utilityProcess, type UtilityProcess } from 'electron'
import log from 'electron-log/main'
import { join } from 'path'
import type { HostToMain, IndexEvent, IndexRequest } from './protocol'
import type { IndexService } from './service'

/** Each method of `T`, returning a promise of what it returned. */
export type Remote<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : never
}

export interface IndexControl {
  start(): void
  /** Answer what is in flight, close the database, and end the process. */
  stop(): Promise<void>
  on(listener: (event: IndexEvent) => void): void
}

export type IndexClient = Remote<Omit<IndexService, 'close'>> & IndexControl

export class IndexError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'IndexError'
    this.code = code
  }
}

interface Pending {
  request: IndexRequest
  sent: boolean
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

const MAX_RESTARTS = 5
const STOP_WAIT_MS = 2000

class Connection implements IndexControl {
  private child: UtilityProcess | undefined
  private ready = false
  private nextId = 1
  private pending = new Map<number, Pending>()
  private restarts = 0
  private stopped = false
  private gaveUp: string | null = null
  private firstStart = true
  private listeners: ((event: IndexEvent) => void)[] = []

  start(): void {
    this.stopped = false
    this.spawn()
  }

  on(listener: (event: IndexEvent) => void): void {
    this.listeners.push(listener)
  }

  async stop(): Promise<void> {
    if (this.stopped) return
    const child = this.child
    const closing = this.request('close', []).catch(() => undefined)
    this.stopped = true
    let timer: NodeJS.Timeout | undefined
    await Promise.race([closing, new Promise((r) => (timer = setTimeout(r, STOP_WAIT_MS)))])
    clearTimeout(timer)
    this.child = undefined
    child?.kill()
    this.failAll(new IndexError('the index has stopped', 'IndexUnavailable'), () => true)
  }

  request(method: string, args: unknown[]): Promise<unknown> {
    if (this.stopped || this.gaveUp !== null) {
      return Promise.reject(
        new IndexError(this.gaveUp ?? 'the index has stopped', 'IndexUnavailable')
      )
    }
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const p: Pending = {
        request: { kind: 'request', id, method, args },
        sent: false,
        resolve,
        reject
      }
      this.pending.set(id, p)
      if (this.ready) this.send(p)
    })
  }

  private send(p: Pending): void {
    p.sent = true
    this.child?.postMessage(p.request)
  }

  private failAll(err: Error, which: (p: Pending) => boolean): void {
    for (const [id, p] of this.pending) {
      if (!which(p)) continue
      this.pending.delete(id)
      p.reject(err)
    }
  }

  private spawn(): void {
    const args = ['--user-data', app.getPath('userData')]
    if (this.firstStart) args.push('--prune')
    this.firstStart = false
    const child = utilityProcess.fork(join(__dirname, 'index-host.js'), args, {
      serviceName: 'pixl-index',
      stdio: 'pipe'
    })
    this.child = child
    this.ready = false

    child.stdout?.on('data', (d: Buffer) => log.info('[index]', d.toString().trimEnd()))
    child.stderr?.on('data', (d: Buffer) => log.warn('[index]', d.toString().trimEnd()))
    child.on('message', (msg: HostToMain) => this.onMessage(msg))
    child.on('exit', (code) => {
      if (this.child !== child) return
      this.child = undefined
      this.ready = false
      const reason = `index host exited with code ${code}`
      // What was sent may or may not have happened; what was not sent waits
      // for the next host.
      this.failAll(new IndexError(reason, 'IndexCrashed'), (p) => p.sent)
      if (this.stopped) return
      log.error(reason)
      this.restarts++
      if (this.restarts > MAX_RESTARTS) {
        this.gaveUp = `${reason}; gave up restarting`
        this.failAll(new IndexError(this.gaveUp, 'IndexUnavailable'), () => true)
        return
      }
      setTimeout(
        () => {
          if (!this.stopped && !this.child) this.spawn()
        },
        Math.min(500 * this.restarts, 5000)
      )
    })
  }

  private onMessage(msg: HostToMain): void {
    if (msg.kind === 'hello') {
      this.ready = true
      log.info('index ready', { pid: this.child?.pid, restarts: this.restarts })
      for (const p of [...this.pending.values()].sort((a, b) => a.request.id - b.request.id)) {
        if (!p.sent) this.send(p)
      }
      return
    }
    if (msg.kind === 'event') {
      const { kind: _kind, ...event } = msg
      void _kind
      for (const l of this.listeners) l(event)
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.ok) p.resolve(msg.result)
    else p.reject(new IndexError(msg.error.message, msg.error.code))
  }
}

/** The index host, started, as an object of async methods. */
export function openIndex(): IndexClient {
  const conn = new Connection()
  return new Proxy(conn, {
    get(target, prop) {
      if (prop === 'start' || prop === 'stop' || prop === 'on') {
        const fn = target[prop]
        return fn.bind(target)
      }
      if (typeof prop !== 'string' || prop === 'then') return undefined
      return (...args: unknown[]) => target.request(prop, args)
    }
  }) as unknown as IndexClient
}
