/**
 * Select by box, clicks and strokes: SAM 2.1 (engine 0.16) on a photo, for
 * the Objects and Sky tools, a lasso's Find object, and smart looks that
 * point at an object.
 *
 * It runs on its own engine host ("select"), at normal priority and never
 * held behind the develop view's renders, so a hover's decode is not queued
 * behind a minutes-long denoise, and a crash here takes no render with it.
 * The heavy encoder runs once per photo (about a second on the CPU: CoreML
 * takes a minute to compile it and is no faster), and its embedding stays
 * in that host; every prompt after it is one decoder run (tens of
 * milliseconds), so a mask can follow the pointer.
 *
 * Masks are of the base frame after the lens correction (the photo's proxy,
 * as Select Subject sees it): what masks are placed on. A selection keeps
 * the prompt it was built from, step by step (shared/prompt.ts), so a host
 * that died (or slept) is caught up by asking again.
 *
 * The host is put to sleep after a few idle minutes: SAM's two models are
 * hundreds of megabytes.
 */
import log from 'electron-log/main'
import type {
  LensCorrection,
  MaskBounds,
  ModelRef,
  PlaneUpsample,
  PromptEmbeddingRequest,
  PromptSegmentRequest,
  SamResult
} from '../../shared/engine-types'
import type { ConceptSize } from '../../shared/concepts'
import { lensCorrection } from '../../shared/lens'
import { guidedKeeps, SAM_GRID } from './size'
import {
  addPart,
  enginePrompt,
  promptSteps,
  strokeObject,
  strokePrompt,
  type PromptGeometry,
  type PromptSourceAsk,
  type SelectCommit,
  type SelectDecode,
  type SelectPlane
} from '../../shared/prompt'
import { hash32 } from '../../shared/recipe'
import { EngineError, type EngineClient } from '../engine/client'
import type { Library } from '../library'
import { encodeGreyPng, grey8 } from '../pngio'
import type { PlaneStore } from '../planestore'
import { planeRef } from '../planeref'
import { ensureProxies } from '../proxy'
import type { DevelopSessions } from '../render'
import { interactiveThreads, versionStamp } from '../source'
import { READ_LIMITS } from '../../shared/limits'
import type { ModelStore } from '../ai/models'

/** The prompt segmenter the roster ships. */
export const SAM_MODEL = 'sam2-1-hiera-tiny'
const ENCODER = 'sam-encoder'
const DECODER = 'sam-decoder'
/** A committed mask is made at the frame's own size (the proxy's, up to 2560 px), not smaller. */
const FRAME_SIZE = Infinity
/** The longest a live preview plane is asked for. */
const PREVIEW_MAX = 1024
/** Embeddings kept, as the host keeps them. */
const KEEP_EMBEDDINGS = 3
/** The host goes to sleep after this long with nothing selecting. */
const IDLE_MS = 3 * 60_000
/**
 * The decoder's logits are upsampled as they are and only then clamped into
 * 0…1: SAM's own cut (at a logit of 0) with about a pixel of anti-aliasing.
 * A sigmoid comes first otherwise, on SAM's 256 px grid, and the soft values
 * it gives are then stretched to the frame: measured on a 24 MP CR2, an edge
 * that faded over about 125 px at full size, and a subject that was barely
 * selected anywhere.
 */
const ACTIVATION = 'None'
/**
 * A committed plane's edge is pulled onto the photo's at the frame's size:
 * the guided filter's box is a few of SAM's grid pixels (about how far its
 * 256 px answer is off), no wider, or flat ground beside the subject would
 * blur the edge again. At least a grid pixel, or a long panorama's is refused.
 */
function guided(frameWidth: number, frameHeight: number): PlaneUpsample {
  const shorter = (SAM_GRID * Math.min(frameWidth, frameHeight)) / Math.max(frameWidth, frameHeight)
  return { Guided: { radius: Math.max(0.004, 0.6 / shorter), epsilon: 0.001 } }
}
/** A live preview is the decoder's answer, resampled: the quickest. */
const RESAMPLED: PlaneUpsample = { Resample: { kernel: 'Bilinear' } }
/** How a plane reaches its size: guided for a mask kept, resampled for a preview. */
type Upsample = 'guided' | 'resampled'

/** The longer side of the unkept answer that only measures an object. */
const SIZE_PROBE = 256

/** The largest of a decode's answers' bounds (null when none found anything). */
function largest(planes: { bounds: MaskBounds | null }[]): MaskBounds | null {
  let best: MaskBounds | null = null
  for (const p of planes)
    if (p.bounds && (!best || p.bounds.width * p.bounds.height > best.width * best.height))
      best = p.bounds
  return best
}
/** A lens correction masks are placed after (none: null). */
type Lens = LensCorrection | null
/** A grey plane, 8 bits, row by row. */
export interface Grey {
  data: Uint8Array
  width: number
  height: number
}

