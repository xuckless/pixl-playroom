import { create } from 'zustand'
import type { ImageStats, MaskMode, NoiseEstimate } from '../../../shared/engine-types'
import type {
  DevelopSession,
  HistoryEntry,
  RenderEvent,
  RenderReport,
  Snapshot,
  ViewState
} from '../../../shared/ipc'
import { newId, type HslBand, type Recipe } from '../../../shared/recipe'
import { FIT, type ZoomView } from '../../../shared/view'
import { api, errorText } from '../lib/api'
import { touchInteracting } from '../lib/interacting'
import { useLibrary } from './library'
import { useUi } from './ui'

export type Tool =
  'none' | 'crop' | 'brush' | 'polygon' | 'linear' | 'radial' | 'wb-picker' | 'range-picker'
export type Compare = 'off' | 'before' | 'split'
/** A geometry gesture in progress: the loupe draws its grid while one runs. */
export type Gesture = 'straighten' | 'crop' | 'rotate' | null

interface DevelopState {
  session: DevelopSession | null
  loading: boolean
  recipe: Recipe | null
  history: HistoryEntry[]
  cursor: number
  snapshots: Snapshot[]
  /** The picture on screen: the latest render for the current view. */
  picture: RenderEvent | null
  /** The latest render for each view, so opening or closing the crop tool swaps at once. */
  pictures: Pictures
  before: RenderEvent | null
  mask: RenderEvent | null
  report: RenderReport | null
  stats: ImageStats | null
  error: string | null
  rendering: boolean
  tool: Tool
  gesture: Gesture
  layerId: string | null
  /** The selected component of the selected mask. */
  compId: string | null
  /**
   * How the next component the user makes joins the selected mask: set by
   * the masks panel's Add / Subtract / Intersect, cleared once it is made.
   */
  addMode: MaskMode | null
  /** Every mask, small (the masks panel's thumbnails), by layer id. */
  maskThumbs: Record<string, RenderEvent>
  overlay: boolean
  compare: Compare
  clipping: boolean
  /** How the loupe looks at the picture: fitted, or zoomed about a point. */
  zoom: ZoomView
  hslFocus: HslBand | null
  hslTab: 'hue' | 'saturation' | 'luminance' | 'all'
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
  setGesture(g: Gesture): void
  setComp(id: string | null): void
  setAddMode(m: MaskMode | null): void
  setLayer(id: string | null): void
  setOverlay(on: boolean): void
  setCompare(c: Compare): void
  setClipping(on: boolean): void
  setZoom(z: ZoomView): void
  setHslFocus(b: HslBand | null): void
  setHslTab(t: DevelopState['hslTab']): void
  setTargetEdge(n: number): void
  pushView(): void
  onRendered(e: RenderEvent): void
  onError(message: string): void
  saveSnapshot(name: string): Promise<void>
  removeSnapshot(id: string): Promise<void>
  measureNoise(): Promise<void>
}

/**
 * Interactive edits (a slider or handle moving) reach the main process at
 * most once per frame: the store holds the newest recipe at once, so the
 * controls follow the pointer, and the engine only ever sees the latest one.
 * Anything that settles an edit sends straight away and drops what waits.
 */
let queued: { key: string; recipe: Recipe } | null = null
let frame = 0

function flushQueued(onError: (message: string) => void): void {
  cancelAnimationFrame(frame)
  frame = 0
  const q = queued
  queued = null
  if (q) void api.develop.update(q.key, q.recipe, true).catch((err) => onError(errorText(err)))
}

function sendNow(key: string, recipe: Recipe, onError: (message: string) => void): void {
  cancelAnimationFrame(frame)
  frame = 0
  queued = null
  void api.develop.update(key, recipe, false).catch((err) => onError(errorText(err)))
}

/** The last picture made for a view: the framed picture, or the crop tool's whole frame. */
type Pictures = { framed: RenderEvent | null; crop: RenderEvent | null }

