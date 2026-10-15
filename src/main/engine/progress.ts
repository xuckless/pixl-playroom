/**
 * A call's progress (engine 0.21.0, E68): the engine counts each window of
 * a model's tiled run and each band of a RAW develop on the call's own
 * `CancelToken`, and says nothing itself, so the host reads the token on a
 * timer and tells main when it moved. Apart from the host for its tests.
 */
import type {
  CancelToken,
  EngineProgressMessage,
  PixlEngineModule
} from '../../shared/engine-types'

/** How often a call's progress is read (ten times a second at most: two atomic loads each). */
export const PROGRESS_MS = 100

/**
 * A token for call `id`, read every `everyMs` while it runs; what it has
 * counted goes to `send` when it moves. One token per call, never reused (a
 * token keeps counting, and once cancelled stays so). Null for an engine
 * without tokens (a development kit on 0.20): that call is counted by the
 * clock, as before.
 */
export function progressOf(
  e: Pick<PixlEngineModule, 'CancelToken'>,
  id: number,
  send: (msg: EngineProgressMessage) => void,
  everyMs = PROGRESS_MS
): { token: CancelToken; stop(): void } | null {
  if (typeof e.CancelToken !== 'function') return null
  const token = new e.CancelToken()
  let done = -1
  let total = -1
  const timer = setInterval(() => {
    const p = token.progress
    if (p.done === done && p.total === total) return
    done = p.done
    total = p.total
    send({ kind: 'progress', id, done, total })
  }, everyMs)
  return { token, stop: () => clearInterval(timer) }
}