interface Embedding {
  id: string
  generation: number
  ready: Promise<{ frameWidth: number; frameHeight: number }>
}

interface Selection {
  id: string
  key: string
  embKey: string
  prompt: PromptGeometry | null
  probe: AbortController | null
  last: SelectPlane | null
  /** A class's clicks keep SAM's answer of this size (shared/concepts.ts). */
  size?: ConceptSize
}

/** The decode the engine could not run because the host is new: catch up and try again. */
const isStale = (err: unknown): boolean => err instanceof EngineError && err.code === 'Stale'

let nextId = 1

export class SelectService {
  private loadedFor = -1
  private loading: Promise<void> | null = null
  private readonly embeddings = new Map<string, Embedding>()
  private readonly selections = new Map<string, Selection>()
  private refs: { encoder: Record<string, unknown>; decoder: Record<string, unknown> } | null = null
  private idle: ReturnType<typeof setTimeout> | null = null
  /** One-shot jobs running (smart looks, a photo not open): the host stays awake for them. */
  private busy = 0

  constructor(
    private readonly engine: EngineClient,
    /** Builds proxies when a photo has none yet. */
    private readonly proxyEngine: EngineClient,
    private readonly library: Library,
    private readonly planes: PlaneStore,
    private readonly models: ModelStore,
    private readonly sessions: () => DevelopSessions | undefined
  ) {
    // A new host holds nothing: every embedding and lane is to be made again.
    engine.onSpawn(() => {
      this.loadedFor = -1
      this.embeddings.clear()
    })
  }

  /** Whether SAM's model is on this machine. */
  installed(): Promise<boolean> {
    return this.models.installed(SAM_MODEL)
  }

  // ── Models and embeddings ────────────────────────────────────────────────

  private async sessionsReady(): Promise<void> {
    if (this.loadedFor === this.engine.generation && this.engine.getStatus().status === 'ready')
      return
    this.loading ??= (async () => {
      // CPU: CoreML takes about a minute to compile SAM's encoder, for no gain.
      const ref = (await this.models.ref(SAM_MODEL, 'Cpu')) as {
        encoder: Record<string, unknown> & { model: ModelRef }
        decoder: Record<string, unknown> & { model: ModelRef }
      }
      const threads = Math.max(2, interactiveThreads())
      ref.encoder.model = {
        ...ref.encoder.model,
        session: { threads, optimisation: 'All', deterministic: false }
      }
      // One prompt at a time, small: two threads answer as fast as eight.
      ref.decoder.model = {
        ...ref.decoder.model,
        session: { threads: 2, optimisation: 'All', deterministic: false }
      }
      await this.engine.sam({ op: 'load', session: ENCODER, ref: ref.encoder.model })
      await this.engine.sam({ op: 'load', session: DECODER, ref: ref.decoder.model })
      this.refs = ref
      this.loadedFor = this.engine.generation
    })().finally(() => (this.loading = null))
    return this.loading
  }

  /** The lens correction a photo's masks are placed after: the one given, else its recipe's. */
  private async lensFor(key: string, lens?: Lens): Promise<Lens> {
    if (lens !== undefined) return lens
    const recipe = this.sessions()?.liveRecipe(key) ?? (await this.library.recipe(key))
    return lensCorrection(recipe.lens)
  }

  private async embKeyOf(key: string, lens?: Lens): Promise<string> {
    const row = await this.library.photoRow(key)
    const l = JSON.stringify(await this.lensFor(key, lens))
    return `${key}|${versionStamp(row)}|${hash32(l).toString(16)}`
  }

