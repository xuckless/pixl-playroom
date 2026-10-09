/**
 * How a RAW is demosaicked and denoised where it is developed at full size
 * (the master behind the 1:1 view and the pixel steps, and the export;
 * engine 0.19's Scene `demosaic` and `mosaic_denoise`):
 *
 * - DemosaicNet (the sensor's own: Bayer or X-Trans, `SourceInfo.raw_cfa`)
 *   once downloaded, the best of what the engine measured; on a Mac through
 *   CoreML with static shapes, 5.3 s for 24 MP on an M2 Pro (35 s on the CPU).
 * - Else AHD on a Bayer sensor (3.2 s), the classic PPG / Markesteijn
 *   otherwise.
 * - PMRID on the Bayer mosaic first when the edit asks (Detail → Noise
 *   reduction → "Denoise the RAW data") and it is downloaded.
 *
 * Proxies stay classic: they are made at half size (`Cell`, no demosaic) or
 * brought down far enough that the demosaic doesn't show. The store is set
 * once it is up (app.ts); before that, and without the engine's `enhance`
 * build, nothing learned runs.
 */
import log from 'electron-log/main'
import { traceRegion } from '../trace'
import type {
  ExecutionProvider,
  MosaicDenoise,
  RawCfa,
  SceneDemosaic
} from '../../shared/engine-types'
import type { Recipe } from '../../shared/recipe'

export const DEMOSAIC_MODEL: Record<RawCfa, string> = {
  Bayer: 'demosaicnet-bayer',
  XTrans: 'demosaicnet-xtrans'
}
export const RAW_DENOISER = 'pmrid'

/** What the edit asks of the develop. */
export interface RawDevelopAsk {
  /** PMRID on the mosaic (Bayer only). */
  pmrid: boolean
}

export const PLAIN_DEVELOP: RawDevelopAsk = { pmrid: false }

/** What an edit asks of its RAW's develop. */
export function askOf(recipe: Pick<Recipe, 'detail'>): RawDevelopAsk {
  return { pmrid: recipe.detail.rawDenoise === true }
}

/** The models' side, as the store gives it. */
export interface RawModels {
  installed(id: string): Promise<boolean>
  ref(id: string, provider?: ExecutionProvider): Promise<Record<string, unknown>>
  withCpuFallback<T>(
    ids: string[],
    make: (onCpu: ReadonlySet<string>) => Promise<T>,
    signal: AbortSignal
  ): Promise<T>
  /** The engine runs models (its `enhance` build). */
  canRun(): Promise<boolean>
  /** Fetch a model quietly (an X-Trans RAW's DemosaicNet the first time one opens). */
  fetch(id: string): void
}

let models: RawModels | null = null

export function setRawModels(m: RawModels): void {
  models = m
}

export type DemosaicKind = 'model' | 'ahd' | 'classic'

/** The demosaic for a sensor: its learned one when there, else AHD (Bayer only), else the classic. */
export function demosaicFor(cfa: RawCfa | null | undefined, model: boolean): DemosaicKind {
  if (!cfa) return 'classic'
  if (model) return 'model'
  return cfa === 'Bayer' ? 'ahd' : 'classic'
}

/**
 * What names a full-size develop's file: the demosaic, and `-pm` with PMRID.
 * The develop's other choices are in the photo's stamp (`versionStamp`).
 */
export function developTag(kind: DemosaicKind, pmrid: boolean): string {
  return `${kind === 'model' ? 'dn' : kind === 'ahd' ? 'ahd' : 'ppg'}${pmrid ? '-pm' : ''}`
}

/** The develop chosen for a RAW, before its model sessions are filled in. */
export interface ScenePlan {
  cfa: RawCfa | null
  demosaic: DemosaicKind
  pmrid: boolean
  tag: string
}

