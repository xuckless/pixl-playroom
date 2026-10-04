/**
 * Segmentation (Select Subject / Background) as an AI job: a salient-object
 * model (U²-Net, or its small sibling U²-Netp — whichever is downloaded,
 * the larger first) on the engine's bundled ONNX Runtime turns the photo's
 * proxy into a grey plane at the proxy's size, its edge pulled onto the
 * photo's by a tight guided upsample and then hardened (`harden`). The plane
 * is of the base frame after the lens correction — what masks are placed
 * on — and becomes a painted mask component, its last pixel or two snapped
 * to the picture's at render time (shared/refine.ts); Background is the same
 * plane inverted (and hardened that way round).
 *
 * Sky has no model yet (the roster ships salient-object models only): the
 * Sky tool asks the user to click it instead (SAM 2.1, `SKY_BY_CLICK`).
 */
import type { AiResult, AiStartRequest } from '../../shared/ai'
import { estimate, SEGMENT_LABEL } from '../../shared/ai'
import { lensCorrection } from '../../shared/lens'
import { hardenPlane } from '../../shared/refine'
import { planeRef } from '../planeref'
import type { EngineClient } from '../engine/client'
import type { Library } from '../library'
import { encodeGreyPng, grey8 } from '../pngio'
import type { PlaneStore } from '../planestore'
import { ensureProxies } from '../proxy'
import type { DevelopSessions } from '../render'
import log from 'electron-log/main'
import { BACKGROUND_THREADS } from '../source'
import { READ_LIMITS } from '../../shared/limits'
import { Cancelled, type AiContext, type AiRunner } from './jobs'
import { ModelMissing, type ModelStore } from './models'

type SegmentRequest = Extract<AiStartRequest, { task: 'segment' }>

/**
 * How the model's 320 px answer reaches the proxy: guided by the photo's
 * luminance over about one of the model's pixels. A wider box blurred the
 * edge wherever the ground beside the subject is flat (0.02 made a glow
 * about 100 px wide on a 24 MP portrait against a plain wall).
 */
const UPSAMPLE = { Guided: { radius: 0.004, epsilon: 0.001 } }
/** The model's answer is soft over a few of its pixels: its middle is stretched this many times. */
const HARDEN = 4
/**
 * Where it is stretched about, 0…1: a little above the middle, so the mask
 * leaves the uncertain rim (light wall along dark hair) rather than taking it.
 */
const HARDEN_AT = 0.6

/**
 * The subject models, best first. U²-Net was retired by engine 0.17 (U²-Netp
 * replaces it) and is kept for who downloaded it until the next update
 * (`legacymodels.ts`): it goes from this list then.
 */
const SUBJECT_MODELS = ['u2net', 'u2netp']

/** Below this the model saw nothing salient (a flat plane stretched to full range). */
const NOTHING_SALIENT = 0.2

export class SegmentRunner implements AiRunner<SegmentRequest> {
  readonly task = 'segment' as const

  constructor(
    private readonly library: Library,
    private readonly planes: PlaneStore,
    /** The AI engine: started when first needed. */
    private readonly engine: EngineClient,
    private readonly models: ModelStore,
    private readonly sessions: () => DevelopSessions | undefined
  ) {}

  stages(): { id: string; label: string; weight: number }[] {
    return [
      { id: 'model', label: 'Model', weight: 0.15 },
      { id: 'analyse', label: 'Analyse', weight: 0.6 },
      { id: 'refine', label: 'Refine', weight: 0.25 }
    ]
  }

  title(req: SegmentRequest): { title: string; subject: string } {
    return { title: 'Segmenting', subject: SEGMENT_LABEL[req.target] }
  }

  /** The subject model to use: the best one downloaded, or null. */
  async model(): Promise<string | null> {
    for (const id of SUBJECT_MODELS) if (await this.models.installed(id)) return id
    return null
  }

