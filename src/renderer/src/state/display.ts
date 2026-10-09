/**
 * The window's display as an HDR target (main/hdrdisplay.ts), kept current
 * as it moves: what the Full HDR toggle and the renders read.
 */
import { create } from 'zustand'
import type { DisplayHdr } from '../../../shared/hdrdisplay'

export { BOOTSTRAP_HEADROOM, canShowHdr, renderDisplay } from '../../../shared/hdrdisplay'
import { api } from '../lib/api'
import { canShowHdr } from '../../../shared/hdrdisplay'
import { useLibrary } from './library'
import { useUi } from './ui'

interface DisplayState {
  display: DisplayHdr | null
}

export const useDisplay = create<DisplayState>(() => ({ display: null }))

/**
 * Whether Develop is showing a photo in HDR now (Full HDR on, a display that
 * can show it). Glass over the photo goes to frost alone then: its rim's bend
 * and saturation lift on light above white glare (LiquidGlass).
 */
export function useHdrShown(): boolean {
  const fullHdr = useUi((s) => s.fullHdr)
  const display = useDisplay((s) => s.display)
  const develop = useLibrary((s) => s.view === 'develop')
  return develop && fullHdr && canShowHdr(display)
}

/** Follow the display from main. Returns the unsubscribe. */
export function startDisplayUpkeep(): () => void {
  void api.app.displayHdr().then(
    (display) => useDisplay.setState({ display }),
    () => undefined
  )
  return api.app.onDisplayHdr((display) => useDisplay.setState({ display }))
}
