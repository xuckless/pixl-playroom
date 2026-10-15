import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  advancing,
  comparePaneOf,
  compareStart,
  dropFrom,
  metaTargetsFor,
  nextOrBefore,
  promoted,
  restoreTo,
  stepFrom,
  SURVEY_MAX,
  surveyLayout,
  surveyOf
} from '../src/shared/cullnav'
import { bursts, groupAround, nearGroups, withAsked } from '../src/shared/shots'
import {
  DEFAULT_PREVIEW_CAP,
  evictions,
  focusPlan,
  PREVIEW_CAPS,
  regionPixels,
  zoomSize
} from '../src/shared/previews'
import {
  entrySize,
  onlyKeys,
  pushEntry,
  EMPTY_STACK,
  type DropEntry
} from '../src/shared/libraryundo'
import {
  DEFAULT_FILTER,
  isDefaultFilter,
  moreFilters,
  savableFilter,
  withoutMore,
  type Filter
} from '../src/shared/filter'
import type { RawPreview } from '../src/shared/engine-types'

const order = ['a', 'b', 'c', 'd', 'e']

// ── stepping ──

test('stepFrom walks the order, passing over the Select, and stops at the ends', () => {
  assert.equal(stepFrom(order, 'b', 1), 'c')
  assert.equal(stepFrom(order, 'b', -1), 'a')
  assert.equal(stepFrom(order, 'b', 1, 'c'), 'd')
  assert.equal(stepFrom(order, 'e', 1), null)
  assert.equal(stepFrom(order, 'a', -1), null)
  // A photo no longer shown: the first that is not skipped.
  assert.equal(stepFrom(order, 'gone', 1, 'a'), 'b')
  assert.equal(stepFrom([], 'a', 1), null)
})

test('nextOrBefore: the photo after, or before it at the end', () => {
  assert.equal(nextOrBefore(order, 'c'), 'd')
  assert.equal(nextOrBefore(order, 'e'), 'd')
  assert.equal(nextOrBefore(order, 'd', 'e'), 'c')
  assert.equal(nextOrBefore(['a'], 'a'), null)
})

// ── Compare ──

test('Compare opens on the two selected, else the focus and the next shown', () => {
  assert.deepEqual(compareStart(order, ['b', 'd'], 'd'), { select: 'd', candidate: 'b' })
  assert.deepEqual(compareStart(order, ['b', 'd'], 'a'), { select: 'b', candidate: 'd' })
  assert.deepEqual(compareStart(order, ['b'], 'b'), { select: 'b', candidate: 'c' })
  // The last photo compares with the one before it.
  assert.deepEqual(compareStart(order, ['e', 'a', 'c'], 'e'), { select: 'e', candidate: 'd' })
  assert.equal(compareStart(['a'], ['a'], 'a'), null)
  assert.equal(compareStart([], [], null), null)
})

test('↑ makes the Candidate the Select and brings the next', () => {
  assert.deepEqual(promoted(order, 'a', 'b'), { select: 'b', candidate: 'c' })
  // Passing over the old Select.
  assert.deepEqual(promoted(order, 'c', 'b'), { select: 'b', candidate: 'd' })
  // At the end: the one before.
  assert.deepEqual(promoted(order, 'a', 'e'), { select: 'e', candidate: 'd' })
  // Only the two: they swap.
  assert.deepEqual(promoted(['a', 'b'], 'a', 'b'), { select: 'b', candidate: 'a' })
})

test('rating keys act on the selection in the Grid, the shown photo elsewhere, Compare’s picked pane', () => {
  const base = { selection: ['a', 'b'], focus: 'a', open: 'c' }
  assert.deepEqual(metaTargetsFor({ ...base, view: 'library', mode: 'grid' }), ['a', 'b'])
  assert.deepEqual(metaTargetsFor({ ...base, view: 'library', mode: 'loupe' }), ['a'])
  assert.deepEqual(metaTargetsFor({ ...base, view: 'library', mode: 'compare' }), ['a'])
  assert.deepEqual(metaTargetsFor({ ...base, view: 'library', mode: 'compare', active: 'd' }), [
    'd'
  ])
  assert.deepEqual(metaTargetsFor({ ...base, view: 'library', mode: 'survey' }), ['a'])
  assert.deepEqual(metaTargetsFor({ ...base, view: 'develop', mode: 'compare', active: 'd' }), [
    'c'
  ])
})

