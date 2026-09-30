/**
 * AI noise reduction (Detail → Noise reduction → AI): a restoring model
 * (SCUNet, blind; or DRUNet, told the noise it measures) run over the photo
 * once, the result kept, and every render graded from it instead of the
 * classic wavelet denoise — Lightroom's Denoise, without the extra file.
 *
 * Two steps, so the loupe shows it long before the whole photo is done:
 *
 * 1. **Preview**: the draft (≤ 1280 px) denoised. The develop view
 *    switches to it at once; the models take tens of seconds a megapixel on
 *    a CPU, so this is what keeps the wait short.
 * 2. **Full resolution**: the original — a RAW developed as the proxies are —
 *    denoised into a 16-bit master beside the photo's cache, and the proxies
 *    remade from it, so the previews, a 1:1 view and an export all see the
 *    same pixels. An export that finds no master makes it first.
 *
 * Everything is kept per photo version and per model and strength (the key),
 * under `cache/photos/<id>/denoise-<key>/`. HDR photos are refused: the
 * models are trained on display-referred pictures.
 */
import log from 'electron-log/main'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { AiStartRequest } from '../../shared/ai'
import { estimate } from '../../shared/ai'
import type { EnhancerRef, SourceInfo } from '../../shared/engine-types'
import { hash32, type AiDenoiseSetting } from '../../shared/recipe'
import type { PhotoRow } from '../db'
import type { EngineClient } from '../engine/client'
import { exists } from '../exists'
import type { IndexClient } from '../indexer/client'
import { parseKey } from '../keys'
import type { Library } from '../library'
import { paths } from '../paths'
import { DRAFT_EDGE, ensureProxies, type Proxies, type ProxyFile } from '../proxy'
import type { DevelopSessions } from '../render'
import { BACKGROUND_THREADS, blankRequest, RAW_DEVELOP, sourceOrientation } from '../source'
import { Cancelled, type AiContext, type AiRunner } from './jobs'
import { ModelMissing, modelName, type ModelStore } from './models'

/** What a photo's AI denoise has made so far. */
export interface DenoiseSet {
  key: string
  /** The proxies to grade: the preview's, or (once `master` exists) remade from it. */
  px: Proxies
  /** The full-resolution denoised frame, upright; null until step 2 is done. */
  master: ProxyFile | null
}

function stamp(photo: PhotoRow): string {
  return `${Math.round(photo.mtime)}-${photo.size}`
}

/** What names a denoise: the photo's version, the model and its strength. */
export function denoiseKey(photo: PhotoRow, ai: AiDenoiseSetting): string {
  return hash32(JSON.stringify([stamp(photo), ai.model, Math.round(ai.strength)])).toString(16)
}

const dirOf = (photo: PhotoRow, key: string): string =>
  join(paths.photoCache(photo.id), `denoise-${key}`)

/** What is built for a key, or null when nothing is. */
export async function findDenoised(photo: PhotoRow, key: string): Promise<DenoiseSet | null> {
  const meta = join(dirOf(photo, key), 'set.json')
  if (!(await exists(meta))) return null
  const set = JSON.parse(await readFile(meta, 'utf8')) as DenoiseSet
  const files = [set.px.proxy.path, set.px.draft.path, ...(set.master ? [set.master.path] : [])]
  for (const f of files) if (!(await exists(f))) return null
  return set
}

async function keep(photo: PhotoRow, set: DenoiseSet): Promise<DenoiseSet> {
  await writeFile(join(dirOf(photo, set.key), 'set.json'), JSON.stringify(set))
  return set
}

/**
 * Models the accelerator would not load (SCUNet under CoreML: ONNX Runtime
 * refuses a reshape of its attention blocks), run on the CPU from then on.
 */
const cpuOnly = new Set<string>()

/**
 * Run `make` with the model on the chosen provider, and once more on the CPU
 * when the accelerator cannot load it.
 */
async function withFallback<T>(
  ai: AiDenoiseSetting,
  make: (cpu: boolean) => Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (cpuOnly.has(ai.model)) return make(true)
  try {
    return await make(false)
  } catch (err) {
    if (signal.aborted || !/load-model/.test(String((err as Error)?.message))) throw err
    log.warn('denoise model would not load on the accelerator; using the CPU', ai.model, err)
    cpuOnly.add(ai.model)
    return make(true)
  }
}

