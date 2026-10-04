/**
 * How the app is laid out and what the user prefers to see — UI state that
 * outlives a photo and a session, kept in localStorage. Nothing here is part
 * of a recipe.
 */
import { create } from 'zustand'
import { DEFAULT_ENHANCE, normaliseEnhance, type EnhanceSettings } from '../../../shared/enhance'
import type { SpotKind } from '../../../shared/retouch'
import type { AiDenoiseModel } from '../../../shared/recipe'
import { isCardId, type CardId } from '../../../shared/cards'
import { migrateUi } from './uiMigrate'
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
  'glass' | 'color' | 'color-bw' | 'image-black' | 'image-white' | 'white-black' | 'outline'
export const OVERLAY_MODES: { value: OverlayMode; label: string }[] = [
  { value: 'glass', label: 'Glass' },
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
  /** The selected mask's components each in a colour of their own (the colour view). */
  byComponent?: boolean
  /** When the on-canvas pins and handles show. */
  pins: PinsMode
  /** Hide the overlay while a slider moves, so the edit itself shows (Lightroom's auto toggle). */
  autoToggle: boolean
}

export const DEFAULT_MASK_OVERLAY: MaskOverlaySettings = {
  mode: 'glass',
  hue: 350,
  opacity: 45,
  showAll: false,
  pins: 'auto',
  autoToggle: true
}

export interface HealSettings {
  mode: SpotKind
  /** A new spot's radius, a fraction of the frame's shorter side. */
  size: number
  /** 0…100 */
  feather: number
  opacity: number
  /** Visualise Spots: the picture as white specks on black, and how faint a speck still shows (0…100). */
  visualise?: boolean
  spotLevel?: number
}

/**
 * What the right column shows: the adjustment cards, or a canvas tool's own
 * panel in their place while that tool is in hand (Crop, Heal).
 */
export type Drawer = 'adjust' | 'crop' | 'heal'

/** The cards that start unfolded: the ones nearly every edit touches. */
const DEFAULT_CARDS_OPEN: Partial<Record<CardId, boolean>> = {
  wb: true,
  light: true,
  presence: true,
  colour: true
}

/**
 * The masks window: open or not, floating over the photo (its top-left, in px
 * from the stage's) or docked as a column beside the left rail, and folded to
 * a pill or not. Masks are not a wheel tool: the window stays up whatever the
 * right column shows.
 */
export interface MasksWindow {
  open: boolean
  docked: boolean
  minimized: boolean
  x: number
  y: number
}

const DEFAULT_MASKS_WIN: MasksWindow = {
  open: false,
  docked: false,
  minimized: false,
  x: -1,
  y: 14
}

