import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SMART_FIELDS,
  defaultRule,
  describeRule,
  matchRule,
  matchSmart,
  memberResolver,
  remapCollections,
  referencedCollections,
  type SmartContext,
  type SmartField,
  type SmartGroup,
  type SmartRule
} from '../src/shared/smart'
import { item } from './items'

const NOW = new Date(2026, 8, 27, 12, 0, 0)
const ctx: SmartContext = { now: NOW, members: () => undefined }

const photo = item({
  key: '1',
  name: 'IMG_0420.CR2',
  ext: 'cr2',
  isRaw: true,
  rating: 4,
  flag: 'pick',
  label: 'red',
  edited: true,
  folder: '/Volumes/Card/DCIM/100CANON',
  title: 'Lake at dusk',
  caption: 'Winnipeg Beach, late August',
  keywords: ['Places|Canada|Winnipeg', 'Nature|Water'],
  camera: {
    make: 'Canon',
    model: 'Canon EOS R5',
    lens: 'RF24-70mm F2.8 L IS USM',
    iso: 400,
    exposureTime: 1 / 250,
    fNumber: 2.8,
    focalLength: 35,
    capturedAt: new Date(2026, 8, 20, 18, 30).toISOString(),
    gps: null
  }
})
const bare = item({ key: '2', name: 'scan.png', ext: 'png' })

const is = (r: SmartRule, it = photo): boolean => matchRule(it, r, ctx)

test('numbers: is, isNot, gte, lte, between, empty', () => {
  assert.ok(is({ field: 'rating', op: 'gte', value: 4 }))
  assert.ok(!is({ field: 'rating', op: 'gte', value: 5 }))
  assert.ok(is({ field: 'rating', op: 'lte', value: 4 }))
  assert.ok(is({ field: 'rating', op: 'is', value: 4 }))
  assert.ok(is({ field: 'rating', op: 'isNot', value: 3 }))
  assert.ok(is({ field: 'rating', op: 'between', value: [5, 3] }), 'reversed bounds')
  assert.ok(is({ field: 'iso', op: 'between', value: [100, 400] }))
  assert.ok(is({ field: 'aperture', op: 'is', value: 2.8 }))
  assert.ok(is({ field: 'shutter', op: 'is', value: 0.004 }), '1/250 read back as a float')
  assert.ok(is({ field: 'focal', op: 'gte', value: 35 }))
  assert.ok(is({ field: 'iso', op: 'isNotEmpty' }))
  assert.ok(is({ field: 'iso', op: 'isEmpty' }, bare))
  assert.ok(!is({ field: 'iso', op: 'gte', value: 0 }, bare), 'nothing known matches no bound')
  assert.ok(is({ field: 'iso', op: 'isNot', value: 400 }, bare))
})

test('flag, label, edited, kind', () => {
  assert.ok(is({ field: 'flag', op: 'is', value: 'pick' }))
  assert.ok(is({ field: 'flag', op: 'is', value: 'none' }, bare))
  assert.ok(is({ field: 'flag', op: 'isNot', value: 'reject' }))
  assert.ok(is({ field: 'label', op: 'is', value: 'red' }))
  assert.ok(is({ field: 'label', op: 'isNot', value: 'red' }, bare))
  assert.ok(is({ field: 'label', op: 'isEmpty' }, bare))
  assert.ok(is({ field: 'label', op: 'isNotEmpty' }))
  assert.ok(is({ field: 'edited', op: 'is', value: true }))
  assert.ok(is({ field: 'edited', op: 'is', value: false }, bare))
  assert.ok(is({ field: 'kind', op: 'is', value: 'raw' }))
  assert.ok(is({ field: 'kind', op: 'is', value: 'nonraw' }, bare))
  assert.ok(is({ field: 'kind', op: 'isNot', value: 'raw' }, bare))
})