  /** The photo's embedding, made if it is not held (the encoder, about a second). */
  private async embedding(
    key: string,
    signal?: AbortSignal,
    /** The lens correction to embed after; the live recipe's when not given. */
    lens?: Lens
  ): Promise<{ embKey: string; e: Embedding }> {
    await this.sessionsReady()
    const embKey = await this.embKeyOf(key, lens)
    const had = this.embeddings.get(embKey)
    if (had && had.generation === this.engine.generation) {
      // Most recent last, as the host keeps them.
      this.embeddings.delete(embKey)
      this.embeddings.set(embKey, had)
      await had.ready
      return { embKey, e: had }
    }
    const id = `emb-${nextId++}`
    const e: Embedding = {
      id,
      generation: this.engine.generation,
      ready: (async () => {
        const row = await this.library.photoRow(key)
        const info = await this.library.probe(row)
        const px = await ensureProxies(this.proxyEngine, row, info)
        const request: PromptEmbeddingRequest = {
          source: { Path: px.proxy.path },
          input: px.proxy.input,
          raw: null,
          gain_map: null,
          // The proxy is the base frame, upright: what masks are placed on.
          orientation: 'Normal',
          lens: await this.lensFor(key, lens),
          encoder: this.refs!.encoder,
          // Kept for the committed plane's guided upsample (about 10 MB more).
          guide: true,
          limits: READ_LIMITS,
          threads: Math.max(2, interactiveThreads())
        }
        const t0 = Date.now()
        const r = (await this.engine.sam(
          { op: 'embed', id, session: ENCODER, request },
          { signal }
        )) as Extract<SamResult, { op: 'embed' }>
        log.info('sam embedding', key, `${Date.now() - t0} ms`, r.provenance.frame_width)
        return { frameWidth: r.provenance.frame_width, frameHeight: r.provenance.frame_height }
      })()
    }
    this.embeddings.set(embKey, e)
    while (this.embeddings.size > KEEP_EMBEDDINGS) {
      const oldest = this.embeddings.keys().next().value as string
      this.embeddings.delete(oldest)
    }
    try {
      await e.ready
    } catch (err) {
      if (this.embeddings.get(embKey) === e) this.embeddings.delete(embKey)
      throw err
    }
    return { embKey, e }
  }

  private async decodeOn(
    lane: string,
    embKey: string,
    prompt: PromptGeometry,
    opts: {
      count?: number
      maskInput: boolean
      keep: boolean
      upsample: Upsample
      longest: number
      signal?: AbortSignal
      /** Every answer the decoder gives, not only its best. */
      all?: boolean
      /** Of every answer, the one of this size, kept for the lane and answered with. */
      pick?: ConceptSize
    }
  ): Promise<Extract<SamResult, { op: 'decode' }>> {
    const e = this.embeddings.get(embKey)
    if (!e) throw Object.assign(new EngineError({ message: 'embedding gone', code: 'Stale' }))
    const { frameWidth, frameHeight } = await e.ready
    const long = Math.max(frameWidth, frameHeight)
    const decode = async (
      upsample: Upsample,
      longest: number,
      keep: boolean
    ): Promise<Extract<SamResult, { op: 'decode' }>> => {
      const request: PromptSegmentRequest = {
        decoder: this.refs!.decoder,
        prompt: enginePrompt(prompt, opts.count),
        candidates: opts.all || opts.pick ? 'All' : 'HighestPredictedIou',
        activation: ACTIVATION,
        upsample: upsample === 'guided' ? guided(frameWidth, frameHeight) : RESAMPLED,
        bounds_at: 0.5,
        png: { compression: 'Fast', filter: 'NoFilter' },
        threads: 2,
        plane_longest: longest < long ? longest : null
      }
      return (await this.engine.sam(
        {
          op: 'decode',
          embedding: e.id,
          session: DECODER,
          lane,
          request,
          maskInput: opts.maskInput,
          keep,
          ...(opts.pick ? { pick: opts.pick } : {})
        },
        { signal: opts.signal }
      )) as Extract<SamResult, { op: 'decode' }>
    }
    let upsample = opts.upsample
    if (upsample === 'guided') {
      // Guided only for an object big enough to keep through its box (engine
      // 0.18): a box prompt says its size; else a small, unkept answer does.
      const size = prompt.rect
        ? { width: prompt.rect.width * frameWidth, height: prompt.rect.height * frameHeight }
        : largest((await decode('resampled', SIZE_PROBE, false)).planes)
      if (!guidedKeeps(size, long)) upsample = 'resampled'
    }
    return decode(upsample, opts.longest, opts.keep)
  }

