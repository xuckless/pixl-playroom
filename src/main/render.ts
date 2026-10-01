/**
 * The develop view's renderer. Every preview is a real engine render of the
 * photo's proxy with the compiled recipe — the same compiler and the same
 * engine an export uses — measured by the engine as it renders, so the
 * histogram and the hue chart describe the pixels on screen.
 *
 * Renders are coalesced: while one is in flight only the newest recipe waits,
 * and a moving slider renders the small draft proxy; the full proxy follows
 * once the slider settles (longer when that is the large proxy a Retina
 * loupe asks for), or at once when it is let go. A newer edit stops a settled
 * render (and the masks, "before" and thumbnails after it) at the engine's
 * next stage; a draft in flight finishes, so a moving slider keeps showing
 * frames. Both are JPEGs, quick to write and for the loupe to read.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { AUTO_PERCENTILES, autoTone, linearSrgbToRec2020 } from '../shared/auto'
import {
  compile,
  fitCrop,
  framingTransparent,
  framingWarps,
  orientedFrame,
  type Compiled
} from '../shared/compile'
import { lensCorrection, MANUAL_GEOMETRY } from '../shared/lens'
import { compileRetouch, featherOf, spotShape, type P as SpotPoint } from '../shared/retouch'
import { stackSignature } from '../shared/pixels'
import { ensureBase, pixelDeps } from './pixels/base'
import { ensureWorking, workingKey, type WorkingSet } from './pixels/working'
import { defaultUpright, uprightTransform, type GuideLine } from '../shared/upright'
import type {
  HdrWorking,
  ConvertReport,
  LateralCa,
  LensCorrection,
  Retouch,
  Transform,
  ImageStats,
  Measure,
  NoiseEstimate,
  SourceInfo
} from '../shared/engine-types'
import { STRIP_ALL } from '../shared/engine-types'
import {
  IPC,
  type BasicSetting,
  type CaMeasurement,
  type DevelopSession,
  type RegionRequest,
  type RegionResult,
  type RenderEvent,
  type RenderReport,
  type SampleResult,
  type ViewState
} from '../shared/ipc'
import { defaultRecipe, hash32, normaliseRecipe, type Recipe } from '../shared/recipe'
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
import type { PhotoRow } from './db'
import { EngineError, isCancelled, type EngineClient } from './engine/client'
import { parseKey } from './keys'
import type { Library } from './library'
import { pngToFloats } from './pngio'
import { cacheUrl } from './protocol'
import {
  ensureLensedProxies,
  ensureMaster,
  ensureProxies,
  pruneLensed,
  type Proxies,
  type ProxyFile
} from './proxy'
import { editsHdr, ensureHdrSource } from './hdrsource'
import type { LensShot } from './lensprofiles'
import {
  blankRequest,
  BACKGROUND_THREADS,
  displayPolicy,
  gainMapOf,
  INTERACTIVE_THREADS,
  orientOnly,
  RAW_DEVELOP,
  sourceOrientation,
  seedOf,
  versionStamp
} from './source'

type Kind = 'draft' | 'full'

/** How long a slider must rest before the full proxy renders. */
const SETTLE_MS = 180
/**
 * How long it must rest when the full render is the large proxy: pausing
 * mid-drag should not start a render four times the draft's size that the
 * next move then waits behind.
 */
