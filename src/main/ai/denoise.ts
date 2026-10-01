/**
 * AI noise reduction as a pixel step (shared/pixels.ts): a restoring model
 * (SCUNet, blind; or DRUNet, told the noise it measures) run once over the
 * photo's pixels as they are (earlier steps laid on), its result kept in the
 * photo's project, and a step added to the recipe. From then on it undoes,
 * redoes and hides in History, and changes Strength, without the model ever
 * running again; the project carries it wherever the photo goes.
 *
 * Inside a mask, the mask as it is now is frozen with the step (freeze.ts):
 * only there is the photo denoised.
 *
 * The develop view sees a whole-photo denoise long before it is done: the
 * draft (≤ 1280 px) denoised first, shown while the full resolution is made.
 *
 * A RAW's result is stored losslessly, always: it is the RAW's developed,
 * linear pixels (white balance, camera profile and tone curve still to come
 * in the grade), and its latitude is the point of a RAW. Anything else is
 * stored near-losslessly by default (JPEG XL at distance 0.1, a sixth of a
 * lossless one's size), or losslessly when the setting `pixels.lossless` says so. What is laid over the photo is always the stored
 * result decoded, never the model's output itself: what the photo shows now
 * is what it shows after a reload, on another machine, from the project alone.
 */
import { readFile, rm } from 'fs/promises'
import { join } from 'path'
import type { AiStartRequest } from '../../shared/ai'
import { estimate } from '../../shared/ai'
import type { EnhancerRef } from '../../shared/engine-types'
import { pixelStepRefusal, type PixelStep } from '../../shared/pixels'
import { hash32, newId, type AiDenoiseModel, type Recipe } from '../../shared/recipe'
import { exists } from '../exists'
import type { EngineClient } from '../engine/client'
import type { IndexClient } from '../indexer/client'
import { keyOf, parseKey } from '../keys'
import type { Library } from '../library'
import { paths } from '../paths'
import { ensureProxies, type ProxyFile } from '../proxy'
import type { DevelopSessions } from '../render'
import { BACKGROUND_THREADS, blankRequest, seedOf, versionStamp } from '../source'
import { ensureBase, pixelDeps } from '../pixels/base'
import { freezeMask } from '../pixels/freeze'
import { addPixelStep, storesLossless } from '../pixels/steps'
import { ensureWorking } from '../pixels/working'
import { Cancelled, type AiContext, type AiRunner } from './jobs'
import { ModelMissing, modelName, type ModelStore } from './models'

export const DENOISE_SHORT: Record<AiDenoiseModel, string> = {
  'scunet-color-real': 'SCUNet',
  'drunet-color': 'DRUNet'
}

/** The setting: store pixel steps' images losslessly (true) or near-losslessly (default). */
export const LOSSLESS_KEY = 'pixels.lossless'

/** The model's engine reference, at full strength (the step's opacity is its Strength). */
async function enhancer(
  models: ModelStore,
  model: AiDenoiseModel,
  cpu: boolean
): Promise<EnhancerRef> {
  if (!(await models.installed(model))) throw new ModelMissing(models.entry(model))
  const ref = (await models.ref(model, cpu ? 'Cpu' : undefined, {
    // DRUNet is told the noise: the engine measures it on each tile's input,
    // luma σ scaled to the per-channel σ the model wants.
    noise: { MeasuredNoise: { gain: 1.33 } }
  })) as unknown as EnhancerRef
  return { ...ref, strength: 1 }
}

const TIFF = { Tiff: { compression: 'None' } } as const
const ICC_ONLY = { exif: false, icc: true, xmp: false, iptc: false } as const

/** The model over `from`, written as a 16-bit TIFF at `out`. */
async function denoise(
  engine: EngineClient,
  models: ModelStore,
  model: AiDenoiseModel,
  from: ProxyFile,
  out: string,
  signal: AbortSignal,
  threads: number
): Promise<ProxyFile> {
  const r = await models.withCpuFallback(
    [model],
    async (onCpu) =>
      engine.convert(
        {
          ...blankRequest(from.path, out, from.input),
          enhance: [{ Model: await enhancer(models, model, onCpu.has(model)) }],
          pixel: { depth: 'Sixteen', channels: 3 },
          encode: TIFF,
          metadata: ICC_ONLY,
          color: 'Preserve',
          threads
        },
        { signal }
      ),
    signal
  )
  return { path: out, input: 'Tiff', width: r.width, height: r.height }
}

