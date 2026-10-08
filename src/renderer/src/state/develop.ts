import { produce, setAutoFreeze } from 'immer'
import { create } from 'zustand'
import type { ImageStats, MaskMode, NoiseEstimate } from '../../../shared/engine-types'
import type {
  DevelopSession,
  HistoryLog,
  RenderEvent,
  RenderReport,
  Snapshot,
  ViewState
} from '../../../shared/ipc'
import { amendLog, appendToLog, replay } from '../../../shared/history'
import {
  newId,
  normaliseRecipe,
  sameValue,
  type HslBand,
  type Recipe
} from '../../../shared/recipe'
import { FIT, type ZoomView } from '../../../shared/view'
import { api, errorText } from '../lib/api'
import { touchInteracting } from '../lib/interacting'
import { useLibrary } from './library'
import { useUi } from './ui'
import type { GuideLine } from '../../../shared/upright'
import type { InvariantPlace } from '../../../shared/invariant'

export type Tool =
  | 'none'
  | 'crop'
  | 'brush'
  | 'polygon'
  | 'linear'
  | 'radial'
  | 'bidirectional'
  /** Select by pointing (SAM 2.1): views/loupe/ObjectsTool.tsx. */
  | 'objects'
  | 'wb-picker'
  | 'range-picker'
  | 'point-picker'
  | 'add-pick'
  | 'fringe-pick'
  | 'upright-guide'
  | 'heal'
  | 'tat'
  /** A smart look's run asks the user to point at an object (views/loupe/LookPick.tsx). */
  | 'look-pick'
export type Compare = 'off' | 'before' | 'split'

/**
 * The tools that work on the whole frame rather than the framed picture:
 * Crop (the warped canvas, before its crop) and Upright's guides (the frame
 * before the warp). They share the whole-frame render.
 */
export function wholeFrameTool(t: Tool): boolean {
  return t === 'crop' || t === 'upright-guide'
}

/** Where an added colour lives: Colour grading, the Effects wash, or a mask. */
/** Where an added colour lives: the photo's colour grading or wash, or a mask's. */
export type AddTarget = 'grade' | 'wash' | { layer: string; part: 'grade' | 'wash' }

/**
 * The additive-colour picker at work (tool `add-pick`): `white` takes one
 * click, the colour to neutralise; `match` takes the colour to change and the
 * one it should become — a second click (`first` holds the first, in the
 * target's space), or a colour chosen beforehand (`goal`, Display P3 code
 * values), when one click does.
 */
export interface AddPick {
  target: AddTarget
  mode: 'white' | 'match'
  first: [number, number, number] | null
  goal?: [number, number, number] | null
  /** The goal as the user chose it, for the hint. */
  goalHex?: string | null
}
export type CurveChannel = 'master' | 'red' | 'green' | 'blue'
/** A geometry gesture in progress: the loupe draws its grid while one runs. */
export type Gesture = 'straighten' | 'crop' | 'rotate' | null

interface DevelopState {
  session: DevelopSession | null
  /**
   * The photo on screen, for what only shows its facts: the session, or
   * while the next photo loads, the last one (edits need `session`).
   */
  shown: DevelopSession | null
  loading: boolean
  recipe: Recipe | null
  /** The photo's edit history: the recipe is its base with every visible step replayed. */
  history: HistoryLog
  /** Steps Undo hid, newest last: what Redo shows again. A new edit clears it. */
  redo: number[]
  snapshots: Snapshot[]
  /** The picture on screen: the latest render for the current view. */
  picture: RenderEvent | null
  /** The latest render for each view, so opening or closing the crop tool swaps at once. */
  pictures: Pictures
  before: RenderEvent | null
  mask: RenderEvent | null
  report: RenderReport | null
  stats: ImageStats | null
  /** For a PQ/HLG photo, the last settled render measured as HDR (see `RenderEvent.hdrStats`). */
  hdrStats: ImageStats | null
  error: string | null
  /**
   * The adjustment the last render failed on (engine 0.18's `Invariant`): its
   * sliders are marked until a render goes through. The last good picture stays.
   */
  invariant: InvariantPlace | null
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
  /** The mask under the pointer in the masks panel or on a pin: previewed on the photo. */
  hoverLayer: string | null
  overlay: boolean
  compare: Compare
  clipping: boolean
  /** An HDR photo: colour where the picture rises above white. */
  headroom: boolean
  /** The engine's headroom plane for the view on screen. */
  headroomPlane: RenderEvent | null
  /** How the loupe looks at the picture: fitted, or zoomed about a point. */
  zoom: ZoomView
  hslFocus: HslBand | null
  hslTab: 'hue' | 'saturation' | 'luminance' | 'all' | 'point'
  /** The selected swatch of the colour mixer's Point tab. */
  pointId: string | null
  addPick: AddPick | null
  /** Upright's guides while they are drawn (tool `upright-guide`), frame fractions. */
  guides: GuideLine[]
  /** The point curve's channel on show (the targeted tool moves that one). */
  curveChannel: CurveChannel
  /** What the targeted adjustment tool moves: the HSL bands or the point curve. */
  tatTarget: 'hsl' | 'curve'
  noise: NoiseEstimate | null
  targetEdge: number

