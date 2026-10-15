// Leaving a photo stops its RAW develop (engine 0.21.0, E6), unless another
// caller waits for it or it is nearly done by its own count (E68); the
// count reaches main from the host's token and the loupe's bar never goes
// back (the owner, 2026-10-14).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SharedWork, FINISH_FROM } from '../src/main/sharedwork'
import { progressOf } from '../src/main/engine/progress'
import { countedFill, timeLeftMs } from '../src/shared/ai'
import { stageBar } from '../src/main/ai/stagebar'
import type { CancelToken, EngineProgressMessage, Progress } from '../src/shared/engine-types'
import type { RawModels } from '../src/main/ai/rawdevelop'

const cancelled = (): Error => Object.assign(new Error('cancelled'), { code: 'Cancelled' })

/** Work that ends when told, or rejects as the engine does once its signal aborts. */
function develop(): {
  work: SharedWork<string>
  finish(v: string): void
  stoppedWith(): AbortSignal
} {
  let finish!: (v: string) => void
  let given!: AbortSignal
  const work = new SharedWork<string>((signal) => {
    given = signal
    return new Promise<string>((resolve, reject) => {
      finish = resolve
      signal.addEventListener('abort', () => reject(cancelled()), { once: true })
    })
  }, cancelled)
  return { work, finish: (v) => finish(v), stoppedWith: () => given }
}

const settled = (p: Promise<unknown>): Promise<string> =>
  p.then(
    (v) => `ok ${String(v)}`,
    (e: { code?: string }) => `no ${e.code ?? ''}`
  )

test('one of two callers leaving does not stop the develop; the second leaving does', async () => {
  const d = develop()
  const a = new AbortController()
  const b = new AbortController()
  const pa = settled(d.work.join(a.signal))
  const pb = settled(d.work.join(b.signal))
  a.abort()
  assert.equal(await pa, 'no Cancelled')
  assert.equal(d.stoppedWith().aborted, false)
  b.abort()
  assert.equal(await pb, 'no Cancelled')
  assert.equal(d.stoppedWith().aborted, true)
  assert.ok(d.work.stopped)
  await d.work.promise.catch(() => undefined)
})

test('a caller without a signal (an export) keeps the develop going for everyone', async () => {
  const d = develop()
  const a = new AbortController()
  const viewer = settled(d.work.join(a.signal))
  const exporter = settled(d.work.join())
  a.abort()
  assert.equal(await viewer, 'no Cancelled')
  assert.equal(d.stoppedWith().aborted, false)
  d.finish('master.tiff')
  assert.equal(await exporter, 'ok master.tiff')
})

test('a develop nearly done finishes when its photo is left; one not yet stops', async () => {
  const near = develop()
  near.work.count({ done: Math.ceil(FINISH_FROM * 100), total: 100 })
  const a = new AbortController()
  const left = settled(near.work.join(a.signal))
  a.abort()
  assert.equal(await left, 'no Cancelled')
  assert.equal(near.stoppedWith().aborted, false)
  assert.ok(near.work.finishing)
  // Coming back to it joins the same develop, which ends as made.
  const back = settled(near.work.join(new AbortController().signal))
  near.finish('master.tiff')
  assert.equal(await back, 'ok master.tiff')

  const early = develop()
  early.work.count({ done: 30, total: 100 })
  const b = new AbortController()
  const gone = settled(early.work.join(b.signal))
  b.abort()
  assert.equal(await gone, 'no Cancelled')
  assert.ok(early.stoppedWith().aborted)
  await early.work.promise.catch(() => undefined)
  // Nothing counted yet (LibRaw's unpack): it stops.
  const none = develop()
  const c = new AbortController()
  void settled(none.work.join(c.signal))
  c.abort()
  assert.ok(none.stoppedWith().aborted)
  await none.work.promise.catch(() => undefined)
})

test('a caller already aborted is answered at once and starts nothing new', async () => {
  const d = develop()
  const a = new AbortController()
  a.abort()
  assert.equal(await settled(d.work.join(a.signal)), 'no Cancelled')
  assert.equal(d.stoppedWith().aborted, false)
  d.finish('x')
})

