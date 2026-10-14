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
 *
 * With a development kit (`pnpm dev:kit`, shared/pixldemosaic.ts) the roster
 * also offers PIXL's own demosaic, which denoises as it develops: where it
 * is offered for the sensor, downloaded and its switch on (Settings → AI
 * models), it is the develop, alone (no PMRID before it), under its own tag
 * `pd`. Refused, the develop above stands in, then the classic; never
 * silently (a trial): the refusal is one `console.error` line, and that
 * model is planned around until its switch is turned off and on, or
 * Playroom starts again (a develop refused at every 1:1 view would be made
 * again at every one).
 */
import { remember, statedNoiseFor, type NoisePlane, type Shot, type StatedNoise } from './noisebook'
import log from 'electron-log/main'
import { traceRegion } from '../trace'
import type {
  DemosaickerRef,
  ExecutionProvider,
  MosaicDenoise,
  RawCfa,
  SceneDemosaic
} from '../../shared/engine-types'
import { PIXL_DEMOSAIC } from '../../shared/pixldemosaic'
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
  /** The roster offers this model (the PIXL demosaic: a development kit's roster only). */
  offered(id: string): boolean
  /** "Use PIXL demosaic (development)" is on (Settings → AI models). */
  pixlDemosaic(): Promise<boolean>
}

let models: RawModels | null = null

/** PIXL demosaic models a plan asked for this run: each fetched once, not at every 1:1 view. */
const pixlAsked = new Set<string>()
/**
 * PIXL demosaic models a develop was refused with this run, and why: planned
 * around until the switch goes off and on.
 */
const pixlRefused = new Map<string, string>()

export function setRawModels(m: RawModels): void {
  models = m
  pixlAsked.clear()
  pixlRefused.clear()
}

export type DemosaicKind = 'pixl' | 'model' | 'ahd' | 'classic'

/** The demosaic for a sensor: its learned one when there, else AHD (Bayer only), else the classic. */
export function demosaicFor(cfa: RawCfa | null | undefined, model: boolean): DemosaicKind {
  if (!cfa) return 'classic'
  if (model) return 'model'
  return cfa === 'Bayer' ? 'ahd' : 'classic'
}

/**
 * What names a full-size develop's file: the demosaic, and `-pm` with PMRID.
 * The develop's other choices are in the photo's stamp (`versionStamp`).
 * The PIXL demosaic is `pd`, never with PMRID: a tag of its own, so a
 * master DemosaicNet made is not taken for its.
 */
export function developTag(kind: DemosaicKind, pmrid: boolean): string {
  if (kind === 'pixl') return 'pd'
  return `${kind === 'model' ? 'dn' : kind === 'ahd' ? 'ahd' : 'ppg'}${pmrid ? '-pm' : ''}`
}

/**
 * The masters a develop's clean-up leaves in a photo's cache, by tag: its
 * own, with and without PMRID (edits that differ). With a development kit
 * also the PIXL demosaic's and DemosaicNet's side by side, so flipping the
 * switch develops nothing again.
 */
export function keptMasterTags(tag: string, devKit: boolean): string[] {
  const own = tag.replace(/-pm$/, '')
  const kept = [own, `${own}-pm`]
  return devKit ? [...new Set([...kept, 'pd', 'dn', 'dn-pm'])] : kept
}

/** The develop chosen for a RAW, before its model sessions are filled in. */
export interface ScenePlan {
  cfa: RawCfa | null
  demosaic: DemosaicKind
  pmrid: boolean
  tag: string
  /** Under a PIXL demosaic plan: the develop without it, which stands in when it is refused. */
  then?: ScenePlan
}

/** The demosaic model a plan runs, if any. */
function demosaicModel(plan: ScenePlan): string | null {
  if (!plan.cfa) return null
  if (plan.demosaic === 'pixl') return PIXL_DEMOSAIC[plan.cfa]
  return plan.demosaic === 'model' ? DEMOSAIC_MODEL[plan.cfa] : null
}

