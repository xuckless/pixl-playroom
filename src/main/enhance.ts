/**
 * Enhance → Super Resolution: the engine's generative upscaler (Real-ESRGAN
 * ×2, downloaded on first use, on the ONNX Runtime the engine ships) enlarges a photo's
 * *original*, before any grade — the model wants display-referred pixels and
 * the engine refuses a grade beside it — into a new 16-bit TIFF beside the
 * original. The new file joins the folder with the source's recipe copied
 * over, so the look carries across, as Lightroom's Enhance does.
 */
import log from 'electron-log/main'
import { unlink } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import type { UpscalerRef } from '../shared/engine-types'
import { PRESERVE_ALL } from '../shared/engine-types'
import type { AiStartRequest } from '../shared/ai'
import { baseWhite } from '../shared/compile'
import { relativeFromOp } from '../shared/wb'
import { Cancelled, type AiContext, type AiRunner } from './ai/jobs'
import type { EngineClient } from './engine/client'
import type { IndexClient } from './indexer/client'
import type { EngineStatus } from '../shared/ipc'
import { exists } from './exists'
import { modelName, type ModelStore } from './ai/models'
import type { Library } from './library'
import { BACKGROUND_THREADS, blankRequest, RAW_DEVELOP, sourceOrientation } from './source'
import { estimate } from '../shared/ai'

/** The model Super Resolution runs (the roster's id). */
export const UPSCALER = 'real-esrgan-x2plus'

export interface EnhanceAvailability {
  available: boolean
  reason?: string
}

/**
 * Whether Super Resolution can run: an engine built with its model support,
 * the ONNX Runtime it ships (0.15+) and the model, downloaded.
 */
export async function enhanceAvailability(
  status: EngineStatus,
  models: ModelStore
): Promise<EnhanceAvailability> {
  if (status.enhance !== true)
    return { available: false, reason: 'this build of the engine has no generative upscaler' }
  if (!status.runtime)
    return { available: false, reason: 'this build of the engine ships no ONNX Runtime' }
  if (!(await models.installed(UPSCALER)))
    return {
      available: false,
      reason: `download ${modelName(models.entry(UPSCALER))} in Settings → AI models`
    }
  return { available: true }
}

type EnhanceRequest = Extract<AiStartRequest, { task: 'enhance' }>

/** How long a megapixel takes, remembered between runs, for the estimated progress. */
const RATE_KEY = 'ai.enhance.msPerMp'
const FIRST_GUESS_MS_PER_MP = 1500

/**
 * Enhance as an AI job: Model (load and check) → Upscale (the engine's
 * run, its progress estimated from the photo's size and how fast the last
 * runs went) → Save (the new file joins the folder with the look). It runs
 * in its own engine process; cancelling stops the engine between model
 * tiles, and a cancelled or failed run leaves no half-written file.
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
      { id: 'model', label: 'Model', weight: 0.08 },
      { id: 'upscale', label: 'Upscale', weight: 0.84 },
      { id: 'save', label: 'Save', weight: 0.08 }
    ]
  }

  title(): { title: string; subject: string } {
    return { title: 'Enhancing', subject: 'Super Resolution ×2' }
  }

  async run(ctx: AiContext, req: EnhanceRequest): Promise<{ kind: 'file'; path: string }> {
    const { key } = req
    ctx.stage('model', 0, 'Loading the model')
    const avail = await enhanceAvailability(this.status(), this.models)
    if (!avail.available) throw new Error(avail.reason ?? 'unavailable')
    const row = await this.library.photoRow(key)
    const info = await this.library.probe(row)
    // The model wants display-referred SDR; the engine refuses PQ/HLG pixels
    // for it by name. Say so up front rather than failing mid-run.
    if (info.is_hdr)
      throw new Error(
        `${row.name}: HDR photos can't be enhanced yet — export an SDR copy and enhance that`
      )
    const stem = basename(row.name, extname(row.name))
    const out = join(dirname(row.path), `${stem}-Enhanced-SR.tif`)
    if (await exists(out)) throw new Error(`${basename(out)} already exists`)
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    if (ctx.signal.aborted) throw new Cancelled()
    const raw = info.input === 'Raw' ? RAW_DEVELOP : null
    const orientation = sourceOrientation(info, raw)
    const upscaler = (await this.models.ref(
      UPSCALER,
      req.cpu ? 'Cpu' : undefined
    )) as unknown as UpscalerRef
    const tryRun = (up: UpscalerRef): Promise<unknown> =>
      this.engine.convert(
        {
          ...blankRequest(row.path, out, info.input, info),
          raw,
          resize: { Scale: { factor: 2 } },
          resampler: 'Ai',
          upscaler: up,
          pixel: { depth: 'Sixteen', channels: 3 },
          encode: { Tiff: { compression: 'Deflate' } },
          metadata: raw ? { ...PRESERVE_ALL, icc: true } : PRESERVE_ALL,
          color: 'Preserve',
          framing:
            orientation === 'Normal'
              ? null
              : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
          threads: BACKGROUND_THREADS * 2
        },
        { signal: ctx.signal }
      )
    // The engine says nothing until it is done: the bar follows the clock.
    const mp = (info.width * info.height) / 1e6
    const rate = await this.rate()
    const expected = Math.max(1000, mp * rate)
    const t0 = Date.now()
    ctx.stage('upscale', 0, `Upscaling ${row.name}`)
    const tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, expected), true), 250)
    try {
      try {
        await tryRun(upscaler)
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled()
        // A provider the runtime cannot register is an error, never a silent
        // CPU run — so the retry on the CPU is the app's, and it says so.
        if (upscaler.model.provider !== 'Cpu' && /provider/i.test((err as Error).message)) {
          log.warn('enhance: accelerated provider unavailable, retrying on the CPU', err)
          ctx.stage('upscale', 0, 'GPU provider unavailable — running on the CPU')
          await tryRun({ ...upscaler, model: { ...upscaler.model, provider: 'Cpu' } })
        } else throw err
      }
      if (ctx.signal.aborted) throw new Cancelled()
      const measured = (Date.now() - t0) / Math.max(0.1, mp)
      void this.settings
        .setSetting(RATE_KEY, Math.round(0.6 * measured + 0.4 * rate))
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
      // Half a file blocks the next try ("already exists"): it goes.
      await unlink(out).catch(() => {})
      throw err
    } finally {
      clearInterval(tick)
    }
  }

  private async rate(): Promise<number> {
    const r: unknown = await this.settings.getSetting(RATE_KEY).catch(() => undefined)
    return typeof r === 'number' && r > 0 ? r : FIRST_GUESS_MS_PER_MP
  }
}
