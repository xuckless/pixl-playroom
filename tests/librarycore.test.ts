import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  afterRedo,
  afterUndo,
  EMPTY_STACK,
  entrySize,
  metaRedoPlan,
  metaUndoPlan,
  onlyKeys,
  pushEntry,
  RING,
  stillSet,
  withoutEntry,
  type MetaEntry,
  type MetaValues,
  type RecipeEntry
} from '../src/shared/libraryundo'
import { gridMove, keepPinned, metaTargetsFor, rangeKeys } from '../src/shared/cullnav'
import {
  batchLabel,
  batchOf,
  canRedo,
  deleteLabel,
  deletedSeqs,
  diffRecipe,
  groupTimeline,
  newestShown,
  nextRedo,
  shownLabel,
  type Step
} from '../src/shared/history'
import {
  clipboardLine,
  copiedAgo,
  COPY_GROUPS,
  groupsSummary,
  NOT_COPIED
} from '../src/shared/clipboard'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import { batchTagOf, stepRefsOf } from '../src/main/batchcommit'
import { IndexService } from '../src/main/indexer/service'
import type { XmpIo } from '../src/main/indexer/xmp'
import type { HistoryLog } from '../src/shared/ipc'

// ── the undo stack ──

const meta = (
  id: string,
  before: Record<string, MetaValues>,
  patch = { rating: 3 }
): MetaEntry => ({
  kind: 'meta',
  id,
  title: 'Rating',
  patch,
  before
})
const v = (
  rating: number,
  flag: MetaValues['flag'] = null,
  label: MetaValues['label'] = null
): MetaValues => ({
  rating,
  flag,
  label
})

test('the stack keeps the newest RING entries, and a new one ends what can be redone', () => {
  let s = EMPTY_STACK
  for (let i = 0; i < RING + 5; i++) s = pushEntry(s, meta(`m${i}`, { a: v(0) }))
  assert.equal(s.done.length, RING)
  assert.equal(s.done[0].id, 'm5')
  s = afterUndo(s, s.done[s.done.length - 1], s.done[s.done.length - 1])
  assert.equal(s.undone.length, 1)
  s = pushEntry(s, meta('new', { b: v(1) }))
  assert.deepEqual(s.undone, [])
  // An entry that changed nothing is not one.
  assert.equal(pushEntry(s, meta('empty', {})), s)
})

test('undo moves what was taken back to the redo side, and redo brings it back', () => {
  const e: RecipeEntry = {
    kind: 'recipe',
    id: 'b1',
    title: 'Paste settings',
    steps: [
      { key: 'a', seq: 4 },
      { key: 'b', seq: 7 }
    ]
  }
  let s = pushEntry(EMPTY_STACK, e)
  // Only a was still the newest: the redo side holds a alone.
  s = afterUndo(s, e, onlyKeys(e, ['a']))
  assert.deepEqual(s.done, [])
  assert.deepEqual((s.undone[0] as RecipeEntry).steps, [{ key: 'a', seq: 4 }])
  s = afterRedo(s, s.undone[0], s.undone[0])
  assert.equal(s.done.length, 1)
  assert.equal(entrySize(s.done[0]), 1)
  // Nothing taken back: nothing to redo.
  s = afterUndo(s, s.done[0], onlyKeys(s.done[0], []))
  assert.deepEqual(s, EMPTY_STACK)
  // A toast's Undo of an older entry takes it off without touching the rest.
  const two = pushEntry(pushEntry(EMPTY_STACK, meta('x', { a: v(0) })), meta('y', { a: v(3) }))
  assert.deepEqual(
    withoutEntry(two, 'x').done.map((d) => d.id),
    ['y']
  )
})

