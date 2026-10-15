/**
 * Enhance (the wheel's last tool): the engine's enhance chain — a JPEG
 * rebuilt from its coefficients, FBCNN's JPEG restore, NAFNet's deblur,
 * PIXL Enhance (where the roster offers it, in their place), Real-ESRGAN's
 * super-resolution, whichever are chosen, in that order — run
 * once over the photo's pixels as they are (its earlier steps laid on), before
 * any grade, and kept in its project as a pixel step (shared/pixels.ts): it
 * undoes, redoes and hides in History like any edit, and no file is written
 * beside the photo. An upscale makes the photo's frame larger from that step
 * on. Deblur and restore can keep to a mask (frozen as it is when made).
 * The steps and their numbers are `shared/enhance.ts`'s.
 */
import { stepDevelopMark } from './developmark'
import { t, tk } from '../shared/i18n'
import log from 'electron-log/main'
import { rm } from 'fs/promises'
import { join } from 'path'
import type {
  ConvertReport,
  EnhanceStep,
  EnhancerRef,
  SourceInfo,
  UpscalerRef
} from '../shared/engine-types'
import type { AiStartRequest } from '../shared/ai'
import { activeSteps, type PixelStep } from '../shared/pixels'
import { newId, type Recipe } from '../shared/recipe'
import {
  chainSubject,
  enhanceRefusal,
  estimateMs,
  jpegRestoreRefusal,
  learnRates,
  pixlModelStep,
  planSteps,
  readsFloat,
  reconstructParams,
  scaleOf,
  type EnhanceRates,
  type EnhanceSettings,
  type PlannedStep
} from '../shared/enhance'
import { Cancelled, type AiContext, type AiRunner } from './ai/jobs'
import type { EngineClient } from './engine/client'
import type { IndexClient } from './indexer/client'
import type { EngineStatus } from '../shared/ipc'
import { ModelMissing, type ModelStore } from './ai/models'
import type { Library } from './library'
import {
  BACKGROUND_THREADS,
  heavyThreads,
  blankRequest,
  colourOf,
  seedOf,
  sourceOrientation,
  uprightFraming,
  versionStamp
} from './source'
import { exposureOffsetOf } from '../shared/rawcolour'
import { LOSSLESS_KEY } from './ai/denoise'
import { keyOf, parseKey } from './keys'
import { paths } from './paths'
import { ensureProxies } from './proxy'
import type { DevelopSessions } from './render'
import { askOf } from './ai/rawdevelop'
import { ensureBase, pixelDeps } from './pixels/base'
import { freezeMask } from './pixels/freeze'
import { addPixelStep, replacePixelStep, storesLossless } from './pixels/steps'
import { ensureWorking, guardPatch, modelInput, rasterOf } from './pixels/working'
import { levelValues, PIXL_ENHANCE } from '../shared/pixlenhance'
import type { PhotoRow } from './db'
import type { ProxyFile } from './proxy'

const TIFF = { Tiff: { compression: 'None' } } as const
const ICC_ONLY = { exif: false, icc: true, xmp: false, iptc: false } as const
import { ENHANCE_RATE_KEY } from './ai/rates'
import { stageBar } from './ai/stagebar'

export interface EnhanceAvailability {
  available: boolean
  reason?: string
}

/**
 * Whether Enhance can run at all: an engine built with its model support and
 * the ONNX Runtime it ships. Each step's model is offered where it is chosen.
 */
export function enhanceAvailability(status: EngineStatus): EnhanceAvailability {
  if (status.enhance !== true)
    return { available: false, reason: t('this build of the engine runs no models') }
  if (!status.runtime)
    return { available: false, reason: t('this build of the engine ships no ONNX Runtime') }
  return { available: true }
}

type EnhanceRequest = Extract<AiStartRequest, { task: 'enhance' }>

/** How long each step takes per megapixel, remembered between runs, for the estimate. */
export const RATE_KEY = ENHANCE_RATE_KEY

/** The remembered speeds (an older build kept one number for ×2). */
export async function enhanceRates(settings: IndexClient): Promise<EnhanceRates> {
  const r: unknown = await settings.getSetting(RATE_KEY).catch(() => null)
  return r && typeof r === 'object' ? (r as EnhanceRates) : {}
}

