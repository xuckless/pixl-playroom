/**
 * Enhance (the wheel's last tool): the engine's enhance chain — a JPEG
 * rebuilt from its coefficients, FBCNN's JPEG restore, NAFNet's deblur,
 * Real-ESRGAN's super-resolution, whichever are chosen, in that order — run
 * once over the photo's pixels as they are (its earlier steps laid on), before
 * any grade, and kept in its project as a pixel step (shared/pixels.ts): it
 * undoes, redoes and hides in History like any edit, and no file is written
 * beside the photo. An upscale makes the photo's frame larger from that step
 * on. Deblur and restore can keep to a mask (frozen as it is when made).
 * The steps and their numbers are `shared/enhance.ts`'s.
 */
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
import type { PixelStep } from '../shared/pixels'
import { newId, type Recipe } from '../shared/recipe'
import {
  chainSubject,
  enhanceRefusal,
  estimateMs,
  FALLBACK_JPEG_QUALITY,
  fbcnnQuality,
  jpegRestoreRefusal,
  learnRates,
  planSteps,
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
  blankRequest,
  seedOf,
  sourceOrientation,
  uprightFraming,
  versionStamp
} from './source'
import { LOSSLESS_KEY } from './ai/denoise'
import { keyOf, parseKey } from './keys'
import { paths } from './paths'
import { ensureProxies } from './proxy'
import type { DevelopSessions } from './render'
import { ensureBase, pixelDeps } from './pixels/base'
import { freezeMask } from './pixels/freeze'
import { addPixelStep, storesLossless } from './pixels/steps'
import { ensureWorking } from './pixels/working'

const TIFF = { Tiff: { compression: 'None' } } as const
const ICC_ONLY = { exif: false, icc: true, xmp: false, iptc: false } as const
import { estimate } from '../shared/ai'

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
    return { available: false, reason: 'this build of the engine runs no models' }
  if (!status.runtime)
    return { available: false, reason: 'this build of the engine ships no ONNX Runtime' }
  return { available: true }
}

type EnhanceRequest = Extract<AiStartRequest, { task: 'enhance' }>

/** How long each step takes per megapixel, remembered between runs, for the estimate. */
export const RATE_KEY = 'ai.enhance.rates'

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
    if (p.kind === 'x2' || p.kind === 'x4' || p.kind === 'x4-wdn') {
      out.push({ Upscale: (await models.ref(id, provider)) as unknown as UpscalerRef })
      continue
    }
    const quality = s.jpegQuality ?? info.jpeg?.quality ?? FALLBACK_JPEG_QUALITY
    const ref = (await models.ref(
      id,
      provider,
      p.kind === 'fbcnn-qf' ? { quality: { Stated: { value: fbcnnQuality(quality) } } } : {}
    )) as unknown as EnhancerRef
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
      { id: 'model', label: 'Model', weight: 0.06 },
      { id: 'enhance', label: 'Enhance', weight: 0.88 },
      { id: 'save', label: 'Save', weight: 0.06 }
    ]
  }

  title(req: EnhanceRequest): { title: string; subject: string } {
    return { title: 'Enhancing', subject: chainSubject(planSteps(req.settings, true)) }
  }

  async run(ctx: AiContext, req: EnhanceRequest): Promise<{ kind: 'step'; label: string }> {
    const { key, settings } = req
    ctx.stage('model', 0, 'Checking the models')
    const avail = enhanceAvailability(this.status())
    if (!avail.available) throw new Error(avail.reason ?? 'unavailable')
    const sessions = this.sessions()
    const recipe: Recipe = sessions?.liveRecipe(key) ?? (await this.library.recipe(key))
    const row = await this.library.photoRow(key)
    const info = await this.library.probe(row)
    const isJpeg = info.input === 'Jpeg'
    const refused =
      enhanceRefusal(settings, { isJpeg, isHdr: info.is_hdr }) ??
      jpegRestoreRefusal(settings, isJpeg, recipe.pixels.length)
    if (refused) throw new Error(`${row.name}: ${refused}`)
    const steps = planSteps(settings, isJpeg)
    const ids = steps.flatMap((p) => (p.model ? [p.model] : []))
    for (const id of ids)
      if (!(await this.models.installed(id))) throw new ModelMissing(this.models.entry(id))
    const k = scaleOf(settings)
    // An upscale is the whole photo; deblur and restore can keep to a mask.
    const layer =
      req.layerId && k === 1 ? recipe.layers.find((l) => l.id === req.layerId) : undefined
    if (req.layerId && k === 1 && !layer) throw new Error('the mask is gone')
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
    const working = await ensureWorking(deps, versionStamp(row), plain, recipe.pixels, () =>
      ensureBase(this.engine, row, info)
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
        threads: BACKGROUND_THREADS * 2
      }
      if (restoresJpeg) {
        const orientation = sourceOrientation(info, null)
        return this.engine.convert(
          {
            ...blankRequest(row.path, out, info.input, info),
            ...common,
            framing: uprightFraming(orientation, info)
          },
          { signal: ctx.signal }
        )
      }
      return this.engine.convert(
        { ...blankRequest(master.path, out, master.input), ...common },
        { signal: ctx.signal }
      )
    }
    // The engine says nothing until it is done: the bar follows the clock.
    const rates = await enhanceRates(this.settings)
    const expected = Math.max(1000, estimateMs(steps, master.width, master.height, rates))
    const t0 = Date.now()
    ctx.stage('enhance', 0, `${chainSubject(steps)} · ${row.name}`)
    const tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, expected), true), 250)
    try {
      let report: ConvertReport
      try {
        report = (await this.models.withCpuFallback(ids, convert, ctx.signal)) as ConvertReport
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled()
        throw err
      } finally {
        clearInterval(tick)
      }
      if (ctx.signal.aborted) throw new Cancelled()
      void this.settings
        .setSetting(RATE_KEY, learnRates(steps, rates, Date.now() - t0, expected))
        .catch(() => {})

      ctx.stage('save', 0.1, 'Keeping it in the project')
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
            ? { JxlLossless: { effort: 3, threads: BACKGROUND_THREADS * 2 } }
            : { JxlLossy: { distance: 0.1, effort: 5, threads: BACKGROUND_THREADS * 2 } },
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
            seed: seedOf(row),
            master
          },
          recipe,
          layer.id
        )
        if (!plane) throw new Error(`${layer.name} selects nothing`)
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
        label: layer ? `Enhance · ${subject} in ${layer.name}` : `Enhance · ${subject}`,
        blob,
        alpha,
        scope: layer?.name ?? null,
        opacity: 100,
        width: report.width,
        height: report.height,
        rect: null,
        params: { chain: subject, scale: k, resizes: k > 1, lossless }
      }
      // Over the steps there were when it began, under any added while it ran.
      ctx.commit()
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
