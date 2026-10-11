/**
 * What the open photo holds, found with no brain (engine 0.19.2's default
 * flow, pixl-auto's `auto({ brain: null })`): U²-Netp's subject, DINOv2's
 * sky, vegetation and water, and Selfie Multiclass's hair, face, skin and
 * clothes, each told as its share of the frame for the Masks pane's found
 * chips (shared/naming.ts `foundThings`). Nothing is masked here: a chip
 * tapped makes its mask with the tool as usual.
 *
 * In the background, out of the way: only with AI on, only with models
 * already downloaded (nothing is fetched for this), a moment after the photo
 * opens, waiting while an AI job the user asked for runs, on the background
 * threads. One photo at a time: another photo opened stops the one in hand.
 * What was found is kept for the session, so the photo opened again asks
 * nothing of the models.
 */
import log from 'electron-log/main'
import { PARTS_MODEL, SCENE_MODEL } from '../../shared/ai'
import { readCull } from '../../shared/cull'
import { foundThings, peoplePlausible, type FoundThing, type PlaneShare } from '../../shared/naming'
import type { IndexClient } from '../indexer/client'
import { parseKey } from '../keys'
import { Cancelled, pause } from './jobs'
import type { ModelStore } from './models'
import type { SegmentRunner } from './segment'
import type { AiSwitchStore } from './switches'

/** How long after the photo opens before the models are asked: its first render comes first. */
const SETTLE_MS = 1200
/** How often a finder waiting on the user's AI job looks again. */
const WAIT_MS = 400

export class PlaneFinder {
  /** What each photo was found to hold, by the models it had (one downloaded later is asked then). */
  private readonly found = new Map<string, FoundThing[]>()
  private current: {
    id: string
    abort: AbortController
    promise: Promise<FoundThing[] | null>
  } | null = null

  constructor(
    private readonly segment: SegmentRunner,
    private readonly models: ModelStore,
    private readonly switches: AiSwitchStore,
    private readonly index: IndexClient,
    /** An AI job is queued or running: the finder waits for it. */
    private readonly jobsBusy: () => boolean
  ) {}

  /** Finding under way: the AI engine stays up until it ends. */
  get busy(): boolean {
    return this.current !== null
  }

  /**
   * What the photo holds, as found chips; null with AI off, or when another
   * photo took over before it was done (that photo's caller hears instead).
   */
  async find(key: string): Promise<FoundThing[] | null> {
    if (!(await this.switches.enabled())) return null
    const subject = await this.segment.model()
    const scene = await this.models.installed(SCENE_MODEL)
    const parts = await this.models.installed(PARTS_MODEL)
    if (!subject && !scene && !parts) return []
    // A copy has its own lens correction, so its own frame: keyed by the key.
    const id = `${key}:${subject ?? ''}:${scene ? 's' : ''}${parts ? 'p' : ''}`
    const had = this.found.get(id)
    if (had) return had
    if (this.current?.id === id) return this.current.promise
    this.current?.abort.abort()
    const abort = new AbortController()
    const promise = this.look(key, subject, scene, parts, abort.signal)
      .then((r) => {
        if (r.complete) this.found.set(id, r.found)
        return r.found
      })
      .catch((err) => {
        if (!(err instanceof Cancelled)) log.info('found chips: none', key, (err as Error).message)
        return null
      })
      .finally(() => {
        if (this.current?.abort === abort) this.current = null
      })
    this.current = { id, abort, promise }
    return promise
  }

  private async look(
    key: string,
    subjectModel: string | null,
    sceneModel: boolean,
    partsModel: boolean,
    signal: AbortSignal
  ): Promise<{ found: FoundThing[]; complete: boolean }> {
    await pause(SETTLE_MS, signal)
    let complete = true
    /** One model's planes, after any job the user asked for; a model that fails loses its chips only. */
    const planes = async (model: string): Promise<PlaneShare[] | null> => {
      while (this.jobsBusy()) await pause(WAIT_MS, signal)
      // AI switched off meanwhile: stop here, keep nothing.
      if (!(await this.switches.enabled())) throw new Cancelled()
      try {
        return await this.segment.coverage(key, model, signal)
      } catch (err) {
        if (signal.aborted || err instanceof Cancelled) throw new Cancelled()
        log.info('found chips:', model, 'failed', (err as Error).message)
        complete = false
        return null
      }
    }
    const t0 = Date.now()
    const subject = subjectModel ? ((await planes(subjectModel))?.[0] ?? null) : null
    const scene = sceneModel ? await planes(SCENE_MODEL) : null
    const parts =
      partsModel && peoplePlausible(subject, await this.facesIn(key))
        ? await planes(PARTS_MODEL)
        : null
    const found = foundThings({ subject, scene, parts })
    log.info(
      'found chips',
      key,
      found.map((f) => f.label).join(', ') || 'none',
      `${Date.now() - t0} ms`
    )
    return { found, complete }
  }

  /** How many faces the cull signals found (null: not measured, or measured without the face models). */
  private async facesIn(key: string): Promise<number | null> {
    const rows = await this.index.cullInputs([parseKey(key).photoId]).catch(() => [])
    return readCull(rows[0]?.signals)?.faces?.length ?? null
  }
}
