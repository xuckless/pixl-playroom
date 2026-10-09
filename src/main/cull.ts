/**
 * The cull signals (shared/cull.ts), measured per photo and kept in the
 * index with the file version they were measured on: one unedited picture
 * of the photo (CULL_EDGE on its long side) is read once by `analyze` for
 * exposure, the picture hash and focus over the whole frame and inside the
 * subject; U²-Netp finds the subject, and Face Mesh's blendshapes give the
 * blink hint. The models run only with AI on and their files here: nothing
 * is downloaded for this, and without them the rest is still measured.
 *
 * In the background like Gemma's names: on mains power, with nobody at the
 * computer for a minute, newest arrivals first, one photo at a time.
 * Suggesting rejects from them is Pass 115's.
 */
import { BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { rm, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  blinkOf,
  CLIP_HIGH,
  CLIP_LOW,
  CULL_EDGE,
  CULL_PERCENTILES,
  CULL_VERSION,
  exposureOf,
  FOCUS_BINS,
  focusOf,
  readCull,
  type CullModels,
  type CullSignals,
  type FaceSignal
} from '../shared/cull'
import {
  learnThresholds,
  samplesOf,
  suggestRejects,
  type CullInput,
  type CullReason,
  type CullThresholds
} from '../shared/cullsuggest'
import type { MeasureRegion } from '../shared/engine-types'
import { IPC } from '../shared/ipc'
import { keyOf, parseKey } from './keys'
import { FACE_DETECTOR, FACE_LANDMARKER } from '../shared/faceparts'
import { READ_LIMITS } from '../shared/limits'
import { idleOnPower } from './ai/idle'
import type { ModelStore } from './ai/models'
import type { AiSwitchStore } from './ai/switches'
import type { EngineClient } from './engine/client'
import type { IndexClient } from './indexer/client'
import type { Library } from './library'
import { paths } from './paths'
import { grey8 } from './pngio'
import { BACKGROUND_THREADS } from './source'

const SUBJECT_MODEL = 'u2netp'
/** Below this the subject model saw nothing salient (segment.ts's bar). */
const NOTHING_SALIENT = 0.2
/** A subject under this share of the frame is too small to measure focus in. */
const MIN_SUBJECT_SHARE = 0.01
/** The subject tool's own edge (segment.ts): the region is the mask the user would get. */
const SUBJECT_UPSAMPLE = { Guided: { radius: 0.004, epsilon: 0.001 } }

const IDLE_S = Number(process.env.PLAYROOM_CULL_IDLE_S ?? 60)
const CHECK_MS = Number(process.env.PLAYROOM_CULL_CHECK_MS ?? 30_000)
const BATCH = 50

async function started(engine: EngineClient): Promise<void> {
  if (engine.getStatus().status === 'starting') {
    engine.start()
    await engine.whenStarted()
  }
}

export class CullMeasurer {
  private timer: NodeJS.Timeout | undefined
  private running = false
  /** Photos that failed this session: not tried again until Playroom starts again. */
  private failed = new Set<number>()

  constructor(
    private readonly index: IndexClient,
    private readonly library: Library,
    /** `analyze`: the background engine. */
    private readonly bgEngine: EngineClient,
    /** The models (subject, faces): the AI engine, started when first needed. */
    private readonly aiEngine: EngineClient,
    private readonly models: ModelStore,
    private readonly switches: AiSwitchStore
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), CHECK_MS)
    this.timer.unref()
  }

  stop(): void {
    clearInterval(this.timer)
  }

  private async tick(): Promise<void> {
    if (this.running || !idleOnPower(IDLE_S)) return
    this.running = true
    let done = 0
    try {
      const models = await this.available()
      const ids = (await this.index.unmeasured(BATCH, models)).filter((id) => !this.failed.has(id))
      let n = 0
      if (ids.length) this.progress(0, ids.length)
      for (const id of ids) {
        if (!idleOnPower(IDLE_S) || this.measuring) break
        try {
          await this.measureAndKeep(id)
          done++
        } catch (err) {
          this.failed.add(id)
          log.info('cull signals not measured', id, (err as Error).message)
        }
        this.progress(++n, ids.length)
      }
      // Stopped early (someone back at the computer): the indicator goes.
      if (ids.length && n < ids.length) this.progress(ids.length, ids.length)
    } finally {
      this.running = false
      if (done > 0) {
        log.info(`cull signals: ${done} photo(s) measured`)
        this.changed()
      }
    }
  }

  /** How far measuring is, for the indicator atop the window (done = total: finished). */
  private progress(done: number, total: number): void {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send(IPC.cull.progress, { done, total })
  }

  /** Signals or decisions changed: thresholds learnt again, the Library asks again. */
  private changed(): void {
    this.learnt = null
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IPC.cull.event, null)
  }

  private learnt: { at: number; t: CullThresholds } | null = null

  /** The thresholds learnt from the user's keeps and rejects (kept a few minutes). */
  private async thresholds(): Promise<CullThresholds> {
    if (this.learnt && Date.now() - this.learnt.at < 5 * 60_000) return this.learnt.t
    const t = learnThresholds(samplesOf(this.inputsOf(await this.index.cullInputs(null))))
    this.learnt = { at: Date.now(), t }
    return t
  }

  private inputsOf(rows: Awaited<ReturnType<IndexClient['cullInputs']>>): CullInput[] {
    return rows.map((r) => ({ ...r, signals: readCull(r.signals) }))
  }

  /**
   * The suggested rejects among these items (a photo's own item; its copies
   * are the user's own), with their reasons, by key. Bursts are found among
   * the photos asked about: the folder or collection shown.
   */
  async suggestions(keys: string[]): Promise<Record<string, CullReason[]>> {
    const ids = [
      ...new Set(
        keys
          .map((k) => parseKey(k))
          .filter((k) => k.copyId === null)
          .map((k) => k.photoId)
      )
    ]
    const found = suggestRejects(
      this.inputsOf(await this.index.cullInputs(ids)),
      await this.thresholds()
    )
    const out: Record<string, CullReason[]> = {}
    for (const [id, reasons] of found) out[keyOf(id, null)] = reasons
    return out
  }

  /** The user's Keep (or its undoing) on suggested rejects. */
  async keep(keys: string[], keep: boolean): Promise<void> {
    await this.index.setCullKeep([...new Set(keys.map((k) => parseKey(k).photoId))], keep)
    this.changed()
  }

  private measuring: AbortController | null = null

  /** Measuring under way (asked for, or an idle batch): the rest keeps the engines until it ends. */
  get busy(): boolean {
    return this.measuring !== null || this.running
  }

  /**
   * Measure now the photos among these not measured yet (the Library's
   * Suggested rejects asked): one at a time, the newest call taking over.
   * Returns how many were measured.
   */
  async measureNow(keys: string[]): Promise<number> {
    this.measuring?.abort()
    const abort = new AbortController()
    this.measuring = abort
    const ids = new Set(keys.map((k) => parseKey(k).photoId))
    const models = await this.available()
    const todo = (await this.index.unmeasured(100_000, models)).filter((id) => ids.has(id))
    let done = 0
    const send = (): void => this.progress(done, todo.length)
    send()
    for (const id of todo) {
      if (abort.signal.aborted) break
      if (this.failed.has(id)) {
        done++
        continue
      }
      try {
        await this.measureAndKeep(id)
      } catch (err) {
        this.failed.add(id)
        log.info('cull signals not measured', id, (err as Error).message)
      }
      done++
      if (done % 10 === 0) this.changed()
      send()
    }
    if (this.measuring === abort) {
      this.measuring = null
      if (done < todo.length) this.progress(todo.length, todo.length)
    }
    if (done > 0) this.changed()
    return done
  }

  /** The models a measurement may use now: AI on and their files here. */
  private async available(): Promise<CullModels> {
    if (!(await this.switches.enabled())) return { subject: false, faces: false }
    return {
      subject: await this.models.installed(SUBJECT_MODEL),
      faces:
        (await this.models.installed(FACE_DETECTOR)) &&
        (await this.models.installed(FACE_LANDMARKER))
    }
  }

  /** Measure one photo and keep its signals, with the models it could use. */
  async measureAndKeep(photoId: number): Promise<CullSignals> {
    const models = await this.available()
    const s = await this.measure(photoId, models)
    await this.index.setCull(photoId, JSON.stringify(s), models)
    return s
  }

  /** One photo's signals. */
  async measure(photoId: number, models: CullModels): Promise<CullSignals> {
    const t0 = Date.now()
    const dir = paths.cacheRoot()
    const picture = join(dir, `cull-${process.pid}-${photoId}.jpg`)
    const plane = join(dir, `cull-${process.pid}-${photoId}-subject.png`)
    try {
      await started(this.bgEngine)
      await this.library.writeUnedited(photoId, CULL_EDGE, picture)
      const subject = models.subject ? await this.subject(picture, plane) : null
      const faces = models.faces ? await this.faces(picture) : null
      const regions: MeasureRegion[] = [{ Box: { x: 0, y: 0, width: 1, height: 1 } }]
      if (subject && subject.share >= MIN_SUBJECT_SHARE)
        regions.push({ Mask: { source: { Png: plane }, resampler: 'Bilinear' } })
      const stats = await this.bgEngine.analyze({
        phash: true,
        focus: { regions, orientation_bins: FOCUS_BINS },
        source: { Path: picture },
        input: 'Jpeg',
        raw: null,
        domain: 'Encoded',
        bins: 256,
        percentiles: CULL_PERCENTILES,
        clip_low: CLIP_LOW,
        clip_high: CLIP_HIGH,
        hue_bins: 12,
        stride: 1,
        transparent: 'Include',
        threads: BACKGROUND_THREADS,
        weights: null,
        noise: false,
        orientation: 'Normal',
        lens: null,
        limits: READ_LIMITS,
        hdr: null,
        gain_map: null
      })
      const whole = focusOf(stats.focus?.regions[0])
      if (!whole) throw new Error('the engine measured no focus')
      return {
        v: CULL_VERSION,
        at: new Date().toISOString(),
        exposure: exposureOf(stats),
        focus: {
          whole,
          subject: regions.length > 1 ? focusOf(stats.focus?.regions[1]) : null,
          subjectShare: subject ? subject.share : null
        },
        faces,
        phash: stats.phash ?? null,
        ms: Date.now() - t0
      }
    } finally {
      await rm(picture, { force: true })
      await rm(plane, { force: true })
    }
  }

  /** U²-Netp's subject plane written to `out`, and its share of the frame; null without the model or a subject. */
  private async subject(picture: string, out: string): Promise<{ share: number } | null> {
    try {
      await started(this.aiEngine)
      const model = await this.models.ref(SUBJECT_MODEL, 'Cpu')
      const r = await this.aiEngine.segment({
        source: { Path: picture },
        input: 'Jpeg',
        raw: null,
        gain_map: null,
        orientation: 'Normal',
        lens: null,
        segmenter: { Classes: model },
        upsample: SUBJECT_UPSAMPLE,
        png: { compression: 'Fast', filter: 'Sub' },
        threads: BACKGROUND_THREADS,
        limits: READ_LIMITS,
        plane_longest: null
      })
      const p = r.planes[0]
      if (!p || p.raw_max < NOTHING_SALIENT) return null
      const png = Buffer.from(p.png)
      const g = grey8(png)
      let sum = 0
      for (let i = 0; i < g.data.length; i++) sum += g.data[i]
      await writeFile(out, png)
      return { share: sum / (255 * Math.max(1, g.data.length)) }
    } catch (err) {
      log.info('cull: no subject plane', (err as Error).message)
      return null
    }
  }

  /** Each face's place and blink hint; null when the faces couldn't be read. */
  private async faces(picture: string): Promise<FaceSignal[] | null> {
    try {
      await started(this.aiEngine)
      const r = await this.aiEngine.faces({
        source: { Path: picture },
        input: 'Jpeg',
        raw: null,
        gain_map: null,
        orientation: 'Normal',
        lens: null,
        region: null,
        detector: await this.models.ref(FACE_DETECTOR, 'Cpu'),
        landmarks: await this.models.ref(FACE_LANDMARKER, 'Cpu'),
        threads: BACKGROUND_THREADS,
        limits: READ_LIMITS
      })
      const W = r.frame_width || 1
      const H = r.frame_height || 1
      return r.faces.map((f) => ({
        bounds: [f.bounds[0] / W, f.bounds[1] / H, f.bounds[2] / W, f.bounds[3] / H],
        ...blinkOf(f.blendshapes)
      }))
    } catch (err) {
      log.info('cull: no faces read', (err as Error).message)
      return null
    }
  }
}
