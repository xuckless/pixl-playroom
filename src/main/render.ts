/**
 * The develop view's renderer. Every preview is a real engine render of the
 * photo's proxy with the compiled recipe — the same compiler and the same
 * engine an export uses — followed by an `analyze` of what was rendered, so
 * the histogram and the hue chart describe the pixels on screen.
 *
 * Renders are coalesced: while one is in flight only the newest recipe waits,
 * and a moving slider renders the small draft proxy; the full proxy follows
 * once the slider settles.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { AUTO_PERCENTILES, autoTone, linearSrgbToRec2020, wbSliders } from '../shared/auto'
import { compile, orientedFrame, type Compiled } from '../shared/compile'
import type {
  AnalyzeRequest,
  ConvertReport,
  ImageStats,
  NoiseEstimate,
  SourceInfo
} from '../shared/engine-types'
import { STRIP_ALL } from '../shared/engine-types'
import {
  IPC,
  type BasicSetting,
  type DevelopSession,
  type RegionRequest,
  type RegionResult,
  type RenderEvent,
  type RenderReport,
  type SampleResult,
  type ViewState
} from '../shared/ipc'
import { defaultRecipe, hash32, newLocalLayer, type Recipe } from '../shared/recipe'
import type { Vec3 } from '../shared/wb'
import { brushPlanes } from './brushes'
import type { PhotoRow } from './db'
import { EngineError, type EngineClient } from './engine/client'
import type { Library } from './library'
import { parseKey } from './library'
import { paths } from './paths'
import { pngToFloats } from './pngio'
import { cacheUrl } from './protocol'
import { ensureMaster, ensureProxies, type Proxies, type ProxyFile } from './proxy'
import { itemOf } from './sidecar'
import {
  blankRequest,
  displayPolicy,
  INTERACTIVE_THREADS,
  RAW_DEVELOP,
  sourceOrientation
} from './source'

type Kind = 'draft' | 'full'

/** How long a slider must rest before the full proxy renders. */
const SETTLE_MS = 180
/** How long an edit must rest before the sidecar is written. */
const SAVE_MS = 600

function reportOf(r: ConvertReport, totalMs: number, notes: string[]): RenderReport {
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
    colorSpace: r.color.space
  }
}

function analyzeRequest(
  path: string,
  input: 'Png' | 'Jpeg' | 'Tiff',
  stride: number
): AnalyzeRequest {
  return {
    source: { Path: path },
    input,
    raw: null,
    domain: 'Encoded',
    bins: 256,
    percentiles: [...AUTO_PERCENTILES, 1, 99],
    clip_low: 0,
    clip_high: 1,
    hue_bins: 36,
    stride,
    transparent: 'Include',
    threads: INTERACTIVE_THREADS,
    weights: null,
    noise: false
  }
}

class Session {
  seq = 0
  view: ViewState = { cropMode: false, before: false, maskLayer: null, targetEdge: 2560 }
  private inflight = false
  private pending: Kind | null = null
  private settle: NodeJS.Timeout | undefined
  private save: NodeJS.Timeout | undefined
  private slot = 0
  private regionSlot = 0
  private beforeKey = ''
  private readonly dir: string
  closed = false

  constructor(
    readonly key: string,
    readonly row: PhotoRow,
    readonly info: SourceInfo,
    readonly px: Proxies,
    public recipe: Recipe,
    private readonly owner: DevelopSessions
  ) {
    this.dir = join(paths.photoCache(row.id), 'renders')
    mkdirSync(this.dir, { recursive: true })
  }

  get isRaw(): boolean {
    return this.row.is_raw === 1
  }

  compileFor(recipe: Recipe, source: ProxyFile, applyCrop: boolean): Compiled {
    const { user } = orientedFrame(recipe, this.px.frameWidth, this.px.frameHeight)
    return compile(recipe, {
      isRaw: this.isRaw,
      asShot: this.info.as_shot_white,
      sourceOrientation: 'Normal',
      frameWidth: this.px.frameWidth,
      frameHeight: this.px.frameHeight,
      scale: source.width / this.px.frameWidth,
      seed: hash32(this.row.path),
      brushPaths: brushPlanes(this.row.id, recipe, user),
      applyCrop
    })
  }

