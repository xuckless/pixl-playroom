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

export type Rail = 'presets' | 'snapshots' | 'history' | 'info'

export type ToolId =
  | 'basic'
  | 'curve'
  | 'hsl'
  | 'grade'
  | 'detail'
  | 'effects'
  | 'masks'
  | 'crop'
  | 'calibration'
  | 'advanced'

interface UiState {
  /** Which pane the left rail shows, and whether it is open or folded to its spine. */
  rail: Rail
  railOpen: boolean
  /** The filmstrip under the loupe; hidden until asked for. */
  filmstrip: boolean
  cropGuide: CropGuide
  /** The one tool the right column shows, chosen on the thumb-wheel. */
  panel: ToolId
  /** The tool before the last change, for a shortcut that toggles back. */
  previousPanel: ToolId
  setPanel(p: ToolId): void
  /** A spine glyph: open its pane, or fold the rail when it is already showing. */
  pickRail(r: Rail): void
  setRailOpen(open: boolean): void
  setFilmstrip(open: boolean): void
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
      rail: 'presets',
      railOpen: true,
      filmstrip: false,
      cropGuide: 'thirds',
      panel: 'basic',
      previousPanel: 'basic',
      setPanel: (panel) => {
        const cur = get().panel
        if (cur !== panel) set({ panel, previousPanel: cur })
      },
      pickRail: (rail) => {
        const s = get()
        if (s.rail === rail && s.railOpen) set({ railOpen: false })
        else set({ rail, railOpen: true })
      },
      setRailOpen: (railOpen) => set({ railOpen }),
      setFilmstrip: (filmstrip) => set({ filmstrip }),
      setCropGuide: (cropGuide) => set({ cropGuide }),
      cycleCropGuide: () => {
        const i = CROP_GUIDES.findIndex((g) => g.value === get().cropGuide)
        set({ cropGuide: CROP_GUIDES[(i + 1) % CROP_GUIDES.length].value })
      }
    }),
    { name: 'playroom.ui', storage, version: 1 }
  )
)
