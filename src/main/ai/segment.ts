/**
 * Segmentation (Select Subject / Background) as an AI job: a salient-object
 * model (U²-Net, or its small sibling U²-Netp — whichever is downloaded,
 * the larger first) on the engine's bundled ONNX Runtime turns the photo's
 * proxy into a grey plane, guided up by the photo's own edges to a painted
 * plane's size (the engine's `segment`, `plane_longest`). The plane is of
 * the base frame after the lens correction — what masks are placed on — and
 * becomes a painted mask component, its edge snapped to the picture's at
 * render time (shared/refine.ts); Background is the same plane inverted.
 *
 * Sky has no model yet (the roster ships salient-object models only): the
 * Sky tool asks the user to click it instead (SAM 2.1, `SKY_BY_CLICK`).
 */
import type { AiResult, AiStartRequest } from '../../shared/ai'
import { estimate, SEGMENT_LABEL } from '../../shared/ai'
import { lensCorrection } from '../../shared/lens'
import { planeRef } from '../planeref'
import type { EngineClient } from '../engine/client'
import type { Library } from '../library'
import { encodeGreyPng, grey8 } from '../pngio'
import type { PlaneStore } from '../planestore'
import { ensureProxies } from '../proxy'
import type { DevelopSessions } from '../render'
import { BACKGROUND_THREADS } from '../source'
import { Cancelled, type AiContext, type AiRunner } from './jobs'
import { ModelMissing, type ModelStore } from './models'

type SegmentRequest = Extract<AiStartRequest, { task: 'segment' }>

/** Segment planes are this many pixels on their long edge (as painted planes are). */
const PLANE_EDGE = 1024

/** The subject models, best first. */
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
    const long = Math.max(px.proxy.width, px.proxy.height)
    let report: Awaited<ReturnType<EngineClient['segment']>>
    try {
      // Stopped mid-run by the signal (the engine's model calls take one since 0.16).
      report = await this.engine.segment(
        {
          source: { Path: px.proxy.path },
          input: px.proxy.input,
          raw: null,
          gain_map: null,
          // The proxy is the base frame, upright: what masks are placed on.
          orientation: 'Normal',
          lens: lensCorrection(recipe.lens),
          segmenter: { Classes: segmenter },
          upsample: { Guided: { radius: 0.02, epsilon: 0.001 } },
          png: { compression: 'Fast', filter: 'Sub' },
          threads: BACKGROUND_THREADS,
          // At a painted plane's size, straight from the model's grid.
          plane_longest: long > PLANE_EDGE ? PLANE_EDGE : null
        },
        { signal: ctx.signal }
      )
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