// ── Survey ──

test('Survey shows the selection in the order shown, twelve at most', () => {
  assert.deepEqual(surveyOf(order, ['d', 'b']), { keys: ['b', 'd'], total: 2 })
  // Selected but hidden by the filter: after those shown.
  assert.deepEqual(surveyOf(order, ['z', 'c']), { keys: ['c', 'z'], total: 2 })
  const many = Array.from({ length: 40 }, (_, i) => `p${i}`)
  const s = surveyOf(many, many)
  assert.equal(s.keys.length, SURVEY_MAX)
  assert.equal(s.total, 40)
  assert.deepEqual(s.keys, many.slice(0, SURVEY_MAX))
})

test('a dropped tile hands the focus on, and comes back where it was', () => {
  assert.deepEqual(dropFrom(['a', 'b', 'c'], 'b'), { keys: ['a', 'c'], focus: 'c' })
  assert.deepEqual(dropFrom(['a', 'b', 'c'], 'c'), { keys: ['a', 'b'], focus: 'b' })
  assert.deepEqual(dropFrom(['a'], 'a'), { keys: [], focus: null })
  assert.deepEqual(dropFrom(['a', 'b'], 'z'), { keys: ['a', 'b'], focus: 'a' })
  assert.deepEqual(restoreTo(['a', 'c'], 'b', 1), ['a', 'b', 'c'])
  assert.deepEqual(restoreTo(['a'], 'b', 9), ['a', 'b'])
  assert.deepEqual(restoreTo(['a', 'b'], 'b', 0), ['a', 'b'], 'already there')
})

test('Survey’s tiles take the columns that make them largest', () => {
  // One photo fills the box.
  assert.deepEqual(surveyLayout(1, { w: 1200, h: 800 }), { cols: 1, rows: 1, w: 1200, h: 800 })
  // Two side by side in a wide box, stacked in a tall one.
  assert.equal(surveyLayout(2, { w: 1600, h: 600 }).cols, 2)
  assert.equal(surveyLayout(2, { w: 600, h: 1600 }).cols, 1)
  // Four in a 3:2 box: two by two.
  const four = surveyLayout(4, { w: 1212, h: 812 })
  assert.deepEqual([four.cols, four.rows], [2, 2])
  assert.equal(four.w, 600)
  // Twelve in a wide box: four across.
  assert.equal(surveyLayout(12, { w: 1600, h: 900 }).cols, 4)
  assert.deepEqual(surveyLayout(0, { w: 100, h: 100 }), { cols: 1, rows: 1, w: 0, h: 0 })
})

test('the drop goes on the undo stack: one entry, cut to what came back', () => {
  const e: DropEntry = { kind: 'drop', id: 'x', title: 'Drop', keys: ['a', 'b'], at: [3, 7] }
  assert.equal(entrySize(e), 2)
  assert.deepEqual(onlyKeys(e, ['b']), { ...e, keys: ['b'], at: [7] })
  assert.equal(pushEntry(EMPTY_STACK, e).done.length, 1)
  assert.equal(pushEntry(EMPTY_STACK, { ...e, keys: [], at: [] }).done.length, 0, 'nothing dropped')
})

// ── auto-advance ──

test('auto-advance: the toggle, flipped while Caps Lock is on', () => {
  assert.equal(advancing(false, false), false)
  assert.equal(advancing(true, false), true)
  assert.equal(advancing(false, true), true)
  assert.equal(advancing(true, true), false)
})

// ── shots ──

const t0 = Date.UTC(2026, 6, 1, 22, 17, 1)
const shot = (key: string, s: number, name = key): { key: string; t: number; name: string } => ({
  key,
  t: t0 + s * 1000,
  name
})

