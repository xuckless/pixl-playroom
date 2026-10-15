import { create } from 'zustand'
import { countedFill, timeLeftMs } from '../../../../shared/ai'
import type { MasterEvent, PixlDemosaicEvent, PixlDemosaicState } from '../../../../shared/ipc'

/**
 * The open RAW's full-size develop under way (main's `MasterEvent`): which
 * photo's, since when, and how far by the engine's own count (engine
 * 0.21.0, E68: the model's windows done of all of them). `fill` is null
 * until something is counted (LibRaw's unpack is not), then never goes
 * back; `leftMs` is about how long is left, once a tenth is done.
 */
export const useMastering = create<{
  key: string | null
  since: number
  fill: number | null
  leftMs: number | null
}>(() => ({ key: null, since: 0, fill: null, leftMs: null }))

export function onMaster(e: MasterEvent): void {
  const s = useMastering.getState()
  if (e.phase === 'start')
    useMastering.setState({ key: e.key, since: Date.now(), fill: null, leftMs: null })
  else if (s.key !== e.key) return
  else if (e.phase === 'progress' && e.progress) {
    const fill = countedFill(s.fill, e.progress)
    useMastering.setState({ fill, leftMs: timeLeftMs(Date.now() - s.since, fill) })
  } else if (e.phase === 'end') useMastering.setState({ key: null, fill: null, leftMs: null })
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