/**
 * The full-resolution result AI denoise made before it was a step (kept per
 * photo version, model and strength under `denoise-<key>/`), when it is still
 * there and the photo's size.
 */
async function legacyMaster(
  dir: string,
  version: string,
  model: AiDenoiseModel,
  strength: number,
  frame: ProxyFile
): Promise<string | null> {
  const key = hash32(JSON.stringify([version, model, Math.round(strength)])).toString(16)
  const meta = join(dir, `denoise-${key}`, 'set.json')
  try {
    const set = JSON.parse(await readFile(meta, 'utf8')) as { master?: ProxyFile | null }
    const m = set.master
    if (!m || m.width !== frame.width || m.height !== frame.height) return null
    return (await exists(m.path)) ? m.path : null
  } catch {
    return null
  }
}

type DenoiseRequest = Extract<AiStartRequest, { task: 'denoise' }>

/** How long a megapixel of the full-resolution step takes, per model, remembered between runs. */
const RATE_KEY = 'ai.denoise.msPerMp'
const FIRST_GUESS_MS_PER_MP: Record<string, number> = {
  'scunet-color-real': 27000,
  'drunet-color': 9000
}

/**
 * AI denoise as an AI job: Model → Preview (a whole-photo one: the develop
 * view shows it) → Full resolution (its progress estimated from the photo's
 * size and how fast earlier runs went) → Save (stored in the project, the
 * step added). Cancelling stops the engine between model tiles; nothing is
 * added then.
 */
export class DenoiseRunner implements AiRunner<DenoiseRequest> {
  readonly task = 'denoise' as const

  constructor(
    private readonly library: Library,
    private readonly engine: EngineClient,
    private readonly models: ModelStore,
    private readonly settings: IndexClient,
    private readonly sessions: () => DevelopSessions | undefined
  ) {}

  stages(): { id: string; label: string; weight: number }[] {
    return [
      { id: 'model', label: 'Model', weight: 0.05 },
      { id: 'preview', label: 'Preview', weight: 0.15 },
      { id: 'full', label: 'Full resolution', weight: 0.7 },
      { id: 'save', label: 'Save', weight: 0.1 }
    ]
  }

  title(req: DenoiseRequest): { title: string; subject: string } {
    return { title: 'Denoising', subject: DENOISE_SHORT[req.model] ?? 'AI' }
  }

