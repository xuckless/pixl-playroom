// The export queue (main/exportqueue.ts): one export at a time, each from
// the recipes and the folder there were when Export was pressed, a full disk
// stopping it once, offline photos passed over, and a Version per photo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultExportSettings } from '../src/shared/export'
import type { ExportProgress } from '../src/shared/ipc'
import {
  ExportQueue,
  isDiskFull,
  quitQuestion,
  RECEIPTS_KEPT,
  type QueueHost
} from '../src/main/exportqueue'

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

const cancelled = (): Error => Object.assign(new Error('convert: cancelled'), { code: 'Cancelled' })

/**
 * A host whose photos are recipes in a map (edited by the test), whose
 * renders wait to be finished one by one, and which records what it did.
 */
function host(opts: { offline?: string[]; fail?: Record<string, Error> } = {}): {
  host: QueueHost<string, string>
  recipes: Map<string, string>
  folder: { now: string }
  rendered: { key: string; recipe: string; dest: string }[]
  versions: { key: string; recipe: string }[]
  sent: ExportProgress[]
  pending: (() => void)[]
  finished: ExportProgress[]
} {
  const recipes = new Map<string, string>()
  const folder = { now: '/exports/a' }
  const rendered: { key: string; recipe: string; dest: string }[] = []
  const versions: { key: string; recipe: string }[] = []
  const sent: ExportProgress[] = []
  const pending: (() => void)[] = []
  const finished: ExportProgress[] = []
  return {
    recipes,
    folder,
    rendered,
    versions,
    sent,
    pending,
    finished,
    host: {
      snapshot: async (key) => ({
        recipe: recipes.get(key) ?? 'plain',
        name: `${key}.CR2`,
        offline: opts.offline?.includes(key) ?? false
      }),
      destination: async () => folder.now,
      render: (job, key) =>
        new Promise((resolve, reject) => {
          const fail = opts.fail?.[key]
          job.abort.signal.addEventListener('abort', () => reject(cancelled()), { once: true })
          pending.push(() => {
            if (job.abort.signal.aborted) return
            if (fail) return reject(fail)
            rendered.push({ key, recipe: job.photos.get(key)!.recipe, dest: job.dest })
            resolve(`${job.dest}/${key}.jpg`)
          })
        }),
      version: (key, recipe) => void versions.push({ key, recipe }),
      send: (p) => void sent.push(p),
      isCancelled: (err) => (err as { code?: string }).code === 'Cancelled',
      finished: (p) => void finished.push(p)
    }
  }
}

/** Finish the renders waiting, until none are left. */
async function drain(h: ReturnType<typeof host>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    await tick()
    const next = h.pending.shift()
    if (!next) {
      await tick()
      if (h.pending.length === 0) return
      continue
    }
    next()
  }
}

const s = defaultExportSettings()

test('exports run one after another, in the order they were asked for', async () => {
  const h = host()
  const q = new ExportQueue(h.host)
  const a = await q.enqueue(['a1', 'a2'], s, 'Web 2048')
  const b = await q.enqueue(['b1'], s, null)
  assert.equal(q.busy, true)
  const list = q.list()
  assert.deepEqual(
    list.map((p) => [p.jobId, p.queued]),
    [
      [a, false],
      [b, true]
    ]
  )
  await drain(h)
  assert.deepEqual(
    h.rendered.map((r) => r.key),
    ['a1', 'a2', 'b1']
  )
  assert.equal(q.busy, false)
  // Receipts, newest first.
  assert.deepEqual(
    q.list().map((p) => p.jobId),
    [b, a]
  )
  assert.equal(q.list()[1].label, 'Web 2048')
  assert.deepEqual(q.list()[1].outputs, ['/exports/a/a1.jpg', '/exports/a/a2.jpg'])
})

