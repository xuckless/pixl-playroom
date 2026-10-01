/**
 * How the app is laid out and what the user prefers to see — UI state that
 * outlives a photo and a session, kept in localStorage. Nothing here is part
 * of a recipe.
 */
import { create } from 'zustand'
import { DEFAULT_ENHANCE, type EnhanceSettings } from '../../../shared/enhance'
import type { SpotKind } from '../../../shared/retouch'
import type { Bindings, Chord } from '../lib/keys'
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
export type OverlayMode =
  'color' | 'color-bw' | 'image-black' | 'image-white' | 'white-black' | 'outline'
export const OVERLAY_MODES: { value: OverlayMode; label: string }[] = [
  { value: 'color', label: 'Colour overlay' },
  { value: 'color-bw', label: 'Colour overlay on B&W' },
  { value: 'image-black', label: 'Image on black' },
  { value: 'image-white', label: 'Image on white' },
  { value: 'white-black', label: 'White on black' },
  { value: 'outline', label: 'Outline' }
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

export interface HealSettings {
  mode: SpotKind
  /** A new spot's radius, a fraction of the frame's shorter side. */
  size: number
  /** 0…100 */
  feather: number
  opacity: number
  /** Show every spot's outline (H); otherwise only the selected one and the one under the pointer. */
  showAll: boolean
}

/** Every tool the wheel can hold (its order is `TOOLS`, in develop/tools.ts). */
export const TOOL_IDS = [
  'basic',
  'curve',
  'hsl',
  'grade',
  'detail',
  'lens',
  'effects',
  'masks',
  'heal',
  'crop',
  'calibration',
  'enhance'
] as const

export type ToolId = (typeof TOOL_IDS)[number]

const isToolId = (v: unknown): v is ToolId => TOOL_IDS.includes(v as ToolId)

interface UiState {
  /** Which pane the left rail shows, and whether it is open or folded to its spine. */
  rail: Rail
  railOpen: boolean
  /** The filmstrip under the loupe; hidden until asked for. */
  filmstrip: boolean
  /** The library's sources down the left, and its info drawer on the right. */
  librarySidebar: boolean
  libraryInfo: boolean
  setLibrarySidebar(open: boolean): void
  setLibraryInfo(open: boolean): void
  cropGuide: CropGuide
  maskOverlay: MaskOverlaySettings
  setMaskOverlay(p: Partial<MaskOverlaySettings>): void
  brushes: Record<BrushSlot, BrushSettings>
  brushSlot: BrushSlot
  setBrushSlot(s: BrushSlot): void
  /** The Heal tool's mode and brush for new spots, and whether spots show on the photo. */
  heal: HealSettings
  setHeal(p: Partial<HealSettings>): void
  /** The Enhance tool's steps, kept for the next photo. */
  enhance: EnhanceSettings
  setEnhance(p: Partial<EnhanceSettings>): void
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
  /**
   * The user's own key bindings, by command id: only the ones changed from the
   * defaults, so a default that changes in a later version still arrives.
   */
  keyBindings: Bindings
  /** Bind a command's keys (`[]` unbinds it), or `null` to go back to its default. */
  setKeyBinding(id: string, keys: Chord[] | null): void
  resetKeyBindings(): void
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
      librarySidebar: true,
      libraryInfo: false,
      setLibrarySidebar: (librarySidebar) => set({ librarySidebar }),
      setLibraryInfo: (libraryInfo) => set({ libraryInfo }),
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
      heal: { mode: 'heal', size: 0.02, feather: 50, opacity: 100, showAll: false },
      setHeal: (p) => set((s) => ({ heal: { ...s.heal, ...p } })),
      enhance: DEFAULT_ENHANCE,
      setEnhance: (p) => set((s) => ({ enhance: { ...s.enhance, ...p } })),
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
      },
      keyBindings: {},
      setKeyBinding: (id, keys) =>
        set((s) => {
          const next = { ...s.keyBindings }
          if (keys) next[id] = keys
          else delete next[id]
          return { keyBindings: next }
        }),
      resetKeyBindings: () => set({ keyBindings: {} })
    }),
    {
      name: 'playroom.ui',
      storage,
      version: 1,
      // A tool saved by an older build that the wheel no longer has (the
      // Engine tool, now a dialog) comes back as Basic.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>
        return {
          ...current,
          ...p,
          // Settings saved before a field existed take its default.
          enhance: { ...DEFAULT_ENHANCE, ...p.enhance },
          keyBindings: p.keyBindings && typeof p.keyBindings === 'object' ? p.keyBindings : {},
          panel: isToolId(p.panel) ? p.panel : current.panel,
          previousPanel: isToolId(p.previousPanel) ? p.previousPanel : current.previousPanel
        }
      }
    }
  )
)
