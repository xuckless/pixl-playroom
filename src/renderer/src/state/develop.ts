import { create } from 'zustand'
import type { ImageStats, NoiseEstimate } from '../../../shared/engine-types'
import type {
  DevelopSession,
  HistoryEntry,
  RenderEvent,
  RenderReport,
  Snapshot,
  ViewState
} from '../../../shared/ipc'
import { newId, type HslBand, type Recipe } from '../../../shared/recipe'
import { api, errorText } from '../lib/api'
import { useLibrary } from './library'

export type Tool = 'none' | 'crop' | 'brush' | 'polygon' | 'wb-picker' | 'range-picker'
export type Compare = 'off' | 'before' | 'split'

export interface BrushSettings {
  /** Diameter in screen pixels. */
  size: number
  /** 0…100: how soft the dab's edge is. */
  softness: number
  /** 0…100: how much one pass lays down. */
  flow: number
  erase: boolean
}

interface DevelopState {
  session: DevelopSession | null
  loading: boolean
  recipe: Recipe | null
  history: HistoryEntry[]
  cursor: number
  snapshots: Snapshot[]
  picture: RenderEvent | null
  before: RenderEvent | null
  mask: RenderEvent | null
  report: RenderReport | null
  stats: ImageStats | null
  error: string | null
  rendering: boolean
  tool: Tool
  layerId: string | null
  overlay: boolean
  compare: Compare
  clipping: boolean
  zoom: 'fit' | 1
  hslFocus: HslBand | null
  hslTab: 'hue' | 'saturation' | 'luminance' | 'all'
  brush: BrushSettings
  noise: NoiseEstimate | null
  targetEdge: number

  open(key: string): Promise<void>
  close(): Promise<void>
  /** Change the recipe. Interactive edits render the draft and write no history. */
  edit(change: (r: Recipe) => void, interactive?: boolean): void
  /** Settle an edit: render in full and record it in the history under `label`. */
  commit(label: string): void
  /** Replace the recipe wholesale (paste, preset, snapshot) and record it. */
  replace(recipe: Recipe, label: string): void
  undo(): void
  redo(): void
  goto(index: number): void
  setTool(tool: Tool): void
  setLayer(id: string | null): void
  setOverlay(on: boolean): void
  setCompare(c: Compare): void
  setClipping(on: boolean): void
  setZoom(z: 'fit' | 1): void
  setHslFocus(b: HslBand | null): void
  setHslTab(t: DevelopState['hslTab']): void
  setBrush(b: Partial<BrushSettings>): void
  setTargetEdge(n: number): void
  pushView(): void
  onRendered(e: RenderEvent): void
  onError(message: string): void
  saveSnapshot(name: string): Promise<void>
  removeSnapshot(id: string): Promise<void>
  measureNoise(): Promise<void>
}