  async run(ctx: AiContext, req: SegmentRequest): Promise<Extract<AiResult, { kind: 'mask' }>> {
    if (req.target === 'sky') throw new Error('No sky model ships yet')
    ctx.stage('model', 0, 'Loading the model')
    const id = await this.model()
    if (!id) throw new ModelMissing(this.models.entry('u2netp'))
    const row = await this.library.photoRow(req.key)
    const info = await this.library.probe(row)
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    const px = await ensureProxies(this.engine, row, info, BACKGROUND_THREADS)
    const recipe = this.sessions()?.liveRecipe(req.key) ?? (await this.library.recipe(req.key))
    // One run of a small network: the CPU is done before an accelerator has
    // compiled it (CoreML takes about a second to), so segmenting stays there.
    const segmenter = await this.models.ref(id, 'Cpu')
    if (ctx.signal.aborted) throw new Cancelled()

    ctx.stage('analyse', 0, `Finding the ${SEGMENT_LABEL[req.target].toLowerCase()}`)
    const t0 = Date.now()
    const tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, 2500), true), 200)
    let report: Awaited<ReturnType<EngineClient['segment']>>
    const request = (model: Record<string, unknown>): Record<string, unknown> => ({
      source: { Path: px.proxy.path },
      input: px.proxy.input,
      raw: null,
      gain_map: null,
      // The proxy is the base frame, upright: what masks are placed on.
      orientation: 'Normal',
      lens: lensCorrection(recipe.lens),
      segmenter: { Classes: model },
      upsample: UPSAMPLE,
      png: { compression: 'Fast', filter: 'Sub' },
      threads: BACKGROUND_THREADS,
      limits: READ_LIMITS,
      // At the proxy's own size: the edge is followed there, not stretched later.
      plane_longest: null
    })
    try {
      // Stopped mid-run by the signal (the engine's model calls take one since 0.16).
      try {
        report = await this.engine.segment(request(segmenter), { signal: ctx.signal })
      } catch (err) {
        // U²-Net is retired and the 0.17 engine no longer tests its own
        // weights: if it will not run, U²-Netp (the model that replaces it)
        // makes the mask, and the failure is logged.
        const model = (err as { code?: string })?.code === 'Model'
        if (
          ctx.signal.aborted ||
          id !== 'u2net' ||
          !model ||
          !(await this.models.installed('u2netp'))
        )
          throw err
        log.warn('U²-Net would not run; using U²-Netp', (err as Error).message)
        report = await this.engine.segment(request(await this.models.ref('u2netp', 'Cpu')), {
          signal: ctx.signal
        })
      }
    } catch (err) {
      if (ctx.signal.aborted) throw new Cancelled()
      throw err
    } finally {
      clearInterval(tick)
    }
    const plane = report.planes[0]
    if (!plane) throw new Error('the model returned no plane')
    if (plane.raw_max < NOTHING_SALIENT)
      throw new Error('No clear subject in this photo: try a brush or a range mask')

    ctx.stage('refine', 0, 'Refining the edges')
    // The 16-bit plane as a painted plane's 8 bits.
    const d = grey8(Buffer.from(plane.png))
    const grey = d.data
    if (req.target === 'background') for (let i = 0; i < grey.length; i++) grey[i] = 255 - grey[i]
    // Measured on a 24 MP portrait: the edge went from fading over 24–75 px
    // to 5–9 px, and to 11–13 px with the render's snap.
    hardenPlane(grey, HARDEN_AT, HARDEN)
    ctx.progress(0.8)
    const png = encodeGreyPng(grey, d.width, d.height).toString('base64')
    const ref = planeRef(png)
    this.planes.put(ref, png)
    return {
      kind: 'mask',
      ref,
      width: d.width,
      height: d.height,
      label: SEGMENT_LABEL[req.target],
      source: { kind: 'segment', target: req.target },
      // Into the mask it was asked for (Add to the selected mask, a smart look's), else a new one.
      ...(req.into ? { into: { ...req.into } } : {})
    }
  }
}
