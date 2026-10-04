import { create } from 'zustand'
import { api } from '../lib/api'
import { useLibrary } from './library'

/** The photo whose legacy preview the comparison dialog shows. */
interface LegacyState {
  key: string | null
  show(key: string): void
}

export const useLegacy = create<LegacyState>((set) => ({
  key: null,
  show(key) {
    set({ key })
    useLibrary.getState().setDialog('legacy')
  }
}))

/**
 * A photo just opened: when an edit of it has a legacy preview that was not
 * shown yet, offer the before and after once (engine 0.17 moved its pixels).
 * Nothing interrupts another dialog; the photo stays reachable from the menu.
 */
export async function offerLegacy(key: string, stale: () => boolean): Promise<void> {
  try {
    const p = await api.legacy.get(key)
    if (!p || p.seen || stale()) return
    if (useLibrary.getState().dialog !== null) return
    useLegacy.getState().show(key)
  } catch {
    // Nothing to compare: the photo opens as it always did.
  }
}
