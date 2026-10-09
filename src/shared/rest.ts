/** The engine's safe-shutdown advisory (0.19): when Playroom's hosts are let go (main/rest.ts). */

/** How long hidden or minimised before the hosts go. */
export const HIDDEN_REST_MS = 60_000
/** How long shown but inactive before the hosts go. */
export const INACTIVE_REST_MS = 120_000
/** How long before resting, from what the windows are doing; null while Playroom is in use. */
export function restDelay(state: { visible: boolean; focused: boolean }): number | null {
  if (!state.visible) return HIDDEN_REST_MS
  if (!state.focused) return INACTIVE_REST_MS
  return null
}

/**
 * HR-0.19-2: an engine writes `.<name>.pixl-<pid>-<n>.tmp` beside its target
 * and renames it into place; one left behind is stale once its process is
 * gone. The pid, when `name` is one.
 */
export function engineTempPid(name: string): number | null {
  const m = /^\..+\.pixl-(\d+)-\d+\.tmp$/.exec(name)
  return m ? Number(m[1]) : null
}
