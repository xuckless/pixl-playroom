import type { PlayroomApi } from '../../../preload/index'

/** The bridge the preload exposes. */
export const api: PlayroomApi = window.playroom

/** The message of anything thrown across the bridge, with the engine's field when it named one. */
export function errorText(err: unknown): string {
  const e = err as { message?: string; field?: string; code?: string }
  const msg = e?.message ?? String(err)
  return e?.field ? `${msg} (field: ${e.field})` : msg
}