test('text fields are case-insensitive', () => {
  assert.ok(is({ field: 'ext', op: 'is', value: '.CR2' }))
  assert.ok(is({ field: 'ext', op: 'isNot', value: 'jpg' }))
  assert.ok(is({ field: 'name', op: 'startsWith', value: 'img_' }))
  assert.ok(is({ field: 'name', op: 'contains', value: '0420' }))
  assert.ok(is({ field: 'name', op: 'notContains', value: 'dsc' }))
  assert.ok(is({ field: 'name', op: 'is', value: 'img_0420.cr2' }))
  assert.ok(is({ field: 'folder', op: 'contains', value: '100canon' }))
  assert.ok(is({ field: 'title', op: 'contains', value: 'DUSK' }))
  assert.ok(is({ field: 'title', op: 'isEmpty' }, bare))
  assert.ok(is({ field: 'caption', op: 'isNotEmpty' }))
  assert.ok(is({ field: 'caption', op: 'notContains', value: 'june' }))
  assert.ok(is({ field: 'caption', op: 'notContains', value: 'june' }, bare))
  assert.ok(is({ field: 'camera', op: 'contains', value: 'eos r5' }))
  assert.ok(is({ field: 'camera', op: 'is', value: 'canon eos r5' }))
  assert.ok(is({ field: 'camera', op: 'isEmpty' }, bare))
  assert.ok(is({ field: 'lens', op: 'startsWith', value: 'rf24' }))
  assert.ok(is({ field: 'lens', op: 'isNot', value: 'EF50mm' }))
})

test('text searches name, title, caption, keywords, camera and lens', () => {
  for (const v of ['0420', 'dusk', 'beach', 'winnipeg', 'water', 'canon', 'rf24']) {
    assert.ok(is({ field: 'text', op: 'contains', value: v }), v)
  }
  assert.ok(is({ field: 'text', op: 'notContains', value: 'nikon' }))
  const copy = item({ key: '1:c', copyName: 'Black and white' })
  assert.ok(is({ field: 'text', op: 'contains', value: 'black' }, copy))
})

test('keywords: is means the keyword or one under it', () => {
  assert.ok(is({ field: 'keyword', op: 'is', value: 'places|canada' }))
  assert.ok(is({ field: 'keyword', op: 'is', value: 'Places|Canada|Winnipeg' }))
  assert.ok(!is({ field: 'keyword', op: 'is', value: 'Places|Can' }), 'not a prefix of a level')
  assert.ok(is({ field: 'keyword', op: 'isNot', value: 'People' }))
  assert.ok(is({ field: 'keyword', op: 'contains', value: 'nada' }))
  assert.ok(is({ field: 'keyword', op: 'startsWith', value: 'wat' }))
  assert.ok(is({ field: 'keyword', op: 'notContains', value: 'people' }))
  assert.ok(is({ field: 'keyword', op: 'isEmpty' }, bare))
  assert.ok(is({ field: 'keyword', op: 'isNotEmpty' }))
})

test('capture dates: before, after, between (days, local), in the last', () => {
  assert.ok(is({ field: 'captured', op: 'before', value: '2026-09-21' }))
  assert.ok(
    !is({ field: 'captured', op: 'before', value: '2026-09-20' }),
    'that day is not before it'
  )
  assert.ok(is({ field: 'captured', op: 'after', value: '2026-09-19' }))
  assert.ok(!is({ field: 'captured', op: 'after', value: '2026-09-20' }), 'nor after it')
  assert.ok(is({ field: 'captured', op: 'between', value: ['2026-09-20', '2026-09-20'] }))
  assert.ok(is({ field: 'captured', op: 'between', value: ['2026-09-25', '2026-09-01'] }))
  assert.ok(!is({ field: 'captured', op: 'between', value: ['2026-09-21', '2026-09-25'] }))
  assert.ok(is({ field: 'captured', op: 'inLast', value: 7, unit: 'days' }))
  assert.ok(!is({ field: 'captured', op: 'inLast', value: 6, unit: 'days' }))
  assert.ok(is({ field: 'captured', op: 'inLast', value: 1, unit: 'weeks' }))
  assert.ok(is({ field: 'captured', op: 'inLast', value: 1, unit: 'months' }))
  assert.ok(is({ field: 'captured', op: 'inLast', value: 1, unit: 'years' }))
  assert.ok(is({ field: 'captured', op: 'isNotEmpty' }))
  assert.ok(is({ field: 'captured', op: 'isEmpty' }, bare))
  assert.ok(!is({ field: 'captured', op: 'inLast', value: 100, unit: 'years' }, bare))
})