test('undoing ratings puts old values back, grouped, leaving photos changed since', () => {
  const e = meta('m', { a: v(1), b: v(1), c: v(2), d: v(0), gone: v(4) }, { rating: 3 })
  const now: Record<string, MetaValues> = { a: v(3), b: v(3), c: v(3), d: v(5) }
  const plan = metaUndoPlan(e, (k) => now[k])
  assert.deepEqual(plan.writes, [
    { patch: { rating: 1 }, keys: ['a', 'b'] },
    { patch: { rating: 2 }, keys: ['c'] }
  ])
  assert.deepEqual(plan.skipped, ['d', 'gone'])
  // A flag entry touches the flag only: a rating changed since doesn't matter.
  const f = meta('f', { a: v(1, null) }, { flag: 'reject' } as never)
  assert.ok(stillSet(v(4, 'reject'), { flag: 'reject' }))
  assert.deepEqual(metaUndoPlan(f, () => v(4, 'reject')).writes, [
    { patch: { flag: null }, keys: ['a'] }
  ])
  // Redo goes only where the undo's value still stands.
  const r = metaRedoPlan(e, (k) => ({ a: v(1), b: v(5), c: v(2) })[k])
  assert.deepEqual(r, { keys: ['a', 'c'], skipped: ['b', 'd', 'gone'] })
})

// ── moving through the grid ──

test('grid moves go by row and keep the column; pages and ends clamp', () => {
  const rows = [
    ['a', 'b', 'c', 'd'],
    ['e', 'f', 'g', 'h'],
    ['i', 'j'],
    ['k', 'l', 'm', 'n']
  ]
  assert.equal(gridMove(rows, 'b', 'down'), 'f')
  assert.equal(gridMove(rows, 'g', 'down'), 'j') // a shorter row: its last tile
  assert.equal(gridMove(rows, 'j', 'down'), 'l')
  assert.equal(gridMove(rows, 'b', 'up'), 'b')
  assert.equal(gridMove(rows, 'n', 'down'), 'n')
  assert.equal(gridMove(rows, 'c', 'home'), 'a')
  assert.equal(gridMove(rows, 'c', 'end'), 'n')
  assert.equal(gridMove(rows, 'b', 'pageDown', 2), 'j')
  assert.equal(gridMove(rows, 'm', 'pageDown', 2), 'n')
  assert.equal(gridMove(rows, 'f', 'pageUp', 5), 'b')
  assert.equal(gridMove(rows, 'c', 'pageUp', 2), 'a')
  // Nothing focused: down starts at the top, up at the bottom.
  assert.equal(gridMove(rows, null, 'down'), 'a')
  assert.equal(gridMove(rows, 'zz', 'up'), 'n')
  assert.equal(gridMove([], 'a', 'down'), null)
})

test('a range runs from the anchor, either way', () => {
  const order = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(rangeKeys(order, 'b', 'd'), ['b', 'c', 'd'])
  assert.deepEqual(rangeKeys(order, 'd', 'b'), ['b', 'c', 'd'])
  assert.deepEqual(rangeKeys(order, null, 'c'), ['c'])
  assert.deepEqual(rangeKeys(order, 'gone', 'c'), ['c'])
})

test('sticky hide keeps the pinned photo where it was', () => {
  const all = ['a', 'b', 'c', 'd'].map((key) => ({ key }))
  const passed = [all[0], all[3]]
  assert.deepEqual(
    keepPinned(all, passed, 'c').map((i) => i.key),
    ['a', 'c', 'd']
  )
  assert.equal(keepPinned(all, passed, 'a'), passed)
  assert.equal(keepPinned(all, passed, null), passed)
  assert.equal(keepPinned(all, passed, 'gone'), passed)
})

test('ratings act on the selection in the Grid only; on the shown photo elsewhere (UX-13)', () => {
  const s = { selection: ['a', 'b'], focus: 'b', open: 'c' }
  assert.deepEqual(metaTargetsFor({ ...s, view: 'library', mode: 'grid' }), ['a', 'b'])
  assert.deepEqual(metaTargetsFor({ ...s, view: 'develop', mode: 'grid' }), ['c'])
  assert.deepEqual(metaTargetsFor({ ...s, view: 'library', mode: 'loupe' }), ['b'])
  assert.deepEqual(metaTargetsFor({ ...s, selection: [], view: 'library', mode: 'grid' }), ['b'])
  assert.deepEqual(metaTargetsFor({ ...s, open: null, view: 'develop', mode: 'grid' }), ['b'])
})

// ── batch steps in History ──

test('a batch rides in the label, after the words shown', () => {
  const l = batchLabel('Paste settings', 'k3x-1')
  assert.equal(batchOf(l), 'k3x-1')
  assert.equal(shownLabel(l), 'Paste settings')
  assert.equal(batchOf('Paste settings'), null)
  // A delete of a batch's row names the steps, not the batch.
  const d = deleteLabel(l, [5])
  assert.equal(shownLabel(d), 'Delete: Paste settings')
  assert.deepEqual(deletedSeqs(d), [5])
  assert.equal(batchOf(d), null)
  // Tagging twice keeps one tag.
  assert.equal(batchOf(batchLabel(l, 'other')), 'other')
})