/** The model's engine reference, with the strength and (DRUNet) the measured noise. */
async function enhancer(
  models: ModelStore,
  ai: AiDenoiseSetting,
  cpu: boolean
): Promise<EnhancerRef> {
  if (!(await models.installed(ai.model))) throw new ModelMissing(models.entry(ai.model))
  const ref = (await models.ref(ai.model, cpu ? 'Cpu' : undefined, {
    // DRUNet is told the noise: the engine measures it on each tile's input,
    // luma σ scaled to the per-channel σ the model wants.
    noise: { MeasuredNoise: { gain: 1.33 } }
  })) as unknown as EnhancerRef
  return { ...ref, strength: Math.min(1, Math.max(0.01, ai.strength / 100)) }
}

const writeTiff = { Tiff: { compression: 'None' } } as const
const withProfile = { exif: false, icc: true, xmp: false, iptc: false } as const

/** A `DRAFT_EDGE` draft of a frame, for the develop view's moving sliders. */
async function draftOf(
  engine: EngineClient,
  from: ProxyFile,
  path: string,
  signal: AbortSignal
): Promise<ProxyFile> {
  const k = Math.min(1, DRAFT_EDGE / Math.max(from.width, from.height))
  const r = await engine.convert(
    {
      ...blankRequest(from.path, path, 'Tiff'),
      resize: k < 1 ? { Scale: { factor: k } } : 'None',
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: writeTiff,
      metadata: withProfile,
      color: 'Preserve'
    },
    { signal }
  )
  return { path, input: 'Tiff', width: r.width, height: r.height }
}

/**
 * Step 1: the draft (≤ 1280 px) denoised, standing in for both proxies until
 * the full resolution is made: seconds rather than minutes, and enough to
 * judge the model and strength by.
 */
export async function buildPreview(
  engine: EngineClient,
  models: ModelStore,
  photo: PhotoRow,
  plain: Proxies,
  ai: AiDenoiseSetting,
  key: string,
  signal: AbortSignal
): Promise<DenoiseSet> {
  const dir = dirOf(photo, key)
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'preview.tiff')
  const r = await withFallback(
    ai,
    async (cpu) =>
      engine.convert(
        {
          ...blankRequest(plain.draft.path, path, plain.draft.input),
          enhance: [{ Model: await enhancer(models, ai, cpu) }],
          pixel: { depth: 'Sixteen', channels: 3 },
          encode: writeTiff,
          metadata: withProfile,
          color: 'Preserve',
          threads: BACKGROUND_THREADS
        },
        { signal }
      ),
    signal
  )
  const preview: ProxyFile = { path, input: 'Tiff', width: r.width, height: r.height }
  return keep(photo, {
    key,
    px: {
      proxy: preview,
      draft: preview,
      frameWidth: plain.frameWidth,
      frameHeight: plain.frameHeight
    },
    master: null
  })
}

/** Step 2: the original denoised at full size, and the proxies remade from it. */
export async function buildMaster(
  engine: EngineClient,
  models: ModelStore,
  photo: PhotoRow,
  info: SourceInfo,
  plain: Proxies,
  ai: AiDenoiseSetting,
  key: string,
  signal: AbortSignal
): Promise<DenoiseSet> {
  const dir = dirOf(photo, key)
  await mkdir(dir, { recursive: true })
  const raw = info.input === 'Raw' ? RAW_DEVELOP : null
  const orientation = sourceOrientation(info, raw)
  const path = join(dir, 'master.tiff')
  const r = await withFallback(
    ai,
    async (cpu) =>
      engine.convert(
        {
          ...blankRequest(photo.path, path, info.input, info),
          raw,
          enhance: [{ Model: await enhancer(models, ai, cpu) }],
          pixel: { depth: 'Sixteen', channels: 3 },
          encode: writeTiff,
          metadata: withProfile,
          color: 'Preserve',
          // Upright, as the proxies are: the develop view's frame.
          framing:
            orientation === 'Normal'
              ? null
              : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
          threads: BACKGROUND_THREADS * 2
        },
        { signal }
      ),
    signal
  )
  const master: ProxyFile = { path, input: 'Tiff', width: r.width, height: r.height }
  // The proxies at the plain ones' sizes, from the master: what the develop
  // view grades is what the export will.
  const k = plain.proxy.width / master.width
  const pr = await engine.convert(
    {
      ...blankRequest(path, join(dir, 'proxy.tiff'), 'Tiff'),
      resize: k < 1 ? { Scale: { factor: k } } : 'None',
      linear_resample: k < 1,
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: writeTiff,
      metadata: withProfile,
      color: 'Preserve'
    },
    { signal }
  )
  const proxy: ProxyFile = {
    path: join(dir, 'proxy.tiff'),
    input: 'Tiff',
    width: pr.width,
    height: pr.height
  }
  const draft = await draftOf(engine, proxy, join(dir, 'draft.tiff'), signal)
  return keep(photo, {
    key,
    px: { proxy, draft, frameWidth: master.width, frameHeight: master.height },
    master
  })
}