interface UiState {
  /** Which pane the left rail shows, and whether it is open or folded to its spine. */
  rail: Rail
  railOpen: boolean
  /** The filmstrip under the loupe; hidden until asked for. */
  filmstrip: boolean
  /** A folder opens with the photos in its subfolders too. */
  subfolders: boolean
  setSubfolders(on: boolean): void
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
  masksWin: MasksWindow
  setMasksWin(p: Partial<MasksWindow>): void
  /** AI denoise's model and strength for the next step (Detail → AI). */
  denoise: { model: AiDenoiseModel; strength: number }
  setDenoise(p: Partial<{ model: AiDenoiseModel; strength: number }>): void
  /** The adjustment cards, or Crop's or Heal's panel in their place (not remembered). */
  drawer: Drawer
  setDrawer(d: Drawer): void
  /** Which cards are unfolded, and solo mode (opening one folds the rest). */
  cardsOpen: Partial<Record<CardId, boolean>>
  setCardOpen(id: CardId, open: boolean): void
  cardSolo: boolean
  setCardSolo(on: boolean): void
  /** The card last opened or jumped to: Jump to shows it, the previous / next keys step from it. */
  focusCard: CardId
  setFocusCard(id: CardId): void
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

/**
 * localStorage may be missing or refuse writes (private profiles, quota); the
 * app works without it. Writes are gathered and made a moment later (a slider
 * in a panel, a resize, a drag would write the whole state each tick), and
 * whatever waits is written as the window goes.
 */
const WRITE_MS = 400
const waiting = new Map<string, string>()
let writeTimer: ReturnType<typeof setTimeout> | undefined
const local = (): Storage | undefined => {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
const flushWrites = (): void => {
  clearTimeout(writeTimer)
  writeTimer = undefined
  const ls = local()
  for (const [k, v] of waiting) {
    try {
      ls?.setItem(k, v)
    } catch {
      // Quota or a private profile: kept for this session only.
    }
  }
  waiting.clear()
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', flushWrites)
const storage = createJSONStorage(() => ({
  getItem: (k: string) => waiting.get(k) ?? local()?.getItem(k) ?? null,
  setItem: (k: string, v: string) => {
    waiting.set(k, v)
    writeTimer ??= setTimeout(flushWrites, WRITE_MS)
  },
  removeItem: (k: string) => {
    waiting.delete(k)
    local()?.removeItem(k)
  }
}))

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      rail: 'presets',
      railOpen: true,
      filmstrip: false,
      subfolders: false,
      setSubfolders: (subfolders) => set({ subfolders }),
      librarySidebar: true,
      libraryInfo: false,
      setLibrarySidebar: (librarySidebar) => set({ librarySidebar }),
      setLibraryInfo: (libraryInfo) => set({ libraryInfo }),
      cropGuide: 'thirds',
      maskOverlay: DEFAULT_MASK_OVERLAY,
      setMaskOverlay: (p) => set((s) => ({ maskOverlay: { ...s.maskOverlay, ...p } })),
      brushes: {
        A: { size: 80, softness: 60, flow: 60, density: 100, autoMask: false, pressure: true },
        B: { size: 28, softness: 30, flow: 35, density: 100, autoMask: false, pressure: true },
        erase: { size: 80, softness: 60, flow: 100, density: 100, autoMask: false, pressure: true }
      },
      brushSlot: 'A',
      setBrushSlot: (brushSlot) => set({ brushSlot }),
      heal: { mode: 'heal', size: 0.02, feather: 50, opacity: 100 },
      setHeal: (p) => set((s) => ({ heal: { ...s.heal, ...p } })),
      enhance: DEFAULT_ENHANCE,
      setEnhance: (p) => set((s) => ({ enhance: { ...s.enhance, ...p } })),
      setBrush: (p) =>
        set((s) => ({
          brushes: { ...s.brushes, [s.brushSlot]: { ...s.brushes[s.brushSlot], ...p } }
        })),
      masksWin: DEFAULT_MASKS_WIN,
      denoise: { model: 'drunet-color', strength: 100 },
      setDenoise: (p) => set((s) => ({ denoise: { ...s.denoise, ...p } })),
      setMasksWin: (p) => set((s) => ({ masksWin: { ...s.masksWin, ...p } })),
      drawer: 'adjust',
      setDrawer: (drawer) => set({ drawer }),
      cardsOpen: DEFAULT_CARDS_OPEN,
      setCardOpen: (id, open) =>
        set((s) => ({
          cardsOpen: s.cardSolo && open ? { [id]: true } : { ...s.cardsOpen, [id]: open },
          ...(open ? { focusCard: id } : {})
        })),
      cardSolo: false,
      setCardSolo: (cardSolo) =>
        set((s) => ({ cardSolo, ...(cardSolo ? { cardsOpen: { [s.focusCard]: true } } : {}) })),
      focusCard: 'light',
      setFocusCard: (focusCard) => set({ focusCard }),
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
      version: 4,
      migrate: (persisted, version) => migrateUi(persisted, version),
      // Crop or Heal is never in hand when the app opens.
      partialize: (s) => {
        const { drawer: _drawer, ...kept } = s
        void _drawer
        return kept
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UiState>
        return {
          ...current,
          ...p,
          // Settings saved before a field existed take its default.
          enhance: normaliseEnhance(p.enhance),
          masksWin: { ...DEFAULT_MASKS_WIN, ...p.masksWin },
          maskOverlay: { ...DEFAULT_MASK_OVERLAY, ...p.maskOverlay },
          denoise: { model: 'drunet-color', strength: 100, ...p.denoise },
          keyBindings: p.keyBindings && typeof p.keyBindings === 'object' ? p.keyBindings : {},
          cardsOpen:
            p.cardsOpen && typeof p.cardsOpen === 'object' ? p.cardsOpen : current.cardsOpen,
          focusCard: isCardId(p.focusCard) ? p.focusCard : current.focusCard,
          drawer: 'adjust'
        }
      }
    }
  )
)
