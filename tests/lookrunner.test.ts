import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AiJobEvent, AiStartRequest } from '../src/shared/ai'
import { defaultRecipe, newLocalLayer, type Recipe } from '../src/shared/recipe'
import type { LookRunEvent } from '../src/shared/looks/run'
import { runProgress, runRemaining, formatEta } from '../src/shared/looks/run'
import type { PlanOp } from '../src/shared/looks/smart'
import { LookRuns, type RunnerDeps } from '../src/main/looks/runner'

interface Harness {
  recipe: Recipe
  shell: ReturnType<typeof newLocalLayer>
  started: AiStartRequest[]
  cancelled: string[]
  events: LookRunEvent[]
  end: (jobId: string, phase: AiJobEvent['phase'], message?: string) => void
  deps: RunnerDeps
  tick: () => Promise<void>
}

/** A job queue that ends each job when told, a photo whose recipe it edits, and what was said. */
function harness(opts: { promptJob?: boolean } = {}): Harness {
  const recipe: Recipe = defaultRecipe(false)
  const shell = newLocalLayer('Sky')
  shell.enabled = false
  recipe.layers.push(shell)
  const listeners = new Set<(e: AiJobEvent) => void>()
  const started: AiStartRequest[] = []
  const cancelled: string[] = []
  const events: LookRunEvent[] = []
  let n = 0
  const end = (jobId: string, phase: AiJobEvent['phase'], message?: string): void => {
    for (const l of [...listeners])
      l({
        jobId,
        phase,
        message,
        key: 'k',
        task: 'segment',
        name: '',
        title: '',
        stages: [],
        stage: '',
        progress: 1
      })
  }
  const deps: RunnerDeps = {
    async startJob(req) {
      started.push(req)
      return `j${++n}`
    },
    cancelJob(id) {
      cancelled.push(id)
      end(id, 'cancelled')
    },
    onJobEnded(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    async edit(_key, change) {
      change(recipe)
    },
    send(e) {
      events.push(e)
    },
    async megapixels() {
      return 24
    },
    ...(opts.promptJob
      ? {
          async promptJob(req) {
            started.push({ task: 'segment', key: req.key, target: 'subject', group: req.group })
            return `j${++n}`
          }
        }
      : {})
  }
  const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
  return { recipe, shell, started, cancelled, events, end, deps, tick }
}

const kinds = (events: LookRunEvent[]): string[] =>
  events.map((e) => (e.kind === 'part' || e.kind === 'landed' ? `${e.kind}:${e.index}` : e.kind))

test('parts run in order, one job at a time; a mask is turned on once its parts are in', async () => {
  const h = harness()
  const ops: PlanOp[] = [
    {
      kind: 'segment',
      layerId: h.shell.id,
      mask: 'sky',
      target: 'subject',
      mode: 'Add',
      invert: true
    },
    {
      kind: 'component',
      layerId: h.shell.id,
      mask: 'sky',
      component: {
        id: 'c1',
        kind: 'range',
        mode: 'Intersect',
        opacity: 100,
        invert: false,
        feather: 5,
        hue: null,
        saturation: null,
        luma: { centre: 0.8, width: 0.3, softness: 0.1 },
        smoothness: 0
      }
    },
    { kind: 'enable', layerId: h.shell.id, mask: 'sky' },
    { kind: 'denoise', model: 'drunet', strength: 40, layerId: h.shell.id }
  ]
  const runs = new LookRuns(h.deps)
  runs.start({ key: 'k', runId: 'r1', look: 'Moody', ops })
  await h.tick()
  assert.equal(h.started.length, 1, 'one job at a time')
  assert.equal(h.started[0].group, 'r1')
  // The model's mask lands (as the job queue's result handler would put it).
  h.shell.components.push({ ...(ops[1] as { component: never }).component, id: 'ai', mode: 'Add' })
  h.end('j1', 'done')
  await h.tick()
  await h.tick()
  assert.equal(h.shell.components[0].invert, true, 'an inverted part is turned round once it lands')
  assert.equal(h.shell.components[1].mode, 'Intersect')
  assert.equal(h.shell.enabled, true)
  assert.equal(h.started.length, 2)
  assert.equal(h.started[1].task, 'denoise')
  h.end('j2', 'done')
  await h.tick()
  assert.deepEqual(kinds(h.events), [
    'start',
    'part:0',
    'landed:0',
    'part:1',
    'landed:1',
    'part:2',
    'landed:2',
    'part:3',
    'landed:3',
    'end'
  ])
  const end = h.events.at(-1)!
  assert.ok(end.kind === 'end' && end.phase === 'done' && end.failed.length === 0)
  assert.equal(runs.size, 0)
})

test('a mask part that fails takes the mask off and skips its scoped step; the rest goes on', async () => {
  const h = harness()
  const other = newLocalLayer('Edge')
  h.recipe.layers.push(other)
  const runs = new LookRuns(h.deps)
  runs.start({
    key: 'k',
    runId: 'r2',
    look: 'Moody',
    ops: [
      {
        kind: 'segment',
        layerId: h.shell.id,
        mask: 'sky',
        target: 'sky',
        mode: 'Add',
        invert: false
      },
      { kind: 'enable', layerId: h.shell.id, mask: 'sky' },
      { kind: 'denoise', model: 'drunet', strength: 40, layerId: h.shell.id },
      { kind: 'denoise', model: 'drunet', strength: 20, layerId: null }
    ]
  })
  await h.tick()
  h.end('j1', 'error', 'No sky model ships yet')
  await h.tick()
  await h.tick()
  assert.equal(
    h.recipe.layers.some((l) => l.id === h.shell.id),
    false,
    'the empty mask is gone'
  )
  assert.equal(h.started.length, 2)
  assert.equal(h.started[1].task === 'denoise' && h.started[1].layerId, null)
  h.end('j2', 'done')
  await h.tick()
  const end = h.events.at(-1)!
  assert.ok(end.kind === 'end')
  assert.equal(end.phase, 'done')
  assert.deepEqual(end.failed, [{ label: 'Finding the sky', why: 'No sky model ships yet' }])
})

test('cancelling stops the job under way and runs nothing after', async () => {
  const h = harness()
  const runs = new LookRuns(h.deps)
  runs.start({
    key: 'k',
    runId: 'r3',
    look: 'Night',
    ops: [
      { kind: 'denoise', model: 'drunet', strength: 40, layerId: null },
      { kind: 'deblur', strength: 30, layerId: null }
    ]
  })
  await h.tick()
  runs.cancelFor('k')
  await h.tick()
  assert.deepEqual(h.cancelled, ['j1'])
  assert.equal(h.started.length, 1)
  const end = h.events.at(-1)!
  assert.ok(end.kind === 'end' && end.phase === 'cancelled')
})

test('an object with no detector asks the user; skipping it drops its mask', async () => {
  const h = harness({ promptJob: true })
  const runs = new LookRuns(h.deps)
  const op: PlanOp = {
    kind: 'object',
    layerId: h.shell.id,
    mask: 'car',
    label: 'car',
    mode: 'Add',
    invert: false,
    detect: false
  }
  runs.start({ key: 'k', runId: 'r4', look: 'Rain City Noir', ops: [op] })
  await h.tick()
  const ask = h.events.find((e) => e.kind === 'pick')
  assert.ok(ask && ask.kind === 'pick' && ask.label === 'car' && ask.look === 'Rain City Noir')
  runs.answer('r4', { kind: 'point', point: { x: 0.4, y: 0.6 } })
  await h.tick()
  assert.equal(h.started.length, 1, 'the click goes to SAM2')
  h.end('j1', 'done')
  await h.tick()

  const h2 = harness({ promptJob: true })
  const runs2 = new LookRuns(h2.deps)
  runs2.start({ key: 'k', runId: 'r5', look: 'X', ops: [{ ...op, layerId: h2.shell.id }] })
  await h2.tick()
  runs2.answer('r5', { kind: 'skip' })
  await h2.tick()
  await h2.tick()
  assert.equal(h2.started.length, 0)
  assert.equal(h2.recipe.layers.length, 0)
})

test('without SAM2 or the people model the part fails, saying it needs the next engine', async () => {
  const h = harness()
  const runs = new LookRuns(h.deps)
  runs.start({
    key: 'k',
    runId: 'r6',
    look: 'X',
    ops: [
      { kind: 'person', layerId: h.shell.id, mask: 's', part: 'skin', mode: 'Add', invert: false }
    ]
  })
  await h.tick()
  await h.tick()
  const end = h.events.at(-1)!
  assert.ok(end.kind === 'end')
  assert.deepEqual(end.failed, [{ label: 'Finding skin', why: 'needs the next engine update' }])
  assert.equal(end.phase, 'error')
})

test('progress and time left follow the parts’ expected times', () => {
  const parts = [{ ms: 1000 }, { ms: 3000 }]
  assert.equal(runProgress(parts, 0, 0), 0)
  assert.equal(runProgress(parts, 1, 0.5), 0.625)
  assert.equal(runRemaining(parts, 1, 0.5), 1500)
  assert.equal(formatEta(1200), 'a moment')
  assert.equal(formatEta(40_000), '~40 s')
  assert.equal(formatEta(200_000), '~3 min')
})