test('groups: all, any, none, nested, and empty', () => {
  const g = (match: SmartGroup['match'], ...rules: (SmartRule | SmartGroup)[]): SmartGroup => ({
    match,
    rules
  })
  const yes: SmartRule = { field: 'rating', op: 'gte', value: 1 }
  const no: SmartRule = { field: 'rating', op: 'gte', value: 5 }
  assert.ok(matchSmart(photo, g('all', yes, yes), ctx))
  assert.ok(!matchSmart(photo, g('all', yes, no), ctx))
  assert.ok(matchSmart(photo, g('any', no, yes), ctx))
  assert.ok(!matchSmart(photo, g('any', no, no), ctx))
  assert.ok(matchSmart(photo, g('none', no, no), ctx))
  assert.ok(!matchSmart(photo, g('none', no, yes), ctx))
  assert.ok(matchSmart(photo, g('all'), ctx), 'no rules: everything')
  // RAW and (picked or red) and not (ISO above 1600 or unedited)
  const nested = g(
    'all',
    { field: 'kind', op: 'is', value: 'raw' },
    g(
      'any',
      { field: 'flag', op: 'is', value: 'pick' },
      { field: 'label', op: 'is', value: 'red' }
    ),
    g('none', { field: 'iso', op: 'gte', value: 1600 }, { field: 'edited', op: 'is', value: false })
  )
  assert.ok(matchSmart(photo, nested, ctx))
  assert.ok(!matchSmart({ ...photo, edited: false }, nested, ctx))
  assert.ok(!matchSmart(bare, nested, ctx))
})

test('collection rules resolve members, and a cycle counts as empty', () => {
  const items = [photo, bare, item({ key: '3', rating: 5 })]
  const cols = [
    { id: 'm', kind: 'manual' as const, parent: null, rules: null },
    // Smart: in m, or rated 5.
    {
      id: 's',
      kind: 'smart' as const,
      parent: 'set',
      rules: {
        match: 'any' as const,
        rules: [
          { field: 'collection' as const, op: 'is' as const, value: 'm' },
          { field: 'rating' as const, op: 'is' as const, value: 5 }
        ]
      }
    },
    { id: 'set', kind: 'set' as const, parent: null, rules: null },
    { id: 'm2', kind: 'manual' as const, parent: 'set', rules: null },
    // a and b name each other.
    {
      id: 'a',
      kind: 'smart' as const,
      parent: null,
      rules: {
        match: 'all' as const,
        rules: [{ field: 'collection' as const, op: 'is' as const, value: 'b' }]
      }
    },
    {
      id: 'b',
      kind: 'smart' as const,
      parent: null,
      rules: {
        match: 'any' as const,
        rules: [
          { field: 'collection' as const, op: 'is' as const, value: 'a' },
          { field: 'rating' as const, op: 'gte' as const, value: 4 }
        ]
      }
    }
  ]
  const members = memberResolver({
    collections: cols,
    items,
    manual: (id) => new Set(id === 'm' ? ['2'] : id === 'm2' ? ['1'] : []),
    now: NOW
  })
  assert.deepEqual([...(members('s') ?? [])].sort(), ['2', '3'])
  assert.deepEqual([...(members('set') ?? [])].sort(), ['1', '2', '3'], 'a set is its children')
  assert.equal(members('nope'), undefined)
  // The cycle ends: b's own rating rule still counts.
  assert.deepEqual([...(members('a') ?? [])].sort(), ['1', '3'])
  const c: SmartContext = { now: NOW, members }
  assert.ok(matchRule(bare, { field: 'collection', op: 'is', value: 'm' }, c))
  assert.ok(matchRule(photo, { field: 'collection', op: 'isNot', value: 'm' }, c))
  assert.ok(!matchRule(photo, { field: 'collection', op: 'is', value: 'nope' }, c))
})

test('field metadata: every field has operators, defaults and words', () => {
  for (const field of Object.keys(SMART_FIELDS) as SmartField[]) {
    const info = SMART_FIELDS[field]
    assert.ok(info.ops.length > 0, field)
    const r = defaultRule(field)
    assert.ok(info.ops.includes(r.op), `${field} default op`)
    assert.equal(typeof describeRule(r), 'string')
    // A default rule never throws.
    matchRule(photo, r, ctx)
  }
  assert.equal(describeRule({ field: 'rating', op: 'gte', value: 3 }), 'Rating is at least 3')
  assert.equal(describeRule({ field: 'flag', op: 'is', value: 'pick' }), 'Flag is Picked')
  assert.equal(
    describeRule({ field: 'collection', op: 'is', value: 'x' }, () => 'Trip'),
    'Collection is Trip'
  )
})

test('collection references can be listed and renamed', () => {
  const g: SmartGroup = {
    match: 'all',
    rules: [
      { field: 'collection', op: 'is', value: 'a' },
      { match: 'any', rules: [{ field: 'collection', op: 'isNot', value: 'b' }] }
    ]
  }
  assert.deepEqual(referencedCollections(g), ['a', 'b'])
  assert.deepEqual(referencedCollections(remapCollections(g, (id) => id + '2')), ['a2', 'b2'])
})