/** The chain the engine runs, the models' references filled in. */
async function chainOf(
  models: ModelStore,
  steps: PlannedStep[],
  s: EnhanceSettings,
  info: SourceInfo,
  onCpu: ReadonlySet<string>
): Promise<EnhanceStep[]> {
  const out: EnhanceStep[] = []
  for (const p of steps) {
    if (p.kind === 'reconstruct') {
      const sub = info.jpeg?.subsampling
      out.push({
        JpegReconstruct: {
          ...reconstructParams(s.smoothing),
          // Required exactly when the file subsamples chroma.
          chroma:
            sub === 'Half' || sub === 'Quarter'
              ? s.guidedChroma
                ? { LumaGuided: { radius: 2, epsilon: 0.001 } }
                : 'Triangle'
              : null
        }
      })
      continue
    }
    const id = p.model!
    if (!(await models.installed(id))) throw new ModelMissing(models.entry(id))
    const provider = onCpu.has(id) ? ('Cpu' as const) : undefined
    if (p.scale) {
      out.push({ Upscale: (await models.ref(id, provider)) as unknown as UpscalerRef })
      continue
    }
    if (p.level) {
      // PIXL Enhance: the level's planes and tiling, as the roster states them
      // (shared/pixlenhance.ts). On CoreML the tile is fixed at 1024
      // (modelshape.ts) and the level sets the overlap.
      const level = levelValues(models.entry(id), p.level)
      const ref = (await models.ref(id, provider, { ...level })) as unknown as EnhancerRef
      out.push({ Model: pixlModelStep(ref, level, s.pixlStrength) })
      continue
    }
    const ref = (await models.ref(id, provider, {})) as unknown as EnhancerRef
    const strength = p.kind === 'deblur' ? s.deblurStrength : s.jpegStrength
    out.push({ Model: { ...ref, strength: Math.min(1, Math.max(0.01, strength / 100)) } })
  }
  return out
}

/**
 * Enhance as an AI job: Model (check and load) → Enhance (the engine's run,
 * its progress estimated from the photo's size and how fast earlier runs
 * went) → Save (the new file joins the folder with the look). It runs in
 * its own engine process; cancelling stops the engine between model tiles,
 * and a cancelled or failed run leaves no half-written file.
 */
export class EnhanceRunner implements AiRunner<EnhanceRequest> {
  readonly task = 'enhance' as const

  constructor(
    private readonly library: Library,
    /** The AI engine: started when first needed. */
    private readonly engine: EngineClient,
    private readonly status: () => EngineStatus,
    private readonly models: ModelStore,
    private readonly settings: IndexClient,
    private readonly sessions: () => DevelopSessions | undefined
  ) {}

  stages(): { id: string; label: string; weight: number }[] {
    return [
      { id: 'model', label: t('Model'), weight: 0.06 },
      { id: 'enhance', label: t('Enhance'), weight: 0.88 },
      { id: 'save', label: t('Save'), weight: 0.06 }
    ]
  }

  title(req: EnhanceRequest): { title: string; subject: string } {
    return { title: t('Enhancing'), subject: chainSubject(planSteps(req.settings, true)) }
  }

