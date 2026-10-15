/**
 * Work several callers wait on at once: a RAW's full-size develop, which
 * the develop on open, the 1:1 view, an export, a pixel step and a rebuild
 * all join (`proxy.ts` `ensureMaster`). A caller with a signal (the photo
 * open in Develop) may leave; one without (an export, a pixel step) stays
 * to the end. When the last caller who may leave has left and nobody stays,
 * the work stops (engine 0.21.0, E6: the engine lets go between model
 * nodes and LibRaw's rows), unless it is nearly done by its own count
 * (E68's `CancelToken.progress`): then it finishes, in the background
 * engine as it was, so coming back is instant (the owner, 2026-10-14).
 *
 * Pure, for tests/mastercancel.test.ts.
 */
import type { Progress } from '../shared/engine-types'

/** How far a develop must be by its own count to finish when its last caller leaves. */
export const FINISH_FROM = 0.7

export class SharedWork<T> {
  /** Aborted when the work is to stop: given to the work itself. */
  private readonly abort = new AbortController()
  /** Callers that stay to the end (no signal). */
  private pinned = 0
  /** Callers that may leave, still waiting. */
  private waiting = 0
  private settled = false
  /** Left to finish once nobody waited (nearly done). */
  finishing = false
  /** What the work has counted so far (`count` sets it). */
  progress: Progress = { done: 0, total: 0 }
  readonly promise: Promise<T>
  /** The error a caller who left is rejected with (`Cancelled`). */
  private readonly cancelled: () => Error
  private readonly finishFrom: number

  constructor(
    start: (signal: AbortSignal) => Promise<T>,
    cancelled: () => Error,
    finishFrom = FINISH_FROM
  ) {
    this.cancelled = cancelled
    this.finishFrom = finishFrom
    this.promise = start(this.abort.signal)
    const end = (): void => {
      this.settled = true
    }
    this.promise.then(end, end)
  }

  /** Stopped (every caller who could leave left early): a caller now needs new work. */
  get stopped(): boolean {
    return this.abort.signal.aborted
  }

  /** The work's count, as it moves. */
  count(p: Progress): void {
    this.progress = p
  }

  /**
   * Wait for the work. Without a signal, the caller stays to the end and the
   * work never stops for others leaving. With one, the caller is answered
   * `cancelled` the moment it aborts (the work may run on for others, or
   * finish), and its leaving may stop the work.
   */
  join(signal?: AbortSignal): Promise<T> {
    if (!signal) {
      this.pinned++
      return this.promise
    }
    if (signal.aborted) return Promise.reject(this.cancelled())
    this.waiting++
    return new Promise<T>((resolve, reject) => {
      const leave = (): void => {
        this.waiting--
        reject(this.cancelled())
        this.left()
      }
      signal.addEventListener('abort', leave, { once: true })
      const off = (): void => signal.removeEventListener('abort', leave)
      this.promise.then(
        (v) => {
          off()
          resolve(v)
        },
        (err: unknown) => {
          off()
          reject(err)
        }
      )
    })
  }

  /** The fraction counted so far, 0 while nothing is. */
  get fraction(): number {
    const { done, total } = this.progress
    return total > 0 ? Math.min(1, done / total) : 0
  }

  private left(): void {
    if (this.settled || this.pinned > 0 || this.waiting > 0 || this.stopped || this.finishing)
      return
    if (this.fraction >= this.finishFrom) this.finishing = true
    else this.abort.abort()
  }
}
