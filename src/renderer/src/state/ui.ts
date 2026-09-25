/**
 * How the app is laid out and what the user prefers to see — UI state that
 * outlives a photo and a session, kept in localStorage. Nothing here is part
 * of a recipe.
 */
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type CropGuide = 'thirds' | 'grid' | 'golden' | 'diagonal' | 'none'
export const CROP_GUIDES: { value: CropGuide; label: string }[] = [
  { value: 'thirds', label: 'Thirds' },
  { value: 'grid', label: 'Grid' },
  { value: 'golden', label: 'Golden' },
  { value: 'diagonal', label: 'Diagonal' },
  { value: 'none', label: 'None' }
]

interface UiState {
  cropGuide: CropGuide
  setCropGuide(g: CropGuide): void
  cycleCropGuide(): void
}

/** localStorage may be missing or refuse writes (private profiles, quota); the app works without it. */
const storage = createJSONStorage(() => {
  try {
    return window.localStorage
  } catch {
    return undefined as unknown as Storage
  }
})

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      cropGuide: 'thirds',
      setCropGuide: (cropGuide) => set({ cropGuide }),
      cycleCropGuide: () => {
        const i = CROP_GUIDES.findIndex((g) => g.value === get().cropGuide)
        set({ cropGuide: CROP_GUIDES[(i + 1) % CROP_GUIDES.length].value })
      }
    }),
    { name: 'playroom.ui', storage, version: 1 }
  )
)
