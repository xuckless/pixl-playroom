/**
 * The window's display as an HDR target (main/hdrdisplay.ts), kept current
 * as it moves: what the Full HDR toggle and the renders read.
 */
import { create } from 'zustand'
import type { DisplayHdr } from '../../../shared/hdrdisplay'

export { BOOTSTRAP_HEADROOM, canShowHdr, renderDisplay } from '../../../shared/hdrdisplay'
import { api } from '../lib/api'
import { canShowHdr } from '../../../shared/hdrdisplay'
import { useDevelop } from './develop'
import { useLibrary } from './library'
import { useUi } from './ui'

interface DisplayState {
  display: DisplayHdr | null
}

export const useDisplay = create<DisplayState>(() => ({ display: null }))

/**
 * Whether a photo's editing space holds light above white: a RAW (its Scene
 * develop), a PQ/HLG file, or a gain-map photo edited in HDR. What Full HDR
 * shows above white and the Headroom overlay marks; an SDR photo has neither.
 */
export function aboveWhite(session: { isRaw: boolean; isHdr: boolean } | null): boolean {
  return !!session && (session.isRaw || session.isHdr)
}

/**
 * Whether Develop is showing a photo in HDR now (Full HDR on, a display that
 * can show it, a photo with light above white). Glass over the photo goes to
 * frost alone then: its rim's bend and saturation lift on light above white
 * glare (LiquidGlass).
 */
export function useHdrShown(): boolean {
  const fullHdr = useUi((s) => s.fullHdr)
  const display = useDisplay((s) => s.display)
  const develop = useLibrary((s) => s.view === 'develop')
  const above = useDevelop((s) => aboveWhite(s.session))
  return develop && fullHdr && canShowHdr(display) && above
}

/**
 * Follow the display from main, and tell it whether the system says this
 * window's screen shows HDR (Chromium's `dynamic-range: high`, which follows
 * the window to another screen and Windows' HDR switch): where nothing reads
 * the screen itself, that is what turns Full HDR on. Returns the unsubscribe.
 */
export function startDisplayUpkeep(): () => void {
  void api.app.displayHdr().then(
    (display) => useDisplay.setState({ display }),
    () => undefined
  )
  const off = api.app.onDisplayHdr((display) => useDisplay.setState({ display }))
  const query = window.matchMedia('(dynamic-range: high)')
  const tell = (): void => {
    void api.app.displayDetected(query.matches).then(
      (display) => useDisplay.setState({ display }),
      () => undefined
    )
  }
  tell()
  query.addEventListener('change', tell)
  return () => {
    off()
    query.removeEventListener('change', tell)
  }
}