  async run(ctx: AiContext, req: DenoiseRequest): Promise<{ kind: 'step'; label: string }> {
    const sessions = this.sessions()
    const recipe: Recipe = sessions?.liveRecipe(req.key) ?? (await this.library.recipe(req.key))
    const layer = req.layerId ? recipe.layers.find((l) => l.id === req.layerId) : undefined
    if (req.layerId && !layer) throw new Error('the mask is gone')
    ctx.stage('model', 0, `Loading ${modelName(this.models.entry(req.model))}`)
    const row = await this.library.photoRow(req.key)
    const info = await this.library.probe(row)
    const refused = pixelStepRefusal(info)
    if (refused) throw new Error(refused)
    if (!(await this.models.installed(req.model)))
      throw new ModelMissing(this.models.entry(req.model))
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    const guard = <T>(p: Promise<T>): Promise<T> =>
      p.catch((err) => {
        if (ctx.signal.aborted) throw new Cancelled()
        throw err
      })
    const tick = (expected: number): (() => void) => {
      const t0 = Date.now()
      const t = setInterval(() => ctx.progress(estimate(Date.now() - t0, expected), true), 250)
      return () => clearInterval(t)
    }

    // The pixels it runs on: the photo with the steps it already has.
    const deps = pixelDeps(this.engine, this.library.index, row)
    const plain = await ensureProxies(this.engine, row, info)
    const working = await guard(
      ensureWorking(deps, versionStamp(row), plain, recipe.pixels, () =>
        ensureBase(this.engine, row, info)
      )
    )
    const master = working.master!
    const dir = paths.photoCache(row.id)
    const stamp = Date.now().toString(36)
    const rate = await this.rate(req.model)
    const files: string[] = []
    try {
      // A whole-photo denoise shows at once, from the draft.
      if (!layer && sessions) {
        ctx.stage('preview', 0, 'Denoising a preview')
        const draft = working.px.draft
        const stop = tick(Math.max(1500, ((draft.width * draft.height) / 1e6) * rate))
        try {
          const out = join(dir, `denoise-preview-${stamp}.tiff`)
          files.push(out)
          const preview = await guard(
            denoise(this.engine, this.models, req.model, draft, out, ctx.signal, BACKGROUND_THREADS)
          )
          sessions.pixelPreview(req.key, preview)
        } finally {
          stop()
        }
      }

      ctx.stage('full', 0, 'Denoising at full resolution')
      const mp = (master.width * master.height) / 1e6
      // What the old setting made, when a photo from before steps still has it.
      const kept =
        req.legacy && recipe.pixels.length === 0
          ? await legacyMaster(dir, versionStamp(row), req.model, req.strength, master)
          : null
      const result = kept ?? join(dir, `denoise-${stamp}.tiff`)
      if (!kept) {
        files.push(result)
        const stop = tick(Math.max(3000, mp * rate))
        const t0 = Date.now()
        try {
          await guard(
            denoise(
              this.engine,
              this.models,
              req.model,
              master,
              result,
              ctx.signal,
              BACKGROUND_THREADS * 2
            )
          )
        } finally {
          stop()
        }
        void this.remember(
          req.model,
          Math.round(0.6 * ((Date.now() - t0) / Math.max(0.1, mp)) + 0.4 * rate)
        )
      }

      ctx.stage('save', 0, 'Keeping it in the project')
      // A RAW's result is its developed, linear pixels: kept losslessly, so
      // exposure and white balance pushed later show nothing of compression.
      const lossless = await storesLossless(row.is_raw === 1, () =>
        this.settings.getSetting(LOSSLESS_KEY)
      )
      const jxl = join(dir, `denoise-${stamp}.jxl`)
      files.push(jxl)
      await this.engine.convert({
        ...blankRequest(result, jxl, 'Tiff'),
        pixel: { depth: 'Sixteen', channels: 3 },
        encode: lossless
          ? { JxlLossless: { effort: 3, threads: BACKGROUND_THREADS * 2 } }
          : { JxlLossy: { distance: 0.1, effort: 5, threads: BACKGROUND_THREADS * 2 } },
        metadata: ICC_ONLY,
        color: 'Preserve'
      })
      const key = keyOf(row.id, null)
      const blob = await this.library.index.putBlob(key, jxl, {
        kind: 'pixels',
        codec: lossless ? 'jxl-lossless' : 'jxl',
        width: master.width,
        height: master.height
      })
      ctx.progress(0.5)
      let alpha: string | null = null
      if (layer) {
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
        alpha = await this.library.index.putBlob(key, plane, {
          kind: 'mask',
          codec: 'png',
          width: master.width,
          height: master.height
        })
      }
      const name = DENOISE_SHORT[req.model]
      const step: PixelStep = {
        id: newId(),
        kind: 'denoise',
        label: layer ? `AI Denoise · ${name} in ${layer.name}` : `AI Denoise · ${name}`,
        blob,
        alpha,
        scope: layer?.name ?? null,
        // The old setting's result has its strength in it already.
        opacity: kept ? 100 : Math.max(1, Math.min(100, Math.round(req.strength))),
        width: master.width,
        height: master.height,
        rect: null,
        params: { model: req.model, lossless }
      }
      // Computed on the steps there were when it began: it goes after them,
      // under any (a heal) added while it ran.
      await addPixelStep(
        this.library,
        this.sessions(),
        req.key,
        step,
        recipe.pixels.map((s) => s.id)
      )
      const { photoId, copyId } = parseKey(req.key)
      this.library.queueThumb(photoId, copyId, true)
      return { kind: 'step', label: step.label }
    } finally {
      await sessions?.clearPreview(req.key).catch(() => undefined)
      for (const f of files) await rm(f, { force: true }).catch(() => undefined)
    }
  }

  private async rate(model: string): Promise<number> {
    const all: unknown = await this.settings.getSetting(RATE_KEY).catch(() => null)
    const r = all && typeof all === 'object' ? (all as Record<string, number>)[model] : undefined
    return typeof r === 'number' && r > 0 ? r : (FIRST_GUESS_MS_PER_MP[model] ?? 6000)
  }

  private async remember(model: string, msPerMp: number): Promise<void> {
    const all: unknown = await this.settings.getSetting(RATE_KEY).catch(() => null)
    const next = { ...(all && typeof all === 'object' ? all : {}), [model]: msPerMp }
    await this.settings.setSetting(RATE_KEY, next).catch(() => undefined)
  }
}
