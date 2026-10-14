import { create } from 'zustand'
import type { MasterEvent } from '../../../../shared/ipc'

/**
 * The open RAW's full-size develop under way (main's `MasterEvent`): which
 * photo's, since when, and how long it should take. The engine says nothing
 * while it develops, so the loupe's badge shows how far by the clock.
 */
export const useMastering = create<{ key: string | null; since: number; expectedMs: number }>(
  () => ({ key: null, since: 0, expectedMs: 0 })
)

export function onMaster(e: MasterEvent): void {
  if (e.expectedMs !== null)
    useMastering.setState({ key: e.key, since: Date.now(), expectedMs: e.expectedMs })
  else if (useMastering.getState().key === e.key) useMastering.setState({ key: null })
}
