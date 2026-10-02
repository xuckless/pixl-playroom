/**
 * Smart looks' runs (see `shared/looks/run.ts`): each run works through its
 * plan's parts in order, one model job at a time on the AI job queue, and
 * lands each on the photo it was started for, open or not. A mask that
 * cannot be made is taken off again (it was off and empty), and the steps
 * scoped to it are skipped; the rest of the look goes on. Cancelling stops
 * the job under way and everything after it.
 *
 * What it needs from the app comes in as `RunnerDeps`, so it can be tested
 * without the engine or a window.
 */
import type { AiJobEvent, AiStartRequest } from '../../shared/ai'
import { DEFAULT_ENHANCE } from '../../shared/enhance'
import type { MaskMode } from '../../shared/engine-types'
import type { LookRunEvent, LookRunRequest, PickAnswer } from '../../shared/looks/run'
import { opLabel, opMs } from '../../shared/looks/run'
import type { FramePoint, PlanOp } from '../../shared/looks/smart'
import type { Recipe } from '../../shared/recipe'

export interface RunnerDeps {
  startJob(req: AiStartRequest): Promise<string>
  cancelJob(jobId: string): void
  onJobEnded(listener: (e: AiJobEvent) => void): () => void
  /** Change the photo's recipe wherever it is (its open session, else saved). */
  edit(key: string, change: (r: Recipe) => void): Promise<void>
  send(e: LookRunEvent): void
  /** The photo's size in megapixels, for the parts' expected times. */
  megapixels(key: string): Promise<number>
  /**
   * SAM2 from a prompt (a point or a box) or the detector and SAM2 from a
   * label, as a job on the queue whose mask lands in `layerId`. Absent until
   * the engine has them (E30, E45): the part fails, saying so.
   */
  promptJob?(req: {
    key: string
    group: string
    layerId: string
    mode: MaskMode
    label: string
    prompt:
      | { kind: 'label' }
      | { kind: 'point'; point: FramePoint }
      | { kind: 'box'; from: FramePoint; to: FramePoint }
  }): Promise<string>
  personJob?(req: {
    key: string
    group: string
    layerId: string
    mode: MaskMode
    part: string
  }): Promise<string>
}

const NOT_YET = 'needs the next engine update'

interface Run {
  req: LookRunRequest
  cancelled: boolean
  jobId: string | null
  pick: ((a: PickAnswer) => void) | null
}

export class LookRuns {
  private readonly runs = new Map<string, Run>()
  private readonly deps: RunnerDeps

  constructor(deps: RunnerDeps) {
    this.deps = deps
  }

  /** Start a run; it goes on by itself and says how it is going. */
  start(req: LookRunRequest): void {
    const run: Run = { req, cancelled: false, jobId: null, pick: null }
    this.runs.set(req.runId, run)
    void this.go(run).finally(() => this.runs.delete(req.runId))
  }

  /** Stop a run: the job under way, a question waiting, and everything after. */
  cancel(runId: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.cancelled = true
    if (run.jobId) this.deps.cancelJob(run.jobId)
    run.pick?.({ kind: 'skip' })
  }

  /** The user's answer to a run's question (a click, a box, or skip). */
  answer(runId: string, a: PickAnswer): void {
    this.runs.get(runId)?.pick?.(a)
  }

  /** Every run on a photo, stopped (the look was swapped or taken off there). */
  cancelFor(key: string): void {
    for (const r of this.runs.values()) if (r.req.key === key) this.cancel(r.req.runId)
  }

  get size(): number {
    return this.runs.size
  }

  private async go(run: Run): Promise<void> {
    const { key, runId, look, ops } = run.req
    const mp = await this.deps.megapixels(key).catch(() => 24)
    const parts = ops.map((op) => ({ label: opLabel(op), ms: opMs(op, mp) }))
    this.deps.send({ kind: 'start', key, runId, look, parts })
    const failed: { label: string; why: string }[] = []
    /** Masks that could not be made: their remaining parts and scoped steps are skipped. */
    const lost = new Set<string>()
    for (const [index, op] of ops.entries()) {
      if (run.cancelled) break
      const layerId = 'layerId' in op ? op.layerId : null
      if (layerId && lost.has(layerId)) continue
      this.deps.send({ kind: 'part', key, runId, index, label: parts[index].label })
      try {
        await this.part(run, index, op)
        if (run.cancelled) break
        this.deps.send({ kind: 'landed', key, runId, index, label: parts[index].label })
      } catch (err) {
        if (run.cancelled) break
        const why = (err as Error).message || 'failed'
        failed.push({ label: parts[index].label, why })
        // A mask part failed: the mask is taken off (it is off and incomplete).
        if (op.kind !== 'denoise' && op.kind !== 'deblur' && layerId) {
          lost.add(layerId)
          await this.deps
            .edit(key, (r) => {
              r.layers = r.layers.filter((l) => l.id !== layerId)
            })
            .catch(() => undefined)
          this.deps.send({ kind: 'landed', key, runId, index, label: 'Mask removed' })
        }
      }
    }
    this.deps.send({
      kind: 'end',
      key,
      runId,
      phase: run.cancelled
        ? 'cancelled'
        : failed.length && failed.length === ops.length
          ? 'error'
          : 'done',
      failed
    })
  }