export const useDevelop = create<DevelopState>((set, get) => ({
  session: null,
  loading: false,
  recipe: null,
  history: [],
  cursor: -1,
  snapshots: [],
  picture: null,
  before: null,
  mask: null,
  report: null,
  stats: null,
  error: null,
  rendering: false,
  tool: 'none',
  layerId: null,
  overlay: true,
  compare: 'off',
  clipping: false,
  zoom: 'fit',
  hslFocus: null,
  hslTab: 'all',
  brush: { size: 80, softness: 60, flow: 60, erase: false },
  noise: null,
  targetEdge: 2560,

  async open(key) {
    const prev = get().session
    if (prev?.key === key) return
    set({
      loading: true,
      error: null,
      picture: null,
      before: null,
      mask: null,
      stats: null,
      report: null,
      noise: null,
      layerId: null,
      tool: 'none',
      zoom: 'fit'
    })
    try {
      const session = await api.develop.open(key)
      let history = await api.develop.historyList(key)
      if (history.length === 0) {
        history = [await api.develop.historyAppend(key, 'Opened', session.recipe)]
      }
      set({
        session,
        recipe: session.recipe,
        history,
        cursor: history.length - 1,
        snapshots: session.snapshots,
        loading: false
      })
      get().pushView()
    } catch (err) {
      set({ loading: false, error: errorText(err) })
    }
  },

  async close() {
    const s = get().session
    if (s) await api.develop.close(s.key)
    set({ session: null, recipe: null, picture: null, before: null, mask: null })
  },

  edit(change, interactive = false) {
    const { session, recipe } = get()
    if (!session || !recipe) return
    const next = structuredClone(recipe)
    change(next)
    set({ recipe: next, rendering: true })
    void api.develop
      .update(session.key, next, interactive)
      .catch((err) => get().onError(errorText(err)))
  },

  commit(label) {
    const { session, recipe } = get()
    if (!session || !recipe) return
    set({ rendering: true })
    void api.develop
      .update(session.key, recipe, false)
      .catch((err) => get().onError(errorText(err)))
    void api.develop.historyAppend(session.key, label, recipe).then((entry) => {
      set((s) => ({ history: [...s.history, entry], cursor: s.history.length }))
    })
    const item = useLibrary.getState().items.find((i) => i.key === session.key)
    if (item && !item.edited) useLibrary.getState().patchItems([{ ...item, edited: true }])
  },

  replace(recipe, label) {
    set({ recipe })
    get().commit(label)
  },

  undo() {
    const { cursor } = get()
    if (cursor > 0) get().goto(cursor - 1)
  },

  redo() {
    const { cursor, history } = get()
    if (cursor < history.length - 1) get().goto(cursor + 1)
  },

  goto(index) {
    const { session, history } = get()
    const entry = history[index]
    if (!session || !entry) return
    set({ recipe: entry.recipe, cursor: index, rendering: true })
    void api.develop.update(session.key, entry.recipe, false)
  },

  setTool(tool) {
    const prev = get().tool
    set({ tool })
    if ((prev === 'crop') !== (tool === 'crop')) get().pushView()
  },

  setLayer(layerId) {
    set({ layerId })
    get().pushView()
  },

  setOverlay(overlay) {
    set({ overlay })
  },

  setCompare(compare) {
    set({ compare })
  },

  setClipping(clipping) {
    set({ clipping })
  },

  setZoom(zoom) {
    set({ zoom })
  },

  setHslFocus(hslFocus) {
    set({ hslFocus })
  },

  setHslTab(hslTab) {
    set({ hslTab })
  },

  setBrush(b) {
    set((s) => ({ brush: { ...s.brush, ...b } }))
  },

  setTargetEdge(targetEdge) {
    if (Math.abs(targetEdge - get().targetEdge) < 64) return
    set({ targetEdge })
    get().pushView()
  },

  pushView() {
    const { session, tool, layerId, targetEdge } = get()
    if (!session) return
    const view: ViewState = {
      cropMode: tool === 'crop',
      // The before render also feeds the hue chart's ghost bars, so it is
      // always wanted, compared or not.
      before: true,
      // A selected layer's mask is rendered whether or not the overlay shows:
      // the hue chart measures inside it.
      maskLayer: layerId,
      targetEdge
    }
    set({ rendering: true })
    void api.develop.view(session.key, view)
  },

  onRendered(e) {
    const { session } = get()
    if (!session || e.key !== session.key) return
    if (e.kind === 'before') set({ before: e })
    else if (e.kind === 'mask') set({ mask: e })
    else {
      const cur = get().picture
      // A late draft must not replace a newer render.
      if (cur && e.seq < cur.seq) return
      set({
        picture: e,
        stats: e.stats ?? null,
        report: e.report ?? null,
        error: null,
        rendering: e.kind === 'draft'
      })
    }
  },

  onError(message) {
    set({ error: message, rendering: false })
  },

  async saveSnapshot(name) {
    const { session, recipe, snapshots } = get()
    if (!session || !recipe) return
    const next = [...snapshots, { id: newId(), name, at: new Date().toISOString(), recipe }]
    set({ snapshots: next })
    await api.develop.saveSnapshots(session.key, next)
  },

  async removeSnapshot(id) {
    const { session, snapshots } = get()
    if (!session) return
    const next = snapshots.filter((s) => s.id !== id)
    set({ snapshots: next })
    await api.develop.saveSnapshots(session.key, next)
  },

  async measureNoise() {
    const { session } = get()
    if (!session) return
    try {
      set({ noise: await api.develop.noise(session.key) })
    } catch (err) {
      useLibrary.getState().say(`Noise measurement: ${errorText(err)}`, 'error')
    }
  }
}))
