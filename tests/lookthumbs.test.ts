import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LookThumbQueue, type LookThumb, type ThumbJob } from '../src/main/lookthumbs'

/** A fake engine: each card waits until the test lets it finish (or it is stopped). */
function harness(): {
  queue: LookThumbQueue<string>
  started: string[]
  emitted: { token: number; id: string }[]
  stopped: string[]
  finish: (id: string) => Promise<void>
} {
  const started: string[] = []
  const emitted: { token: number; id: string }[] = []
  const stopped: string[] = []
  const pending = new Map<string, () => void>()
  const queue = new LookThumbQueue<string>(
    (job, signal) =>
      new Promise<LookThumb>((resolve, reject) => {
        started.push(job.id)
        signal.addEventListener('abort', () => {
          stopped.push(job.id)
          reject(new Error('cancelled'))
        })
        pending.set(job.id, () => resolve({ url: `u:${job.id}`, width: 10, height: 10 }))
      }),
    (token, id) => emitted.push({ token, id })
  )
  const finish = async (id: string): Promise<void> => {
    pending.get(id)?.()
    // Let the queue take its next card.
    await new Promise((r) => setTimeout(r, 0))
  }
  return { queue, started, emitted, stopped, finish }
}

const jobs = (...ids: string[]): ThumbJob<string>[] => ids.map((id) => ({ id, recipe: `r${id}` }))

test('cards are made one at a time, in the order asked', async () => {
  const h = harness()
  h.queue.request(1, jobs('a', 'b', 'c'))
  assert.deepEqual(h.started, ['a'])
  await h.finish('a')
  await h.finish('b')
  await h.finish('c')
  assert.deepEqual(h.started, ['a', 'b', 'c'])
  assert.deepEqual(
    h.emitted.map((e) => e.id),
    ['a', 'b', 'c']
  )
  assert.equal(h.queue.busy, false)
})

test('a newer ask replaces what waits; the card in hand finishes if still wanted', async () => {
  const h = harness()
  h.queue.request(1, jobs('a', 'b', 'c'))
  h.queue.request(2, jobs('d', 'a'))
  assert.deepEqual(h.stopped, [])
  await h.finish('a')
  // Made under the newer ask, and not made twice.
  assert.deepEqual(h.emitted, [{ token: 2, id: 'a' }])
  assert.deepEqual(h.started, ['a', 'd'])
})

test('a card no longer wanted (or wanted on another recipe) is stopped', async () => {
  const h = harness()
  h.queue.request(1, jobs('a', 'b'))
  h.queue.request(2, [{ id: 'a', recipe: 'changed' }])
  assert.deepEqual(h.stopped, ['a'])
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(h.started, ['a', 'a'])
  await h.finish('a')
  assert.deepEqual(h.emitted, [{ token: 2, id: 'a' }])
})

test('a late, older ask changes nothing', async () => {
  const h = harness()
  h.queue.request(5, jobs('a'))
  h.queue.request(3, jobs('x', 'y'))
  await h.finish('a')
  assert.deepEqual(h.started, ['a'])
})

test('cancel and close stop everything', async () => {
  const h = harness()
  h.queue.request(1, jobs('a', 'b'))
  h.queue.cancel()
  assert.deepEqual(h.stopped, ['a'])
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(h.emitted, [])
  h.queue.request(2, jobs('c'))
  assert.deepEqual(h.started, ['a', 'c'])
  h.queue.close()
  h.queue.request(3, jobs('d'))
  await new Promise((r) => setTimeout(r, 0))
  assert.deepEqual(h.started, ['a', 'c'])
  assert.deepEqual(h.emitted, [])
})
