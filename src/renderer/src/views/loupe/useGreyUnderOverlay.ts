import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'

/** Whether the picture under the overlay should turn grey (colour on B&W). */
export function useGreyUnderOverlay(): boolean {
  const overlay = useDevelop((s) => s.overlay && s.layerId !== null && s.tool !== 'crop')
  const mode = useUi((s) => s.maskOverlay.mode)
  const all = useUi((s) => s.maskOverlay.showAll)
  return overlay && mode === 'color-bw' && !all
}