  /** One part. Throws when it could not be made. */
  private async part(run: Run, index: number, op: PlanOp): Promise<void> {
    const { key, runId, look } = run.req
    const group = runId
    switch (op.kind) {
      case 'component':
        return this.deps.edit(key, (r) => {
          const l = r.layers.find((x) => x.id === op.layerId)
          if (!l) throw new Error('its mask is gone')
          const c = structuredClone(op.component)
          if (l.components.length === 0) c.mode = 'Add'
          l.components.push(c)
        })
      case 'enable':
        return this.deps.edit(key, (r) => {
          const l = r.layers.find((x) => x.id === op.layerId)
          if (!l) throw new Error('its mask is gone')
          l.enabled = true
        })
      case 'segment': {
        await this.job(
          run,
          this.deps.startJob({
            task: 'segment',
            key,
            target: op.target,
            into: { layerId: op.layerId, mode: op.mode },
            group
          })
        )
        if (op.invert) await this.invertLast(key, op.layerId)
        return
      }
      case 'person': {
        if (!this.deps.personJob) throw new Error(NOT_YET)
        await this.job(
          run,
          this.deps.personJob({ key, group, layerId: op.layerId, mode: op.mode, part: op.part })
        )
        if (op.invert) await this.invertLast(key, op.layerId)
        return
      }
      case 'object': {
        if (!this.deps.promptJob) throw new Error(NOT_YET)
        let prompt: Parameters<NonNullable<RunnerDeps['promptJob']>>[0]['prompt'] = {
          kind: 'label'
        }
        if (!op.detect) {
          const a = await this.ask(run, index, op.label, look)
          if (a.kind === 'skip') throw new Error('skipped')
          prompt = a.kind === 'point' ? { kind: 'point', point: a.point } : a
        }
        await this.job(
          run,
          this.deps.promptJob({
            key,
            group,
            layerId: op.layerId,
            mode: op.mode,
            label: op.label,
            prompt
          })
        )
        if (op.invert) await this.invertLast(key, op.layerId)
        return
      }
      case 'denoise': {
        // NAFNet's denoise comes with the next engine; the plan only asks for it once it is there.
        if (op.model !== 'drunet') throw new Error(NOT_YET)
        await this.job(
          run,
          this.deps.startJob({
            task: 'denoise',
            key,
            model: 'drunet-color',
            strength: op.strength,
            layerId: op.layerId,
            group
          })
        )
        return
      }
      case 'deblur':
        await this.job(
          run,
          this.deps.startJob({
            task: 'enhance',
            key,
            settings: { ...DEFAULT_ENHANCE, deblur: true, deblurStrength: op.strength },
            layerId: op.layerId,
            group
          })
        )
        return
    }
  }

  /** Wait for a job to end; throws unless it ended done. */
  private async job(run: Run, started: Promise<string>): Promise<void> {
    // Heard before the job can end: the queue answers start before it runs anything.
    let resolve: (e: AiJobEvent) => void = () => undefined
    const ended = new Promise<AiJobEvent>((r) => (resolve = r))
    let id: string | null = null
    const early: AiJobEvent[] = []
    const off = this.deps.onJobEnded((e) => {
      if (id === null) early.push(e)
      else if (e.jobId === id) resolve(e)
    })
    try {
      id = await started
      run.jobId = id
      const seen = early.find((e) => e.jobId === id)
      if (seen) resolve(seen)
      if (run.cancelled) this.deps.cancelJob(id)
      const e = await ended
      if (e.phase === 'cancelled') throw new Error('cancelled')
      if (e.phase !== 'done') throw new Error(e.message ?? 'failed')
    } finally {
      off()
      run.jobId = null
    }
  }

  /** The user is asked to point at `label`; resolves with what they did. */
  private ask(run: Run, index: number, label: string, look: string): Promise<PickAnswer> {
    const { key, runId } = run.req
    return new Promise<PickAnswer>((resolve) => {
      run.pick = (a) => {
        run.pick = null
        resolve(a)
      }
      this.deps.send({ kind: 'pick', key, runId, index, label, look })
    })
  }

  /** A model's mask landed as the layer's last component: selected the other way round. */
  private invertLast(key: string, layerId: string): Promise<void> {
    return this.deps.edit(key, (r) => {
      const c = r.layers.find((l) => l.id === layerId)?.components.at(-1)
      if (c) c.invert = !c.invert
    })
  }
}
