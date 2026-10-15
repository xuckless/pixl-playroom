// The performance pass (feat/ux-perf): the pure pieces behind each fix.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { logRate, rateLimited } from '../src/main/lograte'
import { KnownFiles } from '../src/main/knownfiles'
import { coalesceByKey, mergeChanged } from '../src/main/coalesce'
import { changedBeyond } from '../src/renderer/src/lib/storechange'
import { fadeDone, slotKey, swapPicture } from '../src/renderer/src/lib/pictureslots'
import { LIVE_TILE_MS, liveTiles } from '../src/renderer/src/lib/livetile'
import { withThumbs } from '../src/renderer/src/views/looks/thumbmerge'
import { cosmeticChanges, editedCount, withChanged } from '../src/renderer/src/lib/visiblepatch'
import { floatSettled } from '../src/shared/hdrdisplay'
import { LANGUAGES } from '../src/shared/i18n/index'
import type { LookThumbEvent } from '../src/shared/ipc'
import { item } from './items'

// ── PERF-15: the log ─────────────────────────────────────────────────────────

test('a burst of warnings logs the first few, then counts the rest', () => {
  let now = 0
  const rate = logRate(3, 1000, () => now)
  assert.deepEqual(
    Array.from({ length: 5 }, () => rate.take()),
    [true, true, true, false, false]
  )
  assert.equal(rate.drain(), 2)
  assert.equal(rate.drain(), 0)
  // A new window logs in full again.
  now = 1000
  assert.equal(rate.take(), true)
})

test('what a rate held back is logged as one line when the burst is over', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const lines: unknown[][] = []
    const warn = rateLimited(
      2,
      1000,
      (...a) => lines.push(a),
      (n) => `${n} more`
    )
    for (let i = 0; i < 6; i++) warn('failed', i)
    assert.deepEqual(lines, [
      ['failed', 0],
      ['failed', 1]
    ])
    mock.timers.tick(1000)
    assert.deepEqual(lines.at(-1), ['4 more'])
    assert.equal(lines.length, 3)
  } finally {
    mock.timers.reset()
  }
})

test('the main process logs to its file without waiting on the disk', () => {
  const app = readFileSync(resolve('src/main/app.ts'), 'utf8')
  const sync = app.indexOf('log.transports.file.sync = false')
  assert.ok(sync > 0, 'the file transport is asynchronous')
  // Set before anything is logged: the file keeps the mode it opens with.
  assert.ok(sync < app.indexOf('log.info('), 'set before the first line')
})

// ── PERF-12: plane files ─────────────────────────────────────────────────────

test('known plane files are forgotten by folder, and by prefix', () => {
  const k = new KnownFiles()
  const dir = resolve('/cache/photos/1')
  k.add(join(dir, 'brush-a-Normal.png'))
  k.add(join(dir, 'grad-b-Normal.png'))
  k.add(join(dir, 'lensplanes', 'grad-c.png'))
  k.add(join(resolve('/cache/photos/10'), 'grad-d-Normal.png'))
  k.forget(dir, 'grad-')
  assert.equal(k.has(join(dir, 'brush-a-Normal.png')), true)
  assert.equal(k.has(join(dir, 'grad-b-Normal.png')), false)
  // Only what is directly in the folder; another photo's folder is its own.
  assert.equal(k.has(join(dir, 'lensplanes', 'grad-c.png')), true)
  assert.equal(k.has(join(resolve('/cache/photos/10'), 'grad-d-Normal.png')), true)
  k.forget(dir)
  assert.equal(k.has(join(dir, 'brush-a-Normal.png')), false)
  assert.equal(k.size, 2)
})

// ── PERF-09: a folder's changes ──────────────────────────────────────────────