  /**
   * Make a prompt's mask on `lane`, its steps in order (each feeding the
   * next), the last at `longest` with `upsample`.
   */
  private async replay(
    lane: string,
    embKey: string,
    prompt: PromptGeometry,
    upsample: Upsample,
    longest: number,
    signal?: AbortSignal,
    pick?: ConceptSize
  ): Promise<Extract<SamResult, { op: 'decode' }>> {
    const steps = promptSteps(prompt)
    let out: Extract<SamResult, { op: 'decode' }> | null = null
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1
      out = await this.decodeOn(lane, embKey, prompt, {
        count: steps[i],
        maskInput: i > 0,
        keep: true,
        // The steps before the last are only the next one's input.
        upsample: last ? upsample : 'resampled',
        longest: last ? longest : 256,
        signal,
        ...(pick ? { pick } : {})
      })
    }
    return out!
  }

  // ── Selections: the Objects and Sky tools ────────────────────────────────

  /** Start selecting on a photo: its embedding made (or found), ready for prompts. */
  async open(key: string): Promise<{ selId: string }> {
    this.awake()
    const { embKey } = await this.embedding(key)
    const id = `sel-${nextId++}`
    this.selections.set(id, { id, key, embKey, prompt: null, probe: null, last: null })
    return { selId: id }
  }

  /**
   * A prompt's mask. A probe stops the probe before it (a hover moved on)
   * and changes nothing kept; `replace` starts the selection again from this
   * prompt; `part` adds clicks (Shift: a part, Alt: not a part) to what is
   * selected, refining it. Null for a probe a later one replaced.
   */
  async decode(selId: string, req: SelectDecode): Promise<SelectPlane | null> {
    const sel = this.selections.get(selId)
    if (!sel) throw new Error('this selection is closed')
    this.awake()
    const t0 = Date.now()
    if (req.mode === 'probe') {
      sel.probe?.abort()
      const abort = new AbortController()
      sel.probe = abort
      try {
        const r = await this.withCatchUp(sel, () =>
          this.decodeOn(`${sel.id}-probe`, sel.embKey, req.prompt, {
            maskInput: false,
            keep: false,
            upsample: 'resampled',
            longest: Math.min(PREVIEW_MAX, Math.max(64, Math.round(req.longest ?? PREVIEW_MAX))),
            signal: abort.signal
          })
        )
        return planeOf(req.seq, r, Date.now() - t0)
      } catch (err) {
        if (abort.signal.aborted || (err instanceof EngineError && err.cancelled)) return null
        throw err
      } finally {
        if (sel.probe === abort) sel.probe = null
      }
    }
    if (req.mode === 'replace') sel.size = req.size
    const pick = sel.size
    const prev = sel.prompt
    const next: PromptGeometry =
      req.mode === 'replace' || !prev
        ? { rect: req.prompt.rect, points: [...req.prompt.points] }
        : addPart(prev, req.prompt)
    sel.probe?.abort()
    const r = await this.withCatchUp(sel, async () => {
      if (req.mode === 'part' && prev) {
        // On the selection as it stands (its lane holds the last answer).
        return this.decodeOn(sel.id, sel.embKey, next, {
          maskInput: true,
          keep: true,
          upsample: 'guided',
          longest: FRAME_SIZE,
          ...(pick ? { pick } : {})
        })
      }
      return this.decodeOn(sel.id, sel.embKey, next, {
        maskInput: false,
        keep: true,
        upsample: 'guided',
        longest: FRAME_SIZE,
        ...(pick ? { pick } : {})
      })
    })
    sel.prompt = next
    sel.last = planeOf(req.seq, r, Date.now() - t0)
    return sel.last
  }

  /**
   * A host that is new (it crashed, or slept) holds no embedding or lane:
   * make the embedding again, bring the selection's lane back to where it
   * was, and try once more.
   */
  private async withCatchUp<T>(sel: Selection, run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (err) {
      if (!isStale(err)) throw err
      log.info('select: the host is new; catching up', sel.id)
      this.loadedFor = -1
      this.embeddings.clear()
      const { embKey } = await this.embedding(sel.key)
      sel.embKey = embKey
      if (sel.prompt)
        await this.replay(sel.id, embKey, sel.prompt, 'resampled', 256, undefined, sel.size)
      return run()
    }
  }

  /** The selection as a mask: its last answer, at the frame's size, in the plane store. */
  async commit(selId: string, source: PromptSourceAsk): Promise<SelectCommit> {
    const sel = this.selections.get(selId)
    if (!sel?.last || !sel.prompt) throw new Error('nothing is selected yet')
    return this.keep(sel.last.png, sel.prompt, source)
  }

  private keep(png16: Uint8Array, prompt: PromptGeometry, source: PromptSourceAsk): SelectCommit {
    const d = grey8(Buffer.from(png16))
    const png = encodeGreyPng(d.data, d.width, d.height).toString('base64')
    const ref = planeRef(png)
    this.planes.put(ref, png)
    return {
      ref,
      width: d.width,
      height: d.height,
      source: {
        kind: 'prompt',
        ...(source.label ? { label: source.label } : {}),
        prompt: { ...prompt, parts: promptSteps(prompt) },
        via: source.via,
        ...(source.concept ? { concept: source.concept } : {})
      }
    }
  }

  close(selId: string): void {
    const sel = this.selections.get(selId)
    if (!sel) return
    sel.probe?.abort()
    this.selections.delete(selId)
    void this.engine
      .sam({ op: 'release', lanes: [sel.id, `${sel.id}-probe`] })
      .catch(() => undefined)
    this.awake()
  }

  // ── One prompt, start to end (smart looks, a photo not open) ─────────────

  /** A prompt's mask on a photo, as a job runs it: made, kept in the plane store. */
  async oneShot(
    key: string,
    prompt: PromptGeometry,
    source: PromptSourceAsk,
    signal: AbortSignal,
    onStage?: (stage: 'embed' | 'decode') => void
  ): Promise<SelectCommit> {
    this.busy++
    const lane = `once-${nextId++}`
    try {
      onStage?.('embed')
      const { embKey } = await this.embedding(key, signal)
      onStage?.('decode')
      const r = await this.replay(lane, embKey, prompt, 'guided', FRAME_SIZE, signal)
      const plane = r.planes[0]
      if (!plane) throw new Error('the model found nothing there')
      return this.keep(plane.png, prompt, source)
    } finally {
      this.busy--
      void this.engine.sam({ op: 'release', lanes: [lane] }).catch(() => undefined)
      this.awake()
    }
  }

  // ── Snap to edges on a brush ─────────────────────────────────────────────

  /**
   * What a stroke's snap depends on besides the stroke: the photo's pixels
   * and the lens correction its masks are placed after. Cheap (no model),
   * so a plane already made for it is found without SAM.
   */
  async snapKey(key: string, lens: Lens): Promise<string> {
    return hash32(await this.embKeyOf(key, lens)).toString(16)
  }

  /**
   * The object a brush stroke was painted on, as an 8-bit plane at the
   * frame's size: SAM asked with clicks over the stroke's core, and of its
   * answers the smallest that holds (nearly) all of that core. Null when SAM
   * is not on this machine or the stroke has no core.
   */
  async objectUnder(
    key: string,
    lens: Lens,
    stroke: Grey,
    signal?: AbortSignal
  ): Promise<Grey | null> {
    const prompt = strokePrompt(stroke.data, stroke.width, stroke.height)
    if (!prompt || !(await this.installed())) return null
    this.busy++
    const lane = `snap-${nextId++}`
    try {
      const { embKey } = await this.embedding(key, signal, lens)
      const r = await this.decodeOn(lane, embKey, prompt, {
        maskInput: false,
        keep: false,
        upsample: 'guided',
        longest: FRAME_SIZE,
        signal,
        all: true
      })
      const answers = r.planes.map((p) => grey8(Buffer.from(p.png)))
      if (answers.length === 0) return null
      const held = answers.map((a) => coreHeld(stroke, a))
      return answers[
        strokeObject(
          held,
          r.planes.map((p) => p.coverage)
        )
      ]
    } finally {
      this.busy--
      void this.engine.sam({ op: 'release', lanes: [lane] }).catch(() => undefined)
      this.awake()
    }
  }

  // ── Sleep ────────────────────────────────────────────────────────────────

  /** Something happened: sleep only after IDLE_MS of nothing. */
  private awake(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      this.idle = null
      if (this.selections.size > 0 || this.busy > 0) return this.awake()
      if (this.engine.sleep()) log.info('select: idle, the host sleeps')
    }, IDLE_MS)
  }
}

