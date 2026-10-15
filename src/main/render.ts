/**
 * The develop view's renderer. Every preview is a real engine render of the
 * photo's proxy with the compiled recipe — the same compiler and the same
 * engine an export uses — measured by the engine as it renders, so the
 * histogram and the hue chart describe the pixels on screen.
 *
 * Renders are coalesced: while one is in flight only the newest recipe waits,
 * and a moving slider renders the small draft proxy; the full proxy follows
 * once the slider settles, or at once when it is let go. A slider still held
 * settles at the draft's size wherever the loupe asks for more than the
 * draft (a Retina screen, or a large loupe on a 1× one), and takes the
 * larger proxy only after a long rest (or the release); a drag frame the GPU
 * graded is the full proxy already, and stands until then. A newer edit stops a settled
 * render (and the masks, "before" and thumbnails after it) at the engine's
 * next stage; a draft in flight finishes, so a moving slider keeps showing
 * frames. Both are JPEGs, quick to write and for the loupe to read.
 */
import { stepDevelopMark } from './developmark'
import { pipeline } from './pipeline'
import { rebuildReasons } from '../shared/rebuild'
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { mkdir, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { AUTO_PERCENTILES, autoTone, linearSrgbToRec2020 } from '../shared/auto'
import {
  compile,
  fitCrop,
  framingTransparent,
  framingWarps,
  gradeKey,
  orientedFrame,
  type Compiled
} from '../shared/compile'
import { lensCorrection, MANUAL_GEOMETRY } from '../shared/lens'
import {
  compileRetouch,
  featherOf,
  spotRefine,
  spotShape,
  type P as SpotPoint,
  type RetouchSpot,
  type SpotRefine
} from '../shared/retouch'
import { activeSteps, stackSignature, type PixelStep } from '../shared/pixels'
import { effective } from '../shared/edits'
import { pixlSupported, resolveRawColour } from '../shared/rawcolour'
import { bakeSpot } from './pixels/heal'
import { freezeMask } from './pixels/freeze'
import { askOf, scenePlan, withScene, type ScenePlan } from './ai/rawdevelop'
import { takeDevelopedNote } from './devkit'
import { ensureBase, pixelDeps } from './pixels/base'
import { ensureWorking, frameOf, layStepsOn, workingKey, type WorkingSet } from './pixels/working'
import { defaultUpright, uprightTransform, type GuideLine } from '../shared/upright'
import type {
  ColorPolicy,
  ConvertRequest,
  Encode,
  Grade,
  Companion,
  HdrWorking,
  ConvertReport,
  LateralCa,
  LensCorrection,
  Retouch,
  Transform,
  ImageStats,
  Measure,
  NativeRefs,
  NoiseEstimate,
  SourceInfo
} from '../shared/engine-types'
import { STRIP_ALL } from '../shared/engine-types'
import { CEILING_MAX, CEILING_MIN } from '../shared/export'
import { DETECTED_PEAK, REFERENCE_WHITE } from '../shared/hdrdisplay'
import {
  IPC,
  type BasicSetting,
  type CaMeasurement,
  type DevelopSession,
  type LookThumbEvent,
  type MasterEvent,
  type PixlDemosaicState,
  type RegionRequest,
  type RegionResult,
  type RenderEvent,
  type RenderReport,
  type SampleResult,
  type ViewState
} from '../shared/ipc'
import { beforeRecipe, hash32, normaliseRecipe, sameValue, type Recipe } from '../shared/recipe'
import { LookThumbQueue, type LookThumb, type ThumbJob } from './lookthumbs'
import type { Vec3 } from '../shared/wb'
import {
  analyzeRequest,
  engineWbSliders,
  hdrSignalOf,
  hdrWorkingOf,
  measureAutoWb,
  rendersDir
} from './autowb'
import { brushPlanes } from './brushes'
import { paths } from './paths'
import { sweepPhoto } from './sweep'
import type { PhotoRow } from './db'
import { EngineError, isCancelled, type EngineClient } from './engine/client'
import { GpuDrag, HeldSlot, type FrameRef } from './gpudrag'
import {
  dragRegion,
  dragVerdict,
  gpuDragRequest,
  gpuRefusal,
  gradeInputRequest,
  gradeShape,
  heldKey,
  inputKey,
  measuresPhoto
} from '../shared/gpudrag'
import { keyOf, parseKey } from './keys'
import type { Library, Picture } from './library'
import { CICP_DISPLAY_P3, encodePng8, pngToFloats } from './pngio'
import { pixels } from './workers/pool'
import { traceRegion } from './trace'
import { cacheUrl } from './protocol'
import {
  cutTo,
  ensureDevelopedProxies,
  ensureLensedProxies,
  lensOn,
  ensureMaster,
  onMasterWork,
  ensureProxies,
  ensureQuickMaster,
  masterCached,
  pruneLensed,
  type Proxies,
  type ProxyFile
} from './proxy'
import { editsHdr, ensureHdrSource } from './hdrsource'
import { READ_LIMITS } from '../shared/limits'
import type { LensShot } from './lensprofiles'
import { t, tk } from '../shared/i18n'
import {
  blankRequest,
  BACKGROUND_THREADS,
  displayPolicy,
  gainMapOf,
  interactiveThreads,
  colourOf,
  isLinearRaw,
  rawDevelop,
  rawMaster,
  RAW_DEVELOP,
  sourceOrientation,
  seedOf,
  versionStamp
} from './source'

type Kind = 'draft' | 'full'

/** What a GPU drag frame is made from (see `Session.gpuPlan`, Phase A §4.3). */
interface GpuPlan {
  /** The recipe compiled for the full proxy, as a GPU drag (`compileFor`'s `'gpu'`). */
  compiled: Compiled
  /** Its grade's shape (shared/gpudrag.ts `gradeShape`): what a refusal is remembered by. */
  shape: string
  /** The display space the drag names, the CPU draft's own. */
  color: ColorPolicy
  /** The grade-input render the frame is uploaded from, and its key. */
  input: ConvertRequest
  inputKey: string
}

/** How long a slider must rest before the full proxy renders. */
/**
 * A region's least margin, pixels: what every tile had before the engine
 * stated a grade's reach (0.19.2), and still the floor under it.
 */
const REGION_MARGIN = 96
const SETTLE_MS = 180
/**
 * How long the first draft of a photo stands when the full render is the
 * large proxy, four times the draft's size (a held slider has its own rest,
 * `HELD_SETTLE_MS`).
 */
const SETTLE_LARGE_MS = 500
/**
 * How long a slider still held must rest before its picture is the larger
 * proxy a Retina loupe asks for. Until then it rests at the draft's size:
 * a pause mid-drag started a render two to four times the draft's pixels,
 * which the next move had to stop and then wait for to let go of the cores
 * (up to `DRAIN_MAX_MS`, engine/client.ts), a stall a 1× screen never has.
 */
const HELD_SETTLE_MS = 1000
/** The signature of a mask that compiles to nothing (its event has no picture). */
const EMPTY = 'empty'
/** How long an edit must rest before the sidecar is written. */
const SAVE_MS = 600
/**
 * The long edge mask thumbnails are rendered at: shown at a few dozen pixels
 * in the panel, and stretched over the loupe as a soft tint by hover and
 * "show all", which this still serves.
 */
const MASK_THUMB_EDGE = 512
/** How long editing pauses before an open photo's thumbnail is made again. */
const THUMB_IDLE_MS = 4000
/** The settled picture is made screen-sized once the loupe wants this much more than the proxy. */
const SCREEN_GAIN = 1.1
/** The screen-sized level's largest edge, and the steps its edge is rounded up to. */
const SCREEN_EDGE_MAX = 6144
const SCREEN_STEP = 512
/** Past this share of the frame, the full-size frame itself is the screen-sized level. */
const SCREEN_WHOLE = 0.92
/** How long a RAW stays open before the PIXL demosaic's master is made for it. */
const DEVELOP_ON_OPEN_MS = 1200
/** The middle proxy serves a view up to 1/MID_SHORTFALL its size. */
const MID_SHORTFALL = 0.8
/** Picture files of each kind kept on disk besides any a kept event names. */
const KEEP_RENDERS = 6
/**
 * Settled pictures remembered by what they show: going back to one (a look
 * hovered and left, an Amount dragged back) is the file already made.
 */
const RECENT_FULL = 3
/** The Looks browser's cards: the long edge asked for, within reason, and how many are kept. */
const LOOK_EDGE_DEFAULT = 320
const LOOK_EDGE_MIN = 96
const LOOK_EDGE_MAX = 640
const LOOK_KEEP = 600

/**
 * Full HDR's colour (engine 0.18, integration guide §4.5): the master for
 * this display (`Ceiling::Display`), F16 linear Display P3 with 1.0 = SDR
 * white, and an 8-bit SDR companion for what reads the picture.
 */
/**
 * An SDR picture in float (the settled picture and the 1:1 tiles on a
 * window that draws F16 frames): the same Display P3 picture, linear, so
 * its gradients are not cut into 256 steps. Values stop at 1, as the 8-bit
 * picture's do, and match it within one step of 255 once encoded.
 */
const LINEAR_P3: ColorPolicy = {
  ConvertTo: {
    to: 'LinearDisplayP3',
    intent: 'RelativeColorimetric',
    black_point_compensation: false
  }
}

function masterFor(
  display: { whiteNits: number; peakNits: number },
  /** The whole picture's figures, for a part of it (a region measures neither). */
  stated?: HdrFigures,
  companionEdge = COMPANION_EDGE
): ColorPolicy {
  return {
    Master: {
      headroom: true,
      peak: stated ? { Nits: stated.peakNits } : 'Measured',
      ceiling: { Display: { white_nits: display.whiteNits, peak_nits: display.peakNits } },
      reach: stated ? { Stated: stated.reach } : 'Measured',
      look: 'Colorimetric',
      float: 'ExtendedLinearDisplayP3',
      companion: { longest_side: companionEdge, resampler: 'Bilinear' }
    }
  }
}

/**
 * A RAW's headroom plane (the Headroom overlay): its master to `display`, as
 * Full HDR shows it, written as PQ so the engine can say where it sits above
 * white (`Inspect::Headroom` needs a PQ/HLG output). No companion.
 */
function headroomMaster(display: { whiteNits: number; peakNits: number }): ColorPolicy {
  return {
    Master: {
      headroom: true,
      peak: 'Measured',
      ceiling: { Nits: Math.min(CEILING_MAX, Math.max(CEILING_MIN, display.peakNits)) },
      reach: 'Measured',
      look: 'Colorimetric',
      float: 'LinearPixlRgb',
      companion: null
    }
  }
}

/**
 * Full HDR's settled picture, an A/B (Pass 99): `frame`, F16 pixels over the
 * preview port as drafts are (the default); `avif`, an AVIF file whose SDR
 * base carries the master's gain map, shown by an `<img>`. A dev switch
 * (`PLAYROOM_SETTLED=avif`) until the owner has compared them on the XDR.
 * PQ JPEG XL was the third arm: this Chromium does not decode JXL at all.
 */
const SETTLED_ARM: 'frame' | 'avif' = process.env['PLAYROOM_SETTLED'] === 'avif' ? 'avif' : 'frame'

/** The AVIF arm's encoder: fast (speed 9), 8-bit, full chroma; the master adds the gain map. */
const SETTLED_AVIF: Encode = {
  Avif: {
    quality: 90,
    lossless: false,
    bit_depth: 8,
    chroma: 'Full',
    speed: 9,
    matrix: 'Bt601',
    threads: 2,
    tune: 'Ssim',
    tiling: 'Single'
  }
}

/**
 * A Full HDR picture that must be a file (the Before, a 1:1 tile, the AVIF
 * arm's settled picture): an AVIF whose SDR base carries the master's gain
 * map to this display's headroom, shown by an `<img>`.
 */
function hdrFile(
  display: { whiteNits: number; peakNits: number },
  stated?: HdrFigures
): {
  color: ColorPolicy
  encode: Encode
} {
  return { color: masterFor(display, stated), encode: SETTLED_AVIF }
}

/** What the master measured of the whole picture: a 1:1 tile states them, to match it. */
interface HdrFigures {
  peakNits: number
  reach: number
}

/**
 * The companion's longest side: a settled picture's is what the eyedropper,
 * scopes, overlays and a range's key read; a draft's only bridges a drag
 * (half the size: 70 ms less a draft on the M2 Pro).
 */
const COMPANION_EDGE = 1024
const DRAFT_COMPANION_EDGE = 512
/** A 1:1 tile's companion: only a frame's SDR stand-in (nothing measures a tile), kept small. */
const TILE_COMPANION_EDGE = 256

/** A report's companion as a frame carries it. */
function companionOf(c: Companion): { width: number; height: number; data: Uint8Array } {
  return { width: c.width, height: c.height, data: c.data }
}

/**
 * A convert's rejection, an `Invariant` named against the compiled request it
 * came from (engine 0.18, HR-0.18-9): the window marks that adjustment, the
 * edit stays, and nothing renders again without it.
 */
function named(compiled: Pick<Compiled, 'grade' | 'layerIndex'>): (err: unknown) => never {
  return (err) => {
    if (err instanceof EngineError) err.nameInvariant(compiled.grade, null, compiled.layerIndex)
    throw err
  }
}

/**
 * What the histogram, the hue chart and auto tone read, measured by the
 * engine on the pixels it hands the encoder: `analyze`'s numbers without
 * decoding the file again.
 */
function measureOf(stride: number): Measure {
  return {
    at: 'Output',
    domain: 'Encoded',
    bins: 256,
    percentiles: [...AUTO_PERCENTILES, 1, 99],
    clip_low: 0,
    clip_high: 1,
    hue_bins: 36,
    stride,
    transparent: 'Include',
    noise: false
  }
}

/** The measurement a `measure` asked for; the engine returns it whenever one was. */
function statsOf(r: ConvertReport): ImageStats {
  if (!r.stats) throw new Error('the engine measured nothing')
  return r.stats
}

function reportOf(
  r: ConvertReport,
  totalMs: number,
  notes: string[],
  layerIndex: Record<string, number>
): RenderReport {
  const graded = r.color.graded?.layers ?? []
  const layers: NonNullable<RenderReport['layers']> = {}
  for (const [id, i] of Object.entries(layerIndex)) {
    const l = graded[i]
    if (l) layers[id] = { applied: l.applied, coverage: l.mask?.coverage ?? null, ms: l.layer_ms }
  }
  const lines: string[] = []
  for (const l of r.color.graded?.layers ?? []) {
    lines.push(
      `▸ ${l.name || 'layer'} — ${l.applied ? `${l.blend}, opacity ${l.opacity.toFixed(2)}` : 'not applied'} (${l.layer_ms} ms)`
    )
    if (l.mask) lines.push(`   mask: coverage ${(l.mask.coverage * 100).toFixed(1)}%`)
    for (const s of l.stages) {
      lines.push(`   [${s.space}]`)
      for (const op of s.ops) lines.push(`     ${op}`)
    }
  }
  return {
    totalMs,
    decodeMs: r.decode_ms,
    colorMs: r.color_ms,
    encodeMs: r.encode_ms,
    gradeLines: lines,
    clampedSamples: r.color.graded?.clamped_samples ?? 0,
    loss: r.loss,
    notes,
    colorSpace: r.color.space,
    layers
  }
}

class Session {
  seq = 0
  /**
   * The renderer's number for the recipe last received: every render says
   * which recipe it was made from, so the loupe's own preview knows when
   * the engine has caught up with it.
   */
  rev = 0
  view: ViewState = { cropMode: false, before: false, maskLayer: null, targetEdge: 2560 }
  private inflight = false
  /** What is rendering, and how to stop it. */
  private inflightKind: Kind | null = null
  private abort: AbortController | null = null
  /** The 1:1 region being rendered: a newer one stops it. */
  private regionAbort: AbortController | null = null
  /**
   * What this photo's view waits on its RAW develop with (on open and at
   * 1:1): aborted when the photo is left, so a develop nobody else waits
   * for stops (engine 0.21.0, E6). A pan never stops it.
   */
  private readonly developAbort = new AbortController()
  private pending: Kind | null = null
  /** The render running now, or the last one. */
  private current: Promise<void> = Promise.resolve()
  private settle: NodeJS.Timeout | undefined
  /**
   * Whether the last edit was interactive (a slider still held), and the
   * long rest that lets go of it (`HELD_SETTLE_MS`).
   */
  private held = false
  private letGo: NodeJS.Timeout | undefined
  /**
   * Whether the draft on screen was graded on the GPU: the full proxy's
   * size, so a held slider's rest has nothing smaller to put in its place.
   */
  private gpuShown = false
  private save: NodeJS.Timeout | undefined
  /**
   * Picture, mask and headroom files: each render its own name, so an event
   * kept for re-sending (or the picture pickers measure) still finds what it
   * was made as. The newest few of each are kept, and any one still named.
   */
  private readonly tag = Date.now().toString(36)
  private fileSeq = 0
  private files: Record<string, string[]> = {}
  private lastOut: Record<Kind, string> = { draft: '', full: '' }
  private lastMaskOut = ''
  private regionSlot = 0
  /** Full HDR 1:1 tiles sent as frames, numbered: each its own frame id. */
  private tileSeq = 0
  private beforeKey = ''
  /**
   * What each kind of picture was last rendered from, and the event sent for
   * it. An edit that compiles to the same engine request (a straighten while
   * the crop tool shows the unrotated frame, a slider dragged back to where
   * it was) re-sends the last event instead of rendering again, so the loupe
   * keeps its image and nothing downstream reloads.
   */
  private lastSig: Record<Kind, string> = { draft: '', full: '' }
  private lastEvent: Record<Kind, RenderEvent | null> = { draft: null, full: null }
  /** The picture sent last, of either kind: the one the window has. */
  private lastSent: RenderEvent | null = null

  /**
   * Whether a picture sent before can be sent again in place of rendering
   * it: a file can; a frame (a draft, or any Full HDR picture) only while it
   * is the picture the window has. The window keeps a frame a moment (four
   * of them: lib/frames.ts) and drops an event whose frame is gone, so a
   * slider let go where the photo last settled, a drag's frames since,
   * would leave it waiting for a picture that never comes.
   */
  private showable(e: RenderEvent): boolean {
    return !e.url.startsWith('frame:') || this.lastSent === e
  }
  private maskSig = ''
  /** The last mask event sent: re-sent (with the current seq and rev) when nothing changed. */
  private lastMask: RenderEvent | null = null
  /** Per layer, what its thumbnail was last rendered from. */
  private thumbSig: Record<string, string> = {}
  private readonly dir: string
  closed = false

  /** How a PQ/HLG source is graded and measured: 1.0 is 203-nit reference white. */
  get hdrWorking(): HdrWorking | null {
    return hdrWorkingOf(this.info)
  }

  constructor(
    readonly key: string,
    readonly row: PhotoRow,
    readonly info: SourceInfo,
    /** The proxies renders start from: the plain ones, or (`adoptDeveloped`) those cut from the master. */
    public px: Proxies,
    public recipe: Recipe,
    private readonly owner: DevelopSessions,
    /** The file as probed; `info` is what is graded (a gain map's HDR master, when edited so). */
    readonly file: SourceInfo = info,
    /** A gain-map photo edited as HDR: the applied rendition at full resolution. */
    readonly hdrMaster: ProxyFile | null = null
  ) {
    this.dir = rendersDir(row.id)
    this.heldSlot = new HeldSlot(owner.engine, `${key}#held`)
    this.opened = recipe
    void this.clearEarlier()
  }

  /** The recipe the photo opened with: an editing session that changed it ends in a Version. */
  private readonly opened: Recipe

  /** Before/After's other side: a Version's recipe, or null for the photo as it came. */
  private compareRecipe: Recipe | null = null

  compareWith(recipe: Recipe | null): void {
    this.compareRecipe = recipe
    this.beforeKey = ''
    if (this.view.before) this.schedule('full')
  }

  /** An earlier session's picture files: nothing names them now. */
  private async clearEarlier(): Promise<void> {
    for (const name of await readdir(this.dir).catch(() => [] as string[])) {
      if (/^(view|mask|headroom|look)-/.test(name) && !name.includes(`-${this.tag}-`))
        await rm(join(this.dir, name), { force: true }).catch(() => undefined)
    }
  }

  get isRaw(): boolean {
    return this.row.is_raw === 1
  }

  /**
   * Compile a recipe for a source. A source from the prepared set already
   * carries the lens correction and the spots: the engine is not asked to do
   * those again. `smoothing` false for a draft: the Smoothing slider's work
   * waits for the settled render (engine 0.18: on release, not while dragging).
   */
  async compileFor(
    recipe: Recipe,
    source: ProxyFile,
    applyCrop: boolean,
    headroom = false,
    smoothing = true,
    /** Rendered for an HDR display (Full HDR, engine 0.18's Master): light above white kept. */
    hdrOut = false,
    /** A drag graded on the GPU (Phase A §4.3): Tone keeps the local-Laplacian base there. */
    drag: 'cpu' | 'gpu' = 'cpu'
  ): Promise<Compiled> {
    const baked = this.isBaked(source)
    // The working pixels' frame: the photo's, or an upscale step's.
    const px = baked ? this.lensed!.px : this.basePx()
    const { user } = orientedFrame(recipe, px.frameWidth, px.frameHeight)
    const compiled = compile(recipe, {
      isRaw: this.isRaw,
      asShot: this.info.as_shot_white,
      sourceOrientation: 'Normal',
      frameWidth: px.frameWidth,
      frameHeight: px.frameHeight,
      scale: source.width / px.frameWidth,
      seed: seedOf(this.row),
      brushPaths: await brushPlanes(this.row.id, recipe, user),
      applyCrop,
      // HDR only where the request's pipeline has room above white (Preserve
      // with the HDR working space: masks, the headroom plane, HDR stats). A
      // picture for the screen is tone mapped to SDR first and graded after,
      // its values stopping at 1, so it compiles as SDR (a curve carried past
      // 1 there is refused).
      hdr: (headroom && this.info.is_hdr) || hdrOut,
      showTransform: !this.view.guides,
      smoothing,
      // The M1 drags Tone without its base until it is measured (Phase A
      // §3.2, §4.3); the release brings it back. Only a drag reads these.
      dragWithoutBase: this.owner.gpu.constrained,
      gpuDrag: drag === 'gpu'
    })
    return baked ? { ...compiled, lens: null, retouch: null } : compiled
  }

  /** Whether a source is one of the prepared set's (lens and spots baked in). */
  private isBaked(source: ProxyFile): boolean {
    const px = this.lensed?.px
    return !!px && (source === px.proxy || source === px.mid || source === px.draft)
  }

  /** Whether a source is the plain photo's (no pixel step laid on). */
  private isPlain(source: ProxyFile): boolean {
    return source === this.px.proxy || source === this.px.mid || source === this.px.draft
  }

  // ── pixel steps (shared/pixels.ts, pixels/working.ts) ──

  /** The working set for the recipe's pixel steps, once made (or the last, while the next is). */
  private working: WorkingSet | null = null
  /** A pixel step being made: its draft, shown in its place until the step lands. */
  private preview: Proxies | null = null
  /** The working pixels being made for the recipe's steps (resolved once they are). */
  workingJob: Promise<void> = Promise.resolve()

  private stepsKey(recipe: Recipe): string {
    return workingKey(this.workingVersion(), activeSteps(recipe.pixels))
  }

  /** The develop the proxies were cut from, once they are the master's (`adoptDeveloped`). */
  private developedTag: string | null = null

  /** What the working pixels are kept by: the photo's version, and the develop its proxies are of. */
  private workingVersion(): string {
    const v = versionStamp(this.row)
    return this.developedTag ? `${v}-${this.developedTag}` : v
  }

  /** Whether this RAW's full-size develop is the PIXL demosaic (a development kit's), now. */
  private async pixlPlan(): Promise<ScenePlan | null> {
    if (!this.isRaw || isLinearRaw(this.file)) return null
    const plan = await scenePlan(this.file.raw_cfa, askOf(this.recipe))
    return plan.demosaic === 'pixl' ? plan : null
  }

  /**
   * A RAW the PIXL demosaic develops: its master is made as it opens (after
   * a moment's rest, so flicking through photos starts none), and the
   * zoomed-out picture is cut from it once it is there (`adoptDeveloped`),
   * so what is edited is what the 1:1 view and the export show. The bar in
   * the loupe's badge says how far meanwhile.
   */
  async developOnOpen(): Promise<void> {
    try {
      if (this.developedTag || !(await this.pixlPlan())) return
      const ask = askOf(this.recipe)
      // Made on an earlier visit: at once.
      if (!(await masterCached(this.row, this.file, ask))) {
        await new Promise((r) => setTimeout(r, DEVELOP_ON_OPEN_MS))
        if (this.closed || this.developedTag || !(await this.pixlPlan())) return
        this.setPixl('developing')
        await ensureMaster(this.owner.bgEngine, this.row, this.file, ask, this.developAbort.signal)
      }
      // The engine refused the model: the released develop stood in, and is planned from now on.
      if (!(await this.pixlPlan())) return this.setPixl('refused')
      await this.adoptDeveloped()
    } catch (err) {
      if (this.closed || isCancelled(err)) return
      this.setPixl('refused')
      this.masterRefused(err)
    }
  }

  /** The PIXL demosaic's part in this RAW, as the loupe's badge says it (`PixlDemosaicEvent`). */
  private pixl: PixlDemosaicState | null = null

  private setPixl(state: PixlDemosaicState | null): void {
    if (this.pixl === state || this.closed) return
    this.pixl = state
    this.owner.send(IPC.develop.pixlDemosaic, { key: this.key, state })
  }

  /** The proxies before `adoptDeveloped`: back to them when the PIXL demosaic is turned off. */
  private plainPx: Proxies | null = null

  /**
   * The PIXL demosaic's switch turned (Settings → AI models): the picture
   * follows it, from the master's proxies or back to the plain ones.
   */
  async pixlSwitched(): Promise<void> {
    if (this.closed) return
    if (await this.pixlPlan()) return void this.developOnOpen()
    this.setPixl(null)
    if (!this.developedTag || !this.plainPx) return
    this.px = this.plainPx
    this.plainPx = null
    this.developedTag = null
    this.working = null
    if (activeSteps(this.recipe.pixels).length > 0) await this.refreshWorking()
    else this.schedule('full')
  }

  /**
   * Once the PIXL demosaic's master is made (on open, a 1:1 view, a pixel
   * step or an earlier visit), the develop view's proxies are cut from it
   * and everything renders again from them: the zoomed-out picture is the
   * model's too (denoised), not the half-size develop's. A master another
   * develop stood in for (one the engine refused the model for) is not.
   */
  async adoptDeveloped(): Promise<void> {
    if (this.developedTag || this.closed) return
    try {
      const plan = await this.pixlPlan()
      const ask = askOf(this.recipe)
      if (!plan || !(await masterCached(this.row, this.file, ask))) return
      const master = await ensureMaster(this.owner.bgEngine, this.row, this.file, ask)
      const px = await ensureDevelopedProxies(
        this.owner.bgEngine,
        this.row,
        this.px,
        master,
        plan.tag
      )
      if (this.closed || this.developedTag) return
      this.plainPx = this.px
      this.px = px
      this.developedTag = plan.tag
      this.setPixl('on')
      // Steps laid on the plain proxies are laid again on these.
      this.working = null
      if (activeSteps(this.recipe.pixels).length > 0) await this.refreshWorking()
      else this.schedule('full')
      log.info('develop view now from the master', plan.tag, this.row.name)
    } catch (err) {
      log.warn('proxies from the master not made', (err as Error).message)
    }
  }

  /**
   * The proxies everything else starts from: a step being made's preview,
   * the working pixels (the recipe's steps laid on), or the plain photo.
   */
  private basePx(): Proxies {
    if (this.preview) return this.preview
    if (activeSteps(this.recipe.pixels).length === 0) return this.px
    return this.working?.px ?? this.px
  }

  /**
   * Make the working pixels for the recipe's steps (the proxies; the
   * full-resolution master waits for a 1:1 view or an export), then render
   * again from them. Steps undone or hidden find theirs already made.
   */
  async refreshWorking(): Promise<void> {
    const key = this.stepsKey(this.recipe)
    if (this.working?.key === key) return
    if (activeSteps(this.recipe.pixels).length === 0) {
      const was = this.frameSize()
      this.working = null
      this.frameChanged(was)
      this.schedule('full')
      return
    }
    try {
      const set = await ensureWorking(
        pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row),
        this.workingVersion(),
        this.px,
        activeSteps(this.recipe.pixels),
        null
      )
      if (this.closed || this.stepsKey(this.recipe) !== set.key) return
      const was = this.frameSize()
      this.working = set
      this.frameChanged(was)
      this.schedule('full')
    } catch (err) {
      log.warn('working pixels failed', (err as Error).message)
      this.owner.send(IPC.develop.renderError, {
        key: this.key,
        message: (err as Error).message,
        code: 'Pixels'
      })
    }
  }

  /**
   * The full-resolution frame's size: the photo's, or (an upscale step in
   * the recipe) the steps'. What a 1:1 view and the renderer measure in.
   */
  frameSize(): { width: number; height: number } {
    const px = activeSteps(this.recipe.pixels).length > 0 ? (this.working?.px ?? this.px) : this.px
    return { width: px.frameWidth, height: px.frameHeight }
  }

  /**
   * The photo's full-size frame as the next step would read it: the steps
   * laid on, else its own pixels (a RAW's master). PIXL Enhance's preview is
   * made from it.
   */
  async fullFrame(): Promise<ProxyFile> {
    return (
      (await this.workingMaster()) ??
      ensureBase(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
    )
  }

  /**
   * PIXL Enhance's preview (main/enhance.ts `makeEnhancePreview`): the
   * full-size frame with a square enhanced, which the 1:1 view reads while
   * it is shown; made for these steps only, so gone when they change.
   */
  private enhancePreview: { file: ProxyFile; steps: string; shown: boolean } | null = null

  setEnhancePreview(file: ProxyFile | null): void {
    const was = this.enhancePreview
    if (was && was.file.path !== file?.path) dropFiles([was.file.path])
    this.enhancePreview =
      file && !this.closed ? { file, steps: this.stepsKey(this.recipe), shown: true } : null
    if (file && this.closed) dropFiles([file.path])
    if (was || file) this.owner.send(IPC.develop.tileStale, { key: this.key })
  }

  /** The preview shown, or the 1:1 view without it, to compare. */
  showEnhancePreview(on: boolean): void {
    if (!this.enhancePreview || this.enhancePreview.shown === on) return
    this.enhancePreview.shown = on
    this.owner.send(IPC.develop.tileStale, { key: this.key })
  }

  /** The preview the 1:1 view reads now: shown, and made for the steps the recipe has. */
  private previewFrame(): ProxyFile | null {
    const p = this.enhancePreview
    if (!p) return null
    if (p.steps !== this.stepsKey(this.recipe)) {
      this.setEnhancePreview(null)
      return null
    }
    return p.shown ? p.file : null
  }

  /** The full-resolution working frame (the recipe's steps on the photo at full size): 1:1 and export. */
  async workingMaster(): Promise<ProxyFile | null> {
    if (activeSteps(this.recipe.pixels).length === 0) return null
    const set = await ensureWorking(
      pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row),
      this.workingVersion(),
      this.px,
      activeSteps(this.recipe.pixels),
      () => ensureBase(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
    )
    return set.master
  }

  /** An upscale step added or undone: the renderer measures in the new frame. */
  private frameChanged(was: { width: number; height: number }): void {
    const now = this.frameSize()
    if (now.width === was.width && now.height === was.height) return
    this.owner.send(IPC.develop.frame, {
      key: this.key,
      frameWidth: now.width,
      frameHeight: now.height
    })
  }

  /** Show a pixel step's draft while it is made (null: back to the recipe's pixels). */
  showPreview(draft: ProxyFile | null): void {
    this.preview = draft
      ? { proxy: draft, draft, frameWidth: this.px.frameWidth, frameHeight: this.px.frameHeight }
      : null
    this.schedule('full')
  }

  /** Resolves when the render running now (which may read a preview just cleared) has ended. */
  whenIdle(): Promise<void> {
    return this.inflight ? this.current : Promise.resolve()
  }

  /**
   * What the prepared proxies hold for a recipe: its lens correction and
   * its spots, placed on the base frame (the proxy's own).
   */
  private prepared(recipe: Recipe): {
    lens: LensCorrection | null
    retouch: Retouch | null
    /** The proxies they are prepared from: the plain ones or the working pixels (steps laid on). */
    base: string
  } {
    // Optics or the heal spots switched off are not baked in either (`effective`).
    const shown = effective(recipe, this.isRaw)
    return {
      base: this.basePx().proxy.path,
      lens: lensCorrection(shown.lens),
      retouch: compileRetouch(
        shown.retouch,
        'Normal',
        this.basePx().frameWidth,
        this.basePx().frameHeight
      )
    }
  }

  /** What names the prepared proxies a recipe needs: '' for none (the plain proxies serve). */
  /** The last `lensKey` asked for, by what it is made from (asked several times per update). */
  private lensKeyMemo: { lens: unknown; retouch: unknown; base: Proxies; key: string } | null = null

  private lensKey(recipe: Recipe): string {
    const base = this.basePx()
    const m = this.lensKeyMemo
    if (m && m.lens === recipe.lens && m.retouch === recipe.retouch && m.base === base) return m.key
    const key = this.lensKeyOf(recipe)
    this.lensKeyMemo = { lens: recipe.lens, retouch: recipe.retouch, base, key }
    return key
  }

  private lensKeyOf(recipe: Recipe): string {
    const p = this.prepared(recipe)
    return p.lens || p.retouch ? hash32(JSON.stringify(p)).toString(16) : ''
  }

  /**
   * The proxies previews are graded from: the lens-corrected set when it is
   * the recipe's correction, else the plain one (the correction then runs
   * live, as while a lens slider moves).
   */
  private viewPx(): Proxies {
    const key = this.lensKey(this.recipe)
    return key && this.lensed?.key === key ? this.lensed.px : this.basePx()
  }

  /** A correction waiting for its corrected proxies (one whose bake failed is corrected live). */
  private bakePending(): boolean {
    const key = this.lensKey(this.recipe)
    return key !== '' && this.lensed?.key !== key && key !== this.bakeFailed
  }

  private baking: string | null = null
  /** The correction whose bake failed: not tried again this session. */
  private bakeFailed: string | null = null

  /**
   * Make the recipe's lens-corrected proxies in the background (once the
   * edit has settled), then render again from them. One at a time; a
   * correction changed meanwhile is baked next.
   */
  private bake(): void {
    const key = this.lensKey(this.recipe)
    if (!key || this.lensed?.key === key || this.baking === key || this.bakeFailed === key) return
    const { lens, retouch } = this.prepared(this.recipe)
    const base = this.basePx()
    this.baking = key
    ensureLensedProxies(
      this.owner.bgEngine,
      this.row,
      base,
      lens,
      retouch,
      key,
      this.hdrWorking
    ).then(
      (px) => {
        if (this.baking === key) this.baking = null
        if (this.closed) return
        if (this.lensKey(this.recipe) === key) {
          const before = this.lensed?.key
          this.lensed = { key, px }
          this.schedule('full')
          // The sets before the last go now, not only when the photo closes
          // (each is two proxies: a session of lens edits made gigabytes).
          void pruneLensed(this.row, this.key, key, before)
        } else this.bake()
      },
      (err) => {
        if (this.baking === key) this.baking = null
        log.warn('lens proxies failed; correcting live', (err as Error).message)
        this.bakeFailed = key
        // The settled render, mask, before and headroom waited for the bake: they run now.
        if (!this.closed && this.lensKey(this.recipe) === key) this.schedule('full')
      }
    )
  }

  update(next: Recipe, interactive: boolean, rev?: number): void {
    const stepsWere = stackSignature(activeSteps(this.recipe.pixels))
    // Whatever the renderer replayed (an old history base can lack fields
    // added since), the session only ever holds a complete recipe.
    const recipe = normaliseRecipe(next, this.isRaw)
    this.recipe = recipe
    this.held = interactive
    if (!interactive) clearTimeout(this.letGo)
    // An edit ends any preview: the photo's own recipe is what shows.
    this.previewing = null
    if (rev !== undefined) this.rev = rev
    // A pixel step added, undone, hidden or its strength changed: the working
    // pixels for the steps now (made already, for an undo or a redo).
    if (stackSignature(activeSteps(recipe.pixels)) !== stepsWere)
      this.workingJob = this.refreshWorking()
    // A settled render of the old recipe is only in the way; so is anything
    // in flight when the slider is let go (the full render follows at once).
    if (this.inflight && (this.inflightKind === 'full' || !interactive)) this.abort?.abort()
    clearTimeout(this.save)
    this.save = setTimeout(() => this.persist(), SAVE_MS)
    this.schedule(interactive ? 'draft' : 'full')
  }

  /**
   * A recipe shown on the loupe and nothing more (a look hovered in the
   * rail): never saved, never the thumbnail, no mask, before or headroom
   * render made for it. Null goes back to the photo's own recipe, which a
   * moment ago was a settled picture and so comes back at once.
   */
  previewRecipe(next: Recipe | null): void {
    if (!next && !this.previewing) return
    this.previewing = next ? normaliseRecipe(next, this.isRaw) : null
    if (this.inflight) this.abort?.abort()
    this.schedule(next ? 'draft' : 'full')
  }

  /** Save the recipe now. The index answers in order, so what is asked of it next sees this. */
  persist(): Promise<void> {
    clearTimeout(this.save)
    this.save = undefined
    return this.owner.library.saveRecipe(this.key, this.recipe).then(
      () => this.thumbLater(),
      (err) => {
        log.error('saving recipe failed', err)
        this.owner.send(IPC.develop.renderError, {
          key: this.key,
          message: t('Edits to {{name}} were not saved: {{reason}}', {
            name: this.row.name,
            reason: (err as Error).message
          }),
          code: 'Save'
        })
      }
    )
  }

  /** `recipe` was saved elsewhere (with a history step): a save of it still waiting is not needed. */
  saved(recipe: Recipe): void {
    if (recipe !== this.recipe || !this.save) return
    clearTimeout(this.save)
    this.save = undefined
    this.thumbLater()
  }

  private thumbTimer: NodeJS.Timeout | undefined

  /**
   * The thumbnail (and the project's preview) once editing pauses for a
   * while, or the photo closes: a full graded render on the background
   * engine is not made at every save.
   */
  private thumbLater(now = false): void {
    clearTimeout(this.thumbTimer)
    this.thumbTimer = undefined
    const queue = (): void => {
      this.thumbTimer = undefined
      const { photoId, copyId } = parseKey(this.key)
      // The settled picture of what was saved, when there is one: shrunk, not graded again.
      const shown = this.fullPicture
      const picture = shown?.recipe === this.recipe ? shown.picture : undefined
      this.owner.library.queueThumb(photoId, copyId, true, picture)
    }
    if (now) return queue()
    this.thumbTimer = setTimeout(queue, THUMB_IDLE_MS)
  }

  /** Whether the view has been asked for yet: the first picture comes as a draft, at once. */
  private viewed = false

  /**
   * The window says the settled picture's pixels never reached it (a frame
   * it had let go of, or one lost with the preview port): nothing sent
   * before is taken as shown, and the picture is rendered again.
   */
  frameLost(): void {
    if (this.closed) return
    this.lastSent = null
    this.schedule('full')
  }

  setView(view: ViewState): void {
    this.view = view
    // Opening: the draft first (a fraction of the pixels), the full picture
    // and what follows it once that is up.
    if (!this.viewed) {
      this.viewed = true
      return this.schedule('draft')
    }
    this.schedule('full')
  }

  schedule(kind: Kind): void {
    clearTimeout(this.settle)
    if (kind === 'draft') {
      clearTimeout(this.letGo)
      if (this.held) {
        // A slider held: it rests at the draft's size soon, and at the
        // loupe's own once it has rested a while (or at once when let go).
        this.settle = setTimeout(() => {
          // The GPU's frame is the full proxy: the draft-sized stand-in would be a step down.
          if (this.held && this.gpuShown && this.holding()) return
          this.schedule('full')
        }, SETTLE_MS)
        this.letGo = setTimeout(() => {
          const larger = this.holding()
          this.held = false
          if (larger) this.schedule('full')
          // No larger picture to make: the rest still ends the drag.
          else this.endDrag()
        }, HELD_SETTLE_MS)
      } else {
        const src = this.source('full')
        const large = src === this.viewPx().proxy || src === this.screen?.file
        const wait = large ? SETTLE_LARGE_MS : SETTLE_MS
        this.settle = setTimeout(() => this.schedule('full'), wait)
      }
    }
    if (this.inflight) {
      this.pending = this.pending === 'full' || kind === 'full' ? 'full' : 'draft'
      return
    }
    this.current = this.run(kind)
  }

  private async run(kind: Kind): Promise<void> {
    this.inflight = true
    this.inflightKind = kind
    const abort = new AbortController()
    this.abort = abort
    const { signal } = abort
    try {
      // A settled edit bakes its lens correction in the background.
      if (kind === 'full') this.bake()
      // The release (or the long rest) ends the drag; a held slider's pause does not.
      if (kind === 'full' && !this.held) this.endDrag()
      await this.renderPicture(kind, signal)
      if (kind === 'full') this.gpuShown = false
      // The GPU frame made ready for the next drag, off the drag's path: its
      // upload renders the full proxy, which a held slider must not wait behind.
      if (kind === 'full' && !this.pending && !this.previewing && !this.held) void this.warmGpu()
      // A newer edit waiting behind this render will redo what follows.
      if (
        kind === 'draft' &&
        this.view.maskLive &&
        this.view.maskLayer &&
        !this.closed &&
        !this.previewing
      )
        await this.renderMask('draft', signal)
      // While a bake is pending, what follows waits for the render it brings.
      // A preview is the picture alone: what follows belongs to the photo's own recipe.
      // A held slider's resting picture is only a stand-in: they follow the release.
      const extras =
        !this.closed && !this.pending && !this.bakePending() && !this.previewing && !this.holding()
      if (kind === 'full' && extras) {
        // The picture is shown: what goes beside it failing is logged, not
        // said over it (the picture is fine, and the next edit tries again).
        const beside = async (what: string, run: () => Promise<void>): Promise<void> => {
          try {
            await run()
          } catch (err) {
            if (isCancelled(err)) throw err
            const e = err as EngineError
            log.warn(`${what} render failed`, e.code, e.message)
          }
        }
        if (this.view.maskLayer) await beside('mask', () => this.renderMask('full', signal))
        if (this.view.before) await beside('before', () => this.renderBefore(signal))
        if (this.view.headroom) await beside('headroom', () => this.renderHeadroom(signal))
        if (this.view.maskThumbs) await beside('mask thumbs', () => this.renderMaskThumbs(signal))
      }
    } catch (err) {
      // Stopped for a newer edit, which renders next: nothing went wrong.
      if (isCancelled(err)) return
      const e = err as EngineError
      log.warn('render failed', e.code, e.message)
      this.owner.send(IPC.develop.renderError, {
        key: this.key,
        message: e.message,
        code: e.code ?? 'Unknown',
        field: e instanceof EngineError ? e.field : undefined,
        invariant: e instanceof EngineError ? (e.invariant ?? undefined) : undefined
      })
    } finally {
      this.inflight = false
      this.inflightKind = null
      this.abort = null
      const next = this.pending
      this.pending = null
      if (next && !this.closed) this.current = this.run(next)
    }
  }

  private source(kind: Kind): ProxyFile {
    const px = this.viewPx()
    if (kind === 'draft') return px.draft
    // A correction still being baked: the draft, corrected live, stands in
    // (a large proxy warped on every render is what the bake avoids).
    if (this.bakePending()) return px.draft
    if (this.held) return px.draft
    return this.loupeSource(px)
  }

  /**
   * The screen-sized level: the settled picture at the loupe's own pixels
   * where they are more than the proxy's (a large window, a 5K or 6K
   * screen), cut from the full-size frame (a RAW's master once it is made,
   * else the photo decoded) with the steps and the baked lens correction laid
   * on as on the proxies. Until it is there the proxy serves, and the sharp
   * tile over it as before.
   */
  private screen: { key: string; file: ProxyFile; made: string[] } | null = null
  private screening: string | null = null
  /** A level that could not be made (or has no full-size frame yet): not asked again. */
  private screenFailed: string | null = null

  /**
   * Whether a settled SDR picture (or a 1:1 tile) goes as an F16 frame: the
   * window draws float frames (`ViewState.float`), and the photo has no light
   * above white to tone map (that keeps its 8-bit path).
   */
  private floatSdr(kind: Kind, display: unknown): boolean {
    return kind === 'full' && !display && this.view.float === true && !this.info.is_hdr
  }

  /** The edge the loupe wants past the proxy's, or null when the proxy serves. */
  private screenEdge(px: Proxies): number | null {
    if (this.hdrMaster || this.info.is_hdr) return null
    const long = Math.max(px.proxy.width, px.proxy.height)
    const target = this.view.targetEdge
    if (target <= long * SCREEN_GAIN) return null
    // An upscale step makes another frame: the proxies show it, as before.
    const frame = frameOf(activeSteps(this.recipe.pixels), this.px.frameWidth, this.px.frameHeight)
    if (frame.width !== this.px.frameWidth || frame.height !== this.px.frameHeight) return null
    const whole = Math.max(this.px.frameWidth, this.px.frameHeight)
    const edge = Math.min(whole, SCREEN_EDGE_MAX, Math.ceil(target / SCREEN_STEP) * SCREEN_STEP)
    return edge > long * SCREEN_GAIN ? edge : null
  }

  /** What a screen-sized level is of: its edge, the develop, the steps, and the lens baked or live. */
  private screenKey(edge: number): string {
    const lens = this.lensKey(this.recipe)
    return [
      edge,
      this.developedTag ?? '',
      activeSteps(this.recipe.pixels).length > 0 ? this.stepsKey(this.recipe) : '',
      lens && this.lensed?.key === lens ? lens : 'live'
    ].join(':')
  }

  /** A master made since: a level that waited for one is asked for again. */
  screenAgain(): void {
    this.screenFailed = null
    this.schedule('full')
  }

  private makeScreen(edge: number, key: string): void {
    if (this.screening === key || this.screenFailed === key || this.closed) return
    this.screening = key
    void this.buildScreen(edge, key).then(
      (made) => {
        if (this.screening === key) this.screening = null
        if (!made) return void (this.screenFailed = key)
        const now = this.screenEdge(this.viewPx())
        if (this.closed || now === null || this.screenKey(now) !== key) {
          dropFiles(made.made)
          if (!this.closed && now !== null) this.makeScreen(now, this.screenKey(now))
          return
        }
        const was = this.screen
        this.screen = { key, ...made }
        if (was) dropFiles(was.made)
        this.schedule('full')
      },
      (err: unknown) => {
        if (this.screening === key) this.screening = null
        this.screenFailed = key
        log.warn('screen-sized picture not made', (err as Error).message)
      }
    )
  }

  private async buildScreen(
    edge: number,
    key: string
  ): Promise<{ file: ProxyFile; made: string[] } | null> {
    const engine = this.owner.bgEngine
    const ask = askOf(this.recipe)
    // A RAW's full-size frame is its master, once made (on open for the PIXL demosaic).
    if (this.isRaw && !(await masterCached(this.row, this.file, ask))) return null
    const full = this.isRaw
      ? await ensureMaster(engine, this.row, this.file, ask)
      : await ensureBase(engine, this.row, this.file)
    const dir = paths.photoCache(this.row.id)
    const name = `screen-${versionStamp(this.row)}-${hash32(key).toString(36)}`
    const made: string[] = []
    const k = edge / Math.max(this.px.frameWidth, this.px.frameHeight)
    let file = full
    if (k < SCREEN_WHOLE) {
      file = await cutTo(
        engine,
        full,
        join(dir, `${name}-cut.tiff`),
        Math.round(this.px.frameWidth * k),
        Math.round(this.px.frameHeight * k)
      )
      made.push(file.path)
    }
    if (activeSteps(this.recipe.pixels).length > 0) {
      const deps = pixelDeps(engine, this.owner.library.index, this.row)
      file = await layStepsOn(
        deps,
        file,
        join(dir, `${name}-steps.tiff`),
        activeSteps(this.recipe.pixels)
      )
      made.push(file.path)
    }
    // The lensed set's correction, baked as on its proxies; a live one is the render's.
    if (key.endsWith(':live') === false) {
      const { lens, retouch } = this.prepared(this.recipe)
      file = await lensOn(
        engine,
        file,
        join(dir, `${name}-lens.tiff`),
        lens,
        retouch,
        this.hdrWorking
      )
      made.push(file.path)
    }
    // Only the last is read: what came before it goes.
    dropFiles(made.slice(0, -1))
    log.info('screen-sized picture made', `${file.width}×${file.height}`, this.row.name)
    return { file, made: made.slice(-1) }
  }

  /** The proxy the loupe's own size asks for. */
  private loupeSource(px: Proxies): ProxyFile {
    const long = (f: ProxyFile): number => Math.max(f.width, f.height)
    if (this.view.targetEdge <= long(px.draft)) return px.draft
    const edge = this.screenEdge(px)
    if (edge !== null) {
      const key = this.screenKey(edge)
      if (this.screen?.key === key) return this.screen.file
      this.makeScreen(edge, key)
    }
    // The middle size up to a little short of the view (the screen scales it
    // the last stretch): a 1200 pt loupe on a Retina screen grades 44% fewer
    // pixels than from the full proxy.
    if (px.mid && this.view.targetEdge * MID_SHORTFALL <= long(px.mid)) return px.mid
    return px.proxy
  }

  /** Whether a held slider is resting at the draft's size where the loupe asks for more. */
  private holding(): boolean {
    if (!this.held) return false
    const px = this.viewPx()
    return this.loupeSource(px) !== px.draft
  }

  private nextFile(stem: string, ext: string): string {
    const out = join(this.dir, `${stem}-${this.tag}-${++this.fileSeq}.${ext}`)
    const list = [...(this.files[stem] ?? []), out]
    const held = new Set([
      this.lastOut.draft,
      this.lastOut.full,
      this.lastFull,
      this.lastMaskOut,
      ...[...this.recentFull.values()].map((r) => r.out)
    ])
    const drop = new Set(list.slice(0, -KEEP_RENDERS).filter((f) => !held.has(f)))
    this.files[stem] = list.filter((f) => !drop.has(f))
    for (const f of drop) void rm(f, { force: true }).catch(() => undefined)
    return out
  }

  private async renderPicture(kind: Kind, signal: AbortSignal): Promise<void> {
    const t0 = performance.now()
    const src = this.source(kind)
    // The view is read once, here: the event says which view it was made for.
    const cropMode = this.view.cropMode
    const rev = this.rev
    const preview = this.previewing
    const recipe = preview ?? this.recipe
    // Full HDR (engine 0.18): the display it is shown on, or SDR as before.
    const display = this.view.display ?? null
    // A drag frame on the GPU when it will take it (Phase A §4.3); every
    // other picture, and a drag it won't, on the CPU as before.
    if (kind === 'draft') {
      this.gpuShown = await this.gpuDraft(t0, cropMode, rev, recipe, display, signal)
      if (this.gpuShown) return
    }
    const compiled = await this.compileFor(
      recipe,
      src,
      !cropMode,
      false,
      kind !== 'draft',
      display !== null
    )
    const seq = ++this.seq
    // A whole picture of this recipe (framed, no corners left empty): what
    // the library's thumbnail can be shrunk from. A preview is never that.
    const whole = kind === 'full' && !cropMode && !preview && !framingTransparent(compiled.framing)
    const sig = String(
      hash32(
        gradeKey([
          src.path,
          cropMode,
          display,
          this.floatSdr(kind, display),
          compiled.grade,
          compiled.framing,
          compiled.lens,
          compiled.retouch
        ])
      )
    )
    const known = kind === 'full' ? this.recentFull.get(sig) : undefined
    const again = sig === this.lastSig[kind] ? this.lastEvent[kind] : null
    const last = known?.event ?? (again && this.showable(again) ? again : null)
    if (last) {
      this.lastSent = last
      if (known) {
        this.lastFull = known.out
        this.lastSig.full = sig
        this.lastEvent.full = known.event
        this.lastOut.full = known.out
      }
      // In Full HDR the picture a thumbnail shrinks from is the companion,
      // whose size is its own.
      const shown =
        display || this.floatSdr(kind, display)
          ? this.lastCompanion
          : { path: this.lastFull, width: last.width, height: last.height }
      if (whole && shown) this.fullPicture = { recipe, picture: shown }
      if (!this.closed) this.owner.send(IPC.develop.rendered, { ...last, seq, rev })
      return
    }
    // A warp shown whole (the crop tool) keeps its empty corners: PNG with alpha.
    const alpha = framingTransparent(compiled.framing)
    // A draft (a slider moving) goes to the window as pixels, straight from
    // the engine: no file written, served and decoded for a picture that is
    // replaced a moment later. The settled picture stays a file: the mask's
    // measuring and the thumbnail read it here.
    // In Full HDR the settled picture is pixels too (F16 linear Display P3
    // for the display, an SDR companion for what reads the picture), or an
    // AVIF with a gain map (the A/B's other arm; no alpha, so not a warp
    // shown whole).
    const avif = display !== null && kind === 'full' && !alpha && SETTLED_ARM === 'avif'
    // An SDR settled picture in float too, where the window draws F16 frames
    // (an HDR photo shown in SDR is tone mapped as before, in 8 bits).
    const floatSdr = this.floatSdr(kind, display)
    const frame =
      kind === 'draft' || (display && !avif) || floatSdr ? `${this.tag}-${seq}` : undefined
    const out = frame ? '' : this.nextFile('view', avif ? 'avif' : alpha ? 'png' : 'jpg')
    const hdrStats =
      kind === 'full' ? this.measureHdr(cropMode, signal) : Promise.resolve(undefined)
    // A CPU drag of Dehaze or Denoise reuses its first frame's measurement
    // (Phase A §4.4); a settled picture measures fresh.
    const keyHeld =
      kind === 'draft' && !this.heldOff && measuresPhoto(compiled.grade)
        ? heldKey(src.path, compiled.framing)
        : null
    const report = await this.convertHeld(
      {
        ...blankRequest(src.path, out, src.input),
        ...(frame ? { sink: 'Bytes' as const } : {}),
        pixel: {
          depth: (display || floatSdr) && frame ? 'F32' : 'Eight',
          channels: alpha || frame ? 4 : 3
        },
        encode: frame
          ? { Pixels: { sample: display || floatSdr ? 'F16' : 'U8' } }
          : avif
            ? SETTLED_AVIF
            : alpha
              ? { Png: { compression: 'Fast', filter: 'Sub' } }
              : {
                  // A settled picture is a few MB less as 4:2:0, which a screen
                  // shows the same; the draft keeps full chroma at its lower quality.
                  Jpeg: {
                    quality: kind === 'draft' ? 92 : 95,
                    subsampling: kind === 'draft' ? 'None' : 'Quarter',
                    optimize: false
                  }
                },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: display
          ? masterFor(display, undefined, kind === 'draft' ? DRAFT_COMPANION_EDGE : COMPANION_EDGE)
          : floatSdr
            ? LINEAR_P3
            : displayPolicy(this.info, 'DisplayP3'),
        // The master reads a gain map itself, and refuses the field.
        ...(display ? { gain_map: null } : {}),
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: interactiveThreads(),
        // A warp shown whole counts its empty corners (as black) rather than
        // risk measuring nothing when little of the picture is left.
        measure: measureOf(kind === 'draft' ? 2 : 1)
      },
      { signal, frame, ...(floatSdr ? { native: { sdrCompanion: COMPANION_EDGE } } : {}) },
      keyHeld
    ).catch(named(compiled))
    // The engine had no way to the window (it was reloading): main passes the frame on.
    if (frame && report.output)
      this.owner.send(IPC.develop.previewFrame, {
        frame,
        width: report.width,
        height: report.height,
        data: report.output,
        sample: display || floatSdr ? 'F16' : 'U8',
        ...(report.companion ? { companion: companionOf(report.companion) } : {})
      })
    const stats = statsOf(report)
    // Full HDR's settled picture, either arm: what measures it (inside a
    // mask) and what reads its pixels take its SDR companion, kept as a PNG.
    let readUrl: string | undefined
    if (kind === 'full' && (display || floatSdr)) {
      const m = report.color.master
      if (display)
        this.hdrFigures =
          m && m.gamut ? { peakNits: m.peak_nits, reach: m.gamut.reach } : this.hdrFigures
      const c = report.companion
      if (c) {
        const file = this.nextFile('companion', 'png')
        await writeCompanion(file, c.data, c.width, c.height)
        this.lastFull = file
        readUrl = cacheUrl(file, seq)
        // The library's thumbnail is a JPEG of the picture as shown: in
        // Full HDR the master's SDR rendition of it, not a second SDR grade.
        this.lastCompanion = { path: file, width: c.width, height: c.height }
        if (!preview) this.fullPicture = whole ? { recipe, picture: this.lastCompanion } : null
      } else {
        this.lastFull = ''
        this.lastCompanion = null
      }
    } else if (kind === 'full' && out) {
      this.lastFull = out
      if (!preview)
        this.fullPicture = whole
          ? { recipe, picture: { path: out, width: report.width, height: report.height } }
          : null
    }
    const hdr = await hdrStats
    if (this.closed) return
    const event: RenderEvent = {
      key: this.key,
      seq,
      rev,
      kind,
      cropMode,
      url: frame ? `frame:${frame}` : cacheUrl(out, seq),
      ...(readUrl ? { readUrl } : {}),
      width: report.width,
      height: report.height,
      stats,
      hdrStats: hdr,
      ...(display && report.color.master?.display
        ? { ceiling: report.color.master.display.headroom }
        : {}),
      report: reportOf(
        report,
        Math.round(performance.now() - t0),
        compiled.notes,
        compiled.layerIndex
      )
    }
    this.lastSig[kind] = sig
    this.lastEvent[kind] = event
    this.lastSent = event
    this.lastOut[kind] = out
    // A frame is kept by the window only a moment: a file alone can be shown
    // again (and Full HDR's AVIF arm, which stays a dev switch, is not kept).
    // Nor is a held slider's stand-in (the draft's size) one to go back to.
    if (kind === 'full' && out && !display && !this.holding()) {
      this.recentFull.delete(sig)
      this.recentFull.set(sig, { event, out })
      while (this.recentFull.size > RECENT_FULL)
        this.recentFull.delete(this.recentFull.keys().next().value as string)
    }
    this.owner.send(IPC.develop.rendered, event)
  }

  // ── the GPU drag path (Phase A §4.3) and held measurements (§4.4) ──

  /** This photo's held measurements, kept in the interactive host (see `HeldSlot`). */
  private readonly heldSlot: HeldSlot
  /**
   * The grade shapes (shared/gpudrag.ts `gradeShape`) the engine refused on
   * the GPU this drag: the rest of the drag goes straight to the CPU. The
   * release forgets them.
   */
  private gpuRefused = new Set<string>()
  /** `held` was refused this drag: the rest of it measures each frame, as before. */
  private heldOff = false
  /** Whether this drag's first GPU frame has been logged. */
  private gpuLogged = false

  /**
   * The release (Phase A §4.4: "drop it on release"; it measures fresh), and
   * the end of what this drag learned about the GPU's refusals.
   */
  private endDrag(): void {
    this.heldSlot.drop()
    this.gpuRefused.clear()
    this.heldOff = false
    this.gpuLogged = false
  }

  /**
   * What a GPU drag of `recipe` needs, or null when it stays on the CPU:
   * GPU dragging off or not here, an HDR (PQ/HLG) photo (its grade runs
   * after a tone map the frame would need to carry), a lens correction
   * still being baked (its proxies would make another upload at once), or a
   * grade the GPU is known to refuse (`gpuRefusal`) or refused this drag.
   * The frame is the full proxy (§4.3: "upload at full proxy size"), so the
   * drag grades at the scale of the settled picture.
   */
  private async gpuPlan(
    recipe: Recipe,
    cropMode: boolean,
    display: ViewState['display'] | null,
    /** For the upload alone: a photo with no grade yet may get one the GPU takes. */
    warm = false
  ): Promise<GpuPlan | null> {
    if (!this.owner.gpu.usable() || this.info.is_hdr || this.bakePending()) return null
    const src = this.viewPx().proxy
    const compiled = await this.compileFor(recipe, src, !cropMode, false, false, !!display, 'gpu')
    // No grade is nothing to drag on the GPU, but nothing against the frame
    // being up for the first edit; a grade it refuses would not use one.
    if (compiled.grade ? gpuRefusal(compiled.grade) !== null : !warm) return null
    const shape = gradeShape(compiled.grade)
    if (this.gpuRefused.has(shape)) return null
    // The CPU draft's display space: the drag names it (§4.3), the frame is graded into it.
    const color = display
      ? masterFor(display, undefined, DRAFT_COMPANION_EDGE)
      : displayPolicy(this.info, 'DisplayP3')
    const input = gradeInputRequest({
      path: src.path,
      input: src.input,
      color,
      lens: compiled.lens,
      retouch: compiled.retouch,
      threads: interactiveThreads(),
      limits: READ_LIMITS
    })
    return { compiled, shape, color, input, inputKey: inputKey(input) }
  }

  /**
   * After a settled picture: the photo's GPU frame uploaded for the next
   * drag if it isn't (the photo just opened, or something before the grade
   * changed), in the background. Never in a drag's way: until it is up,
   * drags render on the CPU.
   */
  private async warmGpu(): Promise<void> {
    try {
      const plan = await this.gpuPlan(
        this.recipe,
        this.view.cropMode,
        this.view.display ?? null,
        true
      )
      if (plan && !this.closed) this.owner.gpu.prepare(this.key, plan.inputKey, plan.input)
    } catch {
      // Nothing lost: drags stay on the CPU.
    }
  }

  /**
   * One drag frame graded on the GPU from the photo's uploaded frame (Phase
   * A §4.3), sent as a draft. False when this frame renders on the CPU
   * instead: no frame up yet, a framing the frame can't
   * show (a turn, a straighten, an Upright), or the engine refused it.
   * Every refusal or error is that signal and never the user's error: the
   * engine doesn't fall back by itself, Playroom does.
   */
  private async gpuDraft(
    t0: number,
    cropMode: boolean,
    rev: number,
    recipe: Recipe,
    display: ViewState['display'] | null,
    signal: AbortSignal
  ): Promise<boolean> {
    let shape = ''
    try {
      const plan = await this.gpuPlan(recipe, cropMode, display)
      if (!plan) return false
      shape = plan.shape
      const gpu = this.owner.gpu
      const frame = gpu.ready(this.key, plan.inputKey)
      // No frame up: this drag is the CPU's. The upload renders the full
      // proxy, so it waits for a settled picture (`warmGpu`), never a drag.
      if (!frame) return false
      const { compiled } = plan
      const region = dragRegion(compiled.framing, frame.width, frame.height, 0)
      if (region === 'cpu') return false
      // Full HDR, cropped: a region measures neither the picture's peak nor
      // its reach (refused by `color.peak` / `color.reach`), so it states the
      // whole picture's, as a 1:1 tile does. None yet: this drag is the CPU's.
      let color = plan.color
      if (display && region) {
        if (!this.hdrFigures) return false
        color = masterFor(display, this.hdrFigures, DRAFT_COMPANION_EDGE)
      }
      const keyHeld = heldKey(`gpu:${plan.inputKey}`, compiled.framing)
      const measured = measuresPhoto(compiled.grade) && !this.heldOff
      // A cropped drag is a region, which returns no held measurement (§4.4)
      // and of Dehaze differs without one: the drag's first frame is
      // measured whole, its pixels left in the host, then every frame reuses it.
      if (region && measured && !this.heldSlot.use(keyHeld)) {
        await this.gpuConvert(
          gpuDragRequest({
            grade: compiled.grade,
            color: plan.color,
            hdr: !!display,
            region: null,
            measure: null,
            threads: interactiveThreads()
          }),
          frame,
          keyHeld,
          undefined,
          { discardOutput: true },
          signal
        )
      }
      if (region)
        region.margin = await this.dragReach(compiled.grade, frame, this.heldSlot.use(keyHeld))
      const seq = ++this.seq
      const sig = String(
        hash32(gradeKey(['gpu', plan.inputKey, cropMode, display, color, compiled.grade, region]))
      )
      if (
        sig === this.lastSig.draft &&
        this.lastEvent.draft &&
        this.showable(this.lastEvent.draft)
      ) {
        this.lastSent = this.lastEvent.draft
        if (!this.closed)
          this.owner.send(IPC.develop.rendered, { ...this.lastEvent.draft, seq, rev })
        return true
      }
      const tag = `${this.tag}-${seq}`
      const report = await this.gpuConvert(
        gpuDragRequest({
          grade: compiled.grade,
          color,
          hdr: !!display,
          region,
          measure: gpu.measure ? measureOf(2) : null,
          threads: interactiveThreads()
        }),
        frame,
        keyHeld,
        measured ? this.heldSlot.use(keyHeld) : undefined,
        { frame: tag },
        signal
      )
      // The engine had no way to the window (it was reloading): main passes the frame on.
      if (report.output)
        this.owner.send(IPC.develop.previewFrame, {
          frame: tag,
          width: report.width,
          height: report.height,
          data: report.output,
          sample: display ? 'F16' : 'U8',
          ...(report.companion ? { companion: companionOf(report.companion) } : {})
        })
      const ms = Math.round(performance.now() - t0)
      if (!this.gpuLogged) {
        this.gpuLogged = true
        log.info(`GPU drag frame ${report.width}×${report.height} in ${ms} ms`)
      }
      if (this.closed) return true
      // Unmeasured (the engine wouldn't, on the GPU): the last picture's numbers stand.
      const stats = report.stats ?? this.lastEvent.draft?.stats ?? this.lastEvent.full?.stats
      const event: RenderEvent = {
        key: this.key,
        seq,
        rev,
        kind: 'draft',
        cropMode,
        url: `frame:${tag}`,
        width: report.width,
        height: report.height,
        ...(stats ? { stats } : {}),
        ...(display && report.color?.master?.display
          ? { ceiling: report.color.master.display.headroom }
          : {}),
        report: reportOf(report, ms, compiled.notes, compiled.layerIndex)
      }
      this.lastSig.draft = sig
      this.lastEvent.draft = event
      this.lastSent = event
      this.lastOut.draft = ''
      this.owner.send(IPC.develop.rendered, event)
      return true
    } catch (err) {
      if (isCancelled(err)) throw err
      const e = err as EngineError
      if (dragVerdict(e) === 'stale') {
        // The frame (or the host) is gone: uploaded again for the next drag.
        this.owner.gpu.lost(this.key)
        this.heldSlot.drop()
      } else if (shape) {
        this.gpuRefused.add(shape)
      }
      log.info('GPU drag declined; this drag renders on the CPU', e.code, e.field ?? e.message)
      return false
    }
  }

  /**
   * A GPU drag's convert with the photo's frame, keeping any held
   * measurement it returns. A `held` refused by the engine (§4.4: a
   * different op, size or setting) is dropped and the frame rendered once
   * without it; a `measure` the GPU won't do is left off from then on.
   * Anything else is for `gpuDraft` to read.
   */
  private async gpuConvert(
    request: ConvertRequest,
    frame: FrameRef,
    keyHeld: string,
    held: string | undefined,
    opts: { frame?: string; discardOutput?: boolean },
    signal: AbortSignal,
    retried = false
  ): Promise<ConvertReport> {
    const native: NativeRefs = {
      frame: frame.id,
      keepHeld: this.heldSlot.id,
      ...(held ? { held } : {}),
      ...(opts.discardOutput ? { discardOutput: true } : {})
    }
    try {
      const report = await this.owner.engine.convert(request, {
        signal,
        native,
        ...(opts.frame ? { frame: opts.frame } : {})
      })
      this.heldSlot.kept(report, keyHeld)
      return report
    } catch (err) {
      if (retried || !(err instanceof EngineError) || err.cancelled) throw err
      const v = dragVerdict(err)
      if (v === 'held' && held) {
        this.heldSlot.drop()
        this.heldOff = true
        return this.gpuConvert(request, frame, keyHeld, undefined, opts, signal, true)
      }
      if (v === 'measure' && request.measure) {
        this.owner.gpu.measure = false
        log.info('the GPU drag path does not measure: drags keep the last numbers')
        return this.gpuConvert(
          { ...request, measure: null },
          frame,
          keyHeld,
          held,
          opts,
          signal,
          true
        )
      }
      throw err
    }
  }

  /**
   * A cropped GPU drag's margin: the grade's reach (HR-0.20-1), asked with
   * the held measurement so a held Dehaze leaves `measured` (§3.1, §4.4).
   * Without an answer, the whole frame: the region is then the full render,
   * cut, whatever the grade reads.
   */
  private dragReach(
    grade: Grade | null,
    frame: FrameRef,
    held: string | undefined
  ): Promise<number> {
    const whole = Math.max(frame.width, frame.height)
    return this.owner.engine
      .regionReach(
        {
          grade,
          sdr_grade: null,
          frame_width: frame.width,
          frame_height: frame.height,
          output_width: frame.width,
          output_height: frame.height
        },
        held
      )
      .then(
        (r) => Math.max(REGION_MARGIN, Math.ceil(r.pixels)),
        () => whole
      )
  }

  /**
   * A CPU render, with the held measurement of `keyHeld` when one is kept
   * (a drag of Dehaze or Denoise: Phase A §4.4), keeping what it returns
   * for the next frame. `keyHeld` null: a plain render, as before. A `held`
   * refused is dropped and the render made once without it.
   */
  private async convertHeld(
    request: ConvertRequest,
    opts: { signal: AbortSignal; frame?: string; native?: NativeRefs },
    keyHeld: string | null
  ): Promise<ConvertReport> {
    if (!keyHeld) return this.owner.engine.convert(request, opts)
    const held = this.heldSlot.use(keyHeld)
    try {
      const report = await this.owner.engine.convert(request, {
        ...opts,
        native: { ...opts.native, keepHeld: this.heldSlot.id, ...(held ? { held } : {}) }
      })
      this.heldSlot.kept(report, keyHeld)
      return report
    } catch (err) {
      if (!held || !(err instanceof EngineError) || err.cancelled) throw err
      const v = dragVerdict(err)
      if (v !== 'held' && v !== 'stale') throw err
      this.heldSlot.drop()
      this.heldOff = true
      return this.owner.engine.convert(request, opts)
    }
  }

  /**
   * For a PQ/HLG photo, the graded draft kept HDR (as an HDR export would
   * hold it) and measured in linear light, so the histogram can show the
   * highlights above reference white. Runs beside the preview; a failure
   * only loses the HDR histogram.
   */
  private async measureHdr(
    cropMode: boolean,
    signal: AbortSignal
  ): Promise<ImageStats | undefined> {
    const hdr = this.hdrWorking
    if (!hdr) return undefined
    try {
      const src = this.viewPx().draft
      const compiled = await this.compileFor(this.recipe, src, !cropMode, true)
      // Written only to be measured (or not even read, with float work): an
      // uncompressed TIFF, not a PNG to deflate and inflate again. The signal
      // is stated to the analysis, so the file needs no cICP to carry it.
      const out = join(this.dir, 'hdr-stats.tiff')
      // Fine bins: the chart re-bins them onto a stops axis, where the
      // shadows need the resolution.
      const bins = 4096
      const request = {
        ...blankRequest(src.path, out, src.input),
        pixel: { depth: 'Sixteen', channels: framingTransparent(compiled.framing) ? 4 : 3 },
        encode: { Tiff: { compression: 'None' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: 'Preserve',
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: interactiveThreads()
      } as const
      // With float work the engine measures its own output in linear light
      // by the working white; without, the signal passes through untouched
      // (the engine refuses a working space nothing would use), so the file
      // is measured afterwards by the same numbers.
      const floatWork =
        compiled.grade !== null ||
        compiled.lens !== null ||
        compiled.retouch !== null ||
        framingWarps(compiled.framing)
      if (floatWork) {
        const r = await this.owner.engine
          .convert(
            { ...request, hdr, measure: { ...measureOf(1), domain: 'Linear', bins } },
            { signal }
          )
          .catch(named(compiled))
        return statsOf(r)
      }
      await this.owner.engine.convert(request, { signal }).catch(named(compiled))
      return await this.owner.engine.analyze(
        { ...analyzeRequest(out, 'Tiff', 1), domain: 'Linear', bins, hdr: hdrSignalOf(hdr) },
        { signal }
      )
    } catch (err) {
      if (!isCancelled(err)) log.info('HDR histogram unavailable', (err as Error).message)
      return undefined
    }
  }

  /**
   * Where an HDR picture rises above its white, as the engine measures it on
   * the pixels an HDR export would hold: a grey plane, 0 at and below white,
   * 1 at the working peak (`stops` above white). The loupe colours it.
   */
  private async renderHeadroom(signal: AbortSignal): Promise<void> {
    const hdr = this.hdrWorking
    // A RAW's light above white is its Scene develop's (engine 0.18): the
    // engine marks it on the master Full HDR shows, to this display or (Full
    // HDR off) to a typical HDR screen's peak.
    if (!hdr && !this.isRaw) return
    const src = this.source('full')
    const display = this.view.display ?? null
    const compiled = await this.compileFor(this.recipe, src, !this.view.cropMode, true, true, !hdr)
    // A plane has one channel, so a warp's transparent corners cannot be said.
    if (framingTransparent(compiled.framing)) return
    // In Full HDR, 1 is the display's ceiling: what reaches it is what shows
    // at its brightest; above that the master rolled it off.
    const target = display ?? { whiteNits: REFERENCE_WHITE, peakNits: DETECTED_PEAK }
    const stops = Math.max(
      0.5,
      Math.log2(
        hdr && !display
          ? hdr.peak_nits / hdr.reference_white_nits
          : target.peakNits / target.whiteNits
      )
    )
    const out = this.nextFile('headroom', 'png')
    try {
      const r = await this.owner.engine
        .convert(
          {
            ...blankRequest(src.path, out, src.input),
            pixel: { depth: 'Eight', channels: 1 },
            encode: { Png: { compression: 'Fast', filter: 'Sub' } },
            metadata: STRIP_ALL,
            ...(hdr
              ? { color: 'Preserve' as const, hdr }
              : { color: headroomMaster(target), gain_map: null }),
            grade: compiled.grade,
            framing: compiled.framing,
            lens: compiled.lens,
            retouch: compiled.retouch,
            inspect: { Headroom: { stops } },
            threads: interactiveThreads()
          },
          { signal }
        )
        .catch(named(compiled))
      if (this.closed) return
      this.owner.send(IPC.develop.rendered, {
        key: this.key,
        seq: this.seq,
        kind: 'headroom',
        cropMode: this.view.cropMode,
        url: cacheUrl(out, `${Date.now()}`),
        width: r.width,
        height: r.height,
        stops
      } satisfies RenderEvent)
    } catch (err) {
      if (isCancelled(err)) throw err
      log.info('headroom overlay unavailable', (err as Error).message)
    }
  }

  /**
   * The chosen layer's mask as a grey plane, and the picture measured inside
   * it. A draft (while a range slider moves) is the draft proxy's plane with
   * no measuring, so the overlay keeps up; the settled one follows. The same
   * plane again re-sends its event, stamped with the current recipe, so the
   * loupe's preview knows the engine agrees with it.
   */
  /** The last picture `measureMask` measured through the plane. */
  private maskStatsFor: string | null = null

  /**
   * The picture the renderer shows (the last full render) measured through a
   * plane. `weights` is an engine feature that may be missing from an older
   * build: the overlay still shows without it.
   */
  private async measureMask(plane: string, signal: AbortSignal): Promise<ImageStats | undefined> {
    if (!this.lastFull) return undefined
    try {
      return await this.owner.engine.analyze(
        {
          ...analyzeRequest(this.lastFull, this.lastFull.endsWith('.png') ? 'Png' : 'Jpeg', 1),
          weights: { source: { Png: plane }, resampler: 'Bilinear' }
        },
        { signal }
      )
    } catch (err) {
      if (isCancelled(err)) throw err
      log.info('masked analysis unavailable', (err as Error).message)
      return undefined
    }
  }

  private async renderMask(kind: Kind, signal: AbortSignal): Promise<void> {
    const src = kind === 'draft' ? this.viewPx().draft : this.source('full')
    const rev = this.rev
    const compiled = await this.compileFor(
      this.recipe,
      src,
      !this.view.cropMode,
      true,
      kind !== 'draft'
    )
    const layerId = this.view.maskLayer ?? undefined
    const index = layerId ? compiled.layerIndex[layerId] : undefined
    const send = (e: Omit<RenderEvent, 'key' | 'seq' | 'rev' | 'kind' | 'layerId'>): void => {
      if (this.closed) return
      this.lastMask = { key: this.key, seq: this.seq, rev, kind: 'mask', layerId, ...e }
      this.owner.send(IPC.develop.rendered, this.lastMask)
    }
    if (index === undefined || !compiled.grade || framingTransparent(compiled.framing)) {
      // Nothing left in the mask (its last component undone or deleted), or a
      // warp shown whole, which a one-channel plane cannot carry: the
      // overlay is told, or it would go on showing the old plane.
      this.maskSig = EMPTY
      send({ cropMode: this.view.cropMode, url: '', width: 0, height: 0 })
      return
    }
    const measure = kind === 'full'
    // The plane is the mask's own shapes over the frame; only a colour or
    // luminance range also depends on the picture the layers before it make.
    // The mask layer's own sliders, and anything after it, do not move it.
    const layer = compiled.grade.layers[index]
    const keyed = layer.mask?.components.some((c) => 'Range' in c.shape) ?? false
    const sig = String(
      hash32(
        gradeKey([
          src.path,
          layerId,
          index,
          layer.mask,
          keyed ? compiled.grade.layers.slice(0, index) : null,
          compiled.framing,
          compiled.lens,
          compiled.retouch
        ])
      )
    )
    const statsFor = measure ? this.lastFull : null
    // The same plane: said again for this recipe, and measured again only
    // when the picture under it is a new one.
    if (sig === this.maskSig && this.lastMask && this.lastMaskOut) {
      const restamp = { ...this.lastMask, seq: this.seq, rev }
      if (statsFor !== null && statsFor !== this.maskStatsFor) {
        const maskStats = await this.measureMask(this.lastMaskOut, signal)
        this.maskStatsFor = statsFor
        restamp.maskStats = maskStats
      }
      if (!this.closed) {
        this.lastMask = restamp
        this.owner.send(IPC.develop.rendered, this.lastMask)
      }
      return
    }
    const out = this.nextFile('mask', 'png')
    const report = await this.owner.engine
      .convert(
        {
          ...blankRequest(src.path, out, src.input),
          pixel: { depth: 'Eight', channels: 1 },
          encode: { Png: { compression: 'Fast', filter: 'Sub' } },
          metadata: STRIP_ALL,
          color: 'Preserve',
          grade: compiled.grade,
          framing: compiled.framing,
          lens: compiled.lens,
          retouch: compiled.retouch,
          inspect: { LayerMask: { layer: index } },
          hdr: this.hdrWorking
        },
        { signal }
      )
      .catch(named(compiled))
    const maskStats = measure ? await this.measureMask(out, signal) : undefined
    this.maskStatsFor = statsFor
    this.maskSig = sig
    this.lastMaskOut = out
    send({
      cropMode: this.view.cropMode,
      url: cacheUrl(out, `${this.seq}-m`),
      width: report.width,
      height: report.height,
      maskStats
    })
  }

  /**
   * Every local layer's mask, small, from the draft proxy: the masks panel's
   * thumbnails and the "show all" overlay. A thumbnail is redrawn only when
   * what shapes its mask changed (not its sliders), and the loop yields to a
   * newer edit waiting behind it. Always SDR, Full HDR or not: a mask is
   * shown by its shape, not its light.
   */
  private async renderMaskThumbs(signal: AbortSignal): Promise<void> {
    const src = this.viewPx().draft
    const compiled = await this.compileFor(this.recipe, src, !this.view.cropMode, true)
    // A warp shown whole has transparent corners a plane cannot carry; the
    // thumbnails wait for the crop tool to close.
    if (framingTransparent(compiled.framing)) return
    const live = new Set<string>()
    for (const layer of this.recipe.layers) {
      live.add(layer.id)
      if (this.pending || this.closed) return
      const index = compiled.grade ? compiled.layerIndex[layer.id] : undefined
      if (index === undefined || !compiled.grade) {
        // An empty mask's thumbnail goes blank, once.
        if (this.thumbSig[layer.id] !== EMPTY) {
          this.thumbSig[layer.id] = EMPTY
          this.owner.send(IPC.develop.rendered, {
            key: this.key,
            seq: this.seq,
            kind: 'mask-thumb',
            layerId: layer.id,
            cropMode: this.view.cropMode,
            url: '',
            width: 0,
            height: 0
          } satisfies RenderEvent)
        }
        continue
      }
      const sig = String(
        hash32(
          gradeKey([
            src.path,
            layer.components,
            layer.invert,
            compiled.framing,
            compiled.lens,
            this.view.cropMode,
            // A range keys on the colours the layers before it make; its own
            // sliders and the layers after it do not move its plane.
            layer.components.some((c) => c.kind === 'range')
              ? compiled.grade.layers.slice(0, index)
              : null
          ])
        )
      )
      if (this.thumbSig[layer.id] === sig) continue
      const out = join(this.dir, `mthumb-${layer.id}-${sig}.png`)
      // Made small, not at the draft's size (see MASK_THUMB_EDGE).
      const k = Math.min(1, MASK_THUMB_EDGE / Math.max(src.width, src.height))
      const report = await this.owner.engine
        .convert(
          {
            ...blankRequest(src.path, out, src.input),
            resize: k < 1 ? { Scale: { factor: k } } : 'None',
            resampler: 'Bilinear',
            pixel: { depth: 'Eight', channels: 1 },
            encode: { Png: { compression: 'Fast', filter: 'Sub' } },
            metadata: STRIP_ALL,
            color: 'Preserve',
            grade: compiled.grade,
            framing: compiled.framing,
            lens: compiled.lens,
            retouch: compiled.retouch,
            inspect: { LayerMask: { layer: index } },
            hdr: this.hdrWorking
          },
          { signal }
        )
        .catch(named(compiled))
      this.thumbSig[layer.id] = sig
      if (this.closed) return
      this.owner.send(IPC.develop.rendered, {
        key: this.key,
        seq: this.seq,
        kind: 'mask-thumb',
        layerId: layer.id,
        cropMode: this.view.cropMode,
        url: cacheUrl(out, sig),
        width: report.width,
        height: report.height
      } satisfies RenderEvent)
    }
    // A deleted mask's thumbnail is let go of on the renderer's side too.
    for (const id of Object.keys(this.thumbSig)) {
      if (live.has(id)) continue
      delete this.thumbSig[id]
      if (!this.closed)
        this.owner.send(IPC.develop.rendered, {
          key: this.key,
          seq: this.seq,
          kind: 'mask-thumb',
          layerId: id,
          cropMode: this.view.cropMode,
          url: '',
          width: 0,
          height: 0
        } satisfies RenderEvent)
    }
  }

  /** The most recent full render's file: what the masked hue chart measures. */
  private lastFull = ''
  /** The last settled Full HDR picture's SDR companion, as a file. */
  private lastCompanion: Picture | null = null
  /** The last settled Full HDR picture's peak and reach (`HdrFigures`). */
  private hdrFigures: HdrFigures | null = null
  /** The last few settled pictures by signature, newest last (see RECENT_FULL). */
  private recentFull = new Map<string, { event: RenderEvent; out: string }>()
  /** A recipe shown instead of the photo's, not saved (see `previewRecipe`). */
  private previewing: Recipe | null = null
  /** The last whole settled picture and the recipe it shows (see `thumbLater`). */
  private fullPicture: { recipe: Recipe; picture: Picture } | null = null

  /** The default recipe with the same framing: the "before", and the ghost bars. */
  private async renderBefore(signal: AbortSignal): Promise<void> {
    // The photo as it came, or a Version chosen to compare with (as it renders).
    const before = this.compareRecipe
      ? structuredClone(effective(this.compareRecipe, this.isRaw))
      : beforeRecipe(this.isRaw)
    // As the picture beside it is framed (a crop or optics switched off included).
    const shown = effective(this.recipe, this.isRaw)
    before.geometry = structuredClone(shown.geometry)
    // The lens's geometry too, so before and after line up; not its defringe.
    before.lens = { ...structuredClone(shown.lens), defringe: before.lens.defringe }
    // Spots too: they are repairs, not a look, and the prepared proxies carry them.
    before.retouch = structuredClone(shown.retouch)
    // The photo as it came: never the pixel steps the edit renders from (the
    // plain proxy then, with the lens and spots applied live).
    const view = this.source('full')
    const src =
      this.isPlain(view) || (this.isBaked(view) && this.basePx() === this.px) ? view : this.px.proxy
    // Full HDR: the before in HDR too, as an AVIF with the master's gain map
    // (a file: a frame would be let go as the drafts stream past it).
    const display = this.view.display ?? null
    let compiled = await this.compileFor(
      before,
      src,
      !this.view.cropMode,
      false,
      true,
      display !== null
    )
    // PNG only where it has transparent corners to keep (the crop tool's
    // warp); else a JPEG, as the picture beside it is.
    const alpha = framingTransparent(compiled.framing)
    // That PNG is SDR even in Full HDR: its grade compiles as SDR too (a
    // curve carried past 1 into a Display P3 picture is refused).
    if (alpha && display !== null)
      compiled = await this.compileFor(before, src, !this.view.cropMode, false, true, false)
    // Keyed on what the engine is asked for, not on the raw geometry: a
    // straighten in the crop tool changes the recipe but not this picture.
    const key = JSON.stringify([
      compiled.framing,
      compiled.lens,
      compiled.retouch,
      src.path,
      this.view.cropMode,
      display,
      // A Version compared with grades otherwise than the photo's defaults.
      this.compareRecipe ? compiled.grade : null
    ])
    if (key === this.beforeKey) return
    const hdr = display && !alpha ? hdrFile(display) : null
    const ext = hdr ? 'avif' : alpha ? 'png' : 'jpg'
    const out = join(this.dir, `before-${hash32(key).toString(16)}.${ext}`)
    const report = await this.owner.engine
      .convert(
        {
          ...blankRequest(src.path, out, src.input),
          pixel: { depth: 'Eight', channels: alpha ? 4 : 3 },
          encode: hdr
            ? hdr.encode
            : alpha
              ? { Png: { compression: 'Fast', filter: 'Sub' } }
              : { Jpeg: { quality: 95, subsampling: 'None', optimize: false } },
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          color: hdr ? hdr.color : displayPolicy(this.info, 'DisplayP3'),
          ...(hdr ? { gain_map: null } : {}),
          grade: compiled.grade,
          framing: compiled.framing,
          lens: compiled.lens,
          retouch: compiled.retouch,
          measure: measureOf(1)
        },
        { signal }
      )
      .catch(named(compiled))
    const stats = statsOf(report)
    this.beforeKey = key
    if (this.closed) return
    this.owner.send(IPC.develop.rendered, {
      key: this.key,
      seq: this.seq,
      kind: 'before',
      cropMode: this.view.cropMode,
      url: cacheUrl(out, hash32(key)),
      width: report.width,
      height: report.height,
      stats
    } satisfies RenderEvent)
  }

  /**
   * The RAW master a 1:1 view reads: the plan's (DemosaicNet) once it is
   * made; until then a quick classic one (PPG, about 1.2 s) at once, the
   * plan's made in the background, and the window told to ask again when it
   * is (the engine's viewing guide, 2026-10-09). The PIXL demosaic has no
   * quick one before it: its regions are developed from the RAW until the
   * master is made (`regionFromRaw`, E66), and a 1:1 view that needs the
   * master itself waits for it (the bar in the badge says how far), or
   * says in the window why there is none.
   */
  private async rawMasterForView(): Promise<ProxyFile> {
    const ask = askOf(this.recipe)
    const plan = await scenePlan(this.file.raw_cfa, ask)
    const plain = (): Promise<ProxyFile> =>
      ensureMaster(this.owner.bgEngine, this.row, this.file, ask, this.developAbort.signal)
    if (plan.demosaic === 'pixl')
      return plain().catch((err: unknown) => {
        if (!isCancelled(err)) this.masterRefused(err)
        throw err
      })
    // A linear DNG has no demosaic to wait for (`isLinearRaw`): its one master, at once.
    if (
      plan.demosaic === 'classic' ||
      isLinearRaw(this.file) ||
      (await masterCached(this.row, this.file, ask))
    )
      return plain()
    const key = this.key
    void plain().then(
      () => {
        // With a development kit, what developed it and how long it took (devkit.ts).
        const note = takeDevelopedNote(this.row.id) ?? undefined
        if (!this.closed) this.owner.send(IPC.develop.tileStale, { key, note })
      },
      (err: unknown) => {
        if (!isCancelled(err)) log.warn('RAW master for 1:1 not made', (err as Error).message)
      }
    )
    return ensureQuickMaster(this.owner.bgEngine, this.row)
  }

  /** A RAW master that could not be made, said in the window (the 1:1 tile keeps what it had). */
  private masterRefused(err: unknown): void {
    if (this.closed) return
    const message = (err as Error).message
    log.error('RAW master not made', message)
    this.owner.send(IPC.develop.renderError, { key: this.key, message, code: 'Master' })
  }

  /**
   * The RAW develop's own frame size, once a region developed from the RAW
   * said it (`report.frame_width`): the proxies' is the cells' times their
   * width, within a pixel or two of it.
   */
  private rawFrame: { width: number; height: number } | null = null

  /**
   * Whether a 1:1 region is developed from the RAW itself until its master
   * is made (engine 0.21.0, E66): the PIXL demosaic runs only the windows
   * the region reads, about 1.7 s for a view against 8 s for the whole
   * frame on an M2 Pro, and its pixels are the master's cut, to the bit
   * (the owner, 2026-10-14: develop-on-open stays; this only fills the
   * first 1:1 wait). The plan's, with nothing denoising the mosaic first.
   */
  private async regionFromRaw(): Promise<ScenePlan | null> {
    if (!this.isRaw || this.hdrMaster || isLinearRaw(this.file)) return null
    const ask = askOf(this.recipe)
    const plan = await scenePlan(this.file.raw_cfa, ask)
    if (plan.demosaic !== 'pixl' || plan.pmrid) return null
    if (await masterCached(this.row, this.file, ask)) return null
    // The master goes on being made meanwhile (on open, or from here): the
    // region's are the same pixels, so nothing moves when tiles come from it.
    void ensureMaster(
      this.owner.bgEngine,
      this.row,
      this.file,
      ask,
      this.developAbort.signal
    ).catch((err: unknown) => {
      if (!isCancelled(err)) this.masterRefused(err)
    })
    return plan
  }

  /** A 1:1 (or smaller) render of part of the full-resolution frame. */
  async region(req: RegionRequest, again = false): Promise<RegionResult> {
    const t0 = performance.now()
    // The loupe asks again as it pans and zooms: only the newest view matters.
    this.regionAbort?.abort()
    const abort = new AbortController()
    this.regionAbort = abort
    const { signal } = abort
    // What the region is cut from, timed for the trace: the working copy
    // (pixel steps at full size) or the RAW master, made or found.
    const tMaster = performance.now()
    // The pixel steps laid on at full size: the same pixels an export uses.
    // PIXL Enhance's preview (the steps' frame with a square enhanced) while it is shown.
    const stepsMaster = this.previewFrame() ?? (await this.workingMaster())
    const raw = this.isRaw
    // Before the PIXL demosaic's master is made: the region developed from the RAW (E66).
    const developing = stepsMaster ? null : await this.regionFromRaw()
    const src: ProxyFile = stepsMaster
      ? stepsMaster
      : this.hdrMaster
        ? this.hdrMaster
        : developing
          ? {
              path: this.row.path,
              input: 'Raw',
              width: this.rawFrame?.width ?? this.px.frameWidth,
              height: this.rawFrame?.height ?? this.px.frameHeight
            }
          : raw
            ? await this.rawMasterForView()
            : {
                path: this.row.path,
                input: this.info.input,
                width: this.px.frameWidth,
                height: this.px.frameHeight
              }
    const masterMs = Math.round(performance.now() - tMaster)
    // The source's own size: the frame its full-size render is of.
    const { user, width, height } = orientedFrame(this.recipe, src.width, src.height)
    // 1:1 is 1: the loupe's arithmetic can send 0.9999999999999999, which
    // would ask for a resize that changes nothing (and, in Full HDR, one the
    // engine refuses without a linear resample: Pass 117's trace).
    const zoom = req.zoom >= 0.9999 ? 1 : Math.min(1, req.zoom)
    // Full HDR: the tile in HDR too (an AVIF with the master's gain map),
    // stating the settled picture's peak and reach, which a part cannot
    // measure. Before the first settled HDR picture, an SDR tile.
    const figures = this.hdrFigures
    const display = figures ? (this.view.display ?? null) : null
    // Full HDR: F16 pixels over the preview port, as drafts are, not an AVIF
    // with a gain map read back (an export's format: 0.4–1.3 s a tile; the
    // engine's viewing guide, 2026-10-09). The whole picture's figures stated.
    const hdr = display !== null && figures !== null
    // Framed as the picture on screen is (straightened, cropped, warped, the
    // crop tool's whole frame): since engine 0.16 a region of it is the full
    // render's own pixels there, so 1:1 is sharp on any photo.
    const compiled = compile(this.recipe, {
      isRaw: raw,
      asShot: this.info.as_shot_white,
      sourceOrientation:
        raw || stepsMaster || this.hdrMaster ? 'Normal' : sourceOrientation(this.info, null),
      frameWidth: src.width,
      frameHeight: src.height,
      scale: zoom,
      seed: seedOf(this.row),
      brushPaths: await brushPlanes(this.row.id, this.recipe, user),
      applyCrop: !this.view.cropMode,
      showTransform: !this.view.guides,
      // Tone mapped to SDR for the screen, as the picture is (see compileFor);
      // kept HDR for a Full HDR display.
      hdr: display !== null
    })
    const framed = await this.framedSize(compiled, width, height)
    // The request is a part of the picture as shown (fractions): in the
    // framed output's full-size pixels here, with context around it.
    const x = Math.max(0, Math.min(framed.width - 1, Math.floor(req.x * framed.width)))
    const y = Math.max(0, Math.min(framed.height - 1, Math.floor(req.y * framed.height)))
    const w = Math.max(1, Math.min(framed.width - x, Math.ceil(req.width * framed.width)))
    const h = Math.max(1, Math.min(framed.height - y, Math.ceil(req.height * framed.height)))
    this.regionSlot = (this.regionSlot + 1) % 4
    // A JPEG at full chroma: as sharp at 1:1 as the PNG it was, a fraction
    // of the time to write and decode at the screen's size.
    // An SDR tile in float too, where the window draws F16 frames.
    const floatSdr = !hdr && this.floatSdr('full', display)
    const frame = hdr || floatSdr ? `${this.tag}-tile${++this.tileSeq}` : undefined
    const out = frame ? '' : join(this.dir, `region-${this.regionSlot}.jpg`)
    // The original (not a RAW's master) states its gain-map rendition.
    const original = raw || stepsMaster || this.hdrMaster ? null : this.file
    const margin = await this.regionMargin(
      compiled.grade,
      await this.lensedSize(compiled.lens, width, height),
      framed
    )
    const request: ConvertRequest = {
      ...blankRequest(src.path, out, src.input, original),
      raw: null,
      ...(frame ? { sink: 'Bytes' as const } : {}),
      resize: zoom < 1 ? { Scale: { factor: zoom } } : 'None',
      pixel: frame ? { depth: 'F32', channels: 4 } : { depth: 'Eight', channels: 3 },
      encode: frame
        ? { Pixels: { sample: 'F16' } }
        : { Jpeg: { quality: 95, subsampling: 'None', optimize: false } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color:
        frame && display && figures
          ? masterFor(display, figures, TILE_COMPANION_EDGE)
          : floatSdr
            ? LINEAR_P3
            : displayPolicy(this.info, 'DisplayP3'),
      // The master reads a gain map itself, and refuses the field.
      ...(hdr ? { gain_map: null } : {}),
      grade: compiled.grade,
      framing: compiled.framing,
      lens: compiled.lens,
      retouch: compiled.retouch,
      region: { x, y, width: w, height: h, margin },
      // A Full HDR tile is resized inside the master's float pass, which the
      // engine allows only as a linear resample.
      ...(hdr && zoom < 1 ? { linear_resample: true } : {})
    }
    const tConvert = performance.now()
    const convert = (r: ConvertRequest): Promise<ConvertReport> =>
      this.owner.engine.convert(r, {
        signal,
        frame,
        ...(floatSdr ? { native: { sdrCompanion: TILE_COMPANION_EDGE } } : {})
      })
    const report = await (
      developing
        ? withScene(
            developing,
            (scene) => convert({ ...request, raw: rawMaster(colourOf(this.row), scene) }),
            signal,
            { camera: this.row.camera, iso: this.row.iso }
          ).then((r) => r.value)
        : convert(request)
    ).catch(named(compiled))
    // The develop's frame was taken from the proxies' (cells × their width):
    // once the engine says its own, the region is made again on it.
    if (
      developing &&
      (report.frame_width !== src.width || report.frame_height !== src.height) &&
      !again &&
      this.regionAbort === abort
    ) {
      this.rawFrame = { width: report.frame_width, height: report.frame_height }
      return this.region(req, true)
    }
    // The margin fell short of what the grade read: its edges may not meet a neighbour's.
    if (report.region?.short_by)
      log.warn('region margin short', { margin, short_by: report.region.short_by })
    // The engine had no way to the window (it was reloading): main passes the frame on.
    if (frame && report.output)
      this.owner.send(IPC.develop.previewFrame, {
        frame,
        width: report.width,
        height: report.height,
        data: report.output,
        sample: 'F16',
        ...(report.companion ? { companion: companionOf(report.companion) } : {})
      })
    traceRegion({
      step: 'region',
      key: this.key,
      asked: req,
      // Where the region's pixels come from, and how long getting it took.
      source: stepsMaster
        ? 'working master (pixel steps)'
        : this.hdrMaster
          ? 'HDR master'
          : developing
            ? 'the RAW, developed for the region (E66)'
            : raw
              ? 'RAW master'
              : 'the original',
      masterMs,
      src,
      zoom: req.zoom,
      fullHdr: hdr,
      convertMs: Math.round(performance.now() - tConvert),
      totalMs: Math.round(performance.now() - t0),
      request,
      report: {
        width: report.width,
        height: report.height,
        input_bytes: report.input_bytes,
        output_bytes: report.output_bytes,
        decode_ms: report.decode_ms,
        resize_ms: report.resize_ms,
        color_ms: report.color_ms,
        ingest_ms: report.ingest_ms,
        egress_ms: report.egress_ms,
        encode_ms: report.encode_ms,
        region: report.region,
        frame_width: report.frame_width,
        frame_height: report.frame_height,
        // A region developed alone: its model windows against the whole frame's (E66).
        ...(developing
          ? {
              tiles: report.raw?.demosaic_model?.tiles,
              frame_tiles: report.raw?.demosaic_model?.frame_tiles
            }
          : {})
      }
    })
    if (this.regionAbort === abort) this.regionAbort = null
    return {
      url: frame ? `frame:${frame}` : cacheUrl(out, `${Date.now()}`),
      x: x / framed.width,
      y: y / framed.height,
      width: w / framed.width,
      height: h / framed.height,
      ms: Math.round(performance.now() - t0)
    }
  }

  /** Framed output sizes, by what decides them. */
  private framedSizes = new Map<string, { width: number; height: number }>()

  /**
   * The size of a compiled render's output at full resolution, before any
   * resize: the oriented frame, its lens correction's crop, then the
   * framing's (straighten, Upright, crop). What a region's pixels are of.
   */
  private async framedSize(
    c: Compiled,
    width: number,
    height: number
  ): Promise<{ width: number; height: number }> {
    const key = JSON.stringify([c.lens, c.framing, width, height])
    const had = this.framedSizes.get(key)
    if (had) return had
    const { width: w, height: h } = await this.lensedSize(c.lens, width, height)
    let size = { width: w, height: h }
    if (c.framing) {
      // The frame is already oriented: only what comes after the turn.
      const r = await this.owner.engine.framingCrop({ ...c.framing, orientation: 'Normal' }, w, h)
      size = { width: r.width, height: r.height }
    }
    if (this.framedSizes.size > 32) this.framedSizes.clear()
    this.framedSizes.set(key, size)
    return size
  }

  /** The oriented frame after its lens correction's crop: the frame the grade runs on. */
  private async lensedSize(
    lens: LensCorrection | null,
    width: number,
    height: number
  ): Promise<{ width: number; height: number }> {
    if (!lens) return { width, height }
    const f = await this.owner.engine.lensFrame(lens, width, height)
    return { width: f.frame.width, height: f.frame.height }
  }

  /** The last grade's region reach, by what it was asked for (one: tiles of one view share it). */
  private reach: { key: string; pixels: number } | null = null

  /**
   * A 1:1 tile's margin (host rule HR-0.20-1, Phase A §3.1): at least what
   * the engine says the grade reads around a pixel, asked again whenever the
   * grade changes. A smoothed op at radius 0.02 on a 4000 px short side
   * needs about 220 px, so 96 px tiles disagreed at their edges. An engine
   * without `regionReach` keeps the fixed margin. No held measurement here
   * (Phase A §4.4): a tile is of the full-resolution frame, which no drag's
   * is, so it measures fresh (a cropped GPU drag passes its own: `dragReach`).
   */
  private async regionMargin(
    grade: Grade | null,
    /** The oriented frame after the lens correction: what the grade runs on. */
    frame: { width: number; height: number },
    /** The render's output at full size, before any resize. */
    framed: { width: number; height: number }
  ): Promise<number> {
    const key = JSON.stringify([grade, frame.width, frame.height, framed.width, framed.height])
    if (this.reach?.key !== key) {
      const whole = Math.max(frame.width, frame.height)
      const pixels = await this.owner.engine
        .regionReach({
          grade,
          sdr_grade: null,
          frame_width: frame.width,
          frame_height: frame.height,
          output_width: framed.width,
          output_height: framed.height
        })
        .then(
          (r) => {
            // A mask snapped by a method that reads the whole frame (Edge
            // snap, the solver, Matting) has no reach short of all of it:
            // the tile is then the whole frame's render, cut (the owner,
            // 2026-10-11: 1:1 shows the edge the export makes, at its cost).
            if (r.pixels >= whole)
              log.info('1:1 tiles render the whole frame', { reads: r.measured })
            return Math.min(Math.ceil(r.pixels), whole)
          },
          () => 0
        )
      this.reach = { key, pixels }
    }
    return Math.max(REGION_MARGIN, this.reach.pixels)
  }

  /** Per lens correction and frame size, the shrink its crop makes (1 when none). */
  private lensScale = new Map<string, number>()
  /** The recipe's lens correction baked into proxies (see `ensureLensedProxies`). */
  private lensed: { key: string; px: Proxies } | null = null

  /**
   * A rectangle of the oriented frame (`width × height` pixels) as a region
   * of the lens-corrected one, which a correction's crop makes smaller at
   * the same shape: the same part of the picture, in its pixels.
   */
  private async correctedRegion(
    lens: LensCorrection | null,
    width: number,
    height: number,
    r: { x: number; y: number; w: number; h: number },
    margin = REGION_MARGIN
  ): Promise<{ x: number; y: number; width: number; height: number; margin: number }> {
    let k = 1
    if (lens) {
      const key = JSON.stringify([lens, width, height])
      let cached = this.lensScale.get(key)
      if (cached === undefined) {
        const f = await this.owner.engine.lensFrame(lens, width, height)
        cached = f.frame.width / width
        if (this.lensScale.size > 32) this.lensScale.clear()
        this.lensScale.set(key, cached)
      }
      k = cached
    }
    const fw = Math.max(1, Math.floor(width * k))
    const fh = Math.max(1, Math.floor(height * k))
    const x = Math.max(0, Math.min(fw - 1, Math.floor(r.x * k)))
    const y = Math.max(0, Math.min(fh - 1, Math.floor(r.y * k)))
    return {
      x,
      y,
      width: Math.max(1, Math.min(fw - x, Math.round(r.w * k))),
      height: Math.max(1, Math.min(fh - y, Math.round(r.h * k))),
      margin
    }
  }

  /**
   * The source's colour (before any grade) at a point of the user-oriented,
   * uncropped frame (normalised), averaged over 5×5 proxy pixels, in linear
   * Rec.2020 — what the white balance runs on.
   */
  async sample(nx: number, ny: number): Promise<SampleResult> {
    const src = this.px.proxy
    const { user, width, height } = orientedFrame(this.recipe, src.width, src.height)
    // The point is of the frame on screen: the lens-corrected one when there
    // is a correction, which the sample is taken through too.
    const lens = lensCorrection(this.recipe.lens)
    const at = await this.correctedRegion(
      lens,
      width,
      height,
      { x: Math.max(0, nx * width - 2), y: Math.max(0, ny * height - 2), w: 5, h: 5 },
      0
    )
    const linear = this.info.is_hdr
      ? ({
          ToneMap: {
            to: 'LinearSrgb',
            operator: 'Clip',
            mode: 'PerChannel',
            source_peak: { Nits: this.info.peak_nits ?? 1000 },
            target_peak_nits: 203,
            gamut: 'Clip',
            intent: 'RelativeColorimetric',
            black_point_compensation: false
          }
        } as const)
      : ({
          ConvertTo: {
            to: 'LinearSrgb',
            intent: 'RelativeColorimetric',
            black_point_compensation: false
          }
        } as const)
    const report = await this.owner.engine.convert({
      ...blankRequest(src.path, '', src.input),
      sink: 'Bytes',
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'NoFilter' } },
      metadata: STRIP_ALL,
      color: linear,
      framing:
        user === 'Normal'
          ? null
          : { orientation: user, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
      lens,
      region: at
    })
    if (!report.output) throw new Error('the engine returned no sample')
    const px = pngToFloats(Buffer.from(report.output))
    const sum: Vec3 = [0, 0, 0]
    const n = px.width * px.height
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += px.data[i * px.channels + c]
    const rgb = linearSrgbToRec2020([sum[0] / n, sum[1] / n, sum[2] / n])
    const wb = await engineWbSliders(this.owner.engine, rgb, this.isRaw, this.info.as_shot_white)
    return { linear: rgb, wb }
  }

  /** Auto tone: measure the picture with the tone sliders at zero. */
  async autoTone(): Promise<BasicSetting> {
    const flat: Recipe = structuredClone(this.recipe)
    flat.basic = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }
    flat.layers = []
    const src = this.viewPx().draft
    const compiled = await this.compileFor(flat, src, true)
    const out = join(this.dir, 'auto-tone.png')
    const report = await this.owner.engine
      .convert({
        ...blankRequest(src.path, out, src.input),
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy(this.info, 'DisplayP3'),
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        measure: measureOf(1)
      })
      .catch(named(compiled))
    return autoTone(statsOf(report))
  }

  /** Auto white balance, measured on the draft proxy (see `autowb.ts`). */
  autoWb(): Promise<SampleResult['wb']> {
    return measureAutoWb(
      this.owner.engine,
      this.px.draft,
      this.dir,
      this.hdrWorking,
      this.isRaw,
      this.info.as_shot_white
    )
  }

  /**
   * Lateral chromatic aberration measured on the original at full size (the
   * shifts are fractions of a pixel), as the centred radial scale a lens
   * correction states — rotation- and flip-free, so the same numbers hold
   * for the previews and the export.
   */
  async measureCa(): Promise<CaMeasurement> {
    const raw = this.isRaw ? rawDevelop(colourOf(this.row)) : null
    const r = (await this.owner.bgEngine.suggestLateralCa({
      source: { Path: this.row.path },
      input: this.file.input,
      raw,
      gain_map: gainMapOf(this.file),
      orientation: sourceOrientation(this.file, raw),
      geometry: MANUAL_GEOMETRY,
      model: 'Scale',
      // The source's own primaries: 0.16.0's fit, valid for every source.
      planes: 'Frame',
      limits: READ_LIMITS,
      threads: BACKGROUND_THREADS
    })) as unknown as {
      lateral_ca: LateralCa
      red_points: number
      blue_points: number
      red_before_px: number
      red_after_px: number
      blue_before_px: number
      blue_after_px: number
    }
    return {
      ca: r.lateral_ca,
      red: [r.red_before_px, r.red_after_px],
      blue: [r.blue_before_px, r.blue_after_px],
      points: r.red_points + r.blue_points
    }
  }

  /**
   * Upright: the photo's lines found and the transform a mode asks for, on
   * the large proxy as the loupe frames it (the user's turns, and the lens
   * correction, which comes first). A mode the lines cannot support fails
   * by name; the caller decides whether to try a lesser one.
   */
  async suggestUpright(mode: 'Level' | 'Vertical' | 'Full', focal: number): Promise<Transform> {
    const src = this.px.proxy
    const { user } = orientedFrame(this.recipe, src.width, src.height)
    const r = (await this.owner.engine.suggestUpright({
      source: { Path: src.path },
      input: src.input,
      raw: null,
      gain_map: null,
      orientation: user,
      lens: lensCorrection(this.recipe.lens),
      mode,
      focal,
      limits: READ_LIMITS,
      threads: interactiveThreads()
    })) as unknown as { transform: Transform }
    this.usableUpright(r.transform, src.width, src.height)
    return r.transform
  }

  /**
   * Whether a suggestion is one to keep: a few mis-fitted lines can ask for
   * a turn so steep the photo shrinks to a sliver (or past what the engine
   * will resample). Centred as the develop view keeps it, a quarter of the
   * frame must remain; otherwise it fails by name and Auto tries a lesser
   * mode.
   */
  private usableUpright(tf: Transform, w: number, h: number): void {
    const { width, height } = orientedFrame(this.recipe, w, h)
    const tooSteep = new Error(t('the lines ask for too strong a correction'))
    if (Math.abs(tf.vertical) > 40 || Math.abs(tf.horizontal) > 40) throw tooSteep
    const centred = uprightTransform({ ...defaultUpright(), suggested: tf }, width, height)
    if (!centred) return
    const kept = fitCrop({ x: 0, y: 0, width: 1, height: 1 }, 0, width, height, centred)
    if (kept.width * kept.height < 0.25) throw tooSteep
  }

  /** Guided Upright: the transform that makes the guides (frame fractions) upright or level. */
  async uprightFromLines(lines: GuideLine[], focal: number): Promise<Transform> {
    const { width, height } = orientedFrame(this.recipe, this.px.frameWidth, this.px.frameHeight)
    const tf = await this.owner.engine.uprightFromLines(lines, width, height, focal)
    this.usableUpright(tf, this.px.frameWidth, this.px.frameHeight)
    return tf
  }

  /**
   * Where a heal or clone spot should copy from: the engine's search around
   * it on the large proxy, in the base frame (the proxy's own) after the
   * lens correction, as the spot is stored. Texture for a heal (the membrane
   * fixes the tone), difference for a clone (it keeps the source's tone).
   */
  async suggestHeal(
    points: SpotPoint[],
    radius: number,
    feather: number,
    kind: 'heal' | 'clone',
    refine?: SpotRefine
  ): Promise<SpotPoint> {
    // The spot's refine (0.19.2): the source found lies past the refined hole.
    const frame = orientedFrame(this.recipe, this.px.frameWidth, this.px.frameHeight)
    const r0 = spotRefine(refine, { radius, feather }, frame.width, frame.height)
    // The photo as it is now: a source is never picked from what a stroke healed away.
    const src = this.basePx().proxy
    const r = (await this.owner.bgEngine.suggestHealSource({
      source: { Path: src.path },
      input: src.input,
      raw: null,
      gain_map: null,
      orientation: 'Normal',
      lens: lensCorrection(this.recipe.lens),
      shape: spotShape(points, radius),
      feather: featherOf({ feather, radius }),
      score: kind === 'heal' ? 'Texture' : 'Difference',
      ...(r0 ? { refine: r0 } : {}),
      limits: READ_LIMITS,
      threads: BACKGROUND_THREADS
    })) as unknown as { source_offset: SpotPoint }
    const at = points[0]
    return { x: at.x + r.source_offset.x, y: at.y + r.source_offset.y }
  }

  /**
   * Bake a heal, clone, fill or eye stroke into a pixel step (pixels/heal.ts),
   * on the photo with `steps` laid on (the recipe's, as the renderer has it,
   * strokes before this one included). Null when it changed nothing.
   */
  async bakeSpot(
    spot: RetouchSpot,
    layerId: string | null,
    steps: PixelStep[]
  ): Promise<PixelStep | null> {
    const deps = pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row)
    const set = await ensureWorking(deps, this.workingVersion(), this.px, steps, () =>
      ensureBase(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
    )
    const key = keyOf(this.row.id, null)
    const step = await bakeSpot(
      {
        deps,
        recipe: this.recipe,
        lens: lensCorrection(this.recipe.lens),
        photoId: this.row.id,
        isRaw: this.isRaw,
        asShot: this.info.as_shot_white,
        seed: seedOf(this.row),
        master: set.master!,
        freeze: (recipe, layerId) =>
          freezeMask(
            deps,
            {
              photoId: this.row.id,
              isRaw: this.isRaw,
              asShot: this.info.as_shot_white,
              seed: seedOf(this.row),
              master: set.master!
            },
            recipe,
            layerId
          ),
        store: (file, info) => this.owner.library.index.putBlob(key, file, info)
      },
      spot,
      layerId
    )
    // Made from today's RAW develop (see `staleRawStep`).
    if (step && this.isRaw)
      step.params.develop = await stepDevelopMark(this.row, this.file, askOf(this.recipe))
    // The full-size frame with this stroke, started now: a 1:1 view wants it
    // the moment the step lands, and it is the last one plus a small patch.
    if (step)
      void ensureWorking(deps, this.workingVersion(), this.px, [...steps, step], () =>
        ensureBase(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
      ).catch(() => undefined)
    return step
  }

  /** The noise the denoiser would measure, on the full-resolution frame. */
  async noise(): Promise<NoiseEstimate | null> {
    const src: ProxyFile = this.isRaw
      ? await ensureMaster(this.owner.bgEngine, this.row, this.file, askOf(this.recipe))
      : { path: this.row.path, input: this.file.input, width: 0, height: 0 }
    const s = await this.owner.bgEngine.analyze({
      ...analyzeRequest(src.path, 'Png', 1),
      input: src.input,
      raw: null,
      gain_map: this.isRaw ? null : gainMapOf(this.file),
      noise: true,
      hue_bins: 1,
      bins: 16,
      percentiles: []
    })
    return s.noise
  }

  // ── the Looks browser's cards (lookthumbs.ts) ──

  private lookQueue: LookThumbQueue<Recipe> | null = null
  /** Cards made, by what they were made from: a look scrolled past and back costs nothing. */
  private lookMade = new Map<string, LookThumb>()
  private lookFiles = new Map<string, string>()
  private lookEdge = LOOK_EDGE_DEFAULT

  /**
   * The cards wanted now, in order (see `LookThumbQueue.request`). Always
   * SDR, Full HDR or not: small cards side by side compare looks, and a
   * strip of them glowing would outshine the photo.
   */
  lookThumbs(token: number, jobs: ThumbJob<Recipe>[], edge: number): void {
    if (this.closed) return
    this.lookEdge = Math.round(Math.max(LOOK_EDGE_MIN, Math.min(LOOK_EDGE_MAX, edge)))
    this.lookQueue ??= new LookThumbQueue<Recipe>(
      (job, signal) => this.makeLookThumb(job.recipe, signal),
      (tok, id, thumb) =>
        this.owner.send(IPC.looks.thumb, {
          key: this.key,
          token: tok,
          id,
          ...thumb
        } satisfies LookThumbEvent),
      sameValue
    )
    this.lookQueue.request(token, jobs)
  }

  cancelLookThumbs(): void {
    this.lookQueue?.cancel()
  }

  /** One card: the draft proxy, graded with `recipe`, cropped, small, on the background engine. */
  private async makeLookThumb(recipe: Recipe, signal: AbortSignal): Promise<LookThumb> {
    const src = this.viewPx().draft
    const compiled = await this.compileFor(recipe, src, true)
    const edge = this.lookEdge
    const sig = hash32(
      gradeKey([src.path, edge, compiled.grade, compiled.framing, compiled.lens, compiled.retouch])
    ).toString(16)
    const known = this.lookMade.get(sig)
    if (known) return known
    const out = join(this.dir, `look-${this.tag}-${sig}.jpg`)
    const k = Math.min(1, edge / Math.max(src.width, src.height))
    const report = await this.owner.bgEngine.convert(
      {
        ...blankRequest(src.path, out, src.input),
        resize: k < 1 ? { Scale: { factor: k } } : 'None',
        resampler: 'Bilinear',
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Jpeg: { quality: 85, subsampling: 'Quarter', optimize: false } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy(this.info, 'DisplayP3'),
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: BACKGROUND_THREADS
      },
      { signal }
    )
    const thumb: LookThumb = { url: cacheUrl(out, sig), width: report.width, height: report.height }
    this.lookMade.set(sig, thumb)
    this.lookFiles.set(sig, out)
    // The oldest cards go once there are many (a long browse over several photos' worth).
    while (this.lookMade.size > LOOK_KEEP) {
      const oldest = this.lookMade.keys().next().value as string
      this.lookMade.delete(oldest)
      const f = this.lookFiles.get(oldest)
      this.lookFiles.delete(oldest)
      if (f) void rm(f, { force: true }).catch(() => undefined)
    }
    return thumb
  }

  /** Stop, writing a pending edit; resolves once it is saved. */
  close(): Promise<void> {
    this.closed = true
    if (this.enhancePreview) dropFiles([this.enhancePreview.file.path])
    this.enhancePreview = null
    if (this.screen) dropFiles(this.screen.made)
    this.screen = null
    // The photo's GPU frame and held measurements let go (Phase A §4.3 step 5).
    this.heldSlot.drop()
    this.owner.gpu.close(this.key)
    this.lookQueue?.close()
    for (const f of this.lookFiles.values()) void rm(f, { force: true }).catch(() => undefined)
    clearTimeout(this.settle)
    clearTimeout(this.letGo)
    this.abort?.abort()
    this.regionAbort?.abort()
    // Its RAW develop stops, unless something else waits for it or it is nearly done.
    this.developAbort.abort()
    // Corrected proxies for any other correction are no longer read.
    void pruneLensed(this.row, this.key, this.lensKey(this.recipe))
    void sweepPhoto(this.dir, paths.photoCache(this.row.id))
    const saved = (this.save ? this.persist() : Promise.resolve()).then(() => {
      // A thumbnail still waiting for a pause is made now.
      if (this.thumbTimer) this.thumbLater(true)
      // An editing session that changed the photo ends in a Version of it.
      if (!sameValue(this.recipe, this.opened))
        void this.owner.library.addVersion(this.key, {
          name: tk('Editing session'),
          kind: 'auto',
          reason: 'session',
          recipe: this.recipe
        })
    })
    // Its project may close when idle again, once its last edit is saved.
    return saved.then(() =>
      this.owner.library.index.holdOpen(this.key, false).catch(() => undefined)
    )
  }
}

/**
 * Full HDR's SDR companion written as a Display P3 PNG by the pixels worker:
 * its deflate held main up about 36 ms per settled render (Pass 116). The
 * samples are handed over when they own their buffer (nothing reads them
 * after); the worker gone, it is written here.
 */
async function writeCompanion(file: string, data: Uint8Array, w: number, h: number): Promise<void> {
  const own = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
  const px = own ? data : data.slice()
  try {
    await pixels.run({ op: 'png8', data: px, w, h, out: file }, [px.buffer as ArrayBuffer])
  } catch (err) {
    if (px.byteLength === 0) throw err
    await writeFile(file, encodePng8(px, w, h, 1, [CICP_DISPLAY_P3]))
  }
}

export class DevelopSessions {
  private sessions = new Map<string, Session>()
  /** Counts fresh opens: an open that finds a later one started makes no session. */
  private opening = 0
  /** The photo a fresh open is loading, until its session is made. */
  private openingKey: string | null = null

  /** The GPU drag path's state for the interactive engine (Phase A §4.3). */
  readonly gpu: GpuDrag

  constructor(
    readonly library: Library,
    readonly engine: EngineClient,
    readonly bgEngine: EngineClient
  ) {
    this.gpu = new GpuDrag(engine, library.index)
    // The open RAW's full-size develop, said in the window while it runs.
    onMasterWork((e) => {
      for (const [key, s] of this.sessions)
        if (s.row.id === e.photoId) {
          this.send(IPC.develop.master, {
            key,
            phase: e.phase,
            ...(e.progress ? { progress: e.progress } : {})
          } satisfies MasterEvent)
          if (e.phase !== 'end') continue
          // With a development kit, what developed it and how long it took (devkit.ts).
          const note = takeDevelopedNote(e.photoId)
          if (note) this.send(IPC.develop.tileStale, { key, note })
          // The PIXL demosaic's master, just made: the zoomed-out picture is cut from it,
          // and a screen-sized picture that waited for a full-size frame has one.
          void s.adoptDeveloped()
          s.screenAgain()
        }
    })
  }

  send(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  /** The open photo's 1:1 tile is asked for again: its RAW develop changed. */
  tilesStale(): void {
    for (const key of this.sessions.keys()) this.send(IPC.develop.tileStale, { key })
  }

  /** An open photo's session, for what works on it from outside (PIXL Enhance's preview). */
  session(key: string): Session {
    return this.get(key)
  }

  /** Before/After against a Version's recipe (null: the photo as it came). */
  compareWith(key: string, recipe: Recipe | null): void {
    this.get(key).compareWith(recipe)
  }

  /** The PIXL demosaic's switch turned: the open RAW's picture follows it. */
  pixlSwitched(): void {
    for (const s of this.sessions.values()) void s.pixlSwitched()
  }

  private get(key: string): Session {
    const s = this.sessions.get(key)
    if (!s) throw new Error(`photo ${key} is not open`)
    return s
  }

  /** One photo at a time: closing the others writes their pending edits. */
  private closeOthers(key: string): void {
    for (const [k, s] of this.sessions) {
      if (k !== key) {
        void s.close()
        this.sessions.delete(k)
      }
    }
  }

  async open(key: string): Promise<DevelopSession> {
    // Opening a photo not yet open takes over from any open still on its way;
    // asking again for the open one (to read its recipe) changes nothing.
    const fresh = !this.sessions.has(key)
    const token = fresh ? ++this.opening : this.opening
    if (fresh) {
      this.openingKey = key
      this.closeOthers(key)
    }
    let data = await this.library.index.openData(key)
    // The original, or the copy its project carries when it is gone.
    let row = await this.library.readable(data.row)
    let info = await this.library.probe(row, this.engine)
    // A RAW's camera colour is chosen the first time it is probed, and its
    // saved white balance moves with it: what was read before is read again.
    // (Or moved since, to PIXL's colour once its database holds the body.)
    if (data.row.is_raw === 1 && row.raw_colour && data.row.raw_colour !== row.raw_colour) {
      data = await this.library.index.openData(key)
      row = await this.library.readable(data.row)
      info = await this.library.probe(row, this.engine)
    }
    const { item, snapshots } = data
    // The index names planes; the session renders them.
    const recipe = await this.library.planes.hydrate(data.recipe)
    // A gain-map photo edited as HDR opens on its applied rendition.
    const hdr = editsHdr(recipe, info) ? await ensureHdrSource(this.engine, row, info) : null
    const graded = hdr?.info ?? info
    const px = hdr?.px ?? (await ensureProxies(this.engine, row, info))
    await mkdir(rendersDir(row.id), { recursive: true })
    let session = this.sessions.get(key)
    if (!session) {
      // A later open (or a close) came while this one loaded, or the photo
      // being read again was closed meanwhile: it makes nothing.
      if (!fresh || token !== this.opening) throw new Error(`opening ${key} was superseded`)
      this.openingKey = null
      this.closeOthers(key)
      session = new Session(key, row, graded, px, recipe, this, info, hdr?.master ?? null)
      this.sessions.set(key, session)
      void this.library.index.holdOpen(key, true).catch(() => undefined)
      // A photo with pixel steps opens on them.
      session.workingJob = session.refreshWorking()
      await session.workingJob
      // A RAW the PIXL demosaic develops: its master now, the picture cut from it.
      void session.developOnOpen()
    }
    // Today's develop mark and pipeline: what an older edit is told by (shared/rebuild.ts).
    const mark = row.is_raw === 1 ? await stepDevelopMark(row, info, askOf(session.recipe)) : null
    const today = await pipeline()
    return {
      key,
      item,
      info,
      isRaw: row.is_raw === 1,
      isHdr: graded.is_hdr,
      asShot: info.as_shot_white,
      rawColour: row.is_raw === 1 ? resolveRawColour(row.raw_colour, info) : null,
      cameraColour:
        row.is_raw === 1 && info.camera_colour
          ? {
              make: info.camera_colour.make,
              model: info.camera_colour.model,
              pixlCamera: info.camera_colour.pixl_camera,
              supported: pixlSupported(info)
            }
          : null,
      // The working frame: an upscale step makes it larger than the file.
      frameWidth: session.frameSize().width,
      frameHeight: session.frameSize().height,
      proxyWidth: px.proxy.width,
      proxyHeight: px.proxy.height,
      recipe: session.recipe,
      snapshots,
      seed: seedOf(row),
      developMark: mark,
      rebuild: rebuildReasons(session.recipe, row.is_raw === 1, today, mark)
    }
  }

  close(key: string): Promise<void> {
    const s = this.sessions.get(key)
    if (!s) {
      // Closed while still opening: the open makes nothing.
      if (key === this.openingKey) {
        ++this.opening
        this.openingKey = null
      }
      return Promise.resolve()
    }
    this.sessions.delete(key)
    return s.close()
  }

  closeAll(): Promise<void> {
    return Promise.all([...this.sessions.keys()].map((k) => this.close(k))).then(() => undefined)
  }

  update(key: string, recipe: Recipe, interactive: boolean, rev?: number): void {
    this.get(key).update(recipe, interactive, rev)
  }

  /** Show `recipe` on an open photo's loupe without making it the photo's (null: its own again). */
  preview(key: string, recipe: Recipe | null): void {
    this.sessions.get(key)?.previewRecipe(recipe)
  }

  /** What a white balance saved elsewhere converts into on this photo; null when it is not open. */
  wbContext(key: string): { isRaw: boolean; asShot: SourceInfo['as_shot_white'] } | null {
    const s = this.sessions.get(key)
    return s ? { isRaw: s.isRaw, asShot: s.info.as_shot_white } : null
  }

  /** The Looks browser's cards for an open photo; a photo since closed is not asked. */
  lookThumbs(key: string, token: number, jobs: ThumbJob<Recipe>[], edge: number): void {
    this.sessions.get(key)?.lookThumbs(token, jobs, edge)
  }

  cancelLookThumbs(key: string): void {
    this.sessions.get(key)?.cancelLookThumbs()
  }

  view(key: string, view: ViewState): void {
    this.get(key).setView(view)
  }

  /** The window never got a settled picture's pixels: the photo's picture made again (if still open). */
  frameLost(key: string): void {
    this.sessions.get(key)?.frameLost()
  }

  region(req: RegionRequest): Promise<RegionResult> {
    const t0 = performance.now()
    return this.get(req.key)
      .region(req)
      .catch((err: unknown) => {
        traceRegion({
          step: 'region failed',
          key: req.key,
          asked: req,
          zoom: req.zoom,
          ms: Math.round(performance.now() - t0),
          message: (err as Error)?.message ?? String(err)
        })
        throw err
      })
  }

  sample(key: string, x: number, y: number): Promise<SampleResult> {
    return this.get(key).sample(x, y)
  }

  autoTone(key: string): Promise<BasicSetting> {
    return this.get(key).autoTone()
  }

  autoWb(key: string): Promise<SampleResult['wb']> {
    return this.get(key).autoWb()
  }

  noise(key: string): Promise<NoiseEstimate | null> {
    return this.get(key).noise()
  }

  measureCa(key: string): Promise<CaMeasurement> {
    return this.get(key).measureCa()
  }

  /** What lens matching needs of an open photo: its lens, its camera and its frame. */
  async lensShot(key: string): Promise<LensShot> {
    const session = this.get(key)
    const item = await this.library.item(key)
    return {
      lens: session.file.lens ?? null,
      camera: item ? { make: item.camera.make, model: item.camera.model } : null,
      width: session.px.frameWidth,
      height: session.px.frameHeight
    }
  }

  /** A pixel step's draft shown on the photo while it is made (null when it is done or failed). */
  pixelPreview(key: string, draft: ProxyFile | null): void {
    this.sessions.get(key)?.showPreview(draft)
  }

  /** The preview gone, and no render still reading it: its file can be deleted. */
  async clearPreview(key: string): Promise<void> {
    const s = this.sessions.get(key)
    if (!s) return
    s.showPreview(null)
    await s.whenIdle()
  }

  /** Resolves once an open photo's working pixels are made for its steps. */
  workingReady(key: string): Promise<void> {
    return this.sessions.get(key)?.workingJob ?? Promise.resolve()
  }

  bakeSpot(
    key: string,
    spot: RetouchSpot,
    layerId: string | null,
    steps: PixelStep[]
  ): Promise<PixelStep | null> {
    return this.get(key).bakeSpot(spot, layerId, steps)
  }

  suggestHeal(
    key: string,
    points: SpotPoint[],
    radius: number,
    feather: number,
    kind: 'heal' | 'clone',
    refine?: SpotRefine
  ): Promise<SpotPoint> {
    return this.get(key).suggestHeal(points, radius, feather, kind, refine)
  }

  suggestUpright(
    key: string,
    mode: 'Level' | 'Vertical' | 'Full',
    focal: number
  ): Promise<Transform> {
    return this.get(key).suggestUpright(mode, focal)
  }

  uprightFromLines(key: string, lines: GuideLine[], focal: number): Promise<Transform> {
    return this.get(key).uprightFromLines(lines, focal)
  }

  /** The recipe an open session holds, which may be newer than the sidecar. */
  liveRecipe(key: string): Recipe | undefined {
    return this.sessions.get(key)?.recipe
  }

  /** An open session's recipe was saved elsewhere: see `Session.saved`. */
  saved(key: string, recipe: Recipe): void {
    this.sessions.get(key)?.saved(recipe)
  }

  /** Save an open session's recipe now; resolves once it is saved. */
  flush(key: string): Promise<void> {
    return this.sessions.get(key)?.persist() ?? Promise.resolve()
  }
}

export { RAW_DEVELOP }

/** Files a screen-sized picture made, off the disk (they are hundreds of MB at 5K in float). */
function dropFiles(files: string[]): void {
  for (const f of files) void rm(f, { force: true }).catch(() => undefined)
}