test("a folder's changes close together reach the window once", () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    const told: string[] = []
    const changed = coalesceByKey((k) => told.push(k), 300, 1000)
    changed('/a')
    mock.timers.tick(200)
    changed('/a')
    changed('/b')
    mock.timers.tick(299)
    assert.deepEqual(told, [])
    mock.timers.tick(1)
    assert.deepEqual(told.sort(), ['/a', '/b'])
    // A steady stream still gets through, at most `maxMs` after its first.
    told.length = 0
    for (let i = 0; i < 10; i++) {
      changed('/c')
      mock.timers.tick(200)
    }
    assert.ok(told.length >= 1 && told.length <= 2, `told ${told.length} times`)
  } finally {
    mock.timers.reset()
  }
})

test('facts read in gather by photo; a change to the listing takes it whole', () => {
  assert.deepEqual([...(mergeChanged(undefined, [1, 2]) ?? [])], [1, 2])
  assert.deepEqual([...(mergeChanged(new Set([1]), [2]) ?? [])], [1, 2])
  assert.equal(mergeChanged(new Set([1]), undefined), null)
  assert.equal(mergeChanged(null, [3]), null)
})

// ── PERF-13: the menus ───────────────────────────────────────────────────────

test("a store's update counts only when it changes what the listener reads", () => {
  const prev = { picture: 1, stats: 1, recipe: 'a' }
  const ignored = new Set<keyof typeof prev>(['picture', 'stats'])
  assert.equal(changedBeyond({ ...prev, picture: 2, stats: 2 }, prev, ignored), false)
  assert.equal(changedBeyond({ ...prev, recipe: 'b' }, prev, ignored), true)
})

// ── PERF-05: the loupe's canvases ────────────────────────────────────────────

test('a drag draws into the shown slot; a fade hands it to the fading picture', () => {
  const start = { shown: 'a', prev: null, slot: 0 as const }
  // At once (a drag): the same slot, nothing fading.
  const drag = swapPicture(start, 'b', false)
  assert.deepEqual(drag, { shown: 'b', prev: null, slot: 0 })
  // A fade: the shown picture keeps its element (its slot), the next takes the other.
  const fade = swapPicture(drag, 'c', true)
  assert.deepEqual(fade, { shown: 'c', prev: 'b', slot: 1 })
  assert.equal(slotKey(fade.slot === 0 ? 1 : 0), slotKey(drag.slot))
  assert.deepEqual(fadeDone(fade), { shown: 'c', prev: null, slot: 1 })
  // The same picture again changes nothing.
  assert.equal(swapPicture(fade, 'c', true), fade)
  assert.equal(fadeDone(drag), drag)
})

// ── PERF-04: the 1:1 tile during a drag ──────────────────────────────────────

test('a drag asks for tiles as it goes only while they come quickly, one at a time', () => {
  assert.equal(liveTiles(80, false), true)
  assert.equal(liveTiles(LIVE_TILE_MS, false), true)
  assert.equal(liveTiles(LIVE_TILE_MS + 1, false), false)
  assert.equal(liveTiles(80, true), false)
  // Before any tile was timed, the drag leaves the engine alone.
  assert.equal(liveTiles(Infinity, false), false)
})

// ── PERF-06: the Looks browser ───────────────────────────────────────────────

test("a frame's look thumbnails go in together; another photo's are left out", () => {
  const ev = (id: string, key = 'p1'): LookThumbEvent =>
    ({ key, id, url: `u-${id}` }) as unknown as LookThumbEvent
  const byId = { a: ev('a') }
  const next = withThumbs(byId, 'p1', [ev('b'), ev('c'), ev('x', 'p2')])
  assert.deepEqual(Object.keys(next).sort(), ['a', 'b', 'c'])
  assert.equal(next.a, byId.a)
  // Nothing of this photo's: the same object, so nothing draws again.
  assert.equal(withThumbs(byId, 'p1', [ev('x', 'p2')]), byId)
})

// ── PERF-08: the library's visible list ──────────────────────────────────────

