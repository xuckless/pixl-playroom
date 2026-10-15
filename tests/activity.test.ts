// The top bar's background work: one list from AI jobs, global jobs and downloads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AiJobEvent } from '../src/shared/ai'
import type { ExportProgress, ModelInfo } from '../src/shared/ipc'
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

// ── Exports: queued and running in the list, then their receipts ──

const exp = (id: string, more: Partial<ExportProgress> = {}): ExportProgress => ({
  jobId: id,
  label: 'Web 2048',
  done: 0,
  total: 4,
  current: null,
  errors: [],
  finished: false,
  outputs: [],
  queued: false,
  startedAt: 1,
  finishedAt: null,
  skipped: [],
  paused: false,
  stopped: false,
  diskFull: false,
  retryable: 0,
  ...more
})

test('an export runs as Exporting n/total with its preset; a queued one waits', async () => {
  const { activities } = await import('../src/renderer/src/lib/activity')
  const list = activities(
    [aiJob('a', 'running', 0.5)],
    [],
    [],
    [exp('e1', { done: 1, current: 'IMG_1.CR2' }), exp('e2', { queued: true })]
  )
  assert.deepEqual(
    list.map((a) => a.id),
    ['export:e1', 'a', 'export:e2']
  )
  assert.equal(list[0].title, 'Exporting 1/4 · Web 2048')
  assert.equal(list[0].name, 'IMG_1.CR2')
  assert.equal(list[0].progress, 0.25)
  assert.deepEqual(list[0].stop, { export: 'e1' })
  assert.equal(list[2].queued, true)
  assert.equal(list[2].title, 'Export · Web 2048')
})

test('an export waiting for the editing says so', async () => {
  const { exportActivity } = await import('../src/renderer/src/lib/activity')
  assert.equal(
    exportActivity(exp('e', { done: 2, paused: true })).title,
    'Paused while you edit · 2/4'
  )
})

test('receipts come last, and the progress together leaves them out', async () => {
  const { activities, overall } = await import('../src/renderer/src/lib/activity')
  const list = activities(
    [],
    [],
    [],
    [
      exp('done', { finished: true, done: 4, outputs: ['a', 'b', 'c', 'd'], finishedAt: 5 }),
      exp('run', { done: 1 })
    ]
  )
  assert.deepEqual(
    list.map((a) => [a.id, a.done]),
    [
      ['export:run', undefined],
      ['export:done', 'ok']
    ]
  )
  assert.equal(overall(list), 0.25)
})

test('a receipt says how it went', async () => {
  const { outcome, receiptTitle } = await import('../src/renderer/src/lib/activity')
  const ok = exp('a', { finished: true, outputs: ['x', 'y'] })
  assert.equal(receiptTitle(ok), '2 written')
  assert.equal(outcome(ok), 'ok')
  const part = exp('b', {
    finished: true,
    outputs: ['x'],
    errors: [
      { name: 'b.CR2', message: 'broken' },
      { name: 'x.CR2', message: 'no XMP', warning: true }
    ],
    skipped: ['c.CR2']
  })
  assert.equal(receiptTitle(part), '1 written · 1 failed · 1 offline')
  assert.equal(outcome(part), 'partial')
  const none = exp('c', { finished: true, errors: [{ name: 'a', message: 'x' }] })
  assert.equal(outcome(none), 'failed')
  assert.equal(receiptTitle(exp('d', { finished: true, stopped: true })), 'Stopped · 0 written')
  const full = exp('e', {
    finished: true,
    diskFull: true,
    outputs: ['x'],
    errors: [{ name: 'b', message: 'full' }]
  })
  assert.equal(receiptTitle(full), 'Disk full · 1 written')
  assert.equal(outcome(full), 'partial')
})

test('a receipt lists failures by name, then what was written short, each said once', async () => {
  const { receiptLines } = await import('../src/renderer/src/lib/activity')
  const p = exp('a', {
    finished: true,
    outputs: ['x', 'y', 'z'],
    errors: [
      { name: 'a.CR2', message: 'XMP was not written', warning: true },
      { name: 'b.CR2', message: 'the engine refused it' },
      { name: 'c.CR2', message: 'XMP was not written', warning: true },
      { name: 'c.CR2', message: 'Classic develop stood in', warning: true }
    ],
    skipped: ['d.CR2']
  })
  assert.deepEqual(receiptLines(p), [
    'b.CR2: the engine refused it',
    'd.CR2: skipped, offline',
    'XMP was not written · 2 photos',
    'c.CR2: Classic develop stood in'
  ])
  assert.deepEqual(receiptLines(exp('b', { finished: true, outputs: ['x'] })), [])
})

test('a receipt is said for a few seconds; only one that went wrong stays a dot, until the list is opened', async () => {
  const { freshReceipt, receiptDot, RECEIPT_SHOWN_MS } =
    await import('../src/renderer/src/lib/activity')
  const ok = exp('ok', { finished: true, finishedAt: 1000, outputs: ['x'] })
  assert.equal(freshReceipt([ok], {}, 1000 + RECEIPT_SHOWN_MS - 1)?.jobId, 'ok')
  assert.equal(freshReceipt([ok], {}, 1000 + RECEIPT_SHOWN_MS), null)
  assert.equal(freshReceipt([ok], { ok: true }, 1000), null)
  // A stopped export is never announced.
  const stopped = exp('s', { finished: true, stopped: true, finishedAt: 1000 })
  assert.equal(freshReceipt([stopped], {}, 1000), null)
  // One that went well leaves no dot once it has been said.
  assert.equal(receiptDot([ok], {}, {}), null)
  // One that went wrong keeps its dot until the list is opened, or it is dismissed.
  const bad = exp('bad', { finished: true, errors: [{ name: 'a', message: 'x' }] })
  assert.equal(receiptDot([ok, bad], {}, {}), 'failed')
  assert.equal(receiptDot([ok, bad], { ok: true, bad: true }, {}), null)
  assert.equal(receiptDot([ok, bad], {}, { bad: true }), null)
  // Running exports are not receipts.
  assert.equal(receiptDot([exp('r')], {}, {}), null)
})

test('the exports kept: running and queued first, then the newest receipts', async () => {
  const { withExport } = await import('../src/renderer/src/lib/activity')
  let list: ExportProgress[] = []
  list = withExport(list, exp('a', { finished: true, finishedAt: 1 }))
  list = withExport(list, exp('q', { queued: true }))
  list = withExport(list, exp('b', { finished: true, finishedAt: 3 }))
  list = withExport(list, exp('r'))
  assert.deepEqual(
    list.map((p) => p.jobId),
    ['r', 'q', 'b', 'a']
  )
  // An update replaces its export.
  list = withExport(list, exp('r', { finished: true, finishedAt: 9 }))
  assert.deepEqual(
    list.map((p) => p.jobId),
    ['q', 'r', 'b', 'a']
  )
  assert.equal(withExport(list, exp('c', { finished: true, finishedAt: 10 }), 2).length, 3)
})
