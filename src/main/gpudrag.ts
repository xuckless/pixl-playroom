/**
 * The GPU drag path as main runs it (engine 0.19.2, Phase A §4.3 and §4.4).
 * The decisions are in shared/gpudrag.ts; this keeps the state: whether the
 * app's GPU session is open, which photo's frame is uploaded from which
 * grade input, and each open photo's held measurements. The native objects
 * themselves live in the interactive engine host (engine/host.ts) and are
 * named here by id, as SAM's are: a new host (a crash, a restart, a rest)
 * has none of them, so everything is forgotten when one starts.
 *
 * Only drag frames use it. The release, the settled picture, 1:1 tiles and
 * every export render on the CPU from the file, with no frame or held
 * measurements, as before.
 */
import log from 'electron-log/main'
import { cpus, totalmem } from 'os'
import type { ConvertReport, ConvertRequest, HeldRef } from '../shared/engine-types'
import { constrainedMac, gpuBackend, gpuDragOn, GPU_DRAG_SETTING } from '../shared/gpudrag'
import type { GpuDragState } from '../shared/ipc'
import type { EngineClient } from './engine/client'
import type { IndexClient } from './indexer/client'

/** A photo's uploaded frame, as main knows it. */
export interface FrameRef {
  /** The host's name for it: the photo's session key. */
  id: string
  /** The grade input it was uploaded from (`inputKey`): another needs a new upload. */
  inputKey: string
  /** The host it lives in. */
  generation: number
  width: number
  height: number
}

export class GpuDrag {
  /**
   * The 8 GB / M1 Mac (shared/gpudrag.ts `constrainedMac`): one frame open
   * at a time, and Tone dragged without its base (Phase A §4.3, §3.2).
   */
  readonly constrained = constrainedMac(
    process.platform,
    cpus()[0]?.model ?? '',
    totalmem() / 1048576
  )
  private readonly spec = gpuBackend(process.platform)
  /** The Preferences switch (on unless turned off). */
  private on = true
  /** The session's opening, for the host it was opened in. */
  private opened: { generation: number; ok: Promise<boolean> } | null = null
  /** Each open photo's frame, by its session key. */
  private frames = new Map<string, FrameRef>()
  /** The upload under way per photo: one at a time, the newest input last. */
  private uploading = new Map<string, { inputKey: string; job: Promise<void> }>()
  /** Per photo, a grade input whose upload failed: not tried again until the input changes. */
  private failed = new Map<string, string>()
  /**
   * Whether a GPU drag may measure its output (the histogram while
   * dragging). Turned off for the app the first time the engine refuses it
   * there; drags then show the last picture's numbers.
   */
  measure = true

  constructor(
    private readonly engine: EngineClient,
    private readonly settings: IndexClient
  ) {
    void Promise.resolve(settings.getSetting(GPU_DRAG_SETTING))
      .catch(() => null)
      .then((v) => (this.on = gpuDragOn(v)))
    // A new host holds nothing: no session, no frames (held measurements
    // are forgotten by their slots the same way).
    engine.onSpawn(() => {
      this.opened = null
      this.frames.clear()
      this.uploading.clear()
      this.failed.clear()
    })
  }

  /** This build and computer can drag on the GPU: Metal or Direct3D 12, and an addon with the path. */
  available(): boolean {
    return this.spec !== null && this.engine.getStatus().gpu === true
  }

  /** Drags go to the GPU now: available, and not turned off in Preferences. */
  usable(): boolean {
    return this.on && this.available()
  }

  state(): GpuDragState {
    return { available: this.available(), on: this.on, constrained: this.constrained }
  }

  /** Preferences: off lets go of every frame and the session (their GPU memory with them). */
  async setOn(on: boolean): Promise<GpuDragState> {
    this.on = on
    await this.settings.setSetting(GPU_DRAG_SETTING, on)
    if (!on) this.releaseAll()
    return this.state()
  }

  /** Open the app's session once per host (Phase A §4.3: 12–21 ms). False: it can't be. */
  private session(): Promise<boolean> {
    const generation = this.engine.generation
    if (this.opened?.generation === generation) return this.opened.ok
    const ok = this.engine.gpu({ op: 'open', spec: this.spec! }).then(
      (r) => {
        if (r.op === 'open' && r.ms > 0) log.info(`GPU session open (${r.ms} ms)`)
        return true
      },
      (err: unknown) => {
        log.warn('GPU session not opened; drags stay on the CPU', (err as Error).message)
        return false
      }
    )
    this.opened = { generation, ok }
    return ok
  }

