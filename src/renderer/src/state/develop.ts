import { qualifierLayerId } from '../../../shared/resolve'
import { floatCanvasKnown, floatCanvasReady } from '../lib/floatcanvas'
import { produce, setAutoFreeze } from 'immer'
import { create } from 'zustand'
import { t, tk } from '../lib/i18n'
import type { ImageStats, MaskMode, NoiseEstimate } from '../../../shared/engine-types'
import type {
  DevelopSession,
  HistoryLog,
  ProofCheck,
  ProofIssue,
  RenderEvent,
  RenderReport,
  Snapshot,
  ViewState
} from '../../../shared/ipc'
import { checkedProof, profileName, proofKey, type ProofSettings } from '../../../shared/proof'
import { amendLog, appendToLog, canRedo, replay } from '../../../shared/history'
import { normaliseRecipe, sameValue, type HslBand, type Recipe } from '../../../shared/recipe'
import { FIT, maskPlacementKey, type ZoomView } from '../../../shared/view'
import { renderedLens } from '../../../shared/edits'
import {
  lensFrameKey,
  lensFrameOf,
  rebaseNeed,
  retagMasks,
  sameLensFrame,
  type LensGrid
} from '../../../shared/lensframe'
import { nextGeometryRev, planeFits } from './maskplanes'
import { api, errorText } from '../lib/api'
import { touchInteracting } from '../lib/interacting'
import { useLibrary } from './library'
import { useUi } from './ui'
import { aboveWhite, renderDisplay, useDisplay } from './display'
import type { GuideLine } from '../../../shared/upright'
import type { InvariantPlace } from '../../../shared/invariant'
import {
  lookArrived,
  lookFaded,
  lookOnOpen,
  lookOnPicture,
  wantsPreview,
  type FirstLook
} from '../lib/firstlook'

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
  /** A Depth range centred on the distance clicked (panels/masks/MaskTool.tsx). */
  | 'depth-picker'
  | 'point-picker'
  /** Resolve's Qualifier: a new key around the colour clicked (panels/resolve.tsx). */
  | 'qualifier-pick'
  | 'add-pick'
  | 'fringe-pick'
  | 'upright-guide'
  | 'heal'
  | 'tat'
  /** A smart look's run asks the user to point at an object (views/loupe/LookPick.tsx). */
  | 'look-pick'
/** `proof`: Screen | Proof, the settled picture unproofed beside its proof (soft proofing). */
export type Compare = 'off' | 'before' | 'split' | 'proof'

/**
 * The tools that work on the whole frame rather than the framed picture:
 * Crop (the warped canvas, before its crop) and Upright's guides (the frame
 * before the warp). They share the whole-frame render.
 */
