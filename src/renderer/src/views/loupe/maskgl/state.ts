import { create } from 'zustand'

/** WebGL2 failed or was lost for the mask preview: the CSS overlay takes over. */
export const useMaskGlBroken = create<{ broken: boolean }>(() => ({ broken: false }))