test('bursts: runs with at most three seconds between shots, two or more, in capture order', () => {
  assert.deepEqual(
    bursts([shot('b', 0, 'IMG_2280'), shot('a', 0, 'IMG_2279'), shot('c', 3), shot('d', 15)]),
    [['a', 'b', 'c']]
  )
  assert.deepEqual(bursts([shot('a', 0), shot('b', 15), shot('c', 16), shot('d', 17)]), [
    ['b', 'c', 'd']
  ])
  assert.deepEqual(bursts([shot('a', 0), shot('b', 4)]), [], 'four seconds apart: no burst')
  assert.deepEqual(bursts([shot('a', 0), shot('b', 4)], 10), [['a', 'b']])
  assert.deepEqual(bursts([{ key: 'a', t: NaN, name: 'a' }, shot('b', 0)]), [], 'no time: out')
})

test('near groups compare hashes only; a burst wins over them', () => {
  const near = nearGroups([
    { key: 'd', hash: '00000000000000ff' },
    { key: 'e', hash: '000000000000000f' },
    { key: 'f', hash: 'ffffffffffffffff' }
  ])
  assert.deepEqual(near, [['d', 'e']])
  assert.deepEqual(groupAround('e', [], near), { kind: 'near', keys: ['d', 'e'] })
  assert.deepEqual(groupAround('d', [['c', 'd']], near), { kind: 'burst', keys: ['c', 'd'] })
  assert.equal(groupAround('f', [['c', 'd']], near), null)
})

// ── previews ──

const preview = (width: number, height: number, decodable = true): RawPreview => ({
  format: 'Jpeg',
  width,
  height,
  orientation: 1,
  bytes: 1,
  decodable,
  reducible: true
})

test('1:1 is the camera’s preview when it is two thirds of the sensor, else a region render', () => {
  const canon = {
    width: 6288,
    height: 4056,
    raw_previews: [preview(6000, 4000), preview(160, 120)]
  }
  assert.equal(focusPlan(canon, true, false), 'embedded')
  // An edit is never the camera's rendering.
  assert.equal(focusPlan(canon, true, true), 'region')
  const small = { width: 6048, height: 4024, raw_previews: [preview(1616, 1080)] }
  assert.equal(focusPlan(small, true, false), 'region')
  // The first preview the engine can decode is the one it makes.
  const first = {
    width: 6048,
    height: 4024,
    raw_previews: [preview(1616, 1080), preview(6000, 4000)]
  }
  assert.equal(focusPlan(first, true, false), 'region')
  const skip = {
    width: 6048,
    height: 4024,
    raw_previews: [preview(6000, 4000, false), preview(4032, 2688)]
  }
  assert.equal(focusPlan(skip, true, false), 'embedded')
  // A probe from before engine 0.21 says nothing of its previews.
  assert.equal(focusPlan({ width: 6000, height: 4000 }, true, false), 'region')
  // A JPEG unedited: its own pixels, whole.
  assert.equal(focusPlan({ width: 4000, height: 3000 }, false, false), 'whole')
})

test('the previews folder keeps to its cap, the least recently shown going first', () => {
  const files = [
    { name: 'old', bytes: 600, used: 1 },
    { name: 'mid', bytes: 600, used: 2 },
    { name: 'new', bytes: 600, used: 3 }
  ]
  assert.deepEqual(evictions(files, 2000), [])
  assert.deepEqual(evictions(files, 1200), ['old'])
  assert.deepEqual(evictions(files, 500), ['old', 'mid', 'new'])
  // Shown now: never taken.
  assert.deepEqual(evictions(files, 1200, new Set(['old'])), ['mid'])
  assert.ok(PREVIEW_CAPS.includes(DEFAULT_PREVIEW_CAP))
})