test('the host reads a call’s token on a timer and tells main only when it moved', async () => {
  let progress: Progress = { done: 0, total: 0 }
  class FakeToken implements CancelToken {
    cancelled = false
    cancel(): void {
      this.cancelled = true
    }
    get progress(): Progress {
      return progress
    }
  }
  const sent: EngineProgressMessage[] = []
  const counting = progressOf({ CancelToken: FakeToken }, 7, (m) => void sent.push(m), 2)
  assert.ok(counting)
  const wait = (): Promise<void> => new Promise((r) => setTimeout(r, 12))
  await wait()
  progress = { done: 3, total: 40 }
  await wait()
  await wait()
  progress = { done: 40, total: 40 }
  await wait()
  counting.stop()
  progress = { done: 1, total: 90 }
  await wait()
  assert.deepEqual(sent, [
    { kind: 'progress', id: 7, done: 0, total: 0 },
    { kind: 'progress', id: 7, done: 3, total: 40 },
    { kind: 'progress', id: 7, done: 40, total: 40 }
  ])
  // An engine without tokens (a 0.20 development kit): nothing to read.
  assert.equal(
    progressOf({}, 8, () => undefined),
    null
  )
})

test('the bar never goes back when a second stage lays out its windows', () => {
  let fill = countedFill(null, { done: 0, total: 0 })
  assert.equal(fill, null)
  fill = countedFill(fill, { done: 30, total: 40 })
  assert.equal(fill, 0.75)
  // PMRID done, the demosaic's windows laid out: the count steps back, the bar waits.
  fill = countedFill(fill, { done: 40, total: 400 })
  assert.equal(fill, 0.75)
  fill = countedFill(fill, { done: 360, total: 400 })
  assert.equal(fill, 0.9)
  assert.equal(timeLeftMs(9000, 0.05), null)
  assert.equal(timeLeftMs(2000, 0.5), 2000)
  assert.equal(timeLeftMs(1000, null), null)
})

test('a develop stopped by its photo being left is neither the model’s trouble nor the frame’s', async () => {
  const { scenePlan, setRawModels, withScene } = await import('../src/main/ai/rawdevelop')
  const fetched: string[] = []
  const PIXL = ['pixl-demosaic-v1-bayer', 'pixl-demosaic-v1-xtrans']
  const models: RawModels = {
    offered: (id) => PIXL.includes(id),
    pixlDemosaic: async () => true,
    installed: async () => true,
    ref: async (id) => ({ id }),
    withCpuFallback: async (_ids, make) => make(new Set()),
    canRun: async () => true,
    fetch: (id) => void fetched.push(id)
  }
  setRawModels(models)
  const plan = await scenePlan('Bayer')
  assert.equal(plan.demosaic, 'pixl')
  const said: string[] = []
  const was = console.error
  console.error = (...args: unknown[]): void => void said.push(args.map(String).join(' '))
  let runs = 0
  try {
    await assert.rejects(
      withScene(plan, async () => {
        runs++
        throw cancelled()
      }),
      { code: 'Cancelled' }
    )
  } finally {
    console.error = was
  }
  // Tried once, nothing stood in, nothing said, and still the plan for the next photo.
  assert.equal(runs, 1)
  assert.deepEqual(said, [])
  assert.equal((await scenePlan('Bayer')).demosaic, 'pixl')
})

test('an Enhance or AI Denoise bar is the engine’s count once it counts, the clock only before', async () => {
  const seen: [number, boolean][] = []
  const bar = stageBar((p, estimated = false) => void seen.push([p, estimated]), 1000, 2)
  await new Promise((r) => setTimeout(r, 15))
  assert.ok(seen.length > 0 && seen.every(([, e]) => e), 'the clock’s guesses, marked so')
  const guessed = seen.length
  bar.onProgress({ done: 0, total: 0 })
  bar.onProgress({ done: 10, total: 40 })
  // A retry on the CPU starts a fresh count: the bar holds.
  bar.onProgress({ done: 2, total: 40 })
  bar.onProgress({ done: 30, total: 40 })
  await new Promise((r) => setTimeout(r, 15))
  bar.stop()
  assert.deepEqual(seen.slice(guessed), [
    [0.25, false],
    [0.75, false]
  ])
})