/** Other sets kept per photo besides the newest: a 24 MP master is about 150 MB. */
const KEEP_OTHERS = 2

/** Drop a photo's older denoise sets, keeping `key`'s and the last few before it. */
async function prune(photo: PhotoRow, key: string): Promise<void> {
  const root = paths.photoCache(photo.id)
  const others = (await readdir(root).catch(() => [] as string[])).filter(
    (d) => d.startsWith('denoise-') && d !== `denoise-${key}`
  )
  const dated = await Promise.all(
    others.map(async (d) => ({ d, t: (await stat(join(root, d)).catch(() => null))?.mtimeMs ?? 0 }))
  )
  dated.sort((a, b) => b.t - a.t)
  for (const { d } of dated.slice(KEEP_OTHERS))
    await rm(join(root, d), { recursive: true, force: true })
}

/** Why a photo cannot be AI-denoised, or null. */
export function denoiseRefusal(info: SourceInfo): string | null {
  return info.is_hdr ? 'AI denoise needs an SDR photo; this one is HDR' : null
}

type DenoiseRequest = Extract<AiStartRequest, { task: 'denoise' }>

/** How long a megapixel of the full-resolution step takes, per model, remembered between runs. */
const RATE_KEY = 'ai.denoise.msPerMp'
const FIRST_GUESS_MS_PER_MP: Record<string, number> = {
  'scunet-color-real': 27000,
  'drunet-color': 9000
}

/**
 * AI denoise as an AI job: Model → Preview (the develop view switches to it)
 * → Full resolution (its progress estimated from the photo's size and how
 * fast earlier runs went) → Save. Cancelling stops the engine between
 * model tiles; what is kept is what finished.
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
      { id: 'preview', label: 'Preview', weight: 0.2 },
      { id: 'full', label: 'Full resolution', weight: 0.7 },
      { id: 'save', label: 'Save', weight: 0.05 }
    ]
  }

  title(): { title: string; subject: string } {
    return { title: 'Denoising', subject: 'AI' }
  }

  async run(ctx: AiContext, req: DenoiseRequest): Promise<{ kind: 'applied'; label: string }> {
    const recipe = this.sessions()?.liveRecipe(req.key) ?? (await this.library.recipe(req.key))
    const ai = recipe.detail.ai
    if (!ai.enabled) throw new Error('AI denoise is off for this photo')
    ctx.stage('model', 0, `Loading ${modelName(this.models.entry(ai.model))}`)
    const row = await this.library.photoRow(req.key)
    const info = await this.library.probe(row)
    const refused = denoiseRefusal(info)
    if (refused) throw new Error(refused)
    if (!(await this.models.installed(ai.model)))
      throw new ModelMissing(this.models.entry(ai.model))
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    const key = denoiseKey(row, ai)
    const plain = await ensureProxies(this.engine, row, info)
    let set = await findDenoised(row, key)
    const tick = (expected: number): (() => void) => {
      const t0 = Date.now()
      const t = setInterval(() => ctx.progress(estimate(Date.now() - t0, expected), true), 250)
      return () => clearInterval(t)
    }
    const guard = <T>(p: Promise<T>): Promise<T> =>
      p.catch((err) => {
        if (ctx.signal.aborted) throw new Cancelled()
        throw err
      })

    const rate = await this.rate(ai.model)
    if (!set) {
      ctx.stage('preview', 0, 'Denoising a preview')
      const mp = (plain.draft.width * plain.draft.height) / 1e6
      const stop = tick(Math.max(1500, mp * rate))
      try {
        set = await guard(buildPreview(this.engine, this.models, row, plain, ai, key, ctx.signal))
      } finally {
        stop()
      }
      this.sessions()?.denoiseChanged(req.key)
    }
    if (!set.master) {
      ctx.stage('full', 0, 'Denoising at full resolution')
      const mp = (plain.frameWidth * plain.frameHeight) / 1e6
      const expected = Math.max(3000, mp * rate)
      const stop = tick(expected)
      const t0 = Date.now()
      try {
        set = await guard(
          buildMaster(this.engine, this.models, row, info, plain, ai, key, ctx.signal)
        )
      } finally {
        stop()
      }
      const measured = (Date.now() - t0) / Math.max(0.1, mp)
      void this.remember(ai.model, Math.round(0.6 * measured + 0.4 * rate))
    }
    ctx.stage('save', 0.5, 'Switching the photo over')
    this.sessions()?.denoiseChanged(req.key)
    await prune(row, key).catch((err) => log.warn('denoise prune failed', err))
    const { photoId, copyId } = parseKey(req.key)
    this.library.queueThumb(photoId, copyId, true)
    return { kind: 'applied', label: 'AI denoise' }
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