  async run(ctx: AiContext, req: EnhanceRequest): Promise<{ kind: 'step'; label: string }> {
    const { key } = req
    // PIXL Enhance only where the roster offers it: a level saved on a
    // development kit's run is not asked of a roster without the model.
    const settings: EnhanceSettings = this.models.offered(PIXL_ENHANCE)
      ? req.settings
      : { ...req.settings, pixl: 'off' }
    ctx.stage('model', 0, t('Checking the models'))
    const avail = enhanceAvailability(this.status())
    if (!avail.available) throw new Error(avail.reason ?? t('unavailable'))
    const sessions = this.sessions()
    // The probe first: it records a RAW's camera colour and moves its saved white with it.
    const row = await this.library.photoRow(key)
    const info = await this.library.probe(row)
    const recipe: Recipe = sessions?.liveRecipe(key) ?? (await this.library.recipe(key))
    // Made again in its place (a rebuild): read from the steps before it, its mask kept.
    const old = req.redo ? recipe.pixels.find((p) => p.id === req.redo) : undefined
    if (req.redo && !old) throw new Error(t('the step is gone'))
    const under = activeSteps(
      old ? recipe.pixels.slice(0, recipe.pixels.indexOf(old)) : recipe.pixels
    )
    const isJpeg = info.input === 'Jpeg'
    const refused =
      enhanceRefusal(settings, { isJpeg, isHdr: info.is_hdr }) ??
      jpegRestoreRefusal(settings, isJpeg, under.length)
    if (refused) throw new Error(`${row.name}: ${refused}`)
    const steps = planSteps(settings, isJpeg)
    const ids = steps.flatMap((p) => (p.model ? [p.model] : []))
    for (const id of ids)
      if (!(await this.models.installed(id))) throw new ModelMissing(this.models.entry(id))
    const k = scaleOf(settings)
    // An upscale is the whole photo; deblur and restore can keep to a mask.
    const layer =
      req.layerId && k === 1 && !old ? recipe.layers.find((l) => l.id === req.layerId) : undefined
    if (req.layerId && k === 1 && !old && !layer) throw new Error(t('the mask is gone'))
    // The photo before it, a Version to step back to (a smart look's part:
    // the look made one before it began; a step made again: the rebuild did).
    if (!req.group && !old)
      await this.library.addVersion(key, {
        name: tk('Before Enhance'),
        kind: 'auto',
        reason: 'ai',
        recipe
      })
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    if (ctx.signal.aborted) throw new Cancelled()

    // What the chain reads: the photo's pixels as they are (its steps laid
    // on), or, to restore a JPEG, the file itself (its compressed data is
    // what is restored, so it can only be the first step).
    const deps = pixelDeps(this.engine, this.library.index, row)
    const restoresJpeg = steps.some((p) => p.kind === 'reconstruct' || p.kind.startsWith('fbcnn'))
    const plain = await ensureProxies(this.engine, row, info, BACKGROUND_THREADS)
    const working = await ensureWorking(deps, versionStamp(row), plain, under, () =>
      ensureBase(this.engine, row, info, askOf(recipe))
    )
    const master = working.master!
    const dir = paths.photoCache(row.id)
    const stamp = Date.now().toString(36)
    const out = join(dir, `enhance-${stamp}.tiff`)
    const files = [out]
    const convert = async (onCpu: ReadonlySet<string>): Promise<ConvertReport> => {
      const chain = await chainOf(this.models, steps, settings, info, onCpu)
      const common = {
        enhance: chain,
        pixel: { depth: 'Sixteen' as const, channels: 3 as const },
        encode: TIFF,
        metadata: ICC_ONLY,
        color: 'Preserve' as const,
        threads: heavyThreads(),
        // ×2 is the ×4 model brought down by half on the enlarged frame
        // (engine 0.18 retired its own ×2 model).
        ...(k === 2
          ? {
              resize: { Scale: { factor: 0.5 } },
              resampler: 'Lanczos3' as const,
              linear_resample: true
            }
          : {})
      }
      if (restoresJpeg) {
        const orientation = sourceOrientation(info, null)
        return this.engine.convert(
          {
            ...blankRequest(row.path, out, info.input, info),
            ...common,
            framing: uprightFraming(orientation, info)
          },
          { signal: ctx.signal, onProgress: counted.onProgress }
        )
      }
      // PIXL Enhance alone reads a RAW's float frame as it is (engine 0.21.0,
      // E70): the highlights' real shape around white, not a clipped plateau,
      // and no clipped copy to make. Any other chain reads it clipped to
      // 0..1. Either way the step is kept in 16 bits and laid back under the
      // frame's headroom guard, its light above white the frame's own.
      const input = readsFloat(steps)
        ? master
        : await modelInput(this.engine, dir, master, heavyThreads())
      return this.engine.convert(
        { ...blankRequest(input.path, out, input.input), ...common },
        { signal: ctx.signal, onProgress: counted.onProgress }
      )
    }
    // The bar follows what the engine counts (E68: the chain's windows, all
    // laid out before the first runs); the clock only until it counts.
    const rates = await enhanceRates(this.settings)
    const expected = Math.max(1000, estimateMs(steps, master.width, master.height, rates))
    const t0 = Date.now()
    ctx.stage('enhance', 0, `${chainSubject(steps)} · ${row.name}`)
    const counted = stageBar(ctx.progress, expected)
    try {
      let report: ConvertReport
      try {
        report = (await this.models.withCpuFallback(ids, convert, ctx.signal)) as ConvertReport
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled()
        throw err
      } finally {
        counted.stop()
      }
      if (ctx.signal.aborted) throw new Cancelled()
      void this.settings
        .setSetting(RATE_KEY, learnRates(steps, rates, Date.now() - t0, expected))
        .catch(() => {})
      noteClipped(report, row.name)

      ctx.stage('save', 0.1, t('Keeping it in the project'))
      const lossless = await storesLossless(row.is_raw === 1, () =>
        this.settings.getSetting(LOSSLESS_KEY)
      )
      const jxl = join(dir, `enhance-${stamp}.jxl`)
      files.push(jxl)
      await this.engine.convert(
        {
          ...blankRequest(out, jxl, 'Tiff'),
          pixel: { depth: 'Sixteen', channels: 3 },
          encode: lossless
            ? { JxlLossless: { effort: 3, threads: heavyThreads() } }
            : { JxlLossy: { distance: 0.1, effort: 5, threads: heavyThreads() } },
          metadata: ICC_ONLY,
          color: 'Preserve'
        },
        { signal: ctx.signal }
      )
      const photoKey = keyOf(row.id, null)
      const blob = await this.library.index.putBlob(photoKey, jxl, {
        kind: 'pixels',
        codec: lossless ? 'jxl-lossless' : 'jxl',
        width: report.width,
        height: report.height
      })
      let alpha: string | null = null
      if (layer) {
        ctx.progress(0.6)
        const plane = await freezeMask(
          deps,
          {
            photoId: row.id,
            isRaw: row.is_raw === 1,
            asShot: info.as_shot_white,
            exposureOffset: exposureOffsetOf(colourOf(row)),
            seed: seedOf(row),
            master
          },
          recipe,
          layer.id
        )
        if (!plane) throw new Error(t('{{name}} selects nothing', { name: layer.name }))
        files.push(plane)
        alpha = await this.library.index.putBlob(photoKey, plane, {
          kind: 'mask',
          codec: 'png',
          width: master.width,
          height: master.height
        })
      }
      const subject = chainSubject(steps)
      const step: PixelStep = {
        id: newId(),
        kind: 'enhance',
        label: layer
          ? t('Enhance · {{subject}} in {{mask}}', { subject, mask: layer.name })
          : t('Enhance · {{subject}}', { subject }),
        blob,
        alpha,
        scope: layer?.name ?? null,
        opacity: 100,
        width: report.width,
        height: report.height,
        rect: null,
        params: {
          chain: subject,
          scale: k,
          resizes: k > 1,
          lossless,
          // Everything it was run with, so a later develop can make it again.
          settings: JSON.stringify(settings),
          ...(row.is_raw === 1 ? { develop: await stepDevelopMark(row, info, askOf(recipe)) } : {})
        }
      }
      ctx.commit()
      if (old) {
        // Its place, frozen mask, strength and name stay: only its pixels (and how) are today's.
        await replacePixelStep(this.library, sessions, key, {
          ...step,
          id: old.id,
          label: old.alpha
            ? t('Enhance · {{subject}} in {{mask}}', { subject, mask: old.scope ?? '' })
            : step.label,
          alpha: old.alpha,
          scope: old.scope,
          opacity: old.opacity,
          ...(old.off ? { off: true as const } : {})
        })
      } else
        // Over the steps there were when it began, under any added while it ran.
        await addPixelStep(
          this.library,
          sessions,
          key,
          step,
          recipe.pixels.map((s) => s.id)
        )
      const { photoId, copyId } = parseKey(key)
      this.library.queueThumb(photoId, copyId, true)
      return { kind: 'step', label: step.label }
    } catch (err) {
      if (!(err instanceof Cancelled)) log.warn('enhance failed', row.name, err)
      throw err
    } finally {
      for (const f of files) await rm(f, { force: true }).catch(() => undefined)
    }
  }
}