test('a region asked for as fractions lands inside the picture', () => {
  assert.deepEqual(regionPixels({ x: 0.5, y: 0.5, width: 0.25, height: 0.25 }, 6000, 4000), {
    x: 3000,
    y: 2000,
    width: 1500,
    height: 1000
  })
  // Past the edge: cut to it.
  assert.deepEqual(regionPixels({ x: 0.9, y: 0.9, width: 0.5, height: 0.5 }, 1000, 1000), {
    x: 900,
    y: 900,
    width: 100,
    height: 100
  })
  assert.deepEqual(regionPixels({ x: -1, y: 2, width: 0, height: 0 }, 100, 100), {
    x: 0,
    y: 99,
    width: 1,
    height: 1
  })
})

// ── the filter bar ──

test('the filter bar’s chips are the More… filters, each cleared on its own', () => {
  const f: Filter = {
    ...DEFAULT_FILTER,
    camera: 'Canon EOS R6',
    iso: [100, 800],
    from: '2026-01-01',
    minRating: 3
  }
  assert.deepEqual(moreFilters(f), ['camera', 'iso', 'taken'])
  assert.deepEqual(withoutMore('taken'), { from: '', to: '' })
  assert.deepEqual(withoutMore('iso'), { iso: null })
  assert.deepEqual(moreFilters({ ...f, ...withoutMore('camera') }), ['iso', 'taken'])
  assert.equal(isDefaultFilter(DEFAULT_FILTER), true)
  assert.equal(isDefaultFilter({ ...DEFAULT_FILTER, text: 'birch' }), true, 'the search is apart')
  assert.equal(isDefaultFilter(f), false)
})

test('Survey of a huge selection is quick, each photo counted once', () => {
  const many = Array.from({ length: 40000 }, (_, i) => `p${i}`)
  // Half of them hidden by a filter, and one selected twice.
  const shown = many.filter((_, i) => i % 2 === 0)
  const t0 = performance.now()
  const s = surveyOf(shown, [...many, 'p1'])
  assert.ok(performance.now() - t0 < 500, 'not quadratic')
  assert.equal(s.total, many.length)
  assert.deepEqual(s.keys.slice(0, 3), ['p0', 'p2', 'p4'])
  assert.equal(s.keys.length, SURVEY_MAX)
  // Every one hidden: in the selection's order.
  assert.deepEqual(surveyOf([], ['c', 'a', 'c']), { keys: ['c', 'a'], total: 2 })
})

test('a photo with no larger picture (offline) never zooms; else its 1:1, the last, the preview', () => {
  const full = { width: 6000, height: 4000 }
  const last = { width: 5000, height: 3000 }
  const preview = { width: 2560, height: 1707 }
  assert.equal(zoomSize(false, full, last, preview), null)
  assert.equal(zoomSize(true, full, last, preview), full)
  assert.equal(zoomSize(true, null, last, preview), last)
  assert.equal(zoomSize(true, null, null, preview), preview)
  assert.equal(zoomSize(true, null, undefined, null), null)
})

test('a right-click on Compare’s Candidate acts on it; any other photo becomes the Select', () => {
  assert.equal(comparePaneOf('b', 'b'), 'candidate')
  assert.equal(comparePaneOf('b', 'a'), 'select')
  assert.equal(comparePaneOf(null, 'a'), 'select')
})

test('suggested rejects are never saved as a smart collection (no rule keeps them)', () => {
  const f = (p: Partial<Filter>): Filter => ({ ...DEFAULT_FILTER, ...p })
  assert.equal(savableFilter(DEFAULT_FILTER), false)
  assert.equal(savableFilter(f({ minRating: 3 })), true)
  assert.equal(savableFilter(f({ suggested: true })), false)
  assert.equal(savableFilter(f({ suggested: true, minRating: 3 })), false)
})

test('a virtual copy surveys its photo’s burst, beside its photo', () => {
  const g = { kind: 'burst' as const, keys: ['1', '2', '3'] }
  assert.deepEqual(withAsked(g, '2', '2:c1').keys, ['1', '2', '2:c1', '3'])
  assert.equal(withAsked(g, '2', '2'), g, 'the photo itself: unchanged')
  assert.equal(withAsked(null, '2', '2:c1'), null, 'alone stays alone')
  assert.deepEqual(withAsked(g, '9', '9:c').keys, ['1', '2', '3', '9:c'])
})