export function wholeFrameTool(tool: Tool): boolean {
  return tool === 'crop' || tool === 'upright-guide'
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
  snapshots: Snapshot[]
  /** The picture on screen: the latest render for the current view. */
  picture: RenderEvent | null
  /**
   * What shows while a photo opens, before its develop's first picture
   * (lib/firstlook.ts): its thumbnail, or an unedited RAW's embedded preview.
   */
  firstLook: FirstLook | null
  /** The latest render for each view, so opening or closing the crop tool swaps at once. */
  pictures: Pictures
  before: RenderEvent | null
  mask: RenderEvent | null
  /**
   * The first recipe number drawn with the masks placed as they are now (the
   * framing and the lens, `maskPlacementKey`): a mask plane or thumbnail
   * from before it is of another picture and is not shown (`planeFits`).
   */
  geometryRev: number
  /**
   * The masks drawn under another lens than the one rendered (Optics
   * switched off, a lens slider moving): the loupe's map between the two,
   * so handles and new strokes stay on what they were drawn on. Null when
   * they agree.
   */
  maskGrid: LensGrid | null
  /** The selected qualifier's key plane, while its key view is on (`keyView`). */
  keyMask: RenderEvent | null
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
  /** The gamut warning (soft proofing): colour what the export's colour space can't hold. */
  gamut: boolean
  /** The engine's gamut warning plane for the view on screen. */
  gamutPlane: RenderEvent | null
  /**
   * Soft proofing (S): the settled picture, the before and the 1:1 tiles as
   * the proof (`useUi.proof`) makes them. Off for each photo opened, but a
   * proof copy, which opens proofed.
   */
  proof: boolean
  /** The proof setup's popover is open (⌥S, the Proof button's chevron). */
  proofSetup: boolean
  /** Why proofing turned itself off (its profile not found, or refused). */
  proofIssue: ProofIssue | null
  /** The paper's white (0…255 Display P3) of the proof in force, for the surround while simulating. */
  proofPaper: [number, number, number] | null
  /** The settled picture unproofed: Screen | Proof's other side. */
  screen: RenderEvent | null
  /** How the loupe looks at the picture: fitted, or zoomed about a point. */
  zoom: ZoomView
  hslFocus: HslBand | null
  hslTab: 'hue' | 'saturation' | 'luminance' | 'all' | 'density' | 'point'
  /** The selected swatch of the colour mixer's Point tab. */
  pointId: string | null
  /** The qualifier the Qualifier card has selected, and whether its key shows white on black. */
  qualifierId: string | null
  keyView: boolean
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

  /** Delete steps; the caller has already added any dependents. */

  setTool(tool: Tool): void
  setGesture(g: Gesture): void
  setComp(id: string | null): void
  setAddMode(m: MaskMode | null): void
  setLayer(id: string | null): void
  setHoverLayer(id: string | null): void
  setOverlay(on: boolean): void
  setCompare(c: Compare): void
  setClipping(on: boolean): void
  setGamut(on: boolean): void
  /**
   * Proofing on or off. Turned on, its settings are tried on the engine
   * first: a profile not found or refused leaves it off, and says why.
   */
  setProof(on: boolean): Promise<void>
  /**
   * New proof settings (the setup), tried on the engine first: used (and
   * proofing turned on) when it takes them; the issue back when it does not,
   * the settings in force kept. `opening`: a proof copy's own, as it opens
   * (shown unproofed when the engine will not take them).
   */
  applyProof(s: ProofSettings, opening?: boolean): Promise<ProofIssue | null>
  setProofSetup(open: boolean): void
  setZoom(z: ZoomView): void
  setHslFocus(b: HslBand | null): void
  setHslTab(tab: DevelopState['hslTab']): void
  setPointId(id: string | null): void
  setQualifier(id: string | null): void
  setKeyView(on: boolean): void
  setGuides(g: GuideLine[]): void
  /** Start (or, with null, stop) the additive-colour picker. */
  setAddPick(p: AddPick | null): void
  setCurveChannel(c: CurveChannel): void
  setTatTarget(t: DevelopState['tatTarget']): void
  setTargetEdge(n: number): void
  /** The first look faded out over the develop's picture (the loupe's timer). */
  firstLookGone(key: string): void
  pushView(): void
  onRendered(e: RenderEvent): void
  onError(message: string, invariant?: InvariantPlace | null): void
  /** Versions (History's top; shared/versions.ts): named by the user, or made automatically. */
  addVersion(name: string): Promise<void>
  renameVersion(id: string, name: string): Promise<void>
  deleteVersion(id: string): Promise<void>
  /** An automatic version kept for good (named). */
  keepVersion(id: string): Promise<void>
  /** The versions as stored now (main makes automatic ones as it goes). */
  refreshVersions(): Promise<void>
  /** The photo back to a version: a new step of History, undone like any. */
  restoreVersion(id: string): void
  /** Before/After against a version, or (null) the photo as it came. */
  compareWith(id: string | null): void
  /** The version Before/After compares with, if one. */
  comparing: string | null
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
  snapshots: [],
  comparing: null,
  picture: null,
  firstLook: null,
  pictures: { framed: null, crop: null },
  before: null,
  mask: null,
  geometryRev: 0,
  maskGrid: null,
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
  gamut: false,
  gamutPlane: null,
  proof: false,
  proofSetup: false,
  proofIssue: null,
  proofPaper: null,
  screen: null,
  zoom: FIT,
  hslFocus: null,
  hslTab: 'all',
  pointId: null,
  qualifierId: null,
  keyView: false,
  keyMask: null,
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
    // The photo at once (engine 0.21, OBS-1d): its thumbnail, then an
    // unedited RAW's embedded preview at the stage's size, until the develop's
    // first picture lands.
    const item = useLibrary.getState().items.find((i) => i.key === key)
    if (wantsPreview(item))
      void api.develop
        .firstLook(key, get().targetEdge)
        .then((look) => {
          if (!look || token !== openToken) return
          const { firstLook, picture } = get()
          const opening = openingKey ?? get().session?.key ?? null
          set({ firstLook: lookArrived(firstLook, key, look.url, opening, picture !== null) })
        })
        .catch(() => undefined)
    // The last photo's recipe stays in view until this one's arrives, but
    // nothing edits it: every edit needs the session.
    set({
      session: null,
      loading: true,
      error: null,
      invariant: null,
      previewing: null,
      picture: null,
      firstLook: lookOnOpen(key, item),
      pictures: { framed: null, crop: null },
      maskThumbs: {},
      hoverLayer: null,
      compId: null,
      addMode: null,
      before: null,
      mask: null,
      keyMask: null,
      keyView: false,
      stats: null,
      hdrStats: null,
      headroomPlane: null,
      gamutPlane: null,
      // Each photo opens unproofed (a proof copy proofed, below).
      proof: false,
      proofIssue: null,
      screen: null,
      ...(get().compare === 'proof' ? { compare: 'off' as const } : {}),
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
        const opened = await api.develop.historyAppend(key, tk('Opened'), session.recipe)
        history = appendToLog(history, opened)
      } else if (
        !sameValue(
          // As read today (a recipe from before the masks' lens record gets one, as the sidecar did).
          normaliseRecipe(head ?? replay(history.base.recipe, history.steps), session.isRaw),
          session.recipe
        )
      ) {
        // Changed where no history is written (a paste or sync in the
        // library, an older version's undo): record where it stands now.
        const saved = await api.develop.historyAppend(key, tk('Opened as saved'), session.recipe)
        history = appendToLog(history, saved)
      }
      if (stale()) return
      openingKey = null
      set({
        session,
        shown: session,
        recipe: session.recipe,
        history,
        snapshots: session.snapshots,
        comparing: null,
        loading: false
      })
      // A proof copy brings its proof: it opens proofed with it.
      if (session.proof) void get().applyProof(session.proof, true)
      else get().pushView()
      warmNeighbours(key)
    } catch (err) {
      if (stale()) return
      openingKey = null
      set({ shown: null, loading: false, error: errorText(err), firstLook: null })
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
      firstLook: null,
      pictures: { framed: null, crop: null },
      before: null,
      mask: null,
      keyMask: null,
      keyView: false,
      proof: false,
      screen: null
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
    const { session } = get()
    let { recipe } = get()
    if (!session || !recipe) return Promise.resolve(null)
    // A lens edit settling: the masks move onto the new lens with it
    // (shared/lensframe.ts). With no point to move, only the record does.
    const need = rebaseNeed(recipe)
    if (need === 'retag') {
      recipe = retagMasks(recipe)
      set({ recipe })
    }
    // An edit sent settled just before (edit, then commit) is not sent again.
    if (settled?.key !== session.key || settled.recipe !== recipe || queued || frame) {
      set({ rendering: true })
      sendNow(session.key, recipe, (m) => get().onError(m))
    }
    const item = useLibrary.getState().items.find((i) => i.key === session.key)
    if (item && !item.edited) useLibrary.getState().patchItems([{ ...item, edited: true }])
    // Points to carry take the correction's maps, in main. The picture meanwhile
    // is the same (compile maps them); the step records them moved.
    const sent = recipe
    const recorded: Promise<Recipe> =
      need !== 'remap'
        ? Promise.resolve(sent)
        : api.develop
            .rebaseMasks(session.key, sent)
            .then((moved) => {
              const now = get()
              if (now.session?.key !== session.key || now.recipe !== sent) return sent
              set({ recipe: moved })
              sendNow(session.key, moved, (m) => get().onError(m))
              return moved
            })
            .catch(() => sent)
    // In line with Undo and Redo: one pressed straight after waits for this step.
    return new Promise<number | null>((resolve) => {
      queueHistoryOp(async () => {
        try {
          const change = await api.develop.historyAppend(session.key, label, await recorded)
          if (get().session?.key === session.key)
            set({ history: appendToLog(get().history, change) })
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
          if (get().session?.key === session.key) set({ history: amendLog(get().history, change) })
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
      const session = get().session
      if (!session || !get().history.steps.some((s) => !s.hidden)) return
      applyLog(session.key, await api.develop.historyUndo(session.key))
    })
  },

  redoStep() {
    queueHistoryOp(async () => {
      await landing
      const session = get().session
      if (!session || !canRedo(get().history.steps)) return
      applyLog(session.key, await api.develop.historyRedo(session.key))
    })
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
    // The whole-frame tools work on the whole fitted frame. The mask planes
    // on hand were drawn for the other view: the next ones are this one's.
    set({
      tool,
      picture: shown ?? picture,
      mask: null,
      keyMask: null,
      ...(whole ? { zoom: FIT } : {})
    })
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
    const was = get().compare
    set({ compare })
    // Screen | Proof asks main for the unproofed picture beside the proof.
    if ((was === 'proof') !== (compare === 'proof')) get().pushView()
  },

  setClipping(clipping) {
    set({ clipping })
  },

  setHeadroom(headroom) {
    set({ headroom, headroomPlane: headroom ? get().headroomPlane : null })
    get().pushView()
  },

  setGamut(gamut) {
    set({ gamut, gamutPlane: gamut ? get().gamutPlane : null })
    get().pushView()
  },

  async setProof(on) {
    if (!on) {
      set({ proof: false, ...(get().compare === 'proof' ? { compare: 'off' as const } : {}) })
      return get().pushView()
    }
    const issue = await get().applyProof(useUi.getState().proof)
    if (issue) set({ proofIssue: issue })
  },

  async applyProof(settings, opening = false) {
    const session = get().session
    if (!session) return null
    const check = await api.develop
      .proofCheck(session.key, settings)
      .catch((err: unknown): ProofCheck => ({
        ok: false,
        issue: {
          kind: 'unusable',
          key: proofKey(settings),
          name: profileName(settings.profile),
          why: errorText(err)
        }
      }))
    // Another photo opened meanwhile: it starts unproofed.
    if (get().session?.key !== session.key) return null
    const checked = checkedProof(check, opening)
    if (!checked.use) {
      // A proof copy whose profile is gone or refused: shown unproofed, saying why.
      if (checked.show) {
        set({ proofIssue: checked.issue })
        get().pushView()
      }
      return checked.issue
    }
    useUi.getState().setProofSettings(settings)
    set({
      proof: true,
      proofIssue: null,
      proofPaper: checked.paper,
      // A CMYK or grey profile: engine 0.21 warns against it, with no preview.
      ...(checked.gamut ? { gamut: true } : {})
    })
    get().pushView()
    return null
  },

  setProofSetup(proofSetup) {
    set({ proofSetup })
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

  setQualifier(qualifierId) {
    if (qualifierId === get().qualifierId) return
    set({ qualifierId, keyMask: null })
    if (get().keyView) get().pushView()
  },

  setKeyView(keyView) {
    if (keyView === get().keyView) return
    set({ keyView, keyMask: null })
    get().pushView()
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

  firstLookGone(key) {
    set({ firstLook: lookFaded(get().firstLook, key) })
  },

  setTargetEdge(targetEdge) {
    if (Math.abs(targetEdge - get().targetEdge) < 64) return
    set({ targetEdge })
    get().pushView()
  },

  pushView() {
    const { session, tool, layerId, targetEdge, keyView, qualifierId } = get()
    if (!session) return
    // The key view asks for the selected qualifier's layer instead of a mask's.
    const keyLayer = keyView && qualifierId ? qualifierLayerId(qualifierId) : null
    // Proofing shows an SDR picture: paper has no light above white.
    const proof = get().proof ? useUi.getState().proof : null
    const view: ViewState = {
      cropMode: wholeFrameTool(tool),
      guides: tool === 'upright-guide',
      // The before render also feeds the hue chart's ghost bars, so it is
      // always wanted, compared or not.
      before: true,
      // A selected layer's mask is rendered whether or not the overlay shows:
      // the hue chart measures inside it.
      maskLayer: keyLayer ?? layerId,
      // Thumbnails of every mask while the masks window is unfolded, or all show.
      maskThumbs: useUi.getState().masksWin.open || useUi.getState().maskOverlay.showAll,
      // With a range selected its mask comes with every draft: only the
      // engine knows exactly what the key selects in the graded picture.
      maskLive: rangeSelected(get()) || keyLayer !== null,
      // Every photo whose editing space has light above white: a RAW or an HDR one.
      headroom: get().headroom && aboveWhite(session) && !proof,
      // Full HDR for those too; an SDR photo (a gain-map one edited in SDR
      // among them) shows its SDR picture, which has nothing above white.
      display:
        aboveWhite(session) && !proof
          ? renderDisplay(useUi.getState().fullHdr, useDisplay.getState().display)
          : null,
      targetEdge,
      // Settled SDR pictures in float once the window is known to draw F16
      // frames (asked once; the view goes again when the answer comes).
      float: floatCanvasKnown() === true,
      // The engine measures the gamut warning on an SDR picture only: main
      // renders none while Full HDR shows the photo.
      gamut: get().gamut,
      proof,
      proofScreen: proof !== null && get().compare === 'proof'
    }
    if (floatCanvasKnown() === null) void floatCanvasReady().then((ok) => ok && get().pushView())
    set({ rendering: true })
    void api.develop.view(session.key, view)
  },

  onRendered(e) {
    const { session } = get()
    if (!session || e.key !== session.key) return
    // Proofing asked for and refused (its profile gone, the engine refusing
    // it): off, saying why, never another profile in its place.
    const issue = e.proofIssue
    if (issue && get().proof && issue.key === proofKey(useUi.getState().proof)) {
      set({
        proof: false,
        proofIssue: issue,
        ...(get().compare === 'proof' ? { compare: 'off' as const } : {})
      })
      get().pushView()
    }
    if (e.kind === 'before') set({ before: e })
    else if (e.kind === 'screen') {
      if (Boolean(e.cropMode) === wholeFrameTool(get().tool)) set({ screen: e })
    } else if (e.kind === 'headroom') {
      if (get().headroom && Boolean(e.cropMode) === wholeFrameTool(get().tool))
        set({ headroomPlane: e })
    } else if (e.kind === 'gamut') {
      if (get().gamut && Boolean(e.cropMode) === wholeFrameTool(get().tool)) set({ gamutPlane: e })
    } else if (e.kind === 'mask') {
      // A plane drawn for the other view, or before the framing or lens
      // changed, would sit off its subject over the picture on screen.
      if (!planeFits(e, { whole: wholeFrameTool(get().tool), geometryRev: get().geometryRev }))
        return
      const { keyView, qualifierId } = get()
      if (keyView && qualifierId) {
        // The key view's plane: kept apart from the masks'.
        if (e.layerId !== qualifierLayerId(qualifierId)) return
        const cur = get().keyMask
        if (cur && e.seq < cur.seq) return
        set({ keyMask: e.url ? e : null })
        return
      }
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
        // The develop's picture is here: the first look fades out over it.
        firstLook: lookOnPicture(get().firstLook, e.key),
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
    // A develop that failed is not "Developing…": the first look goes.
    set({ error: message, invariant, rendering: false, firstLook: null })
  },

  async addVersion(name) {
    const { session, recipe } = get()
    if (!session || !recipe) return
    const v = await api.develop.versionAdd(session.key, name, recipe)
    if (v && get().session?.key === session.key) set({ snapshots: v })
  },

  async renameVersion(id, name) {
    const session = get().session
    if (!session) return
    const v = await api.develop.versionRename(session.key, id, name)
    if (get().session?.key === session.key) set({ snapshots: v })
  },

  async deleteVersion(id) {
    const session = get().session
    if (!session) return
    if (get().comparing === id) get().compareWith(null)
    const v = await api.develop.versionDelete(session.key, id)
    if (get().session?.key === session.key) set({ snapshots: v })
  },

  async keepVersion(id) {
    const session = get().session
    if (!session) return
    const v = await api.develop.versionKeep(session.key, id)
    if (get().session?.key === session.key) set({ snapshots: v })
  },

  async refreshVersions() {
    const session = get().session
    if (!session) return
    const v = await api.develop.versionList(session.key)
    if (get().session?.key === session.key) set({ snapshots: v })
  },

  restoreVersion(id) {
    const v = get().snapshots.find((s) => s.id === id)
    if (v) get().replace(structuredClone(v.recipe), `Version: ${v.name}`)
  },

  compareWith(id) {
    const { session, snapshots } = get()
    if (!session) return
    const v = id ? snapshots.find((s) => s.id === id) : undefined
    set({ comparing: v ? v.id : null })
    void api.develop.compareWith(session.key, v ? v.recipe : null).catch(() => undefined)
  },

  async measureNoise() {
    const { session } = get()
    if (!session) return
    try {
      set({ noise: await api.develop.noise(session.key) })
    } catch (err) {
      useLibrary
        .getState()
        .say(t('Noise measurement: {{error}}', { error: errorText(err) }), 'error')
    }
  }
}))

/** How long a lens change rests before the loupe's lens grid is asked for (a slider moving). */
const GRID_SETTLE_MS = 200
/** The photo and the pair of lens frames the loupe's grid was last asked for ('' for none). */
let gridFor = ''
let gridTimer: ReturnType<typeof setTimeout> | undefined

// The masks on another lens than the one rendered: the loupe maps its
// pointer and handles through a grid of the map between them (view.ts).
useDevelop.subscribe((s, prev) => {
  if (s.recipe === prev.recipe && s.session === prev.session) return
  const session = s.session
  const masks = s.recipe?.masks?.lensFrame ?? null
  const rendered = s.recipe && session ? lensFrameOf(renderedLens(s.recipe, session.isRaw)) : null
  const key =
    session && s.recipe && !sameLensFrame(masks, rendered)
      ? `${session.key}|${lensFrameKey(masks)}>${lensFrameKey(rendered)}`
      : ''
  if (key === gridFor) return
  gridFor = key
  clearTimeout(gridTimer)
  if (!key || !session) {
    if (s.maskGrid) useDevelop.setState({ maskGrid: null })
    return
  }
  // Each frame of a lens slider is a new correction: asked once it rests;
  // the last grid stands meanwhile.
  gridTimer = setTimeout(() => {
    void api.develop
      .maskGrid(session.key, masks, rendered)
      .then((maskGrid) => {
        if (gridFor === key) useDevelop.setState({ maskGrid })
      })
      .catch(() => undefined)
  }, GRID_SETTLE_MS)
})

/** The masks' placement (`maskPlacementKey`) and the recipe number it last changed at. */
let placement: { key: string | null; rev: number } = { key: null, rev: 0 }
/** The photo `placement` is of: another photo's first recipe is no change. */
let placementOf: string | null = null

// A framing or lens change drops the mask planes on hand at once: the
// loupe's own mask (drawn through the new geometry) shows until the
// engine's plane for the edit arrives.
useDevelop.subscribe((s, prev) => {
  if (s.recipe === prev.recipe && s.session === prev.session) return
  if (!s.session || !s.recipe) {
    placement = { key: null, rev: 0 }
    placementOf = null
    return
  }
  const { isRaw, frameWidth, frameHeight } = s.session
  const key = maskPlacementKey(s.recipe, isRaw, frameWidth, frameHeight)
  if (placementOf !== s.session.key) {
    // A photo just opened: its renders count from its own first edit.
    placementOf = s.session.key
    placement = { key, rev: 0 }
    if (s.geometryRev !== 0) useDevelop.setState({ geometryRev: 0 })
    return
  }
  const next = nextGeometryRev(placement, key, lastSentRev())
  if (next === placement) return
  placement = next
  useDevelop.setState({ geometryRev: next.rev, mask: null, keyMask: null })
})
