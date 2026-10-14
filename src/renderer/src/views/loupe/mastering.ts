import { create } from 'zustand'
import type { MasterEvent, PixlDemosaicEvent, PixlDemosaicState } from '../../../../shared/ipc'

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

/**
 * The PIXL demosaic's part in each open RAW (main's `PixlDemosaicEvent`, a
 * development kit's): developing, on (the picture is the model's, zoomed out
 * and at 1:1), or refused (the released develop stood in).
 */
export const usePixlDemosaic = create<{ states: Record<string, PixlDemosaicState> }>(() => ({
  states: {}
}))

export function onPixlDemosaic(e: PixlDemosaicEvent): void {
  usePixlDemosaic.setState((s) => {
    const states = { ...s.states }
    if (e.state) states[e.key] = e.state
    else delete states[e.key]
    return { states }
  })
}