const T0 = Date.parse('2026-10-15T10:00:00Z')
const at = (min: number): string => new Date(T0 + min * 60_000).toISOString()

test("the timeline keeps a batch's step a row of its own", () => {
  const base = defaultRecipe(false)
  const r1 = structuredClone(base)
  r1.basic.exposure = 0.3
  const r2 = structuredClone(r1)
  r2.basic.exposure = 0.6
  const r3 = structuredClone(r2)
  r3.basic.exposure = 0.9
  const steps: Step[] = [
    { seq: 2, label: 'Exposure', at: at(1), patch: diffRecipe(base, r1), hidden: false },
    {
      seq: 3,
      label: batchLabel('Paste settings', 'b1'),
      at: at(2),
      patch: diffRecipe(r1, r2),
      hidden: false
    },
    {
      seq: 4,
      label: batchLabel('Paste settings', 'b2'),
      at: at(3),
      patch: diffRecipe(r2, r3),
      hidden: false
    }
  ]
  const log: HistoryLog = { base: { seq: 1, label: 'Opened', at: at(0), recipe: base }, steps }
  const [session] = groupTimeline(log)
  assert.deepEqual(
    session.rows.map((r) => [r.seqs, r.batch]),
    [
      [[2], undefined],
      [[3], 'b1'],
      [[4], 'b2']
    ]
  )
})

test('undo and redo pick the steps the history table does', () => {
  const s = (seq: number, hidden = false, undone = false): Step => ({
    seq,
    label: '',
    at: '',
    patch: [],
    hidden,
    ...(undone ? { undone: true as const } : {})
  })
  assert.equal(newestShown([s(2), s(3), s(4, true, true)])?.seq, 3)
  assert.equal(nextRedo([s(2), s(3, true, true), s(4, true, true)])?.seq, 3)
  // A step in effect after an undone one: nothing to redo.
  assert.equal(nextRedo([s(2, true, true), s(3)]), null)
  assert.equal(canRedo([s(2, true, true), s(3)]), false)
  assert.equal(canRedo([s(2), s(3, true, true)]), true)
  // Hidden by hand (not undone) is not redone.
  assert.equal(nextRedo([s(2), s(3, true)]), null)
})

// ── the clipboard ──

test('the clipboard names its photo, its age and its groups', () => {
  assert.ok(!COPY_GROUPS.some((g) => NOT_COPIED.includes(g)))
  assert.ok(COPY_GROUPS.includes('whiteBalance'))
  const now = T0
  assert.equal(copiedAgo(now - 20_000, now), 'just now')
  assert.equal(copiedAgo(now - 3 * 60_000, now), '3 min ago')
  assert.equal(copiedAgo(now - 130 * 60_000, now), '2 h ago')
  assert.equal(groupsSummary(['whiteBalance']), 'White balance')
  assert.equal(
    groupsSummary(['whiteBalance', 'basicTone', 'hsl', 'effects']),
    'White balance, Exposure & tone and 2 more'
  )
  assert.equal(groupsSummary([]), 'no settings')
  assert.equal(
    clipboardLine(
      {
        recipe: defaultRecipe(false),
        groups: ['whiteBalance'],
        source: { key: '1', name: 'IMG_0412.CR2' },
        at: now - 4 * 60_000
      },
      now
    ),
    'IMG_0412.CR2 · 4 min ago · White balance'
  )
})

// ── the batch writer's index half ──

test('a batch tag and its steps are checked as they cross from the renderer', () => {
  assert.deepEqual(batchTagOf({ id: 'abc-1', label: 'Paste settings' }), {
    id: 'abc-1',
    label: 'Paste settings',
    version: null
  })
  assert.deepEqual(
    batchTagOf({ id: 'a', label: 'L', version: { name: 'Before', reason: 'paste' } }).version,
    { name: 'Before', reason: 'paste' }
  )
  assert.equal(
    batchTagOf({ id: 'a', label: 'L', version: { name: 'x', reason: 'ai' } }).version,
    null
  )
  assert.throws(() => batchTagOf({ id: 'a b} [#1]', label: 'L' }))
  assert.throws(() => batchTagOf(null))
  assert.deepEqual(
    stepRefsOf([
      { key: '1', seq: 2 },
      { key: 3, seq: 1 },
      { key: '2', seq: 1.5 }
    ]),
    [{ key: '1', seq: 2 }]
  )
  assert.throws(() => stepRefsOf('no'))
})

