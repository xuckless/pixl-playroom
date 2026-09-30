/**
 * Segmentation (Select Subject / Sky / Background) as an AI job: a salient-
 * object model (U²-Net or ISNet, on the bundled ONNX Runtime, in a utility
 * process of its own so cancelling can kill it) turns the photo into a grey
 * plane in its base frame, which becomes a painted mask component. The model
 * is not bundled yet (TODO.md, "AI masks"); `PLAYROOM_FAKE_AI=1` runs a
 * stand-in with the same stages, timing and result, so the job queue, the
 * scan over the loupe and a mask landing on its photo can be tried end to end.
 */
import type { AiStartRequest, SegmentTarget } from '../../shared/ai'
import { SEGMENT_LABEL } from '../../shared/ai'
import { planeRef } from '../../shared/recipe'
import type { Library } from '../library'
import { encodeGreyPng } from '../pngio'
import { sourceOrientation } from '../source'
import type { PlaneStore } from '../planestore'
import { pause, type AiContext, type AiRunner } from './jobs'

type SegmentRequest = Extract<AiStartRequest, { task: 'segment' }>

/** Segment planes are this many pixels on their long edge (as painted planes are). */
const PLANE_EDGE = 1024

export const fakeAi = (): boolean => process.env.PLAYROOM_FAKE_AI === '1'

export class SegmentRunner implements AiRunner<SegmentRequest> {
  readonly task = 'segment' as const

  constructor(
    private readonly library: Library,
    private readonly planes: PlaneStore
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

  async run(
    ctx: AiContext,
    req: SegmentRequest
  ): Promise<{ kind: 'mask'; ref: string; width: number; height: number; label: string }> {
    const row = await this.library.photoRow(req.key)
    const info = await this.library.probe(row)
    // The base frame: the file upright, as painted planes are kept.
    const turned = ['Transpose', 'Rotate90', 'Transverse', 'Rotate270'].includes(
      sourceOrientation(info, null)
    )
    const fw = turned ? info.height : info.width
    const fh = turned ? info.width : info.height
    const k = PLANE_EDGE / Math.max(fw, fh)
    const w = Math.max(1, Math.round(fw * k))
    const h = Math.max(1, Math.round(fh * k))
    ctx.stage('model', 0, 'Loading the model')
    await this.stand(ctx, 700)
    ctx.stage('analyse', 0, `Finding the ${SEGMENT_LABEL[req.target].toLowerCase()}`)
    await this.stand(ctx, 2200)
    ctx.stage('refine', 0, 'Refining the edges')
    const plane = standInPlane(req.target, w, h)
    await this.stand(ctx, 900)
    const png = encodeGreyPng(plane, w, h).toString('base64')
    const ref = planeRef(png)
    this.planes.put(ref, png)
    return { kind: 'mask', ref, width: w, height: h, label: SEGMENT_LABEL[req.target] }
  }

  /** The stand-in's time on a stage, reported as the model would. */
  private async stand(ctx: AiContext, ms: number): Promise<void> {
    const steps = Math.max(1, Math.round(ms / 100))
    for (let i = 1; i <= steps; i++) {
      await pause(ms / steps, ctx.signal)
      ctx.progress(i / steps)
    }
  }
}

/** The stand-in's plane: a soft figure for a subject, the top for a sky, and the rest for a background. */
function standInPlane(target: SegmentTarget, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  const s = Math.min(w, h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v: number
      if (target === 'sky') v = 1 - Math.min(1, Math.max(0, (y / h - 0.28) / 0.12))
      else {
        // A head over shoulders, centred.
        const head = Math.hypot((x - w / 2) / (0.13 * s), (y - 0.36 * h) / (0.17 * s))
        const body = Math.hypot((x - w / 2) / (0.3 * s), (y - 0.95 * h) / (0.42 * s))
        const d = Math.min(head, body)
        v = 1 - Math.min(1, Math.max(0, (d - 0.92) / 0.16))
        if (target === 'background') v = 1 - v
      }
      out[y * w + x] = Math.round(v * 255)
    }
  return out
}