const SETTLE_LARGE_MS = 500
/** The signature of a mask that compiles to nothing (its event has no picture). */
const EMPTY = 'empty'
/** How long an edit must rest before the sidecar is written. */
const SAVE_MS = 600

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
  private pending: Kind | null = null
  private settle: NodeJS.Timeout | undefined
  private save: NodeJS.Timeout | undefined
  private slot = 0
  private regionSlot = 0
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
    readonly px: Proxies,
    public recipe: Recipe,
    private readonly owner: DevelopSessions,
    /** The file as probed; `info` is what is graded (a gain map's HDR master, when edited so). */
    readonly file: SourceInfo = info,
    /** A gain-map photo edited as HDR: the applied rendition at full resolution. */
    readonly hdrMaster: ProxyFile | null = null
  ) {
    this.dir = rendersDir(row.id)
  }

  get isRaw(): boolean {
    return this.row.is_raw === 1
  }

  /**
   * Compile a recipe for a source. A source from the prepared set already
   * carries the lens correction and the spots: the engine is not asked to do
   * those again.
   */
  async compileFor(recipe: Recipe, source: ProxyFile, applyCrop: boolean): Promise<Compiled> {
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
      hdr: this.info.is_hdr,
      showTransform: !this.view.guides
    })
    return baked ? { ...compiled, lens: null, retouch: null } : compiled
  }

  /** Whether a source is one of the prepared set's (lens and spots baked in). */
  private isBaked(source: ProxyFile): boolean {
    const px = this.lensed?.px
    return !!px && (source === px.proxy || source === px.draft)
  }

  /** Whether a source is the plain photo's (no pixel step laid on). */
  private isPlain(source: ProxyFile): boolean {
    return source === this.px.proxy || source === this.px.draft
  }

  // ── pixel steps (shared/pixels.ts, pixels/working.ts) ──

  /** The working set for the recipe's pixel steps, once made (or the last, while the next is). */
  private working: WorkingSet | null = null
  /** A pixel step being made: its draft, shown in its place until the step lands. */
  private preview: Proxies | null = null

  private stepsKey(recipe: Recipe): string {
    return workingKey(versionStamp(this.row), recipe.pixels)
  }

  /**
   * The proxies everything else starts from: a step being made's preview,
   * the working pixels (the recipe's steps laid on), or the plain photo.
   */
  private basePx(): Proxies {
    if (this.preview) return this.preview
    if (this.recipe.pixels.length === 0) return this.px
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
    if (this.recipe.pixels.length === 0) {
      const was = this.frameSize()
      this.working = null
      this.frameChanged(was)
      this.schedule('full')
      return
    }
    try {
      const set = await ensureWorking(
        pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row),
        versionStamp(this.row),
        this.px,
        this.recipe.pixels,
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
    const px = this.recipe.pixels.length > 0 ? (this.working?.px ?? this.px) : this.px
    return { width: px.frameWidth, height: px.frameHeight }
  }

  /** The full-resolution working frame (the recipe's steps on the photo at full size): 1:1 and export. */
  async workingMaster(): Promise<ProxyFile | null> {
    if (this.recipe.pixels.length === 0) return null
    const set = await ensureWorking(
      pixelDeps(this.owner.bgEngine, this.owner.library.index, this.row),
      versionStamp(this.row),
      this.px,
      this.recipe.pixels,
      () => ensureBase(this.owner.bgEngine, this.row, this.file)
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
    return {
      base: this.basePx().proxy.path,
      lens: lensCorrection(recipe.lens),
      retouch: compileRetouch(
        recipe.retouch,
        'Normal',
        this.basePx().frameWidth,
        this.basePx().frameHeight
      )
    }
  }

  /** What names the prepared proxies a recipe needs: '' for none (the plain proxies serve). */
  private lensKey(recipe: Recipe): string {
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

  /** A correction waiting for its corrected proxies. */
  private bakePending(): boolean {
    const key = this.lensKey(this.recipe)
    return key !== '' && this.lensed?.key !== key
  }

  private baking: string | null = null

  /**
   * Make the recipe's lens-corrected proxies in the background (once the
   * edit has settled), then render again from them. One at a time; a
   * correction changed meanwhile is baked next.
   */
  private bake(): void {
    const key = this.lensKey(this.recipe)
    if (!key || this.lensed?.key === key || this.baking === key) return
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
          this.lensed = { key, px }
          this.schedule('full')
        } else this.bake()
      },
      (err) => {
        if (this.baking === key) this.baking = null
        log.warn('lens proxies failed; correcting live', (err as Error).message)
      }
    )
  }

  update(next: Recipe, interactive: boolean, rev?: number): void {
    const stepsWere = stackSignature(this.recipe.pixels)
    // Whatever the renderer replayed (an old history base can lack fields
    // added since), the session only ever holds a complete recipe.
    const recipe = normaliseRecipe(next, this.isRaw)
    this.recipe = recipe
    if (rev !== undefined) this.rev = rev
    // A pixel step added, undone, hidden or its strength changed: the working
    // pixels for the steps now (made already, for an undo or a redo).
    if (stackSignature(recipe.pixels) !== stepsWere) void this.refreshWorking()
    // A settled render of the old recipe is only in the way; so is anything
    // in flight when the slider is let go (the full render follows at once).
    if (this.inflight && (this.inflightKind === 'full' || !interactive)) this.abort?.abort()
    clearTimeout(this.save)
    this.save = setTimeout(() => this.persist(), SAVE_MS)
    this.schedule(interactive ? 'draft' : 'full')
  }

  /** Save the recipe now. The index answers in order, so what is asked of it next sees this. */
  persist(): Promise<void> {
    clearTimeout(this.save)
    this.save = undefined
    const { photoId, copyId } = parseKey(this.key)
    return this.owner.library.saveRecipe(this.key, this.recipe).then(
      () => this.owner.library.queueThumb(photoId, copyId, true),
      (err) => log.error('saving recipe failed', err)
    )
  }

  setView(view: ViewState): void {
    this.view = view
    this.schedule('full')
  }

  schedule(kind: Kind): void {
    clearTimeout(this.settle)
    if (kind === 'draft') {
      const wait = this.source('full') === this.viewPx().proxy ? SETTLE_LARGE_MS : SETTLE_MS
      this.settle = setTimeout(() => this.schedule('full'), wait)
    }
    if (this.inflight) {
      this.pending = this.pending === 'full' || kind === 'full' ? 'full' : 'draft'
      return
    }
    void this.run(kind)
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
      await this.renderPicture(kind, signal)
      // A newer edit waiting behind this render will redo what follows.
      if (kind === 'draft' && this.view.maskLive && this.view.maskLayer && !this.closed)
        await this.renderMask('draft', signal)
      // While a bake is pending, what follows waits for the render it brings.
      if (kind === 'full' && !this.closed && !this.pending && !this.bakePending()) {
        if (this.view.maskLayer) await this.renderMask('full', signal)
        if (this.view.before) await this.renderBefore(signal)
        if (this.view.headroom) await this.renderHeadroom(signal)
        if (this.view.maskThumbs) await this.renderMaskThumbs(signal)
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
        field: e instanceof EngineError ? e.field : undefined
      })
    } finally {
      this.inflight = false
      this.inflightKind = null
      this.abort = null
      const next = this.pending
      this.pending = null
      if (next && !this.closed) void this.run(next)
    }
  }

  private source(kind: Kind): ProxyFile {
    const px = this.viewPx()
    if (kind === 'draft') return px.draft
    // A correction still being baked: the draft, corrected live, stands in
    // (a large proxy warped on every render is what the bake avoids).
    if (this.bakePending()) return px.draft
    const long = Math.max(px.draft.width, px.draft.height)
    return this.view.targetEdge <= long ? px.draft : px.proxy
  }

  private nextFile(stem: string, ext: string): string {
    this.slot = (this.slot + 1) % 6
    return join(this.dir, `${stem}-${this.slot}.${ext}`)
  }

  private async renderPicture(kind: Kind, signal: AbortSignal): Promise<void> {
    const t0 = performance.now()
    const src = this.source(kind)
    // The view is read once, here: the event says which view it was made for.
    const cropMode = this.view.cropMode
    const rev = this.rev
    const compiled = await this.compileFor(this.recipe, src, !cropMode)
    const seq = ++this.seq
    const sig = String(
      hash32(
        JSON.stringify([
          src.path,
          cropMode,
          compiled.grade,
          compiled.framing,
          compiled.lens,
          compiled.retouch
        ])
      )
    )
    const last = this.lastEvent[kind]
    if (last && sig === this.lastSig[kind]) {
      if (kind === 'full') this.lastFull = this.lastFullFor[sig] ?? this.lastFull
      if (!this.closed) this.owner.send(IPC.develop.rendered, { ...last, seq, rev })
      return
    }
    // A warp shown whole (the crop tool) keeps its empty corners: PNG with alpha.
    const alpha = framingTransparent(compiled.framing)
    const out = this.nextFile('view', alpha ? 'png' : 'jpg')
    const hdrStats =
      kind === 'full' ? this.measureHdr(cropMode, signal) : Promise.resolve(undefined)
    const report = await this.owner.engine.convert(
      {
        ...blankRequest(src.path, out, src.input),
        pixel: { depth: 'Eight', channels: alpha ? 4 : 3 },
        encode: alpha
          ? { Png: { compression: 'Fast', filter: 'Sub' } }
          : {
              Jpeg: { quality: kind === 'draft' ? 92 : 95, subsampling: 'None', optimize: false }
            },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy(this.info, 'DisplayP3'),
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: INTERACTIVE_THREADS,
        // A warp shown whole counts its empty corners (as black) rather than
        // risk measuring nothing when little of the picture is left.
        measure: measureOf(kind === 'draft' ? 2 : 1)
      },
      { signal }
    )
    const stats = statsOf(report)
    if (kind === 'full') {
      this.lastFull = out
      this.lastFullFor = { [sig]: out }
    }
    const hdr = await hdrStats
    if (this.closed) return
    const event: RenderEvent = {
      key: this.key,
      seq,
      rev,
      kind,
      cropMode,
      url: cacheUrl(out, seq),
      width: report.width,
      height: report.height,
      stats,
      hdrStats: hdr,
      report: reportOf(
        report,
        Math.round(performance.now() - t0),
        compiled.notes,
        compiled.layerIndex
      )
    }
    this.lastSig[kind] = sig
    this.lastEvent[kind] = event
    this.owner.send(IPC.develop.rendered, event)
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
      const compiled = await this.compileFor(this.recipe, src, !cropMode)
      const out = join(this.dir, 'hdr-stats.png')
      // Fine bins: the chart re-bins them onto a stops axis, where the
      // shadows need the resolution.
      const bins = 4096
      const request = {
        ...blankRequest(src.path, out, src.input),
        pixel: { depth: 'Sixteen', channels: framingTransparent(compiled.framing) ? 4 : 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: 'Preserve',
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        threads: INTERACTIVE_THREADS
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
        const r = await this.owner.engine.convert(
          { ...request, hdr, measure: { ...measureOf(1), domain: 'Linear', bins } },
          { signal }
        )
        return statsOf(r)
      }
      await this.owner.engine.convert(request, { signal })
      return await this.owner.engine.analyze(
        { ...analyzeRequest(out, 'Png', 1), domain: 'Linear', bins, hdr: hdrSignalOf(hdr) },
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
    if (!hdr) return
    const src = this.source('full')
    const compiled = await this.compileFor(this.recipe, src, !this.view.cropMode)
    // A plane has one channel, so a warp's transparent corners cannot be said.
    if (framingTransparent(compiled.framing)) return
    const stops = Math.max(0.5, Math.log2(hdr.peak_nits / hdr.reference_white_nits))
    const out = this.nextFile('headroom', 'png')
    try {
      const r = await this.owner.engine.convert(
        {
          ...blankRequest(src.path, out, src.input),
          pixel: { depth: 'Eight', channels: 1 },
          encode: { Png: { compression: 'Fast', filter: 'Sub' } },
          metadata: STRIP_ALL,
          color: 'Preserve',
          hdr,
          grade: compiled.grade,
          framing: compiled.framing,
          lens: compiled.lens,
          retouch: compiled.retouch,
          inspect: { Headroom: { stops } },
          threads: INTERACTIVE_THREADS
        },
        { signal }
      )
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
  private async renderMask(kind: Kind, signal: AbortSignal): Promise<void> {
    const src = kind === 'draft' ? this.viewPx().draft : this.source('full')
    const rev = this.rev
    const compiled = await this.compileFor(this.recipe, src, !this.view.cropMode)
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
    const sig = String(
      hash32(
        JSON.stringify([
          src.path,
          layerId,
          index,
          compiled.grade,
          compiled.framing,
          compiled.lens,
          compiled.retouch,
          measure ? this.lastFull : null
        ])
      )
    )
    // The same plane over the same picture: say so again, for this recipe.
    if (sig === this.maskSig && this.lastMask) {
      if (!this.closed) {
        this.lastMask = { ...this.lastMask, seq: this.seq, rev }
        this.owner.send(IPC.develop.rendered, this.lastMask)
      }
      return
    }
    const out = this.nextFile('mask', 'png')
    const report = await this.owner.engine.convert(
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
    // The picture the renderer shows is the last full render; measure it
    // through the plane. `weights` is an engine feature that may be missing
    // from an older build — the overlay still shows without it.
    let maskStats: ImageStats | undefined
    if (measure) {
      try {
        maskStats = await this.owner.engine.analyze(
          {
            ...analyzeRequest(this.lastFull, 'Jpeg', 1),
            weights: { source: { Png: out }, resampler: 'Bilinear' }
          },
          { signal }
        )
      } catch (err) {
        if (isCancelled(err)) throw err
        log.info('masked analysis unavailable', (err as Error).message)
      }
    }
    this.maskSig = sig
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
   * newer edit waiting behind it.
   */
  private async renderMaskThumbs(signal: AbortSignal): Promise<void> {
    const src = this.viewPx().draft
    const compiled = await this.compileFor(this.recipe, src, !this.view.cropMode)
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
          JSON.stringify([
            src.path,
            layer.components,
            layer.invert,
            compiled.framing,
            compiled.lens,
            this.view.cropMode,
            // A range keys on the graded colours, so the grade under it counts too.
            layer.components.some((c) => c.kind === 'range') ? compiled.grade : null
          ])
        )
      )
      if (this.thumbSig[layer.id] === sig) continue
      const out = join(this.dir, `mthumb-${layer.id}-${sig}.png`)
      const report = await this.owner.engine.convert(
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
  private lastFullFor: Record<string, string> = {}

  /** The default recipe with the same framing: the "before", and the ghost bars. */
  private async renderBefore(signal: AbortSignal): Promise<void> {
    const before = defaultRecipe(this.isRaw)
    before.geometry = structuredClone(this.recipe.geometry)
    // The lens's geometry too, so before and after line up; not its defringe.
    before.lens = { ...structuredClone(this.recipe.lens), defringe: before.lens.defringe }
    // Spots too: they are repairs, not a look, and the prepared proxies carry them.
    before.retouch = structuredClone(this.recipe.retouch)
    // The photo as it came: never the pixel steps the edit renders from (the
    // plain proxy then, with the lens and spots applied live).
    const view = this.source('full')
    const src =
      this.isPlain(view) || (this.isBaked(view) && this.basePx() === this.px) ? view : this.px.proxy
    const compiled = await this.compileFor(before, src, !this.view.cropMode)
    // Keyed on what the engine is asked for, not on the raw geometry: a
    // straighten in the crop tool changes the recipe but not this picture.
    const key = JSON.stringify([
      compiled.framing,
      compiled.lens,
      compiled.retouch,
      src.path,
      this.view.cropMode
    ])
    if (key === this.beforeKey) return
    const out = join(this.dir, `before-${hash32(key).toString(16)}.png`)
    const report = await this.owner.engine.convert(
      {
        ...blankRequest(src.path, out, src.input),
        pixel: { depth: 'Eight', channels: framingTransparent(compiled.framing) ? 4 : 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy(this.info, 'DisplayP3'),
        grade: compiled.grade,
        framing: compiled.framing,
        lens: compiled.lens,
        retouch: compiled.retouch,
        measure: measureOf(1)
      },
      { signal }
    )
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

  /** A 1:1 (or smaller) render of part of the full-resolution frame. */
  async region(req: RegionRequest): Promise<RegionResult> {
    const t0 = performance.now()
    // The loupe asks again as it pans and zooms: only the newest view matters.
    this.regionAbort?.abort()
    const abort = new AbortController()
    this.regionAbort = abort
    const { signal } = abort
    // The pixel steps laid on at full size: the same pixels an export uses.
    const stepsMaster = await this.workingMaster()
    const raw = this.isRaw
    const src: ProxyFile = stepsMaster
      ? stepsMaster
      : this.hdrMaster
        ? this.hdrMaster
        : raw
          ? await ensureMaster(this.owner.bgEngine, this.row)
          : {
              path: this.row.path,
              input: this.info.input,
              width: this.px.frameWidth,
              height: this.px.frameHeight
            }
    const frame = this.frameSize()
    const { user, width, height } = orientedFrame(this.recipe, frame.width, frame.height)
    const zoom = Math.min(1, req.zoom)
    const compiled = compile(this.recipe, {
      isRaw: raw,
      asShot: this.info.as_shot_white,
      sourceOrientation:
        raw || stepsMaster || this.hdrMaster ? 'Normal' : sourceOrientation(this.info, null),
      frameWidth: frame.width,
      frameHeight: frame.height,
      scale: zoom,
      seed: seedOf(this.row),
      brushPaths: await brushPlanes(this.row.id, this.recipe, user),
      applyCrop: false,
      hdr: this.info.is_hdr
    })
    const x = Math.max(0, Math.min(width - 1, Math.floor(req.x)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(req.y)))
    const w = Math.max(1, Math.min(width - x, Math.ceil(req.width)))
    const h = Math.max(1, Math.min(height - y, Math.ceil(req.height)))
    const region = await this.correctedRegion(compiled.lens, width, height, { x, y, w, h })
    this.regionSlot = (this.regionSlot + 1) % 4
    const out = join(this.dir, `region-${this.regionSlot}.png`)
    // The original (not a RAW's master) states its gain-map rendition.
    const original = raw || stepsMaster || this.hdrMaster ? null : this.file
    await this.owner.engine.convert(
      {
        ...blankRequest(src.path, out, src.input, original),
        raw: null,
        resize: zoom < 1 ? { Scale: { factor: zoom } } : 'None',
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy(this.info, 'DisplayP3'),
        grade: compiled.grade,
        framing: orientOnly(compiled.framing),
        lens: compiled.lens,
        retouch: compiled.retouch,
        region
      },
      { signal }
    )
    // The overlay at 1:1: the same region through the layer's mask.
    let maskUrl: string | undefined
    const index = req.maskLayer ? compiled.layerIndex[req.maskLayer] : undefined
    if (index !== undefined && compiled.grade) {
      const maskOut = join(this.dir, `region-mask-${this.regionSlot}.png`)
      try {
        await this.owner.engine.convert(
          {
            ...blankRequest(src.path, maskOut, src.input, original),
            raw: null,
            resize: zoom < 1 ? { Scale: { factor: zoom } } : 'None',
            pixel: { depth: 'Eight', channels: 1 },
            encode: { Png: { compression: 'Fast', filter: 'Sub' } },
            metadata: STRIP_ALL,
            color: 'Preserve',
            grade: compiled.grade,
            framing: orientOnly(compiled.framing),
            lens: compiled.lens,
            retouch: compiled.retouch,
            region,
            inspect: { LayerMask: { layer: index } }
          },
          { signal }
        )
        maskUrl = cacheUrl(maskOut, `${Date.now()}`)
      } catch (err) {
        if (isCancelled(err)) throw err
        log.info('region mask unavailable', (err as Error).message)
      }
    }
    if (this.regionAbort === abort) this.regionAbort = null
    return {
      maskUrl,
      url: cacheUrl(out, `${Date.now()}`),
      x,
      y,
      width: w,
      height: h,
      ms: Math.round(performance.now() - t0)
    }
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
    margin = 96
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
    const report = await this.owner.engine.convert({
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
    const raw = this.isRaw ? RAW_DEVELOP : null
    const r = (await this.owner.bgEngine.suggestLateralCa({
      source: { Path: this.row.path },
      input: this.file.input,
      raw,
      gain_map: gainMapOf(this.file),
      orientation: sourceOrientation(this.file, raw),
      geometry: MANUAL_GEOMETRY,
      model: 'Scale',
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
      threads: INTERACTIVE_THREADS
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
  private usableUpright(t: Transform, w: number, h: number): void {
    const { width, height } = orientedFrame(this.recipe, w, h)
    const tooSteep = new Error('the lines ask for too strong a correction')
    if (Math.abs(t.vertical) > 40 || Math.abs(t.horizontal) > 40) throw tooSteep
    const centred = uprightTransform({ ...defaultUpright(), suggested: t }, width, height)
    if (!centred) return
    const kept = fitCrop({ x: 0, y: 0, width: 1, height: 1 }, 0, width, height, centred)
    if (kept.width * kept.height < 0.25) throw tooSteep
  }

  /** Guided Upright: the transform that makes the guides (frame fractions) upright or level. */
  async uprightFromLines(lines: GuideLine[], focal: number): Promise<Transform> {
    const { width, height } = orientedFrame(this.recipe, this.px.frameWidth, this.px.frameHeight)
    const t = await this.owner.engine.uprightFromLines(lines, width, height, focal)
    this.usableUpright(t, this.px.frameWidth, this.px.frameHeight)
    return t
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
    kind: 'heal' | 'clone'
  ): Promise<SpotPoint> {
    const src = this.px.proxy
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
      threads: BACKGROUND_THREADS
    })) as unknown as { source_offset: SpotPoint }
    const at = points[0]
    return { x: at.x + r.source_offset.x, y: at.y + r.source_offset.y }
  }

  /** The noise the denoiser would measure, on the full-resolution frame. */
  async noise(): Promise<NoiseEstimate | null> {
    const src: ProxyFile = this.isRaw
      ? await ensureMaster(this.owner.bgEngine, this.row)
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

  /** Stop, writing a pending edit; resolves once it is saved. */
  close(): Promise<void> {
    this.closed = true
    clearTimeout(this.settle)
    this.abort?.abort()
    this.regionAbort?.abort()
    // Corrected proxies for any other correction are no longer read.
    void pruneLensed(this.row, this.lensKey(this.recipe))
    return this.save ? this.persist() : Promise.resolve()
  }
}

export class DevelopSessions {
  private sessions = new Map<string, Session>()

  constructor(
    readonly library: Library,
    readonly engine: EngineClient,
    readonly bgEngine: EngineClient
  ) {}

  send(channel: string, payload: unknown): void {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
  }

  private get(key: string): Session {
    const s = this.sessions.get(key)
    if (!s) throw new Error(`photo ${key} is not open`)
    return s
  }

  async open(key: string): Promise<DevelopSession> {
    // One photo at a time: closing the others writes their pending edits.
    for (const [k, s] of this.sessions) {
      if (k !== key) {
        void s.close()
        this.sessions.delete(k)
      }
    }
    const data = await this.library.index.openData(key)
    const { recipe, item, snapshots } = data
    // The original, or the copy its project carries when it is gone.
    const row = await this.library.readable(data.row)
    const info = await this.library.probe(row)
    // A gain-map photo edited as HDR opens on its applied rendition.
    const hdr = editsHdr(recipe, info) ? await ensureHdrSource(this.engine, row, info) : null
    const graded = hdr?.info ?? info
    const px = hdr?.px ?? (await ensureProxies(this.engine, row, info))
    await mkdir(rendersDir(row.id), { recursive: true })
    let session = this.sessions.get(key)
    if (!session) {
      session = new Session(key, row, graded, px, recipe, this, info, hdr?.master ?? null)
      this.sessions.set(key, session)
      // A photo with pixel steps opens on them.
      await session.refreshWorking()
    }
    return {
      key,
      item,
      info,
      isRaw: row.is_raw === 1,
      isHdr: graded.is_hdr,
      asShot: info.as_shot_white,
      // The working frame: an upscale step makes it larger than the file.
      frameWidth: session.frameSize().width,
      frameHeight: session.frameSize().height,
      proxyWidth: px.proxy.width,
      proxyHeight: px.proxy.height,
      recipe: session.recipe,
      snapshots,
      seed: seedOf(row)
    }
  }

  close(key: string): Promise<void> {
    const s = this.sessions.get(key)
    if (!s) return Promise.resolve()
    this.sessions.delete(key)
    return s.close()
  }

  closeAll(): Promise<void> {
    return Promise.all([...this.sessions.keys()].map((k) => this.close(k))).then(() => undefined)
  }

  update(key: string, recipe: Recipe, interactive: boolean, rev?: number): void {
    this.get(key).update(recipe, interactive, rev)
  }

  view(key: string, view: ViewState): void {
    this.get(key).setView(view)
  }

  region(req: RegionRequest): Promise<RegionResult> {
    return this.get(req.key).region(req)
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

  suggestHeal(
    key: string,
    points: SpotPoint[],
    radius: number,
    feather: number,
    kind: 'heal' | 'clone'
  ): Promise<SpotPoint> {
    return this.get(key).suggestHeal(points, radius, feather, kind)
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

  /** Save an open session's recipe now; resolves once it is saved. */
  flush(key: string): Promise<void> {
    return this.sessions.get(key)?.persist() ?? Promise.resolve()
  }
}

export { RAW_DEVELOP }