test('thumbnails and badges keep the visible order; anything else sorts again', () => {
  const a = item({ key: '1', name: 'a.jpg' })
  const b = item({ key: '2', name: 'b.jpg' })
  const c = item({ key: '3', name: 'c.jpg' })
  const prev = [a, b, c]
  const thumbs = [a, { ...b, thumbUrl: 'pixl://c/b' }, { ...c, hdr: 'gainmap' as const }]
  const changed = cosmeticChanges(prev, thumbs)
  assert.ok(changed)
  assert.deepEqual([...changed.keys()], ['2', '3'])
  // The visible list (say, sorted the other way) keeps its order, the new items in.
  const visible = [c, b, a]
  const out = withChanged(visible, changed)
  assert.deepEqual(
    out.map((i) => i.key),
    ['3', '2', '1']
  )
  assert.equal(out[1].thumbUrl, 'pixl://c/b')
  assert.equal(withChanged(visible, new Map()), visible)
  // A rating (the sort may read it), an item more or one moved: sorted again.
  assert.equal(cosmeticChanges(prev, [a, { ...b, rating: 3 }, c]), null)
  assert.equal(cosmeticChanges(prev, [a, b]), null)
  assert.equal(cosmeticChanges(prev, [b, a, c]), null)
})

test('the edited count is made once per list', () => {
  const list = [
    item({ key: '1', edited: true }),
    item({ key: '2' }),
    item({ key: '3', edited: true })
  ]
  assert.equal(editedCount(list), 2)
  // The same list again: the count kept (a change would make a new list).
  list[1].edited = true
  assert.equal(editedCount(list), 2)
  assert.equal(editedCount([...list]), 3)
})

// ── PERF-02: settled SDR pictures ────────────────────────────────────────────

test('a settled SDR picture is F16 only where the display shows more than 8 bits', () => {
  const sdr = { settled: true, display: null, float: true, isHdr: false }
  assert.equal(floatSettled({ ...sdr, depth: 10 }), true)
  assert.equal(floatSettled({ ...sdr, depth: 8 }), false)
  // Not known yet: as before.
  assert.equal(floatSettled({ ...sdr, depth: null }), true)
  // Full HDR, an HDR photo, a window without float frames, a draft: never this path.
  assert.equal(floatSettled({ ...sdr, depth: 10, display: { peakNits: 1000 } }), false)
  assert.equal(floatSettled({ ...sdr, depth: 10, isHdr: true }), false)
  assert.equal(floatSettled({ ...sdr, depth: 10, float: false }), false)
  assert.equal(floatSettled({ ...sdr, depth: 10, settled: false }), false)
})

// ── PERF-10: the catalogs ────────────────────────────────────────────────────

test('only English is bundled at start; every other catalog loads when wanted', () => {
  const setup = readFileSync(resolve('src/shared/i18n/setup.ts'), 'utf8')
  const statics = [...setup.matchAll(/^import .* from '\.\/locales\/([\w-]+)\.json'/gm)].map(
    (m) => m[1]
  )
  assert.deepEqual(statics, ['en'])
  for (const { code } of LANGUAGES) {
    if (code === 'en') continue
    assert.ok(setup.includes(`import('./locales/${code}.json')`), `${code} is loaded on demand`)
  }
  // Nothing else in the app reaches a catalog directly.
  for (const file of sources(resolve('src'))) {
    if (file.endsWith('setup.ts')) continue
    assert.doesNotMatch(
      readFileSync(file, 'utf8'),
      /(from\s*|import\()'[^']*locales\/[\w-]+\.json'/,
      file
    )
  }
})

// ── PERF-16: stable selector results ─────────────────────────────────────────

test('no store selector makes a new empty array or object on each call', () => {
  // `useX((s) => s.a ?? [])` returns a new [] whenever `a` is missing: zustand
  // 5 sees a changed snapshot each time. A module constant keeps it stable.
  const bad = /use[A-Z]\w*\(\s*\(\w+\)\s*=>[^\n]*\?\?\s*(\[\]|\{\})\s*\)/
  for (const file of sources(resolve('src/renderer/src'))) {
    const text = readFileSync(file, 'utf8')
    assert.doesNotMatch(text, bad, file)
  }
})

/** Every .ts and .tsx file under `dir`. */
function sources(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...sources(p))
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}
