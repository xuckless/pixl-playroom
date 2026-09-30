/**
 * Enhance (the wheel's last tool): the engine's enhance chain — a JPEG
 * rebuilt from its coefficients, FBCNN's JPEG restore, NAFNet's deblur,
 * Real-ESRGAN's super-resolution, whichever are chosen, in that order — run
 * over a photo's *original*, before any grade (the models want
 * display-referred pixels), into a new 16-bit TIFF beside it. The new file
 * joins the folder with the source's recipe copied over, so the look carries
 * across, as Lightroom's Enhance does. The steps and their numbers are
 * `shared/enhance.ts`'s.
 */
import log from 'electron-log/main'
import { unlink } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { EnhanceStep, EnhancerRef, SourceInfo, UpscalerRef } from '../shared/engine-types'
import { PRESERVE_ALL } from '../shared/engine-types'
import type { AiStartRequest } from '../shared/ai'
import { baseWhite } from '../shared/compile'
import {
  chainSubject,
  enhanceRefusal,
  estimateMs,
  FALLBACK_JPEG_QUALITY,
  fbcnnQuality,
  learnRates,
  planSteps,
  reconstructParams,
  type EnhanceRates,
  type EnhanceSettings,
  type PlannedStep
} from '../shared/enhance'
import { relativeFromOp } from '../shared/wb'
import { Cancelled, type AiContext, type AiRunner } from './ai/jobs'
import type { EngineClient } from './engine/client'
import type { IndexClient } from './indexer/client'
import type { EngineStatus } from '../shared/ipc'
import { exists } from './exists'
import { ModelMissing, type ModelStore } from './ai/models'
import type { Library } from './library'
import {
  BACKGROUND_THREADS,
  blankRequest,
  RAW_DEVELOP,
  sourceOrientation,
  uprightFraming
} from './source'
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

/** A name beside the original that is not taken: IMG-Enhanced.tif, IMG-Enhanced-2.tif… */
async function freeName(dir: string, stem: string): Promise<string> {
  for (let n = 1; ; n++) {
    const out = join(dir, `${stem}-Enhanced${n > 1 ? `-${n}` : ''}.tif`)
    if (!(await exists(out))) return out
  }
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
    private readonly settings: IndexClient
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

  async run(ctx: AiContext, req: EnhanceRequest): Promise<{ kind: 'file'; path: string }> {
    const { key, settings } = req
    ctx.stage('model', 0, 'Checking the models')
    const avail = enhanceAvailability(this.status())
    if (!avail.available) throw new Error(avail.reason ?? 'unavailable')
    const row = await this.library.photoRow(key)
    const info = await this.library.probe(row)
    const isJpeg = info.input === 'Jpeg'
    const refused = enhanceRefusal(settings, { isJpeg, isHdr: info.is_hdr })
    if (refused) throw new Error(`${row.name}: ${refused}`)
    const steps = planSteps(settings, isJpeg)
    const ids = steps.flatMap((p) => (p.model ? [p.model] : []))
    for (const id of ids)
      if (!(await this.models.installed(id))) throw new ModelMissing(this.models.entry(id))
    const out = await freeName(dirname(row.path), basename(row.name, extname(row.name)))
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    if (ctx.signal.aborted) throw new Cancelled()
    const raw = info.input === 'Raw' ? RAW_DEVELOP : null
    const orientation = sourceOrientation(info, raw)
    const convert = async (onCpu: ReadonlySet<string>): Promise<unknown> =>
      this.engine.convert(
        {
          ...blankRequest(row.path, out, info.input, info),
          raw,
          enhance: await chainOf(this.models, steps, settings, info, onCpu),
          pixel: { depth: 'Sixteen', channels: 3 },
          encode: { Tiff: { compression: 'Deflate' } },
          metadata: raw ? { ...PRESERVE_ALL, icc: true } : PRESERVE_ALL,
          color: 'Preserve',
          framing: uprightFraming(orientation, info),
          threads: BACKGROUND_THREADS * 2
        },
        { signal: ctx.signal }
      )
    // The engine says nothing until it is done: the bar follows the clock.
    const rates = await enhanceRates(this.settings)
    const expected = Math.max(1000, estimateMs(steps, info.width, info.height, rates))
    const t0 = Date.now()
    ctx.stage('enhance', 0, `${chainSubject(steps)} · ${row.name}`)
    const tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, expected), true), 250)
    try {
      try {
        await this.models.withCpuFallback(ids, convert, ctx.signal)
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled()
        throw err
      }
      if (ctx.signal.aborted) throw new Cancelled()
      void this.settings
        .setSetting(RATE_KEY, learnRates(steps, rates, Date.now() - t0, expected))
        .catch(() => {})
      ctx.stage('save', 0.2, 'Adding it to the folder')
      // The enhanced file starts with the source's look.
      const recipe = await this.library.recipe(key)
      recipe.geometry = { ...recipe.geometry, quarterTurns: 0, flipHorizontal: false }
      // A RAW's absolute white balance becomes the same white as relative
      // sliders: the enhanced file was developed with the as-shot white.
      if (raw && recipe.wb.mode === 'custom') {
        const op = baseWhite(recipe, { isRaw: true, asShot: info.as_shot_white })
        const rel = op ? relativeFromOp(op) : { temperature: 0, tint: 0 }
        recipe.wb = {
          mode: 'custom',
          temperature: Math.round(rel.temperature),
          tint: Math.round(rel.tint),
          preset: null
        }
      }
      await this.library.index.seedRecipe(out, recipe)
      await this.library.openFolder(dirname(row.path))
      return { kind: 'file', path: out }
    } catch (err) {
      // Half a file is no file.
      await unlink(out).catch(() => {})
      if (!(err instanceof Cancelled)) log.warn('enhance failed', row.name, err)
      throw err
    } finally {
      clearInterval(tick)
    }
  }
}
