/**
 * The Looks browser's cards: the open photo, small, with each look on it.
 * The browser asks for the cards it can see (and a row ahead), in the order
 * it shows them; a newer ask replaces whatever still waits, and the card
 * being made finishes only if it is still wanted. One render at a time, on
 * the background engine, which already gives way to the loupe's renders.
 *
 * This is the scheduling alone; what a card is (the recipe, the engine
 * request, the cache) is the session's (`render.ts`), handed in as `make`.
 */
export interface LookThumb {
  url: string
  width: number
  height: number
}

export interface ThumbJob<R> {
  /** The card: a look's id, or `current`. */
  id: string
  /** What it shows: the photo's recipe with the look on it. */
  recipe: R
}

export class LookThumbQueue<R> {
  private waiting: ThumbJob<R>[] = []
  private token = 0
  private running: { job: ThumbJob<R>; abort: AbortController } | null = null
  private closed = false

  private readonly make: (job: ThumbJob<R>, signal: AbortSignal) => Promise<LookThumb>
  private readonly emit: (token: number, id: string, thumb: LookThumb) => void
  private readonly same: (a: R, b: R) => boolean

  constructor(
    make: (job: ThumbJob<R>, signal: AbortSignal) => Promise<LookThumb>,
    emit: (token: number, id: string, thumb: LookThumb) => void,
    same: (a: R, b: R) => boolean = (a, b) => a === b
  ) {
    this.make = make
    this.emit = emit
    this.same = same
  }

  /**
   * The cards wanted now, in order. A token older than the last one asked
   * with is a late message and changes nothing.
   */
  request(token: number, jobs: ThumbJob<R>[]): void {
    if (this.closed || token < this.token) return
    this.token = token
    this.waiting = [...jobs]
    const r = this.running
    if (r) {
      const still = this.waiting.findIndex(
        (j) => j.id === r.job.id && this.same(j.recipe, r.job.recipe)
      )
      if (still >= 0) this.waiting.splice(still, 1)
      else r.abort.abort()
    }
    void this.pump()
  }

  /** Nothing more is wanted (the browser closed). */
  cancel(): void {
    this.waiting = []
    this.running?.abort.abort()
  }

  /** The photo closed: nothing more, ever. */
  close(): void {
    this.closed = true
    this.cancel()
  }

  get busy(): boolean {
    return this.running !== null || this.waiting.length > 0
  }

  private async pump(): Promise<void> {
    while (!this.running && !this.closed) {
      const job = this.waiting.shift()
      if (!job) return
      const abort = new AbortController()
      this.running = { job, abort }
      try {
        const thumb = await this.make(job, abort.signal)
        // Still wanted (a newer ask that wanted it kept it running): said under that ask.
        if (!abort.signal.aborted && !this.closed) this.emit(this.token, job.id, thumb)
      } catch (err) {
        // A card no longer wanted was stopped; any other failure loses that card only.
        if (!abort.signal.aborted && !this.closed) console.warn('look thumbnail failed', err)
      } finally {
        this.running = null
      }
    }
  }
}