test('a queued export writes the recipe and folder there were when Export was pressed', async () => {
  const h = host()
  const q = new ExportQueue(h.host)
  h.recipes.set('a', 'warm')
  h.recipes.set('b', 'cool')
  await q.enqueue(['a'], s, null)
  await q.enqueue(['b'], s, null)
  // Edited, and the folder changed, while the first one runs.
  h.recipes.set('b', 'edited after')
  h.folder.now = '/exports/elsewhere'
  await drain(h)
  assert.deepEqual(h.rendered, [
    { key: 'a', recipe: 'warm', dest: '/exports/a' },
    { key: 'b', recipe: 'cool', dest: '/exports/a' }
  ])
})

test('one Version per photo, of its snapshot, once its file is written', async () => {
  const h = host({ fail: { b: new Error('broken') } })
  const q = new ExportQueue(h.host)
  h.recipes.set('a', 'r-a')
  await q.enqueue(['a', 'a', 'b'], s, null)
  await drain(h)
  // A key given twice is exported once; nothing is kept for a failure.
  assert.deepEqual(h.versions, [{ key: 'a', recipe: 'r-a' }])
  assert.equal(q.list()[0].total, 2)
})

test('offline originals are passed over and listed, not failed', async () => {
  const h = host({ offline: ['b'] })
  const q = new ExportQueue(h.host)
  await q.enqueue(['a', 'b', 'c'], s, null)
  await drain(h)
  const [p] = q.list()
  assert.deepEqual(p.skipped, ['b.CR2'])
  assert.deepEqual(p.errors, [])
  assert.equal(p.done, 3)
  assert.equal(p.outputs.length, 2)
  assert.equal(p.retryable, 0)
})

test('a full disk stops the export once, and Retry takes up from there', async () => {
  const full = Object.assign(new Error('write failed: No space left on device (os error 28)'), {})
  const h = host({ fail: { b: full } })
  const q = new ExportQueue(h.host)
  const id = await q.enqueue(['a', 'b', 'c', 'd'], s, null)
  await drain(h)
  const [p] = q.list()
  assert.equal(p.diskFull, true)
  assert.equal(p.errors.length, 1)
  assert.equal(p.errors[0].name, 'b.CR2')
  assert.deepEqual(
    h.rendered.map((r) => r.key),
    ['a']
  )
  assert.equal(p.retryable, 3)
  assert.equal(p.finished, true)
  // Retried: the same settings and folder, the photos as they are now.
  h.folder.now = '/exports/elsewhere'
  h.recipes.set('c', 'mended')
  h.host.render = async (job, key) => {
    h.rendered.push({ key, recipe: job.photos.get(key)!.recipe, dest: job.dest })
    return `${job.dest}/${key}.jpg`
  }
  const again = await q.retry(id)
  assert.ok(again)
  await drain(h)
  assert.deepEqual(h.rendered.slice(1), [
    { key: 'b', recipe: 'plain', dest: '/exports/a' },
    { key: 'c', recipe: 'mended', dest: '/exports/a' },
    { key: 'd', recipe: 'plain', dest: '/exports/a' }
  ])
  // Nothing is left to retry on the first.
  assert.equal(q.list().find((x) => x.jobId === id)?.retryable, 0)
  assert.equal(await q.retry(id), null)
})

test('an export is listed as soon as it is asked for, its photos read meanwhile', async () => {
  const h = host()
  let release!: () => void
  const slow = new Promise<void>((r) => (release = r))
  const snapshot = h.host.snapshot
  h.host.snapshot = async (key) => {
    // Read when Export was pressed, handed over later (a large selection).
    const snap = await snapshot(key)
    await slow
    return snap
  }
  h.recipes.set('a', 'as pressed')
  const q = new ExportQueue(h.host)
  const id = await q.enqueue(['a'], s, 'Web 2048')
  assert.equal(q.busy, true)
  assert.deepEqual(
    q.list().map((p) => p.jobId),
    [id]
  )
  assert.ok(h.sent.some((p) => p.jobId === id))
  h.recipes.set('a', 'edited after')
  await tick()
  assert.equal(h.pending.length, 0)
  release()
  await drain(h)
  assert.deepEqual(h.rendered, [{ key: 'a', recipe: 'as pressed', dest: '/exports/a' }])
})