/** A plan's models: its demosaic, and PMRID before it. */
function modelsOf(plan: ScenePlan): string[] {
  const id = demosaicModel(plan)
  return [...(id ? [id] : []), ...(plan.pmrid ? [RAW_DENOISER] : [])]
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
  const released: ScenePlan = {
    cfa: cfa ?? null,
    demosaic,
    pmrid,
    tag: developTag(demosaic, pmrid)
  }
  // PIXL's own demosaic, where a development kit's roster offers it for this
  // sensor: the whole develop, PMRID never before it.
  const pixl = cfa ? PIXL_DEMOSAIC[cfa] : null
  if (!runs || !cfa || pixl === null || !m!.offered(pixl)) return released
  if (!(await m!.pixlDemosaic().catch(() => true))) {
    // Off: what was refused is tried again when it is turned back on.
    pixlRefused.clear()
    return released
  }
  if (pixlRefused.has(pixl)) return released
  if (!(await m!.installed(pixl))) {
    // Fetched the first time a RAW wants it (once a run), the released develop meanwhile.
    if (!pixlAsked.has(pixl)) {
      pixlAsked.add(pixl)
      m!.fetch(pixl)
    }
    return released
  }
  return { cfa, demosaic: 'pixl', pmrid: false, tag: developTag('pixl', false), then: released }
}

/**
 * Scene's `demosaic` and `mosaic_denoise` for a plan, its models on the CPU
 * where asked; `stated`, the frame's noise told to PIXL's demosaic instead of
 * read from the frame (E64).
 */
async function fill(
  plan: ScenePlan,
  onCpu: ReadonlySet<string>,
  stated?: StatedNoise
): Promise<SceneModels> {
  const ref = (id: string): Promise<Record<string, unknown>> =>
    models!.ref(id, onCpu.has(id) ? 'Cpu' : undefined)
  const model = demosaicModel(plan)
  // The roster's ref as it is: a 0.20 engine's `encoding` and `noise` come with it.
  const own = model ? ((await ref(model)) as DemosaickerRef) : null
  const demosaic: SceneDemosaic = own
    ? {
        Model: stated
          ? {
              ...own,
              noise: { Map: { noise: { Stated: { k: stated.k, sigma2: stated.sigma2 } } } }
            }
          : own
      }
    : plan.demosaic === 'ahd'
      ? 'Ahd'
      : 'Classic'
  // Never beside the PIXL demosaic (the plan says so: its `pmrid` is false).
  const mosaic_denoise: MosaicDenoise | null = plan.pmrid
    ? { model: await ref(RAW_DENOISER), noise: 'Measured' }
    : null
  traceRegion({
    step: 'scene',
    tag: plan.tag,
    demosaic: model ?? plan.demosaic,
    pmrid: plan.pmrid,
    // The store's default is the accelerator (CoreML on a Mac); a model it refused runs on the CPU.
    provider: Object.fromEntries(
      modelsOf(plan).map((id) => [id, onCpu.has(id) ? 'Cpu' : 'default'])
    )
  })
  return { demosaic, mosaic_denoise }
}

const NEVER = new AbortController().signal

/** What a develop refused for its models says (anything else is the file's, and stands). */
const MODEL_TROUBLE = /raw\.(demosaic|mosaic_denoise)|model|onnx|session|provider|coreml/i

/**
 * The engine could not read this frame's noise (E64): the photo's own
 * trouble, not the model's. Its noise can be stated instead, and the model
 * stays planned for every other photo.
 */
const NOISE_UNREAD = /noise cannot be read|state it with MosaicNoise::Stated/i

/** A develop's own account of the noise its demosaic was told, where one ran. */
function planesOf(value: unknown): NoisePlane[] | null {
  const raw = (value as { raw?: { demosaic_model?: { noise_planes?: unknown } } } | null)?.raw
  const planes = raw?.demosaic_model?.noise_planes
  return Array.isArray(planes) ? (planes as NoisePlane[]) : null
}

export type SceneModels = { demosaic: SceneDemosaic; mosaic_denoise: MosaicDenoise | null }

/** A develop as it ran. */
export interface SceneRun<T> {
  value: T
  /** Another develop stood in for the plan's: what is kept from it is not the plan's. */
  classic: boolean
  /** The develop that made it, by tag: the plan's, or the stand-in's (`ppg` for the classic). */
  ran: string
  /** Why the plan's did not, when one stood in: the engine's words. */
  refused?: string
  /** The plan's ran with the frame's noise stated, not read (E64): from what. */
  statedFrom?: string
}

/** An engine error's message and code, for a line in the log. */
function inWords(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown } | null
  const message = String(e?.message ?? err)
  return typeof e?.code === 'string' ? `${message} [${e.code}]` : message
}