  update(recipe: Recipe, interactive: boolean): void {
    this.recipe = recipe
    clearTimeout(this.save)
    this.save = setTimeout(() => this.persist(), SAVE_MS)
    this.schedule(interactive ? 'draft' : 'full')
  }

  persist(): void {
    clearTimeout(this.save)
    this.save = undefined
    try {
      this.owner.library.saveRecipe(this.key, this.recipe)
      const { photoId, copyId } = parseKey(this.key)
      this.owner.library.queueThumb(photoId, copyId, true)
    } catch (err) {
      log.error('saving recipe failed', err)
    }
  }

  setView(view: ViewState): void {
    this.view = view
    this.schedule('full')
  }

  schedule(kind: Kind): void {
    clearTimeout(this.settle)
    if (kind === 'draft') this.settle = setTimeout(() => this.schedule('full'), SETTLE_MS)
    if (this.inflight) {
      this.pending = this.pending === 'full' || kind === 'full' ? 'full' : 'draft'
      return
    }
    void this.run(kind)
  }

  private async run(kind: Kind): Promise<void> {
    this.inflight = true
    try {
      await this.renderPicture(kind)
      if (kind === 'full' && !this.closed) {
        if (this.view.maskLayer) await this.renderMask()
        if (this.view.before) await this.renderBefore()
      }
    } catch (err) {
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
      const next = this.pending
      this.pending = null
      if (next && !this.closed) void this.run(next)
    }
  }

  private source(kind: Kind): ProxyFile {
    if (kind === 'draft') return this.px.draft
    const long = Math.max(this.px.draft.width, this.px.draft.height)
    return this.view.targetEdge <= long ? this.px.draft : this.px.proxy
  }

  private nextFile(stem: string, ext: string): string {
    this.slot = (this.slot + 1) % 6
    return join(this.dir, `${stem}-${this.slot}.${ext}`)
  }