  open(key: string): Promise<void>
  close(): Promise<void>
  /** Open the photo again from its saved recipe (its HDR editing turned on or off). */
  reopen(): Promise<void>
  setHeadroom(on: boolean): void
  /** Change the recipe. Interactive edits render the draft and write no history. */
  edit(change: (r: Recipe) => void, interactive?: boolean): void
  /** Settle an edit: render in full and record it in the history under `label`. */
  commit(label: string): Promise<number | null>
  /** Replace the recipe wholesale (paste, preset, snapshot) and record it. */
  replace(recipe: Recipe, label: string): Promise<number | null>
  /**
   * The newest step, `seq`, rewritten to hold the recipe as it is now (a
   * look's Amount, a look swapped for another), under `label`. Recorded as
   * a new step instead when `seq` is no longer the newest shown one. The
   * step's seq, or null when nothing is left of it.
   */
  amend(seq: number, label: string): Promise<number | null>
  /** What the loupe shows instead of the recipe, by name; null when it shows the recipe. */
  previewing: string | null
  /** Show `recipe` on the loupe as `name`, never saved; null shows the photo's recipe again. */
  preview(name: string | null, recipe: Recipe | null): void
  /** Hide the newest visible step. */
  undo(): void
  /** Show the step Undo last hid. */
  redoStep(): void
  /** Hide or show steps; the caller has already added any dependents. */
  setStepsHidden(seqs: number[], hidden: boolean): Promise<void>
  /** Delete steps; the caller has already added any dependents. */
  deleteSteps(seqs: number[]): Promise<void>
  setTool(tool: Tool): void
  setGesture(g: Gesture): void
  setComp(id: string | null): void
  setAddMode(m: MaskMode | null): void
  setLayer(id: string | null): void
  setHoverLayer(id: string | null): void
  setOverlay(on: boolean): void
  setCompare(c: Compare): void
  setClipping(on: boolean): void
  setZoom(z: ZoomView): void
  setHslFocus(b: HslBand | null): void
  setHslTab(t: DevelopState['hslTab']): void
  setPointId(id: string | null): void
  setGuides(g: GuideLine[]): void
  /** Start (or, with null, stop) the additive-colour picker. */
  setAddPick(p: AddPick | null): void
  setCurveChannel(c: CurveChannel): void
  setTatTarget(t: DevelopState['tatTarget']): void
  setTargetEdge(n: number): void
  pushView(): void
  onRendered(e: RenderEvent): void
  onError(message: string, invariant?: InvariantPlace | null): void
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
// Recipes are handed on and changed in place elsewhere (a clone first, but
// not everywhere): frozen ones would throw there.
setAutoFreeze(false)
/** Counts opens: one that finds a newer one started (or a close) shows nothing. */
let openToken = 0
/** The photo an open is loading, until it is shown. */
let openingKey: string | null = null
let frame = 0
/** Numbers each recipe sent to the engine; every render says which one it drew. */
let rev = 0

/** The number of the recipe sent to the engine last. */
export function lastSentRev(): number {
  return rev
}

function flushQueued(onError: (message: string) => void): void {
  cancelAnimationFrame(frame)
  frame = 0
  const q = queued
  queued = null
  if (!q) return
  settled = null
  void api.develop.update(q.key, q.recipe, true, ++rev).catch((err) => onError(errorText(err)))
}

/** The last recipe sent settled (not mid-drag): sent again it would only render twice. */
let settled: { key: string; recipe: Recipe } | null = null

function sendNow(key: string, recipe: Recipe, onError: (message: string) => void): void {
  cancelAnimationFrame(frame)
  frame = 0
  queued = null
  settled = { key, recipe }
  void api.develop.update(key, recipe, false, ++rev).catch((err) => onError(errorText(err)))
}

/**
 * The photos either side of `key` in the library's order and filters (the
 * next first, as the arrow keys most often go): their proxies are made
 * ahead, so stepping to one opens at once.
 */
function warmNeighbours(key: string): void {
  const list = useLibrary.getState().visible()
  const at = list.findIndex((i) => i.key === key)
  if (at < 0) return
  const near = [list[at + 1], list[at - 1], list[at + 2]]
    .filter((i): i is (typeof list)[number] => !!i && !i.offline && !i.unreadable)
    .map((i) => i.key)
  if (near.length > 0) void api.develop.warm(near).catch(() => undefined)
}

/**
 * Show what a changed history describes: its replayed recipe becomes the
 * photo's (rendered and saved like any settled edit).
 */
function applyLog(key: string, history: HistoryLog): void {
  const { session } = useDevelop.getState()
  if (!session || session.key !== key || !history.base) return
  // A base saved by an older version can lack fields added since (AI denoise's).
  const { head, ...log } = history
  const recipe = normaliseRecipe(head ?? replay(log.base!.recipe, log.steps), session.isRaw)
  useDevelop.setState({ history: log, recipe, rendering: true, previewing: null })
  sendNow(session.key, recipe, (m) => useDevelop.getState().onError(m))
}

/**
 * Work that lands in the recipe a moment later (a heal stroke being baked):
 * Undo and Redo wait for it, so they undo what the user did last, not what
 * was there before it landed.
 */
let landing: Promise<void> = Promise.resolve()
export function landingWork(p: Promise<void>): void {
  landing = landing
    .then(
      () => p,
      () => p
    )
    .catch(() => undefined)
}

/** History changes, one at a time: each reads the history the one before left. */
let historyOps: Promise<void> = Promise.resolve()
function queueHistoryOp(op: () => Promise<void>): void {
  historyOps = historyOps.then(op).catch((err) => useDevelop.getState().onError(errorText(err)))
}

/** Whether the selected mask component is a colour or luminance range. */
function rangeSelected(s: Pick<DevelopState, 'recipe' | 'layerId' | 'compId'>): boolean {
  const l = s.recipe?.layers.find((x) => x.id === s.layerId)
  return l?.components.find((c) => c.id === s.compId)?.kind === 'range'
}

/** The last picture made for a view: the framed picture, or the crop tool's whole frame. */
type Pictures = { framed: RenderEvent | null; crop: RenderEvent | null }

export const useDevelop = create<DevelopState>((set, get) => ({
  session: null,
  shown: null,
  loading: false,
  recipe: null,
  previewing: null,
  history: { base: null, steps: [] },
  redo: [],
  snapshots: [],
  picture: null,
  pictures: { framed: null, crop: null },
  before: null,
  mask: null,
  report: null,
  stats: null,
  hdrStats: null,
  error: null,
  invariant: null,
  rendering: false,
  tool: 'none',
  gesture: null,
  layerId: null,
  compId: null,
  addMode: null,
  maskThumbs: {},
  hoverLayer: null,
  overlay: true,
  compare: 'off',
  clipping: false,
  headroom: false,
  headroomPlane: null,
  zoom: FIT,
  hslFocus: null,
  hslTab: 'all',
  pointId: null,
  addPick: null,
  guides: [],
  curveChannel: 'master',
  tatTarget: 'hsl',
  noise: null,
  targetEdge: 2560,

  async open(key) {
    const prev = get().session
    if (prev?.key === key || openingKey === key) return
    const token = ++openToken
    openingKey = key
    // A slider's last frame is the photo being left's: it goes to that photo first.
    flushQueued((m) => get().onError(m))
    // The last photo's recipe stays in view until this one's arrives, but
    // nothing edits it: every edit needs the session.
    set({
      session: null,
      loading: true,
      error: null,
      invariant: null,
      previewing: null,
      picture: null,
      pictures: { framed: null, crop: null },
      maskThumbs: {},
      hoverLayer: null,
      compId: null,
      addMode: null,
      before: null,
      mask: null,
      stats: null,
      hdrStats: null,
      headroomPlane: null,
      report: null,
      noise: null,
      layerId: null,
      tool: 'none',
      zoom: FIT
    })
    // A later open (or a close) took over: what this one found is not shown.
    const stale = (): boolean => token !== openToken
    try {
      // Asked together: neither waits on the other.
      const [session, listed] = await Promise.all([
        api.develop.open(key),
        api.develop.historyList(key)
      ])
      if (stale()) return
      const { head, ...rest } = listed
      let history: HistoryLog = rest
      if (!history.base) {
        const opened = await api.develop.historyAppend(key, 'Opened', session.recipe)
        history = appendToLog(history, opened)
      } else if (!sameValue(head ?? replay(history.base.recipe, history.steps), session.recipe)) {
        // Changed where no history is written (a paste or sync in the
        // library, an older version's undo): record where it stands now.
        const saved = await api.develop.historyAppend(key, 'Opened as saved', session.recipe)
        history = appendToLog(history, saved)
      }
      if (stale()) return
      openingKey = null
      set({
        session,
        shown: session,
        recipe: session.recipe,
        history,
        redo: [],
        snapshots: session.snapshots,
        loading: false
      })
      get().pushView()
      warmNeighbours(key)
    } catch (err) {
      if (stale()) return
      openingKey = null
      set({ shown: null, loading: false, error: errorText(err) })
    }
  },

  async close() {
    // An open still on its way is dropped, and its photo closed in main too.
    ++openToken
    const key = get().session?.key ?? openingKey
    openingKey = null
    if (key) await api.develop.close(key)
    queued = null
    set({
      session: null,
      shown: null,
      loading: false,
      recipe: null,
      previewing: null,
      picture: null,
      pictures: { framed: null, crop: null },
      before: null,
      mask: null
    })
  },

  edit(change, interactive = false) {
    const { session, recipe } = get()
    if (!session || !recipe) return
    // What the change leaves alone keeps its identity, so only what reads
    // the part that moved re-renders (a slider tick, not the whole develop view).
    const next = produce(recipe, (draft) => {
      change(draft as Recipe)
    })
    if (next === recipe) return
    // An edit ends a preview (main shows the recipe again on any update).
    set({ recipe: next, rendering: true, previewing: null })
    const onError = (m: string): void => get().onError(m)
    if (!interactive) return sendNow(session.key, next, onError)
    touchInteracting()
    queued = { key: session.key, recipe: next }
    if (!frame) frame = requestAnimationFrame(() => flushQueued(onError))
  },

  commit(label) {
    const { session, recipe } = get()
    if (!session || !recipe) return Promise.resolve(null)
    // An edit sent settled just before (edit, then commit) is not sent again.
    if (settled?.key !== session.key || settled.recipe !== recipe || queued || frame) {
      set({ rendering: true })
      sendNow(session.key, recipe, (m) => get().onError(m))
    }
    const item = useLibrary.getState().items.find((i) => i.key === session.key)
    if (item && !item.edited) useLibrary.getState().patchItems([{ ...item, edited: true }])
    // In line with Undo and Redo: one pressed straight after waits for this step.
    return new Promise<number | null>((resolve) => {
      queueHistoryOp(async () => {
        try {
          const change = await api.develop.historyAppend(session.key, label, recipe)
          if (get().session?.key === session.key)
            set({ history: appendToLog(get().history, change), redo: [] })
          resolve(change.step?.seq ?? null)
        } catch (err) {
          resolve(null)
          throw err
        }
      })
    })
  },

  replace(recipe, label) {
    set({ recipe, previewing: null })
    return get().commit(label)
  },

  amend(seq, label) {
    const { session, recipe } = get()
    if (!session || !recipe) return Promise.resolve(null)
    if (settled?.key !== session.key || settled.recipe !== recipe || queued || frame) {
      set({ rendering: true })
      sendNow(session.key, recipe, (m) => get().onError(m))
    }
    return new Promise<number | null>((resolve) => {
      queueHistoryOp(async () => {
        try {
          const change = await api.develop.historyAmend(session.key, seq, label, recipe)
          if (!change) {
            // No longer the newest step (an edit since, an undo): a step of
            // its own, recorded once this history change is done.
            resolve(get().commit(label))
            return
          }
          if (get().session?.key === session.key)
            set({ history: amendLog(get().history, change), redo: [] })
          resolve(change.step ? change.seq : null)
        } catch (err) {
          resolve(null)
          throw err
        }
      })
    })
  },

  preview(name, recipe) {
    const { session } = get()
    if (!session) return
    if (!recipe && get().previewing === null) return
    set({ previewing: recipe ? name : null, rendering: true })
    void api.develop.preview(session.key, recipe).catch((err) => get().onError(errorText(err)))
  },

  undo() {
    queueHistoryOp(async () => {
      await landing
      const last = get().history.steps.findLast((s) => !s.hidden)
      if (!last) return
      await get().setStepsHidden([last.seq], true)
      set({ redo: [...get().redo, last.seq] })
    })
  },

  redoStep() {
    queueHistoryOp(async () => {
      await landing
      const { redo, history } = get()
      // Skip what was shown again by hand since.
      const stack = redo.filter((seq) => history.steps.some((s) => s.seq === seq && s.hidden))
      const seq = stack.pop()
      if (seq !== undefined) await get().setStepsHidden([seq], false)
      set({ redo: stack })
    })
  },

  async setStepsHidden(seqs, hidden) {
    const session = get().session
    if (!session || seqs.length === 0) return
    applyLog(session.key, await api.develop.historySetHidden(session.key, seqs, hidden))
  },

  async deleteSteps(seqs) {
    const session = get().session
    if (!session || seqs.length === 0) return
    applyLog(session.key, await api.develop.historyDelete(session.key, seqs))
  },

  setTool(tool) {
    const prev = get().tool
    if (tool !== 'add-pick' && get().addPick) set({ addPick: null })
    const same =
      wholeFrameTool(prev) === wholeFrameTool(tool) &&
      (prev === 'upright-guide') === (tool === 'upright-guide')
    if (same) return set({ tool })
    // Show the other view's last picture at once; a fresh one follows.
    const { pictures, picture } = get()
    const whole = wholeFrameTool(tool)
    const shown = whole ? pictures.crop : pictures.framed
    // The whole-frame tools work on the whole fitted frame.
    set({ tool, picture: shown ?? picture, ...(whole ? { zoom: FIT } : {}) })
    get().pushView()
  },

  setGesture(gesture) {
    if (get().gesture !== gesture) set({ gesture })
  },

  setLayer(layerId) {
    if (layerId === get().layerId) return
    // The last mask's plane goes at once: it is not this one's.
    set({ layerId, compId: null, addMode: null, mask: null })
    get().pushView()
  },

  setHoverLayer(hoverLayer) {
    if (get().hoverLayer !== hoverLayer) set({ hoverLayer })
  },

  setComp(compId) {
    const was = rangeSelected(get())
    set({ compId })
    if (rangeSelected(get()) !== was) get().pushView()
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

  setHeadroom(headroom) {
    set({ headroom, headroomPlane: headroom ? get().headroomPlane : null })
    get().pushView()
  },

  async reopen() {
    const s = get().session
    if (!s) return
    await api.develop.close(s.key)
    set({ session: null })
    await get().open(s.key)
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

  setAddPick(addPick) {
    if (!addPick) return get().setTool('none')
    set({ addPick })
    get().setTool('add-pick')
  },

  setGuides(guides) {
    set({ guides })
  },

  setPointId(pointId) {
    set({ pointId })
  },

  setCurveChannel(curveChannel) {
    set({ curveChannel })
  },

  setTatTarget(tatTarget) {
    set({ tatTarget })
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
      cropMode: wholeFrameTool(tool),
      guides: tool === 'upright-guide',
      // The before render also feeds the hue chart's ghost bars, so it is
      // always wanted, compared or not.
      before: true,
      // A selected layer's mask is rendered whether or not the overlay shows:
      // the hue chart measures inside it.
      maskLayer: layerId,
      // Thumbnails of every mask while the masks window is unfolded, or all show.
      maskThumbs:
        (useUi.getState().masksWin.open && !useUi.getState().masksWin.minimized) ||
        useUi.getState().maskOverlay.showAll,
      // With a range selected its mask comes with every draft: only the
      // engine knows exactly what the key selects in the graded picture.
      maskLive: rangeSelected(get()),
      headroom: get().headroom && session.isHdr,
      targetEdge
    }
    set({ rendering: true })
    void api.develop.view(session.key, view)
  },

  onRendered(e) {
    const { session } = get()
    if (!session || e.key !== session.key) return
    if (e.kind === 'before') set({ before: e })
    else if (e.kind === 'headroom') {
      if (get().headroom && Boolean(e.cropMode) === wholeFrameTool(get().tool))
        set({ headroomPlane: e })
    } else if (e.kind === 'mask') {
      // Only the selected mask's plane, and never an older one than shown.
      if (e.layerId !== get().layerId) return
      const cur = get().mask
      if (cur && e.seq < cur.seq) return
      // A mask event without a picture: the mask is empty now. A draft's
      // plane has no measurements; the last ones stand until the settled one.
      set({ mask: e.url ? { ...e, maskStats: e.maskStats ?? cur?.maskStats } : null })
    } else if (e.kind === 'mask-thumb') {
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
      const forView = wholeFrameTool(tool) === Boolean(e.cropMode)
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
        // Drafts carry no HDR measurement; keep the last settled one meanwhile.
        hdrStats: e.kind === 'full' ? (e.hdrStats ?? null) : get().hdrStats,
        report: e.report ?? null,
        error: null,
        invariant: null,
        rendering: e.kind === 'draft'
      })
    }
  },

  onError(message, invariant = null) {
    set({ error: message, invariant, rendering: false })
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
