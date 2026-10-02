import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'

/** Whether the picture under the overlay should turn grey (colour on B&W). */
export function useGreyUnderOverlay(): boolean {
  const overlay = useDevelop((s) => s.overlay && s.layerId !== null && s.tool !== 'crop')
  const mode = useUi((s) => s.maskOverlay.mode)
  const all = useUi((s) => s.maskOverlay.showAll)
  const up = useUi((s) => s.masksWin.open && !s.masksWin.minimized)
  return overlay && up && mode === 'color-bw' && !all
}