  private async renderPicture(kind: Kind): Promise<void> {
    const t0 = performance.now()
    const src = this.source(kind)
    const compiled = this.compileFor(this.recipe, src, !this.view.cropMode)
    const seq = ++this.seq
    const ext = kind === 'draft' ? 'jpg' : 'png'
    const out = this.nextFile('view', ext)
    const report = await this.owner.engine.convert({
      ...blankRequest(src.path, out, src.input),
      pixel: { depth: 'Eight', channels: 3 },
      encode:
        kind === 'draft'
          ? { Jpeg: { quality: 92, subsampling: 'None', optimize: false } }
          : { Png: { compression: 'Fast', filter: 'Sub' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: displayPolicy(this.info, 'DisplayP3'),
      grade: compiled.grade,
      framing: compiled.framing,
      threads: INTERACTIVE_THREADS
    })
    const stats = await this.owner.engine.analyze(
      analyzeRequest(out, kind === 'draft' ? 'Jpeg' : 'Png', kind === 'draft' ? 2 : 1)
    )
    if (kind === 'full') this.lastFull = out
    if (this.closed) return
    const event: RenderEvent = {
      key: this.key,
      seq,
      kind,
      url: cacheUrl(out, seq),
      width: report.width,
      height: report.height,
      stats,
      report: reportOf(report, Math.round(performance.now() - t0), compiled.notes)
    }
    this.owner.send(IPC.develop.rendered, event)
  }

  /** The chosen layer's mask as a grey plane, and the picture measured inside it. */
  private async renderMask(): Promise<void> {
    const src = this.source('full')
    const compiled = this.compileFor(this.recipe, src, !this.view.cropMode)
    const layerId = this.view.maskLayer
    const index = layerId ? compiled.layerIndex[layerId] : undefined
    if (index === undefined || !compiled.grade) return
    const out = this.nextFile('mask', 'png')
    const report = await this.owner.engine.convert({
      ...blankRequest(src.path, out, src.input),
      pixel: { depth: 'Eight', channels: 1 },
      encode: { Png: { compression: 'Fast', filter: 'Sub' } },
      metadata: STRIP_ALL,
      color: 'Preserve',
      grade: compiled.grade,
      framing: compiled.framing,
      inspect: { LayerMask: { layer: index } },
      hdr: this.info.is_hdr
        ? { reference_white_nits: 203, peak_nits: this.info.peak_nits ?? 1000 }
        : null
    })
    // The picture the renderer shows is the last full render; measure it
    // through the plane. `weights` is an engine feature that may be missing
    // from an older build — the overlay still shows without it.
    let maskStats: ImageStats | undefined
    try {
      const picture = this.lastFull
      maskStats = await this.owner.engine.analyze({
        ...analyzeRequest(picture, 'Png', 1),
        weights: { source: { Png: out }, resampler: 'Bilinear' }
      })
    } catch (err) {
      log.info('masked analysis unavailable', (err as Error).message)
    }
    if (this.closed) return
    this.owner.send(IPC.develop.rendered, {
      key: this.key,
      seq: this.seq,
      kind: 'mask',
      url: cacheUrl(out, `${this.seq}-m`),
      width: report.width,
      height: report.height,
      maskStats
    } satisfies RenderEvent)
  }

  /** The most recent full render's file: what the masked hue chart measures. */
  private lastFull = ''

  /** The default recipe with the same framing: the "before", and the ghost bars. */
  private async renderBefore(): Promise<void> {
    const before = defaultRecipe(this.isRaw)
    before.geometry = structuredClone(this.recipe.geometry)
    const src = this.source('full')
    const key = JSON.stringify([before.geometry, src.path, this.view.cropMode])
    if (key === this.beforeKey) return
    const compiled = this.compileFor(before, src, !this.view.cropMode)
    const out = join(this.dir, `before-${hash32(key).toString(16)}.png`)
    const report = await this.owner.engine.convert({
      ...blankRequest(src.path, out, src.input),
      pixel: { depth: 'Eight', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'Sub' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: displayPolicy(this.info, 'DisplayP3'),
      grade: compiled.grade,
      framing: compiled.framing
    })
    const stats = await this.owner.engine.analyze(analyzeRequest(out, 'Png', 1))
    this.beforeKey = key
    if (this.closed) return
    this.owner.send(IPC.develop.rendered, {
      key: this.key,
      seq: this.seq,
      kind: 'before',
      url: cacheUrl(out, key.length),
      width: report.width,
      height: report.height,
      stats
    } satisfies RenderEvent)
  }

  /** A 1:1 (or smaller) render of part of the full-resolution frame. */
  async region(req: RegionRequest): Promise<RegionResult> {
    const t0 = performance.now()
    const raw = this.isRaw
    const src: ProxyFile = raw
      ? await ensureMaster(this.owner.bgEngine, this.row)
      : {
          path: this.row.path,
          input: this.info.input,
          width: this.px.frameWidth,
          height: this.px.frameHeight
        }
    const { user, width, height } = orientedFrame(
      this.recipe,
      this.px.frameWidth,
      this.px.frameHeight
    )
    const zoom = Math.min(1, req.zoom)
    const compiled = compile(this.recipe, {
      isRaw: raw,
      asShot: this.info.as_shot_white,
      sourceOrientation: raw ? 'Normal' : sourceOrientation(this.info, null),
      frameWidth: this.px.frameWidth,
      frameHeight: this.px.frameHeight,
      scale: zoom,
      seed: hash32(this.row.path),
      brushPaths: brushPlanes(this.row.id, this.recipe, user),
      applyCrop: false
    })
    const x = Math.max(0, Math.min(width - 1, Math.floor(req.x)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(req.y)))
    const w = Math.max(1, Math.min(width - x, Math.ceil(req.width)))
    const h = Math.max(1, Math.min(height - y, Math.ceil(req.height)))
    this.regionSlot = (this.regionSlot + 1) % 4
    const out = join(this.dir, `region-${this.regionSlot}.png`)
    await this.owner.engine.convert({
      ...blankRequest(src.path, out, src.input),
      raw: null,
      resize: zoom < 1 ? { Scale: { factor: zoom } } : 'None',
      pixel: { depth: 'Eight', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'Sub' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: displayPolicy(this.info, 'DisplayP3'),
      grade: compiled.grade,
      framing: compiled.framing ? { ...compiled.framing, rotate_degrees: 0, crop: null } : null,
      region: { x, y, width: w, height: h, margin: 96 }
    })
    return {
      url: cacheUrl(out, `${Date.now()}`),
      x,
      y,
      width: w,
      height: h,
      ms: Math.round(performance.now() - t0)
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
    const cx = Math.round(nx * width)
    const cy = Math.round(ny * height)
    const x = Math.max(0, Math.min(width - 5, cx - 2))
    const y = Math.max(0, Math.min(height - 5, cy - 2))
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
      region: { x, y, width: 5, height: 5, margin: 0 }
    })
    if (!report.output) throw new Error('the engine returned no sample')
    const px = pngToFloats(Buffer.from(report.output))
    const sum: Vec3 = [0, 0, 0]
    const n = px.width * px.height
    for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) sum[c] += px.data[i * px.channels + c]
    const rgb = linearSrgbToRec2020([sum[0] / n, sum[1] / n, sum[2] / n])
    return { linear: rgb, wb: wbSliders(rgb, this.isRaw, this.info.as_shot_white) }
  }

  /** Auto tone: measure the picture with the tone sliders at zero. */
  async autoTone(): Promise<BasicSetting> {
    const flat: Recipe = structuredClone(this.recipe)
    flat.basic = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }
    flat.layers = []
    const src = this.px.draft
    const compiled = this.compileFor(flat, src, true)
    const out = join(this.dir, 'auto-tone.png')
    await this.owner.engine.convert({
      ...blankRequest(src.path, out, src.input),
      pixel: { depth: 'Eight', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'Sub' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: displayPolicy(this.info, 'DisplayP3'),
      grade: compiled.grade,
      framing: compiled.framing
    })
    const stats = await this.owner.engine.analyze(analyzeRequest(out, 'Png', 1))
    return autoTone(stats)
  }

  /**
   * Auto white balance: the mean colour of the photo's near-neutral pixels
   * (low saturation, away from black and clipping), falling back to the
   * whole frame's grey world when too few qualify.
   */
  async autoWb(): Promise<SampleResult['wb']> {
    const src = this.px.draft
    const linearReq: AnalyzeRequest = {
      ...analyzeRequest(src.path, src.input === 'Png' ? 'Png' : 'Tiff', 1),
      domain: 'Linear'
    }
    let means: number[] | null = null
    if (!this.info.is_hdr) {
      try {
        const layer = newLocalLayer('neutral')
        const maskOut = join(this.dir, 'auto-wb-mask.png')
        await this.owner.engine.convert({
          ...blankRequest(src.path, maskOut, src.input),
          pixel: { depth: 'Eight', channels: 1 },
          encode: { Png: { compression: 'Fast', filter: 'Sub' } },
          metadata: STRIP_ALL,
          color: 'Preserve',
          grade: {
            layers: [
              {
                name: layer.name,
                enabled: true,
                opacity: 1,
                blend: { mode: 'Normal', space: 'LinearWorking' },
                mask: {
                  components: [
                    {
                      shape: {
                        Range: {
                          hue: null,
                          saturation: { centre: 0, width: 0.3, softness: 0.1 },
                          luma: { centre: 0.5, width: 0.8, softness: 0.08 },
                          blur_radius: 0,
                          invert: false
                        }
                      },
                      mode: 'Add',
                      opacity: 1,
                      invert: false,
                      feather: { radius: 0, edge: 'Zero' }
                    }
                  ],
                  invert: false,
                  space: {
                    Encoded: {
                      space: 'Srgb',
                      intent: 'RelativeColorimetric',
                      black_point_compensation: false
                    }
                  }
                },
                stages: [
                  {
                    space: 'LinearWorking',
                    ops: [
                      {
                        Primary: {
                          exposure: 0,
                          lift: { r: 0, g: 0, b: 0 },
                          gamma: { r: 1, g: 1, b: 1 },
                          gain: { r: 1, g: 1, b: 1 },
                          contrast: 1,
                          contrast_pivot: 0.18,
                          saturation: 1,
                          hue_shift: 0
                        }
                      }
                    ]
                  }
                ]
              }
            ]
          },
          inspect: { LayerMask: { layer: 0 } }
        })
        const s = await this.owner.engine.analyze({
          ...linearReq,
          weights: { source: { Png: maskOut }, resampler: 'Bilinear' }
        })
        const total = src.width * src.height
        if (s.pixels_measured > total * 0.02) means = s.channel_mean
      } catch (err) {
        log.info('grey-pixel white balance unavailable, using grey world', (err as Error).message)
      }
    }
    if (!means) {
      const s = await this.owner.engine.analyze(linearReq)
      means = s.channel_mean
    }
    return wbSliders([means[0], means[1], means[2]], this.isRaw, this.info.as_shot_white)
  }

  /** The noise the denoiser would measure, on the full-resolution frame. */
  async noise(): Promise<NoiseEstimate | null> {
    const src: ProxyFile = this.isRaw
      ? await ensureMaster(this.owner.bgEngine, this.row)
      : { path: this.row.path, input: this.info.input, width: 0, height: 0 }
    const s = await this.owner.bgEngine.analyze({
      ...analyzeRequest(src.path, 'Png', 1),
      input: src.input,
      raw: null,
      noise: true,
      hue_bins: 1,
      bins: 16,
      percentiles: []
    })
    return s.noise
  }

  close(): void {
    this.closed = true
    clearTimeout(this.settle)
    if (this.save) this.persist()
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
        s.close()
        this.sessions.delete(k)
      }
    }
    const row = this.library.photoRow(key)
    const info = await this.library.probe(row)
    const px = await ensureProxies(this.engine, row, info)
    let session = this.sessions.get(key)
    if (!session) {
      session = new Session(key, row, info, px, this.library.recipe(key), this)
      this.sessions.set(key, session)
    }
    const item = this.library.item(key)
    if (!item) throw new Error(`no item ${key}`)
    const side = itemOf(this.library.sidecar(key), parseKey(key).copyId)
    return {
      key,
      item,
      info,
      isRaw: row.is_raw === 1,
      isHdr: info.is_hdr,
      asShot: info.as_shot_white,
      frameWidth: px.frameWidth,
      frameHeight: px.frameHeight,
      proxyWidth: px.proxy.width,
      proxyHeight: px.proxy.height,
      recipe: session.recipe,
      snapshots: side?.snapshots ?? [],
      seed: hash32(row.path)
    }
  }

  close(key: string): void {
    const s = this.sessions.get(key)
    if (s) {
      s.close()
      this.sessions.delete(key)
    }
  }

  closeAll(): void {
    for (const k of [...this.sessions.keys()]) this.close(k)
  }

  update(key: string, recipe: Recipe, interactive: boolean): void {
    this.get(key).update(recipe, interactive)
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

  /** The recipe an open session holds, which may be newer than the sidecar. */
  liveRecipe(key: string): Recipe | undefined {
    return this.sessions.get(key)?.recipe
  }

  flush(key: string): void {
    this.sessions.get(key)?.persist()
  }
}

export { RAW_DEVELOP }
