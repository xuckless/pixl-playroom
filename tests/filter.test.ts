import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyFilter,
  clearedFilters,
  DEFAULT_FILTER,
  extraFilterCount,
  filterRules
} from '../src/shared/filter'
import type { LibraryItem } from '../src/shared/ipc'
import { item } from './items'

const NOW = new Date(2026, 8, 27, 12, 0, 0)

const camera = (over: Partial<LibraryItem['camera']>): LibraryItem['camera'] => ({
  make: null,
  model: null,
  lens: null,
  iso: null,
  exposureTime: null,
  fNumber: null,
  focalLength: null,
  capturedAt: null,
  gps: null,
  ...over
})

const items = [
  item({
    key: '1',
    name: 'IMG_0001.CR2',
    isRaw: true,
    rating: 4,
    flag: 'pick',
    title: 'Lake at dusk',
    keywords: ['Places|Canada|Winnipeg'],
    camera: camera({
      make: 'Canon',
      model: 'Canon EOS R5',
      lens: 'RF24-70mm',
      iso: 400,
      focalLength: 35,
      capturedAt: new Date(2026, 7, 20, 18, 0).toISOString()
    })
  }),
  item({
    key: '2',
    name: 'IMG_0002.jpg',
    rating: 1,
    flag: 'reject',
    caption: 'Blurry dog',
    camera: camera({
      make: 'FUJIFILM',
      model: 'X-T5',
      lens: 'XF23mm',
      iso: 3200,
      focalLength: 23,
      capturedAt: new Date(2026, 7, 21, 9, 0).toISOString()
    })
  }),
  item({ key: '3', name: 'scan.tif', label: 'red', edited: true })
]

const keys = (list: LibraryItem[]): string[] => list.map((i) => i.key)
const run = (f: Partial<typeof DEFAULT_FILTER>): string[] =>
  keys(applyFilter(items, { ...DEFAULT_FILTER, ...f }, NOW))

test('the default filter hides rejects and nothing else', () => {
  assert.deepEqual(run({}), ['1', '3'])
  assert.deepEqual(run({ flag: 'all' }), ['1', '2', '3'])
  assert.deepEqual(filterRules({ ...DEFAULT_FILTER, flag: 'all' }).rules, [])
})

test('flags, labels, ratings and edits', () => {
  assert.deepEqual(run({ flag: 'pick' }), ['1'])
  assert.deepEqual(run({ flag: 'reject' }), ['2'])
  assert.deepEqual(run({ flag: 'unflagged' }), ['3'])
  assert.deepEqual(run({ flag: 'all', minRating: 2 }), ['1'])
  assert.deepEqual(run({ label: 'red' }), ['3'])
  assert.deepEqual(run({ edited: 'edited' }), ['3'])
  assert.deepEqual(run({ edited: 'unedited', flag: 'all' }), ['1', '2'])
})

test('text search covers titles, captions, keywords and the camera; every word must match', () => {
  assert.deepEqual(run({ text: 'dusk' }), ['1'])
  assert.deepEqual(run({ text: 'winnipeg' }), ['1'])
  assert.deepEqual(run({ text: 'dog', flag: 'all' }), ['2'])
  assert.deepEqual(run({ text: 'canon r5' }), ['1'])
  assert.deepEqual(run({ text: 'canon fuji', flag: 'all' }), [])
  assert.deepEqual(run({ text: '  xf23 ', flag: 'all' }), ['2'])
})

test('camera, lens, kind, ranges, dates and keyword', () => {
  assert.deepEqual(run({ camera: 'Canon EOS R5' }), ['1'])
  assert.deepEqual(run({ flag: 'all', lens: 'XF23mm' }), ['2'])
  assert.deepEqual(run({ flag: 'all', kind: 'raw' }), ['1'])
  assert.deepEqual(run({ flag: 'all', kind: 'nonraw' }), ['2', '3'])
  assert.deepEqual(run({ flag: 'all', iso: [100, 800] }), ['1'])
  assert.deepEqual(run({ flag: 'all', focal: [20, 30] }), ['2'])
  assert.deepEqual(run({ flag: 'all', from: '2026-08-21' }), ['2'])
  assert.deepEqual(run({ flag: 'all', to: '2026-08-20' }), ['1'])
  assert.deepEqual(run({ flag: 'all', from: '2026-08-20', to: '2026-08-21' }), ['1', '2'])
  assert.deepEqual(run({ keyword: 'Places|Canada' }), ['1'])
  assert.deepEqual(run({ keyword: 'Places|Can' }), [])
})

test('extraFilterCount counts the popover’s filters, not the search text', () => {
  assert.equal(extraFilterCount(DEFAULT_FILTER), 0)
  assert.equal(extraFilterCount({ ...DEFAULT_FILTER, text: 'x' }), 0)
  assert.equal(
    extraFilterCount({
      ...DEFAULT_FILTER,
      minRating: 3,
      flag: 'all',
      label: 'red',
      edited: 'edited'
    }),
    4
  )
  assert.equal(
    extraFilterCount({ ...DEFAULT_FILTER, kind: 'raw', iso: [1, 2], to: '2026-01-01' }),
    3
  )
})

test('clearedFilters resets everything but the search text', () => {
  const f = {
    ...DEFAULT_FILTER,
    text: 'lake',
    minRating: 4,
    flag: 'pick' as const,
    camera: 'Canon'
  }
  const cleared = { ...f, ...clearedFilters() }
  assert.equal(cleared.text, 'lake')
  assert.equal(extraFilterCount(cleared), 0)
})