/** Which develop a RAW gets now: what is downloaded, and what the edit asks. */
export async function scenePlan(
  cfa: RawCfa | null | undefined,
  ask: RawDevelopAsk = PLAIN_DEVELOP
): Promise<ScenePlan> {
  const m = models
  const runs = !!m && (await m.canRun().catch(() => false))
  const id = cfa ? DEMOSAIC_MODEL[cfa] : null
  const model = runs && id !== null && (await m!.installed(id))
  // An X-Trans RAW, opened for the first time without its model: fetched now
  // (1.6 MB), the classic demosaic meanwhile.
  if (runs && cfa === 'XTrans' && !model) m!.fetch(id!)
  const pmrid = runs && ask.pmrid && cfa === 'Bayer' && (await m!.installed(RAW_DENOISER))
  const demosaic = demosaicFor(cfa, model)
  return { cfa: cfa ?? null, demosaic, pmrid, tag: developTag(demosaic, pmrid) }
}

/** Scene's `demosaic` and `mosaic_denoise` for a plan, its models on the CPU where asked. */
async function fill(plan: ScenePlan, onCpu: ReadonlySet<string>): Promise<SceneModels> {
  const ref = (id: string): Promise<Record<string, unknown>> =>
    models!.ref(id, onCpu.has(id) ? 'Cpu' : undefined)
  const demosaic: SceneDemosaic =
    plan.demosaic === 'model'
      ? { Model: await ref(DEMOSAIC_MODEL[plan.cfa!]) }
      : plan.demosaic === 'ahd'
        ? 'Ahd'
        : 'Classic'
  const mosaic_denoise: MosaicDenoise | null = plan.pmrid
    ? { model: await ref(RAW_DENOISER), noise: 'Measured' }
    : null
  traceRegion({
    step: 'scene',
    tag: plan.tag,
    demosaic: plan.demosaic === 'model' ? DEMOSAIC_MODEL[plan.cfa!] : plan.demosaic,
    pmrid: plan.pmrid,
    // The store's default is the accelerator (CoreML on a Mac); a model it refused runs on the CPU.
    provider: Object.fromEntries(
      [
        ...(plan.demosaic === 'model' ? [DEMOSAIC_MODEL[plan.cfa!]] : []),
        ...(plan.pmrid ? [RAW_DENOISER] : [])
      ].map((id) => [id, onCpu.has(id) ? 'Cpu' : 'default'])
    )
  })
  return { demosaic, mosaic_denoise }
}

const NEVER = new AbortController().signal

/** What a develop refused for its models says (anything else is the file's, and stands). */
const MODEL_TROUBLE = /raw\.(demosaic|mosaic_denoise)|model|onnx|session|provider|coreml/i

export type SceneModels = { demosaic: SceneDemosaic; mosaic_denoise: MosaicDenoise | null }

/**
 * Run a develop with a plan's demosaic and denoiser. A model the accelerator
 * won't load moves to the CPU (the store's fallback); a develop the engine
 * refuses with them (a sensor it reads otherwise than probe said) runs
 * classic, as 0.18 did, so the picture is never lost to a model. `classic`
 * says it did: what is kept from it is not the plan's.
 */
export async function withScene<T>(
  plan: ScenePlan,
  run: (scene: SceneModels) => Promise<T>,
  signal: AbortSignal = NEVER
): Promise<{ value: T; classic: boolean }> {
  const ids = [
    ...(plan.demosaic === 'model' ? [DEMOSAIC_MODEL[plan.cfa!]] : []),
    ...(plan.pmrid ? [RAW_DENOISER] : [])
  ]
  const plain: SceneModels = { demosaic: 'Classic', mosaic_denoise: null }
  if (plan.demosaic === 'classic' && ids.length === 0)
    return { value: await run(plain), classic: false }
  try {
    const value =
      ids.length === 0
        ? await run(await fill(plan, new Set()))
        : await models!.withCpuFallback(ids, async (onCpu) => run(await fill(plan, onCpu)), signal)
    return { value, classic: false }
  } catch (err) {
    if (signal.aborted || !MODEL_TROUBLE.test(String((err as Error)?.message))) throw err
    log.warn('RAW develop with', plan.tag, 'refused; developing classic', (err as Error).message)
    traceRegion({ step: 'refused', tag: plan.tag, message: (err as Error).message })
    return { value: await run(plain), classic: true }
  }
}
