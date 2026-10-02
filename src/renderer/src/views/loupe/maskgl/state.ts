import { create } from 'zustand'
import type { MaskComponentSetting } from '../../../../../shared/recipe'

/** WebGL2 failed or was lost for the mask preview: the CSS overlay takes over. */
export const useMaskGlBroken = create<{ broken: boolean }>(() => ({ broken: false }))

/**
 * A component being drawn and not yet in the recipe (a lasso before it
 * closes): the loupe's mask joins it to the selected mask, so what is drawn
 * shows as it will be, feather and all. Never in the history.
 */
export const useMaskDraft = create<{ draft: MaskComponentSetting | null }>(() => ({
  draft: null
}))
