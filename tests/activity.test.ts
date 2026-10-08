// The top bar's background work: one list from AI jobs, global jobs and downloads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AiJobEvent } from '../src/shared/ai'
import type { ModelInfo } from '../src/shared/ipc'
import type { Job } from '../src/renderer/src/state/busy'

const aiJob = (id: string, phase: 'running' | 'queued', progress: number | null): AiJobEvent =>
  ({
    jobId: id,
    task: 'enhance',
    key: `k-${id}`,
    name: `${id}.CR2`,
    title: 'Enhancing',
    subject: '×2',
    stages: [],
    stage: '',
    progress,
    phase
  }) as unknown as AiJobEvent

const model = (id: string, progress: number | null): ModelInfo =>
  ({ id, title: id.toUpperCase(), progress }) as unknown as ModelInfo

const job = (id: string, progress: number | null, cancel?: () => void): Job => ({
  id,
  title: 'Exporting',
  detail: '3 of 10',
  progress,
  scope: 'global',
  cancel,
  startedAt: 0
})

test('AI jobs, global jobs and downloads in one list, running before queued', async () => {
  const { activities } = await import('../src/renderer/src/lib/activity')
  const list = activities(
    [aiJob('a1', 'queued', null), aiJob('a2', 'running', 0.5)],
    [job('j1', 0.2)],
    [model('nafnet', 0.4), model('sam', null)]
  )
  assert.deepEqual(
    list.map((a) => a.id),
    ['a2', 'j1', 'model:nafnet', 'a1']
  )
  assert.equal(list[0].title, 'Enhancing ×2')
  assert.equal(list[0].name, 'a2.CR2')
  assert.equal(list[0].key, 'k-a2')
  assert.equal(list[2].title, 'Downloading NAFNET')
  assert.equal(list[2].stop, null)
  assert.equal(list[1].stop, null)
})

test('a global job with a cancel can be stopped', async () => {
  const { activities } = await import('../src/renderer/src/lib/activity')
  const cancel = (): void => undefined
  assert.deepEqual(activities([], [job('j', null, cancel)], [])[0].stop, { job: cancel })
})

test('progress together is known only when every running piece knows its own', async () => {
  const { activities, overall } = await import('../src/renderer/src/lib/activity')
  assert.equal(overall([]), null)
  const known = activities(
    [aiJob('a', 'running', 0.2), aiJob('q', 'queued', null)],
    [],
    [model('m', 0.6)]
  )
  assert.ok(Math.abs((overall(known) ?? 0) - 0.4) < 1e-9)
  assert.equal(overall(activities([aiJob('a', 'running', null)], [], [model('m', 0.6)])), null)
})

test('the hover text names each piece and how far', async () => {
  const { activities, activitySummary } = await import('../src/renderer/src/lib/activity')
  const list = activities([aiJob('a', 'running', 0.25), aiJob('q', 'queued', null)], [], [])
  assert.equal(activitySummary(list), 'Enhancing ×2 · a.CR2: 25%\nEnhancing ×2 · q.CR2: queued')
})
