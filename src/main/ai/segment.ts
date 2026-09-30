/**
 * Segmentation (Select Subject / Background) as an AI job: a salient-object
 * model (U²-Net, or its small sibling U²-Netp — whichever is downloaded,
 * the larger first) on the engine's bundled ONNX Runtime turns the photo's
 * proxy into a grey plane, guided back to full resolution by the photo's own
 * edges (the engine's `segment`). The plane is of the base frame after the
 * lens correction — what masks are placed on — and becomes a painted mask
 * component; Background is the same plane inverted.
 *
 * Sky has no model yet (the roster ships salient-object models only).
 */
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { AiStartRequest } from '../../shared/ai'
import { estimate, SEGMENT_LABEL } from '../../shared/ai'
import { lensCorrection } from '../../shared/lens'
import { planeRef } from '../../shared/recipe'
import type { EngineClient } from '../engine/client'
import type { Library } from '../library'
import { decodePng, encodeGreyPng } from '../pngio'
import type { PlaneStore } from '../planestore'
import { paths } from '../paths'
import { ensureProxies } from '../proxy'
import type { DevelopSessions } from '../render'
import { BACKGROUND_THREADS, blankRequest } from '../source'
import { STRIP_ALL } from '../../shared/engine-types'
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

  async run(
    ctx: AiContext,
    req: SegmentRequest
  ): Promise<{ kind: 'mask'; ref: string; width: number; height: number; label: string }> {
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
    const px = await ensureProxies(this.engine, row, info)
    const recipe = this.sessions()?.liveRecipe(req.key) ?? (await this.library.recipe(req.key))
    // One run of a small network: the CPU is done before an accelerator has
    // compiled it (CoreML takes about a second to), so segmenting stays there.
    const segmenter = await this.models.ref(id, 'Cpu')
    if (ctx.signal.aborted) throw new Cancelled()

    ctx.stage('analyse', 0, `Finding the ${SEGMENT_LABEL[req.target].toLowerCase()}`)
    const t0 = Date.now()
    const tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, 2500), true), 200)
    // The engine cannot stop a segment midway; cancelling restarts its process.
    const stop = (): void => this.engine.restart()
    ctx.signal.addEventListener('abort', stop, { once: true })
    let report: { planes: { png: Uint8Array; raw_max: number; coverage: number }[] }
    try {
      report = (await this.engine.segment({
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
        threads: BACKGROUND_THREADS
      })) as unknown as typeof report
    } catch (err) {
      if (ctx.signal.aborted) throw new Cancelled()
      throw err
    } finally {
      clearInterval(tick)
      ctx.signal.removeEventListener('abort', stop)
    }
    const plane = report.planes[0]
    if (!plane) throw new Error('the model returned no plane')
    if (plane.raw_max < NOTHING_SALIENT)
      throw new Error('No clear subject in this photo: try a brush or a range mask')

    ctx.stage('refine', 0, 'Refining the edges')
    // The frame-sized 16-bit plane, down to a painted plane's size, as 8 bits.
    const full = join(paths.photoCache(row.id), `segment-${id}.png`)
    await writeFile(full, plane.png)
    const k = Math.min(1, PLANE_EDGE / Math.max(px.proxy.width, px.proxy.height))
    const small = await this.engine.convert({
      ...blankRequest(full, '', 'Png'),
      sink: 'Bytes',
      resize: k < 1 ? { Scale: { factor: k } } : 'None',
      pixel: { depth: 'Eight', channels: 1 },
      encode: { Png: { compression: 'Fast', filter: 'NoFilter' } },
      metadata: STRIP_ALL,
      color: 'Preserve',
      threads: BACKGROUND_THREADS
    })
    if (!small.output) throw new Error('the engine returned no plane')
    const d = decodePng(Buffer.from(small.output))
    const grey = new Uint8Array(d.rows.subarray(0, d.width * d.height))
    if (req.target === 'background') for (let i = 0; i < grey.length; i++) grey[i] = 255 - grey[i]
    ctx.progress(0.8)
    const png = encodeGreyPng(grey, d.width, d.height).toString('base64')
    const ref = planeRef(png)
    this.planes.put(ref, png)
    return { kind: 'mask', ref, width: d.width, height: d.height, label: SEGMENT_LABEL[req.target] }
  }
}
