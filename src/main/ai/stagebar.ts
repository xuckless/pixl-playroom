/**
 * A model job's bar while the engine runs it (Enhance, AI Denoise): what
 * the engine counts once it counts (engine 0.21.0, E68: an enhance chain
 * lays out all its windows before the first runs, so the count is exact
 * from its first read), the clock's guess only until then (an engine
 * without tokens, the moment before the windows are laid out). The count
 * never goes back. Pure, for tests/mastercancel.test.ts.
 */
import { countedFill, estimate } from '../../shared/ai'
import type { Progress } from '../../shared/engine-types'

export interface StageBar {
  /** What the engine counted: give it to the convert's `onProgress`. */
  onProgress(p: Progress): void
  /** The run is over: the clock stops. */
  stop(): void
}

export function stageBar(
  progress: (p: number, estimated?: boolean) => void,
  expectedMs: number,
  tickMs = 250
): StageBar {
  const t0 = Date.now()
  let fill: number | null = null
  const clock = setInterval(() => {
    if (fill === null) progress(estimate(Date.now() - t0, expectedMs), true)
  }, tickMs)
  return {
    onProgress(p) {
      const next = countedFill(fill, p)
      if (next === null || next === fill) return
      fill = next
      clearInterval(clock)
      progress(next, false)
    },
    stop() {
      clearInterval(clock)
    }
  }
}
