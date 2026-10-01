import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Collection } from '../src/shared/ipc'
import { keywordPresence, sharedText, textPatch } from '../src/renderer/src/lib/metadata'
import { isoDay, ruleCount, withOp } from '../src/renderer/src/lib/rules'
import {
  collectionTree,
  folderName,
  isUnder,
  sameSource,
  setsFor,
  sourceTrail
} from '../src/renderer/src/lib/sources'
import { item } from './items'

const col = (id: string, over: Partial<Collection> = {}): Collection => ({
  id,
  name: id,
  kind: 'manual',
  parent: null,
  rules: null,
  sort: 0,
  ...over
})

const list = [
  col('b'),
  col('trips', { kind: 'set' }),
  col('a', { parent: 'trips' }),
  col('best', { kind: 'smart', parent: 'trips' }),
  col('europe', { kind: 'set', parent: 'trips' }),
  col('paris', { parent: 'europe' }),
  col('orphan', { parent: 'gone' }),
  col('A2')
]

test('collectionTree nests sets, sets first, then by name; orphans go to the top', () => {
  const names = (nodes: ReturnType<typeof collectionTree>): unknown[] =>
    nodes.map((n) => (n.children.length ? [n.collection.id, names(n.children)] : n.collection.id))
  assert.deepEqual(names(collectionTree(list)), [
    ['trips', [['europe', ['paris']], 'a', 'best']],
    'A2',
    'b',
    'orphan'
  ])
})

test('setsFor leaves out the collection itself and the sets inside it', () => {
  assert.deepEqual(
    setsFor(list, 'trips').map((c) => c.id),
    []
  )
  assert.deepEqual(
    setsFor(list, 'europe').map((c) => c.id),
    ['trips']
  )
  assert.deepEqual(
    setsFor(list, undefined).map((c) => c.id),
    ['europe', 'trips']
  )
})

test('sourceTrail names the source and the sets it sits in', () => {
  assert.deepEqual(sourceTrail({ kind: 'folder', path: '/a/b/100CANON/' }, list), ['100CANON'])
  assert.deepEqual(sourceTrail({ kind: 'collection', id: 'paris' }, list), [
    'Collections',
    'trips',
    'europe',
    'paris'
  ])
  assert.deepEqual(sourceTrail({ kind: 'keyword', path: 'Places|Canada' }, list), [
    'Keywords',
    'Places',
    'Canada'
  ])
  assert.deepEqual(sourceTrail({ kind: 'duplicates', folder: null, threshold: 6 }, list), [
    'Duplicates',
    'Whole library'
  ])
  assert.equal(folderName('C:\\Photos\\Trip'), 'Trip')
})

test('sameSource compares by what the source names', () => {
  assert.ok(sameSource({ kind: 'folder', path: '/a' }, { kind: 'folder', path: '/a' }))
  assert.ok(!sameSource({ kind: 'folder', path: '/a' }, { kind: 'keyword', path: '/a' }))
  assert.ok(sameSource(null, null))
  assert.ok(!sameSource(null, { kind: 'collection', id: 'x' }))
})

test('the metadata editor sends only what changed', () => {
  const a = item({ key: '1', title: 'Lake', caption: 'One', keywords: ['A', 'B|C'] })
  const b = item({ key: '2', title: 'Lake', caption: 'Two', keywords: ['A'] })
  const title = sharedText([a, b], 'title')
  const caption = sharedText([a, b], 'caption')
  assert.deepEqual(title, { value: 'Lake', mixed: false })
  assert.deepEqual(caption, { value: '', mixed: true })
  assert.deepEqual(sharedText([a, b], 'copyright'), { value: '', mixed: false })
  assert.equal(textPatch(title, ' Lake ', 'title'), null)
  assert.deepEqual(textPatch(title, 'Pond', 'title'), { title: 'Pond' })
  assert.deepEqual(textPatch(title, '  ', 'title'), { title: null })
  assert.equal(textPatch(caption, '', 'caption'), null)
  assert.deepEqual(textPatch(caption, 'Both', 'caption'), { caption: 'Both' })
  assert.deepEqual(keywordPresence([a, b]), [
    { path: 'A', all: true },
    { path: 'B|C', all: false }
  ])
})

test('a rule given another operator keeps what it can, in the shape it needs', () => {
  const now = new Date(2026, 8, 27)
  assert.deepEqual(withOp({ field: 'iso', op: 'gte', value: 400 }, 'between', now), {
    field: 'iso',
    op: 'between',
    value: [400, 400]
  })
  assert.deepEqual(withOp({ field: 'iso', op: 'between', value: [100, 800] }, 'lte', now), {
    field: 'iso',
    op: 'lte',
    value: 100
  })
  assert.deepEqual(
    withOp({ field: 'captured', op: 'inLast', value: 30, unit: 'days' }, 'before', now),
    { field: 'captured', op: 'before', value: '2026-09-27' }
  )
  assert.deepEqual(
    withOp({ field: 'captured', op: 'after', value: '2026-01-02' }, 'between', now),
    {
      field: 'captured',
      op: 'between',
      value: ['2026-01-02', '2026-01-02']
    }
  )
  assert.deepEqual(
    withOp({ field: 'captured', op: 'before', value: '2026-01-02' }, 'inLast', now),
    {
      field: 'captured',
      op: 'inLast',
      value: 30,
      unit: 'days'
    }
  )
  assert.deepEqual(withOp({ field: 'name', op: 'contains', value: 'x' }, 'startsWith', now), {
    field: 'name',
    op: 'startsWith',
    value: 'x'
  })
  assert.equal(isoDay(new Date(2026, 0, 5)), '2026-01-05')
  assert.equal(
    ruleCount({
      match: 'all',
      rules: [
        { field: 'rating', op: 'gte', value: 3 },
        {
          match: 'any',
          rules: [
            { field: 'flag', op: 'is', value: 'pick' },
            { match: 'none', rules: [] }
          ]
        }
      ]
    }),
    2
  )
})

test('isUnder: inside at any depth, not a sibling sharing a prefix', () => {
  assert.equal(isUnder('/p/Day 2/inner', '/p'), true)
  assert.equal(isUnder('/p/Day 2', '/p/'), true)
  assert.equal(isUnder('/p', '/p'), false)
  assert.equal(isUnder('/photos', '/p'), false)
  assert.equal(isUnder('C:\\p\\a', 'C:\\p'), true)
})