test('photos that cannot be read end the export with one error, nothing written', async () => {
  const h = host()
  h.host.destination = async () => {
    throw new Error('the settings could not be read')
  }
  const q = new ExportQueue(h.host)
  await q.enqueue(['a', 'b'], s, 'Web 2048')
  await drain(h)
  const [p] = q.list()
  assert.equal(p.finished, true)
  assert.deepEqual(p.errors, [{ name: 'Web 2048', message: 'the settings could not be read' }])
  assert.deepEqual(h.rendered, [])
  assert.equal(q.busy, false)
})

test('a failure is listed and the rest go on', async () => {
  const h = host({ fail: { a: new Error('the engine refused it') } })
  const q = new ExportQueue(h.host)
  await q.enqueue(['a', 'b'], s, null)
  await drain(h)
  const [p] = q.list()
  assert.deepEqual(p.errors, [{ name: 'a.CR2', message: 'the engine refused it' }])
  assert.equal(p.outputs.length, 1)
  assert.equal(p.retryable, 1)
  assert.equal(h.finished.length, 1)
})

test('Stop: the running export at its next stage, a queued one before it begins', async () => {
  const h = host()
  const q = new ExportQueue(h.host)
  const a = await q.enqueue(['a1', 'a2'], s, null)
  const b = await q.enqueue(['b1'], s, null)
  q.stop(b)
  const queued = q.list().find((p) => p.jobId === b)!
  assert.equal(queued.finished, true)
  assert.equal(queued.stopped, true)
  await tick()
  q.stop(a)
  await drain(h)
  const ran = q.list().find((p) => p.jobId === a)!
  assert.equal(ran.stopped, true)
  assert.deepEqual(ran.errors, [])
  assert.deepEqual(h.rendered, [])
  assert.equal(q.busy, false)
})

test('the pause shows on the running export only, and is gone when it ends', async () => {
  const h = host()
  const q = new ExportQueue(h.host)
  q.setPaused(true)
  assert.equal(h.sent.length, 0)
  await q.enqueue(['a'], s, null)
  await tick()
  q.setPaused(true)
  assert.equal(q.list()[0].paused, true)
  await drain(h)
  assert.equal(q.list()[0].paused, false)
})

test('only the last receipts are kept', async () => {
  const h = host()
  const q = new ExportQueue(h.host)
  for (let i = 0; i < RECEIPTS_KEPT + 3; i++) {
    await q.enqueue([`k${i}`], s, null)
    await drain(h)
  }
  assert.equal(q.list().length, RECEIPTS_KEPT)
})

test('a full disk is told from other failures', () => {
  assert.equal(isDiskFull(Object.assign(new Error('x'), { code: 'ENOSPC' })), true)
  assert.equal(isDiskFull(new Error('Io: No space left on device (os error 28)')), true)
  assert.equal(isDiskFull(new Error('There is not enough space on the disk. (os error 112)')), true)
  assert.equal(isDiskFull(new Error('the export would overwrite the original')), false)
  assert.equal(isDiskFull(null), false)
})

test('quitting asks only while photos are still to export', () => {
  const p = (more: Partial<ExportProgress>): ExportProgress =>
    ({ jobId: 'j', done: 0, total: 0, finished: false, ...more }) as ExportProgress
  assert.equal(quitQuestion([]), null)
  assert.equal(quitQuestion([p({ finished: true, total: 4, done: 4 })]), null)
  const ask = quitQuestion([p({ total: 10, done: 4 }), p({ total: 3, queued: true })])
  assert.ok(ask)
  assert.match(ask.detail, /^9 photos are still to export/)
})
