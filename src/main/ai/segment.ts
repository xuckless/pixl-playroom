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
 * Engine 0.19's named masks: the sky, vegetation and water are DINOv2-S+ADE's
 * planes, soft and guided wide (the engine's stated upsample for its sky); a
 * person's hair, face, skin and clothes are Selfie Multiclass's, found on
 * the photo and again on a square around the person (the model reads
 * 256 × 256: a half-body portrait's person is otherwise a few dozen of its
 * pixels), each part kept where it beats the others.
 */
import { t } from '../../shared/i18n'
import type { AiResult, AiStartRequest } from '../../shared/ai'
import {
  estimate,
  isPartTarget,
  isSceneTarget,
  OFFERED_PHRASE_MODEL,
  PHRASE_MODELS,
  SAM3_PHRASE,
  segmentModel,
  SEGMENT_LABEL,
  type PartTarget
} from '../../shared/ai'
import type { LensCorrection } from '../../shared/engine-types'
import {
  FACE_DETECTOR,
  FACE_LANDMARKER,
  faceTiles,
  isFacePart,
  leftToRight,
  mergeFaces,
  partRings,
  type FaceOutline,
  type FacePart
} from '../../shared/faceparts'
import { lensCorrection } from '../../shared/lens'
import { hardenPlane } from '../../shared/refine'
import { partPlane, pasted, personBox, squareAround } from './parts'
import { planeRef } from '../planeref'
import type { EngineClient, FaceReport } from '../engine/client'
import type { Library } from '../library'
import { encodeGreyPng, grey8 } from '../pngio'
import type { PlaneStore } from '../planestore'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { paths } from '../paths'
import { ensureProxies, type ProxyFile } from '../proxy'
import type { DevelopSessions } from '../render'
import { BACKGROUND_THREADS, blankRequest } from '../source'
import { READ_LIMITS } from '../../shared/limits'
import type { SamResult } from '../../shared/engine-types'
import log from 'electron-log/main'
import { Cancelled, type AiContext, type AiRunner } from './jobs'
import { ModelMissing, type ModelStore } from './models'
import { heavyAllowedNow } from './switches'

type SegmentRequest = Extract<AiStartRequest, { task: 'segment' }>

/**
 * How the model's 320 px answer reaches the proxy: guided by the photo's
 * luminance over about one of the model's pixels. A wider box blurred the
 * edge wherever the ground beside the subject is flat (0.02 made a glow
 * about 100 px wide on a 24 MP portrait against a plain wall).
 */
const UPSAMPLE = { Guided: { radius: 0.004, epsilon: 0.001 } }
const DEPTH_UPSAMPLE = { Resample: { kernel: 'Bilinear' } }
/** The model's answer is soft over a few of its pixels: its middle is stretched this many times. */
const HARDEN = 4
/**
 * Where it is stretched about, 0…1: a little above the middle, so the mask
 * leaves the uncertain rim (light wall along dark hair) rather than taking it.
 */
const HARDEN_AT = 0.6

/** The engine's stated upsample for DINOv2's sky (a stopgap), used for its other planes too. */
const SCENE_UPSAMPLE = { Guided: { radius: 0.02, epsilon: 0.001 } }
/** A scene plane covering less of the frame than this found nothing. */
const NOTHING_FOUND = 0.002
/** Selfie Multiclass's planes for each part (summed). */
const PART_PLANES: Record<PartTarget, string[]> = {
  face: ['face_skin'],
  hair: ['hair'],
  skin: ['face_skin', 'body_skin'],
  clothes: ['clothes']
}

/** The subject models, best first. (U²-Net, retired by engine 0.17, went with 0.18.) */
const SUBJECT_MODELS = ['u2netp']

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
      { id: 'model', label: t('Model'), weight: 0.15 },
      { id: 'analyse', label: t('Analyse'), weight: 0.6 },
      { id: 'refine', label: t('Refine'), weight: 0.25 }
    ]
  }

  title(req: SegmentRequest): { title: string; subject: string } {
    return { title: t('Segmenting'), subject: t(SEGMENT_LABEL[req.target]) }
  }

  /** The subject model to use: the best one downloaded, or null. */
  async model(): Promise<string | null> {
    for (const id of SUBJECT_MODELS) if (await this.models.installed(id)) return id
    return null
  }

  async run(ctx: AiContext, req: SegmentRequest): Promise<Extract<AiResult, { kind: 'mask' }>> {
    ctx.stage('model', 0, t('Loading the model'))
    if (isFacePart(req.target)) return this.faceParts(ctx, req, req.target)
    if (req.target === 'phrase') return this.phrase(ctx, req)
    const depth = req.target === 'depth'
    const scene = isSceneTarget(req.target)
    // The model the ask names (the depth map, the fine cut-out, a scene's or
    // a person's planes), else the subject model.
    const named =
      depth || scene || isPartTarget(req.target) || req.fine
        ? segmentModel(req.target, req.fine)
        : null
    const id = named ? ((await this.models.installed(named)) ? named : null) : await this.model()
    if (!id) throw new ModelMissing(this.models.entry(named ?? 'u2netp'))
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

    ctx.stage(
      'analyse',
      0,
      t('Finding the {{subject}}', { subject: t(SEGMENT_LABEL[req.target]).toLowerCase() })
    )
    const t0 = Date.now()
    // BiRefNet: 13.5 s on the M2 Pro's CPU with a 24 MP decode, about 10 s from a
    // proxy (its 1024² grid is fixed); DINOv2 about a second; U²-Netp and
    // Selfie Multiclass a moment.
    const expected = req.fine ? 10000 : 2500
    const tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, expected), true), 200)
    let report: Awaited<ReturnType<EngineClient['segment']>>
    const lens = lensCorrection(recipe.lens)
    if (isPartTarget(req.target)) {
      try {
        return await this.part(ctx, req, req.target, row.id, px.proxy, lens, segmenter)
      } finally {
        clearInterval(tick)
      }
    }
    const request = (model: Record<string, unknown>): Record<string, unknown> => ({
      source: { Path: px.proxy.path },
      input: px.proxy.input,
      raw: null,
      gain_map: null,
      // The proxy is the base frame, upright: what masks are placed on.
      orientation: 'Normal',
      lens,
      segmenter: { Classes: model },
      // A depth map's edges aren't the picture's: bilinear (engine 0.18).
      upsample: depth ? DEPTH_UPSAMPLE : scene ? SCENE_UPSAMPLE : UPSAMPLE,
      png: { compression: 'Fast', filter: 'Sub' },
      threads: BACKGROUND_THREADS,
      limits: READ_LIMITS,
      // At the proxy's own size: the edge is followed there, not stretched later.
      plane_longest: null
    })
    try {
      // Stopped mid-run by the signal (the engine's model calls take one since 0.16).
      report = await this.engine.segment(request(segmenter), { signal: ctx.signal })
    } catch (err) {
      if (ctx.signal.aborted) throw new Cancelled()
      throw err
    } finally {
      clearInterval(tick)
    }
    const plane = scene ? report.planes.find((p) => p.name === req.target) : report.planes[0]
    if (!plane) throw new Error('the model returned no plane')
    if (scene) {
      const label = t(SEGMENT_LABEL[req.target])
      if (plane.coverage < NOTHING_FOUND)
        throw new Error(t('No {{label}} found in this photo', { label: label.toLowerCase() }))
      // The plane as it is: soft where the model is unsure (sky through branches).
      const d = grey8(Buffer.from(plane.png))
      const png = encodeGreyPng(d.data, d.width, d.height).toString('base64')
      const ref = planeRef(png)
      this.planes.put(ref, png)
      return {
        kind: 'mask',
        ref,
        width: d.width,
        height: d.height,
        label,
        source: { kind: 'segment', target: req.target as 'sky' | 'vegetation' | 'water' },
        ...(req.into ? { into: { ...req.into } } : {})
      }
    }
    if (req.target === 'depth') {
      // The map as it is (255 the nearest thing in the photo): the range is keyed on it.
      const d = grey8(Buffer.from(plane.png))
      const png = encodeGreyPng(d.data, d.width, d.height).toString('base64')
      const ref = planeRef(png)
      this.planes.put(ref, png)
      return {
        kind: 'mask',
        ref,
        width: d.width,
        height: d.height,
        label: t(SEGMENT_LABEL.depth),
        depth: true,
        ...(req.into ? { into: { ...req.into } } : {})
      }
    }
    if (plane.raw_max < NOTHING_SALIENT)
      throw new Error(t('No clear subject in this photo: try a brush or a range mask'))

    ctx.stage('refine', 0, t('Refining the edges'))
    // The 16-bit plane as a painted plane's 8 bits.
    const d = grey8(Buffer.from(plane.png))
    const grey = d.data
    if (req.target === 'background') for (let i = 0; i < grey.length; i++) grey[i] = 255 - grey[i]
    // Measured on a 24 MP portrait: the edge went from fading over 24–75 px
    // to 5–9 px, and to 11–13 px with the render's snap.
    // BiRefNet's matte keeps hair and fur: hardening would cut them.
    if (!req.fine) hardenPlane(grey, HARDEN_AT, HARDEN)
    ctx.progress(0.8)
    const png = encodeGreyPng(grey, d.width, d.height).toString('base64')
    const ref = planeRef(png)
    this.planes.put(ref, png)
    return {
      kind: 'mask',
      ref,
      width: d.width,
      height: d.height,
      label: req.fine
        ? t('{{label}} (fine)', { label: t(SEGMENT_LABEL[req.target]) })
        : t(SEGMENT_LABEL[req.target]),
      source: {
        kind: 'segment',
        target: req.target as 'subject' | 'background',
        ...(req.fine ? { fine: true as const } : {})
      },
      // Into the mask it was asked for (Add to the selected mask, a smart look's), else a new one.
      ...(req.into ? { into: { ...req.into } } : {})
    }
  }

  /**
   * Anything named by a phrase (engine 0.19's `segmentConcept`): SAM 3, or
   * EfficientSAM3 when only it is here. Every instance it finds goes into
   * the one mask. The plane is brought up bilinear: SAM 3's guided upsample
   * lost small objects whose edge the luminance doesn't carry (the roster's
   * measurement); the render's snap firms the edge instead.
   */
  private async phrase(
    ctx: AiContext,
    req: SegmentRequest
  ): Promise<Extract<AiResult, { kind: 'mask' }>> {
    const text = (req.phrase ?? '').trim().slice(0, 80)
    if (!text) throw new Error(t('Type what to find: “red car”, “the dog”'))
    let id: string | null = null
    // SAM 3 only while it is on (a passing benchmark, shared/heavy.ts) and not held (E58).
    for (const m of PHRASE_MODELS) {
      if (id || (m === 'sam3' && !(SAM3_PHRASE && (await heavyAllowedNow('sam3'))))) continue
      if (await this.models.installed(m)) id = m
    }
    if (!id) throw new ModelMissing(this.models.entry(OFFERED_PHRASE_MODEL))
    const row = await this.library.photoRow(req.key)
    const info = await this.library.probe(row)
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    const px = await ensureProxies(this.engine, row, info, BACKGROUND_THREADS)
    const recipe = this.sessions()?.liveRecipe(req.key) ?? (await this.library.recipe(req.key))
    const ref = (await this.models.ref(id, 'Cpu')) as {
      encoder: Record<string, unknown>
      text_encoder: Record<string, unknown>
      decoder: Record<string, unknown>
      segment: { min_score: number; max_instances: number; activation: string }
    }
    if (ctx.signal.aborted) throw new Cancelled()
    const lens = lensCorrection(recipe.lens)
    ctx.stage('analyse', 0, t('Finding “{{text}}”', { text }))
    // SAM 3: about 9 s for the photo, then a second a phrase (8 CPU threads,
    // the roster); EfficientSAM3 1.4 s and half a second.
    const expected = id === 'sam3' ? 10_000 : 2_000
    const t0 = Date.now()
    const tick = setInterval(() => ctx.progress(estimate(Date.now() - t0, expected), true), 200)
    let r: Extract<SamResult, { op: 'concept' }>
    try {
      r = (await this.engine.sam(
        {
          op: 'concept',
          // The same frame (photo, proxy, lens) and model: its embedding is reused.
          key: `${row.id}:${px.proxy.path}:${JSON.stringify(lens)}:${id}`,
          embed: {
            source: { Path: px.proxy.path },
            input: px.proxy.input,
            raw: null,
            gain_map: null,
            orientation: 'Normal',
            lens,
            encoder: ref.encoder,
            guide: false,
            limits: READ_LIMITS,
            threads: BACKGROUND_THREADS
          },
          request: {
            text_encoder: ref.text_encoder,
            decoder: ref.decoder,
            prompt: { text, exemplars: [] },
            min_score: ref.segment.min_score,
            max_instances: ref.segment.max_instances,
            activation: ref.segment.activation,
            upsample: DEPTH_UPSAMPLE,
            bounds_at: null,
            png: { compression: 'Fast', filter: 'Sub' },
            threads: BACKGROUND_THREADS
          }
        },
        { signal: ctx.signal }
      )) as Extract<SamResult, { op: 'concept' }>
    } catch (err) {
      if (ctx.signal.aborted) throw new Cancelled()
      throw err
    } finally {
      clearInterval(tick)
    }
    log.info(
      'phrase',
      id,
      JSON.stringify(text),
      `${r.instances.length} found`,
      r.reused ? 'embedding reused' : `embedding ${r.embedMs} ms`,
      `phrase ${r.conceptMs} ms`
    )
    if (r.instances.length === 0)
      throw new Error(
        t('Nothing found for “{{text}}”: try other words, or Objects to draw a box', { text })
      )
    ctx.stage('refine', 0, t('Joining what was found'))
    // Every instance in the one mask: the most of them at each pixel.
    let plane: { data: Uint8Array; width: number; height: number } | null = null
    for (const i of r.instances) {
      const g = grey8(Buffer.from(i.png))
      if (!plane) plane = g
      else
        for (let k = 0; k < plane.data.length; k++)
          if (g.data[k] > plane.data[k]) plane.data[k] = g.data[k]
    }
    const png = encodeGreyPng(plane!.data, plane!.width, plane!.height).toString('base64')
    const pref = planeRef(png)
    this.planes.put(pref, png)
    return {
      kind: 'mask',
      ref: pref,
      width: plane!.width,
      height: plane!.height,
      label: text.charAt(0).toUpperCase() + text.slice(1),
      source: { kind: 'phrase', text },
      ...(req.into ? { into: { ...req.into } } : {})
    }
  }

  /**
   * A face part (engine 0.19's `faces`): every face's outline of it, as a
   * lasso. YuNet sees the frame fitted into 640² (reliable down to 1/8 of
   * its long side), so the four overlapping quarters are looked at too, for
   * a group's smaller faces; a face found twice is kept once.
   */
  private async faceParts(
    ctx: AiContext,
    req: SegmentRequest,
    part: FacePart
  ): Promise<Extract<AiResult, { kind: 'mask' }>> {
    for (const id of [FACE_DETECTOR, FACE_LANDMARKER])
      if (!(await this.models.installed(id))) throw new ModelMissing(this.models.entry(id))
    const row = await this.library.photoRow(req.key)
    const info = await this.library.probe(row)
    if (this.engine.getStatus().status === 'starting') {
      this.engine.start()
      await this.engine.whenStarted()
    }
    const px = await ensureProxies(this.engine, row, info, BACKGROUND_THREADS)
    const recipe = this.sessions()?.liveRecipe(req.key) ?? (await this.library.recipe(req.key))
    const detector = await this.models.ref(FACE_DETECTOR, 'Cpu')
    const landmarks = await this.models.ref(FACE_LANDMARKER, 'Cpu')
    if (ctx.signal.aborted) throw new Cancelled()
    const label = t(SEGMENT_LABEL[part])
    ctx.stage('analyse', 0, t('Finding faces'))
    const W = px.proxy.width
    const H = px.proxy.height
    const look = async (
      region: { x: number; y: number; width: number; height: number } | null
    ): Promise<FaceReport['faces']> => {
      try {
        const r = await this.engine.faces(
          {
            source: { Path: px.proxy.path },
            input: px.proxy.input,
            raw: null,
            gain_map: null,
            // The proxy is the base frame, upright, after the lens: what masks are placed on.
            orientation: 'Normal',
            lens: lensCorrection(recipe.lens),
            region: region ? { ...region, margin: 0 } : null,
            detector,
            landmarks,
            threads: BACKGROUND_THREADS,
            limits: READ_LIMITS
          },
          { signal: ctx.signal }
        )
        return r.faces
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled()
        throw err
      }
    }
    const whole = await look(null)
    ctx.progress(0.4)
    const tiles: { tile: ReturnType<typeof faceTiles>[number]; faces: FaceReport['faces'] }[] = []
    for (const tile of faceTiles(W, H)) tiles.push({ tile, faces: await look(tile) })
    const faces = mergeFaces(whole, tiles, W, H)
    const outlines: FaceOutline[] = leftToRight(
      faces
        .filter((f) => f.outlines)
        .map((f) => ({
          bounds: [f.bounds[0] / W, f.bounds[1] / H, f.bounds[2] / W, f.bounds[3] / H] as [
            number,
            number,
            number,
            number
          ],
          rings: partRings(f.outlines!, part)
        }))
        .filter((f) => f.rings.length > 0)
    )
    if (outlines.length === 0) throw new Error(t('No face found in this photo for {{label}}', { label }))
    ctx.progress(0.9)
    return {
      kind: 'mask',
      ref: '',
      width: W,
      height: H,
      label,
      polygon: { part, faces: outlines, face: null },
      ...(req.into ? { into: { ...req.into } } : {})
    }
  }

  /**
   * A person's part: Selfie Multiclass on the photo, to find where the
   * person is, then on a square around them, its planes laid back where the
   * square came from. The part is kept where it beats the person's other
   * parts (a dark jumper read as some hair stays clothes) and hardened a
   * little: the model's edges are soft.
   */
  private async part(
    ctx: AiContext,
    req: SegmentRequest,
    target: PartTarget,
    photoId: number,
    proxy: ProxyFile,
    lens: LensCorrection | null,
    segmenter: Record<string, unknown>
  ): Promise<Extract<AiResult, { kind: 'mask' }>> {
    const run = async (
      path: string,
      input: string,
      withLens: LensCorrection | null
    ): Promise<{ name: string; data: Uint8Array; width: number; height: number }[]> => {
      try {
        const r = await this.engine.segment(
          {
            source: { Path: path },
            input,
            raw: null,
            gain_map: null,
            orientation: 'Normal',
            lens: withLens,
            segmenter: { Classes: segmenter },
            upsample: UPSAMPLE,
            png: { compression: 'Fast', filter: 'Sub' },
            threads: BACKGROUND_THREADS,
            limits: READ_LIMITS,
            plane_longest: null
          },
          { signal: ctx.signal }
        )
        return r.planes.map((p) => ({ name: p.name, ...grey8(Buffer.from(p.png)) }))
      } catch (err) {
        if (ctx.signal.aborted) throw new Cancelled()
        throw err
      }
    }
    const label = t(SEGMENT_LABEL[target])
    const whole = await run(proxy.path, proxy.input, lens)
    const { width: W, height: H } = whole[0]
    const box = personBox(whole, W, H)
    if (!box) throw new Error(t('No person found in this photo for {{label}}: try a brush', { label }))
    const sq = squareAround(box, W, H)
    let planes = whole
    // The person already fills the frame: the first answer is as good as it gets.
    if (sq.side < 0.9 * Math.min(W, H)) {
      const cropPath = join(paths.photoCache(photoId), `parts-${process.pid}-${Date.now()}.tiff`)
      try {
        await this.engine.convert({
          ...blankRequest(proxy.path, cropPath, proxy.input),
          lens,
          pixel: { depth: proxy.float ? 'F32' : 'Sixteen', channels: 3 },
          encode: { Tiff: { compression: 'None' } },
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          color: 'Preserve',
          framing: {
            orientation: 'Normal',
            rotate_degrees: 0,
            rotate_resampler: 'Lanczos3',
            crop: { x: sq.x / W, y: sq.y / H, width: sq.side / W, height: sq.side / H }
          },
          threads: BACKGROUND_THREADS
        })
        const near = await run(cropPath, 'Tiff', null)
        planes = near.map((p) => ({ ...p, data: pasted(p, sq, W, H), width: W, height: H }))
      } finally {
        await unlink(cropPath).catch(() => undefined)
      }
    }
    ctx.stage('refine', 0, t('Refining the edges'))
    const grey = partPlane(planes, PART_PLANES[target], W * H)
    let any = false
    for (let i = 0; i < grey.length && !any; i++) any = grey[i] >= 128
    if (!any)
      throw new Error(t('No {{label}} found in this photo', { label: label.toLowerCase() }))
    hardenPlane(grey, 0.5, 3)
    ctx.progress(0.8)
    const png = encodeGreyPng(grey, W, H).toString('base64')
    const ref = planeRef(png)
    this.planes.put(ref, png)
    return {
      kind: 'mask',
      ref,
      width: W,
      height: H,
      label,
      source: { kind: 'person', part: target },
      ...(req.into ? { into: { ...req.into } } : {})
    }
  }
}