  /** The photo's frame when it is uploaded from `inputKey` in this host; else null. */
  ready(key: string, inputKey: string): FrameRef | null {
    const f = this.frames.get(key)
    return f && f.inputKey === inputKey && f.generation === this.engine.generation ? f : null
  }

  /**
   * Upload the photo's grade input (`request`, shared/gpudrag.ts
   * `gradeInputRequest`) unless it is up already or on its way: once per
   * photo, and again only when something before the grade changes. In the
   * background: the drags meanwhile render on the CPU. On the constrained
   * Mac the host closes every other photo's frame first.
   */
  prepare(key: string, inputKey: string, request: ConvertRequest): void {
    if (!this.usable() || this.ready(key, inputKey)) return
    const busy = this.uploading.get(key)
    if (busy?.inputKey === inputKey || this.failed.get(key) === inputKey) return
    const run = async (): Promise<void> => {
      if (!(await this.session())) {
        this.failed.set(key, inputKey)
        return
      }
      const generation = this.engine.generation
      if (this.constrained) for (const k of this.frames.keys()) if (k !== key) this.frames.delete(k)
      try {
        const r = await this.engine.gpu({
          op: 'upload',
          id: key,
          request,
          only: this.constrained
        })
        if (r.op !== 'upload' || generation !== this.engine.generation) return
        this.frames.set(key, {
          id: key,
          inputKey,
          generation,
          width: r.width,
          height: r.height
        })
        this.failed.delete(key)
        log.info(
          `GPU frame ${r.width}×${r.height} up (input ${r.renderMs} ms, upload ${r.uploadMs} ms)`
        )
      } catch (err) {
        this.failed.set(key, inputKey)
        log.warn('GPU frame not uploaded; drags stay on the CPU', (err as Error).message)
      }
    }
    const job = (busy?.job ?? Promise.resolve()).then(run)
    const entry = { inputKey, job }
    this.uploading.set(key, entry)
    void job.finally(() => {
      if (this.uploading.get(key) === entry) this.uploading.delete(key)
    })
  }

  /** The frame the host no longer has (a `Stale` answer): forgotten, uploaded again next drag. */
  lost(key: string): void {
    this.frames.delete(key)
    this.failed.delete(key)
  }

  /** The photo closed (Phase A §4.3 step 5: `frame.close()`): its frame let go. */
  close(key: string): void {
    const had = this.frames.get(key)
    this.frames.delete(key)
    this.failed.delete(key)
    if (had && had.generation === this.engine.generation)
      void this.engine.gpu({ op: 'release', frames: [key] }).catch(() => undefined)
  }

  /** Every frame and the session let go (GPU dragging turned off). */
  private releaseAll(): void {
    this.frames.clear()
    this.failed.clear()
    if (!this.opened || this.opened.generation !== this.engine.generation) return
    this.opened = null
    void this.engine.gpu({ op: 'release', session: true }).catch(() => undefined)
  }
}

/**
 * One open photo's held measurements (Phase A §4.4), kept in the host under
 * `id`: what a whole-frame drag that ran Dehaze or Denoise measured, passed
 * back on the next drags so they reuse it. Passed only to a render of the
 * same `heldKey` (the same pixels, framing and size); dropped on release,
 * which measures fresh, and when the photo closes.
 */
export class HeldSlot {
  private cur: { key: string; generation: number; fields: string[] } | null = null

  constructor(
    private readonly engine: EngineClient,
    readonly id: string
  ) {}

  /** The id to pass as `held` for a render of `key`, if one is kept for it. */
  use(key: string): string | undefined {
    const c = this.cur
    if (!c || c.generation !== this.engine.generation) return undefined
    return c.key === key ? this.id : undefined
  }

  /** What the host kept of a render of `key` asked to `keepHeld` this slot. */
  kept(report: ConvertReport, key: string): void {
    const held = report.held as HeldRef | null | undefined
    if (held?.id === this.id)
      this.cur = { key, generation: this.engine.generation, fields: held.fields }
  }

  /** Let go of it (release, a refusal by `held`, the photo closing). */
  drop(): void {
    const c = this.cur
    this.cur = null
    if (c && c.generation === this.engine.generation)
      void this.engine.gpu({ op: 'release', held: [this.id] }).catch(() => undefined)
  }
}