/**
 * Light past what a model's encoding reaches (PIXL Enhance: 8× white) is
 * clamped on its way in, and counted: said in the log, not to the user.
 */
function noteClipped(report: ConvertReport, name: string): void {
  const clipped = (report.enhance ?? []).reduce(
    (sum, s) =>
      sum + ('Model' in s ? s.Model.input_clipped : 'Upscale' in s ? s.Upscale.input_clipped : 0),
    0
  )
  if (clipped > 0) log.info('enhance: samples past the model’s reach clamped', clipped, name)
}

/** The side of the square PIXL Enhance's preview makes, in the photo's own pixels. */
export const PREVIEW_EDGE = 1024

/**
 * PIXL Enhance's preview (the panel's "Preview at 100%"): the model run on a
 * square of the full-size frame about `at` (the view's centre, as a fraction
 * of the frame), with its tiles' overlap of the frame around it so the
 * square's edges are made as the whole photo's would be, then laid back on
 * the frame as a step is (16 bits, guarded on a RAW). A RAW's float frame is
 * read as it is, as Apply's is (`readsFloat`). The loupe's 1:1 view
 * reads the result, graded, framed and masked as Apply's step will be. The
 * upscale is not previewed: PIXL Enhance only.
 */
export async function makeEnhancePreview(
  engine: EngineClient,
  models: ModelStore,
  index: IndexClient,
  row: PhotoRow,
  info: SourceInfo,
  frame: ProxyFile,
  settings: EnhanceSettings,
  at: { x: number; y: number },
  signal: AbortSignal = new AbortController().signal
): Promise<ProxyFile & { square: { x: number; y: number; width: number; height: number } }> {
  const steps = planSteps({ ...settings, upscale: 'off' }, false).filter((p) => p.level)
  if (steps.length === 0) throw new Error(t('Choose an Enhance level to preview'))
  if (!(await models.installed(PIXL_ENHANCE))) throw new ModelMissing(models.entry(PIXL_ENHANCE))
  const dir = paths.photoCache(row.id)
  const stamp = Date.now().toString(36)
  const made: string[] = []
  const W = frame.width
  const H = frame.height
  const side = Math.min(PREVIEW_EDGE, W, H)
  const pad = levelValues(models.entry(PIXL_ENHANCE), steps[0].level!).tiling.Fixed.overlap
  const clamp = (v: number, hi: number): number => Math.max(0, Math.min(hi, Math.round(v)))
  const ix = clamp(at.x * W - side / 2, W - side)
  const iy = clamp(at.y * H - side / 2, H - side)
  const ox = Math.max(0, ix - pad)
  const oy = Math.max(0, iy - pad)
  const ow = Math.min(W, ix + side + pad) - ox
  const oh = Math.min(H, iy + side + pad) - oy
  const cut = (
    from: ProxyFile,
    to: string,
    x: number,
    y: number,
    w: number,
    h: number,
    channels: 3 | 4
  ): Promise<ConvertReport> =>
    engine.convert(
      {
        ...blankRequest(from.path, to, from.input),
        // The square's surround from a float frame stays float: the model reads it whole.
        pixel: { depth: channels === 3 && from.float ? 'F32' : 'Sixteen', channels },
        encode: TIFF,
        metadata: ICC_ONLY,
        color: 'Preserve',
        framing: {
          orientation: 'Normal',
          rotate_degrees: 0,
          rotate_resampler: 'Lanczos3',
          crop: {
            x: x / from.width,
            y: y / from.height,
            width: w / from.width,
            height: h / from.height
          }
        },
        threads: heavyThreads()
      },
      { signal }
    )
  try {
    // PIXL Enhance reads a RAW's float frame as it is (E70), as Apply does.
    const input = readsFloat(steps) ? frame : await modelInput(engine, dir, frame, heavyThreads())
    const around = join(dir, `enhance-preview-${stamp}-in.tiff`)
    made.push(around)
    await cut(input, around, ox, oy, ow, oh, 3)
    const enhanced = join(dir, `enhance-preview-${stamp}-out.tiff`)
    made.push(enhanced)
    const ids = [PIXL_ENHANCE]
    await models.withCpuFallback(
      ids,
      async (onCpu) =>
        engine.convert(
          {
            ...blankRequest(around, enhanced, 'Tiff'),
            enhance: await chainOf(models, steps, settings, info, onCpu),
            pixel: { depth: 'Sixteen', channels: 3 },
            encode: TIFF,
            metadata: ICC_ONLY,
            color: 'Preserve',
            threads: heavyThreads()
          },
          { signal }
        ),
      signal
    )
    // The square alone (its surround was only context), as the overlay a step is.
    // Uncompressed (engine 0.21, E33): nothing to deflate, then inflate again.
    const square = join(dir, `enhance-preview-${stamp}-sq.tiff`)
    made.push(square)
    const r = await cut(
      { path: enhanced, input: 'Tiff', width: ow, height: oh },
      square,
      ix - ox,
      iy - oy,
      side,
      side,
      4
    )
    const deps = pixelDeps(engine, index, row)
    const src = await guardPatch(deps, frame, square, { x: ix, y: iy })
    if (src !== square) made.push(src)
    const out = join(dir, `enhance-preview-${stamp}.tiff`)
    await engine.convert(
      {
        ...blankRequest(frame.path, out, frame.input),
        pixel: { depth: frame.float ? 'F32' : 'Sixteen', channels: 3 },
        encode: TIFF,
        metadata: ICC_ONLY,
        color: 'Preserve',
        overlays: [
          {
            source: rasterOf(src),
            rect: { x: ix / W, y: iy / H, width: r.width / W },
            opacity: 1,
            // As a step is laid on: in linear light.
            blend: { mode: 'Normal', space: 'LinearWorking' },
            resampler: 'Lanczos3'
          }
        ],
        threads: heavyThreads()
      },
      { signal }
    )
    log.info('enhance preview made', `${r.width}×${r.height} at ${ix},${iy}`, row.name)
    return {
      path: out,
      input: 'Tiff',
      width: W,
      height: H,
      ...(frame.float ? { float: true } : {}),
      square: { x: ix / W, y: iy / H, width: r.width / W, height: r.height / H }
    }
  } finally {
    for (const f of made) void rm(f, { force: true }).catch(() => undefined)
  }
}
