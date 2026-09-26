/**
 * A small pool of `worker_threads` for the pixels worker: jobs go round the
 * threads; a thread that dies fails its jobs and is replaced on the next one.
 * The main process only posts and awaits.
 */
import log from 'electron-log/main'
import { availableParallelism } from 'os'
import type { Worker } from 'worker_threads'
import type { Orientation } from '../../shared/engine-types'
import type { CameraInfo } from '../../shared/ipc'
import type { LinearComponent, RadialComponent } from '../../shared/recipe'
import createPixels from './pixels.worker?nodeWorker'

export type PixelsJob =
  | {
      op: 'gradient'
      file: string
      dir: string
      c: LinearComponent | RadialComponent
      user: Orientation
    }
  | { op: 'brush'; file: string; png: string; user: Orientation }
  | { op: 'camera'; path: string }

type Reply = { id: number; value?: unknown; error?: string }

class Pool {
  private threads: (Worker | null)[]
  private turn = 0
  private nextId = 0
  private waiting = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; thread: number }
  >()

  constructor(size: number) {
    this.threads = new Array(size).fill(null)
  }

  private thread(i: number): Worker {
    const live = this.threads[i]
    if (live) return live
    const w = createPixels({})
    w.on('message', (r: Reply) => {
      const job = this.waiting.get(r.id)
      if (!job) return
      this.waiting.delete(r.id)
      if (r.error !== undefined) job.reject(new Error(r.error))
      else job.resolve(r.value)
    })
    const fail = (err: Error): void => {
      log.warn('pixels worker stopped', err.message)
      this.threads[i] = null
      for (const [id, job] of this.waiting)
        if (job.thread === i) {
          this.waiting.delete(id)
          job.reject(err)
        }
    }
    w.on('error', fail)
    w.on('exit', (code) => code !== 0 && fail(new Error(`exit ${code}`)))
    // An idle pool does not keep the app alive.
    w.unref()
    this.threads[i] = w
    return w
  }

  run<T>(job: PixelsJob): Promise<T> {
    const i = this.turn
    this.turn = (this.turn + 1) % this.threads.length
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (v: unknown) => void, reject, thread: i })
      this.thread(i).postMessage({ ...job, id })
    })
  }

  camera(path: string): Promise<CameraInfo> {
    return this.run<CameraInfo>({ op: 'camera', path })
  }

  close(): void {
    for (const w of this.threads) void w?.terminate()
    this.threads.fill(null)
  }
}

/** Two threads: planes for a render and exif for a folder rarely need more. */
export const pixels = new Pool(Math.min(2, Math.max(1, availableParallelism() - 1)))
