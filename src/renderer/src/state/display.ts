/**
 * The window's display as an HDR target (main/hdrdisplay.ts), kept current
 * as it moves: what the Full HDR toggle and the renders read.
 */
import { create } from 'zustand'
import type { DisplayHdr } from '../../../shared/hdrdisplay'

export { BOOTSTRAP_HEADROOM, canShowHdr, renderDisplay } from '../../../shared/hdrdisplay'
import { api } from '../lib/api'

interface DisplayState {
  display: DisplayHdr | null
}

export const useDisplay = create<DisplayState>(() => ({ display: null }))

/** Follow the display from main. Returns the unsubscribe. */
export function startDisplayUpkeep(): () => void {
  void api.app.displayHdr().then(
    (display) => useDisplay.setState({ display }),
    () => undefined
  )
  return api.app.onDisplayHdr((display) => useDisplay.setState({ display }))
}