/** The share of a stroke's core (nine tenths of its strongest and up) inside `object`. */
function coreHeld(stroke: Grey, object: Grey): number {
  let max = 0
  for (const v of stroke.data) if (v > max) max = v
  const at = max * 0.9
  let core = 0
  let inside = 0
  const step = Math.max(1, Math.round(Math.max(stroke.width, stroke.height) / 256))
  for (let y = step >> 1; y < stroke.height; y += step) {
    const oy = Math.min(object.height - 1, Math.floor(((y + 0.5) / stroke.height) * object.height))
    for (let x = step >> 1; x < stroke.width; x += step) {
      if (stroke.data[y * stroke.width + x] < at) continue
      core++
      const ox = Math.min(object.width - 1, Math.floor(((x + 0.5) / stroke.width) * object.width))
      if (object.data[oy * object.width + ox] >= 128) inside++
    }
  }
  return core ? inside / core : 0
}

function planeOf(seq: number, r: Extract<SamResult, { op: 'decode' }>, ms: number): SelectPlane {
  const p = r.planes[0]
  return {
    seq,
    png: p?.png ?? new Uint8Array(),
    width: r.plane_width,
    height: r.plane_height,
    iou: p?.predicted_iou ?? 0,
    coverage: p?.coverage ?? 0,
    ms
  }
}
