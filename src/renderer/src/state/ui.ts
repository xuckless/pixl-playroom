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

/** How a mask is shown over the photo (Lightroom's overlay modes). */
export type OverlayMode = 'color' | 'color-bw' | 'image-black' | 'image-white' | 'white-black'
export const OVERLAY_MODES: { value: OverlayMode; label: string }[] = [
  { value: 'color', label: 'Colour overlay' },
  { value: 'color-bw', label: 'Colour overlay on B&W' },
  { value: 'image-black', label: 'Image on black' },
  { value: 'image-white', label: 'Image on white' },
  { value: 'white-black', label: 'White on black' }
]
export type PinsMode = 'auto' | 'always' | 'never'

export interface BrushSettings {
  /** Diameter in screen pixels. */
  size: number
  /** 0…100: how much of the radius fades (Lightroom's Feather). */
  softness: number
  /** 0…100: how much one dab lays down; strokes build up. */
  flow: number
  /** 0…100: the most a stroke can reach, however often it passes. */
  density: number
  /** Paint only where the colour matches the colour under the brush's centre. */
  autoMask: boolean
  /** A pen's pressure scales size and flow. */
  pressure: boolean
}
/** Lightroom's two brushes, A and B, and the eraser, each remembering its own settings. */
export type BrushSlot = 'A' | 'B' | 'erase'

export interface MaskOverlaySettings {
  mode: OverlayMode
  /** Hue of the colour overlay, 0…360. */
  hue: number
  /** 0…100 */
  opacity: number
  /** Every mask at once, each in its own colour. */
  showAll: boolean
  /** When the on-canvas pins and handles show. */
  pins: PinsMode
}

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
  maskOverlay: MaskOverlaySettings
  setMaskOverlay(p: Partial<MaskOverlaySettings>): void
  brushes: Record<BrushSlot, BrushSettings>
  brushSlot: BrushSlot
  setBrushSlot(s: BrushSlot): void
  /** Change the current brush's settings. */
  setBrush(p: Partial<BrushSettings>): void
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
      maskOverlay: { mode: 'color', hue: 350, opacity: 45, showAll: false, pins: 'auto' },
      setMaskOverlay: (p) => set((s) => ({ maskOverlay: { ...s.maskOverlay, ...p } })),
      brushes: {
        A: { size: 80, softness: 60, flow: 60, density: 100, autoMask: false, pressure: true },
        B: { size: 28, softness: 30, flow: 35, density: 100, autoMask: false, pressure: true },
        erase: { size: 80, softness: 60, flow: 100, density: 100, autoMask: false, pressure: true }
      },
      brushSlot: 'A',
      setBrushSlot: (brushSlot) => set({ brushSlot }),
      setBrush: (p) =>
        set((s) => ({
          brushes: { ...s.brushes, [s.brushSlot]: { ...s.brushes[s.brushSlot], ...p } }
        })),
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