/**
 * Run a develop with a plan's demosaic and denoiser. A model the accelerator
 * won't load moves to the CPU (the store's fallback); a develop the engine
 * refuses with them (a sensor it reads otherwise than probe said) runs
 * classic, as 0.18 did, so the picture is never lost to a model. `classic`
 * says it did: what is kept from it is not the plan's.
 *
 * A PIXL demosaic plan that is refused runs the released develop first
 * (`plan.then`: DemosaicNet, PMRID when asked), then the classic. It says so
 * on the console, with the engine's message and code, and that model is
 * planned around from then on (`scenePlan`).
 */
export async function withScene<T>(
  plan: ScenePlan,
  run: (scene: SceneModels) => Promise<T>,
  signal: AbortSignal = NEVER,
  /** The frame's camera and ISO: what its noise is kept under, and stated from (E64). */
  shot: Shot = { camera: null, iso: null }
): Promise<SceneRun<T>> {
  const ids = modelsOf(plan)
  const plain: SceneModels = { demosaic: 'Classic', mosaic_denoise: null }
  if (plan.demosaic === 'classic' && ids.length === 0)
    return { value: await run(plain), classic: false, ran: plan.tag }
  const attempt = (stated?: StatedNoise): Promise<T> =>
    ids.length === 0
      ? fill(plan, new Set(), stated).then(run)
      : models!.withCpuFallback(ids, async (onCpu) => run(await fill(plan, onCpu, stated)), signal)
  try {
    const value = await attempt()
    // What PIXL's demosaic read of this frame's noise: kept for a sibling it cannot read.
    if (plan.demosaic === 'pixl') remember(shot, planesOf(value))
    return { value, classic: false, ran: plan.tag }
  } catch (err) {
    if (signal.aborted) throw err
    const trouble = MODEL_TROUBLE.test(String((err as Error)?.message))
    if (plan.demosaic === 'pixl') {
      const id = demosaicModel(plan)!
      if (!trouble) {
        // The file's own trouble, most likely: it stands, and is said here too.
        console.error(`PIXL demosaic: the develop with ${id} failed: ${inWords(err)}`)
        throw err
      }
      let why = inWords(err)
      // This frame's noise could not be read (E64): stated from what its
      // camera's other frames were measured to have, and developed again.
      const unread = NOISE_UNREAD.test(why)
      const stated = unread ? statedNoiseFor(shot) : null
      if (stated) {
        try {
          const value = await attempt(stated.noise)
          log.info(
            'PIXL demosaic: noise not readable from the frame; stated from',
            stated.source,
            `k ${stated.noise.k.toExponential(3)}, σ² ${stated.noise.sigma2.toExponential(3)}`
          )
          traceRegion({ step: 'stated', tag: plan.tag, from: stated.source })
          return { value, classic: false, ran: plan.tag, statedFrom: stated.source }
        } catch (again) {
          if (signal.aborted) throw again
          why = `${why}; with its noise stated from ${stated.source}: ${inWords(again)}`
        }
      }
      const next: ScenePlan = plan.then ?? {
        cfa: plan.cfa,
        demosaic: 'classic',
        pmrid: false,
        tag: developTag('classic', false)
      }
      // A frame whose noise cannot be read is this photo's trouble: the model
      // stays planned for the rest. Anything else is the model's, for the run.
      const scope = unread
        ? 'for this photo (no noise measured yet to state for it)'
        : 'now and for the rest of this run (its switch off and on tries again)'
      console.error(
        `PIXL demosaic: ${id} was planned (${plan.tag}) but the engine refused it; developing ${next.tag} instead, ${scope}: ${why}`
      )
      log.warn('RAW develop with', plan.tag, 'refused; developing', next.tag, why)
      traceRegion({ step: 'refused', tag: plan.tag, then: next.tag, message: why })
      if (!unread) pixlRefused.set(id, why)
      const stood = await withScene(next, run, signal)
      return { ...stood, classic: true, refused: why }
    }
    if (!trouble) throw err
    log.warn('RAW develop with', plan.tag, 'refused; developing classic', (err as Error).message)
    traceRegion({ step: 'refused', tag: plan.tag, message: (err as Error).message })
    return { value: await run(plain), classic: true, ran: developTag('classic', false) }
  }
}