const noXmp: XmpIo = {
  read: () => Promise.resolve(null),
  write: () => Promise.resolve(),
  end: () => Promise.resolve()
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r))
  await new Promise((r) => setTimeout(r, 50))
}

const exposed = (r: Recipe, ev: number): Recipe => {
  const out = structuredClone(r)
  out.basic.exposure = ev
  return out
}

test('a batch writes one step per photo, its base seeded quietly, and undoes through each history', async () => {
  const root = mkdtempSync(join(tmpdir(), 'playroom-batch-'))
  const folder = join(root, 'photos')
  mkdirSync(folder)
  for (const f of ['a.jpg', 'b.jpg', 'c.jpg']) writeFileSync(join(folder, f), `photo ${f}`)
  const index = new IndexService({ userData: join(root, 'ud'), emit: () => {}, xmp: noXmp })
  try {
    const keys = (await index.listFolder(folder)).filter((i) => i.copyId === null).map((i) => i.key)
    const [a, b, c] = keys
    const r = defaultRecipe(false)
    const label = batchLabel('Paste settings', 'b1')
    // Never edited: the base is where it stood, and the batch is its one step.
    const seqA = index.batchStep(a, label, r, exposed(r, 1))
    const seqB = index.batchStep(b, label, r, exposed(r, 1))
    assert.ok(seqA !== null && seqB !== null)
    assert.deepEqual(
      index.history(a).steps.map((s) => s.label),
      [label]
    )
    assert.equal(index.history(a).base?.label, 'Opened')
    assert.ok(index.projectPath(a), 'the first step makes the project')
    assert.equal(index.recipe(a).basic.exposure, 1)
    // Changing nothing writes nothing.
    assert.equal(index.batchStep(c, label, r, r), null)
    assert.equal(index.history(c).steps.length, 0)
    // b is edited since: its batch step is no longer the newest.
    index.commitEdit(
      b,
      'Contrast',
      { ...exposed(r, 1), basic: { ...exposed(r, 1).basic, contrast: 20 } },
      { ...exposed(r, 1), basic: { ...exposed(r, 1).basic, contrast: 20 } }
    )
    const undone = index.undoBatchSteps([
      { key: a, seq: seqA! },
      { key: b, seq: seqB! }
    ])
    assert.deepEqual(Object.keys(undone.recipes), [a])
    assert.deepEqual(undone.skipped, [b])
    assert.equal(index.recipe(a).basic.exposure, 0)
    assert.equal(index.recipe(b).basic.exposure, 1, 'b keeps everything')
    assert.equal(index.recipe(b).basic.contrast, 20)
    // Redo brings a's step back; b's was never taken back, so it is not redone.
    const redone = index.redoBatchSteps([
      { key: a, seq: seqA! },
      { key: b, seq: seqB! }
    ])
    assert.deepEqual(Object.keys(redone.recipes), [a])
    assert.equal(index.recipe(a).basic.exposure, 1)
    // A saved recipe that moved on without a step catches up before the next batch.
    index.saveRecipe(a, exposed(r, 2))
    const seq2 = index.batchStep(
      a,
      batchLabel('Paste settings', 'b2'),
      exposed(r, 2),
      exposed(r, 3)
    )
    const labels = index.history(a).steps.map((s) => shownLabel(s.label))
    assert.deepEqual(labels, ['Paste settings', 'Opened as saved', 'Paste settings'])
    // Undo returns to where the photo stood when the batch came, not before.
    index.undoBatchSteps([{ key: a, seq: seq2! }])
    assert.equal(index.recipe(a).basic.exposure, 2)
    // A photo that is gone is skipped, not an error.
    assert.deepEqual(index.undoBatchSteps([{ key: '999999', seq: 2 }]).skipped, ['999999'])
  } finally {
    await settle()
    index.close()
    rmSync(root, { recursive: true, force: true })
  }
})
