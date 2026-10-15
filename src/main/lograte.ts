/**
 * A warning that can come once per file (a thumbnail that fails, over a
 * folder of thousands): the first few of a burst are logged in full, the
 * rest counted and logged as one line when the burst is over, so a bad
 * folder never writes a line per photo.
 */
export interface LogRate {
  /** Whether this one is logged in full; when not, it is counted. */
  take(): boolean
  /** The count since the last summary (and starts again), or 0. */
  drain(): number
}

export function logRate(first: number, windowMs: number, now = Date.now): LogRate {
  let start = -Infinity
  let taken = 0
  let skipped = 0
  return {
    take() {
      const t = now()
      if (t - start >= windowMs) {
        start = t
        taken = 0
      }
      if (taken < first) {
        taken++
        return true
      }
      skipped++
      return false
    },
    drain() {
      const n = skipped
      skipped = 0
      return n
    }
  }
}

/**
 * `warn` through a rate: in full while it allows, then one summary
 * (`summary(n)`) `windowMs` after the first one it held back.
 */
export function rateLimited(
  first: number,
  windowMs: number,
  warn: (...args: unknown[]) => void,
  summary: (n: number) => string
): (...args: unknown[]) => void {
  const rate = logRate(first, windowMs)
  let timer: ReturnType<typeof setTimeout> | null = null
  return (...args) => {
    if (rate.take()) return warn(...args)
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      const n = rate.drain()
      if (n > 0) warn(summary(n))
    }, windowMs)
    timer.unref?.()
  }
}