export const useDevelop = create<DevelopState>((set, get) => ({
  session: null,
  loading: false,
  recipe: null,
  history: [],
  cursor: -1,
  snapshots: [],
  picture: null,
  pictures: { framed: null, crop: null },
  before: null,
  mask: null,
  report: null,
  stats: null,
  error: null,
  rendering: false,
  tool: 'none',
  gesture: null,
  layerId: null,
  compId: null,
  addMode: null,
  maskThumbs: {},
  overlay: true,
  compare: 'off',
  clipping: false,
  zoom: FIT,
  hslFocus: null,
  hslTab: 'all',
  noise: null,
  targetEdge: 2560,

  async open(key) {
    const prev = get().session
    if (prev?.key === key) return
    set({
      loading: true,
      error: null,
      picture: null,
      pictures: { framed: null, crop: null },
      maskThumbs: {},
      compId: null,
      addMode: null,
      before: null,
      mask: null,
      stats: null,
      report: null,
      noise: null,
      layerId: null,
      tool: 'none',
      zoom: FIT
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
    queued = null
    set({
      session: null,
      recipe: null,
      picture: null,
      pictures: { framed: null, crop: null },
      before: null,
      mask: null
    })
  },

  edit(change, interactive = false) {
    const { session, recipe } = get()
    if (!session || !recipe) return
    const next = structuredClone(recipe)
    change(next)
    set({ recipe: next, rendering: true })
    const onError = (m: string): void => get().onError(m)
    if (!interactive) return sendNow(session.key, next, onError)
    touchInteracting()
    queued = { key: session.key, recipe: next }
    if (!frame) frame = requestAnimationFrame(() => flushQueued(onError))
  },

  commit(label) {
    const { session, recipe } = get()
    if (!session || !recipe) return
    set({ rendering: true })
    sendNow(session.key, recipe, (m) => get().onError(m))
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
    sendNow(session.key, entry.recipe, (m) => get().onError(m))
  },

  setTool(tool) {
    const prev = get().tool
    if ((prev === 'crop') === (tool === 'crop')) return set({ tool })
    // Show the other view's last picture at once; a fresh one follows.
    const { pictures, picture } = get()
    const shown = tool === 'crop' ? pictures.crop : pictures.framed
    // The crop tool works on the whole fitted frame.
    set({ tool, picture: shown ?? picture, ...(tool === 'crop' ? { zoom: FIT } : {}) })
    get().pushView()
  },

  setGesture(gesture) {
    if (get().gesture !== gesture) set({ gesture })
  },

  setLayer(layerId) {
    if (layerId === get().layerId) return
    set({ layerId, compId: null, addMode: null })
    get().pushView()
  },

  setComp(compId) {
    set({ compId })
  },

  setAddMode(addMode) {
    set({ addMode })
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
      // Thumbnails of every mask while the masks panel is open or all show.
      maskThumbs: useUi.getState().panel === 'masks' || useUi.getState().maskOverlay.showAll,
      targetEdge
    }
    set({ rendering: true })
    void api.develop.view(session.key, view)
  },

  onRendered(e) {
    const { session } = get()
    if (!session || e.key !== session.key) return
    if (e.kind === 'before') set({ before: e })
    // A mask event without a picture: the mask is empty now.
    else if (e.kind === 'mask') set({ mask: e.url ? e : null })
    else if (e.kind === 'mask-thumb') {
      const id = e.layerId
      if (!id) return
      set((s) => {
        const next = { ...s.maskThumbs }
        if (e.url) next[id] = e
        else delete next[id]
        return { maskThumbs: next }
      })
    } else {
      const slot: keyof Pictures = e.cropMode ? 'crop' : 'framed'
      const { pictures, tool } = get()
      const cur = pictures[slot]
      // A late draft must not replace a newer render.
      if (cur && e.seq < cur.seq) return
      const next = { ...pictures, [slot]: e }
      const forView = (tool === 'crop') === Boolean(e.cropMode)
      // Only the view on screen changes the picture, the scopes and the busy
      // state; a render made for the other view is kept for when it returns.
      if (!forView) return set({ pictures: next })
      // The same file again (an edit that changed nothing the engine sees)
      // keeps the event object, so nothing that shows it re-renders.
      const same = get().picture?.url === e.url
      set({
        pictures: next,
        picture: same ? get().picture : e,
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
