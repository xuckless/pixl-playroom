import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import { applyFields, defaultRecipe, type Recipe } from '../src/shared/recipe'
import {
  LOOKS,
  LOOK_ALIASES,
  LOOK_BY_ID,
  resolveLook,
  STARTER_LOOK_IDS
} from '../src/shared/looks/catalog'
import { COLLECTIONS, COLLECTION_BY_ID } from '../src/shared/looks/collections'
import { allowedPath, BRAND_WORDS, CURVE_PATHS, rangeOf } from '../src/shared/looks/ranges'
import { fold, searchLooks } from '../src/shared/looks/search'
import { applyLook, lookFields } from '../src/shared/looks/apply'
import { look, collection, fade, grain, mono, sCurve, tone } from '../src/shared/looks/dsl'

const ctx = (isRaw: boolean): CompileContext => ({
  isRaw,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 6000,
  frameHeight: 4000,
  scale: 0.4,
  seed: 7,
  brushPaths: {},
  applyCrop: true
})

const at = (r: unknown, path: string[]): unknown =>
  path.reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], r)

const LEGACY = [
  'builtin:bw-contrast',
  'builtin:bw-soft',
  'builtin:warm-film',
  'builtin:cool-matte',
  'builtin:vivid',
  'builtin:teal-orange',
  'builtin:landscape',
  'builtin:portrait',
  'builtin:vignette'
]

test('every look has a lasting, unique id, and the original nine are still there', () => {
  const ids = LOOKS.map((l) => l.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^builtin:[a-z0-9-]+$/)
  for (const id of LEGACY) assert.ok(LOOK_BY_ID.has(id), id)
})

test('names are unique and our own: no maker, stock or film in them', () => {
  const names = LOOKS.map((l) => l.name.toLowerCase())
  assert.equal(new Set(names).size, names.length)
  for (const l of LOOKS) {
    const words = fold(l.name).split(' ')
    for (const w of BRAND_WORDS) assert.ok(!words.includes(w), `${l.name} names ${w}`)
  }
})

test('every look sets something, and only what a look may set, within the sliders', () => {
  for (const l of LOOKS) {
    assert.ok(l.fields.length > 0, `${l.name} changes nothing`)
    for (const path of l.fields) {
      const where = `${l.name}: ${path.join('.')}`
      assert.ok(allowedPath(path), `${where} is not a look's to set`)
      const v = at(l.recipe, path)
      assert.notEqual(v, undefined, `${where} is not in a recipe`)
      if (typeof v === 'number') {
        const range = rangeOf(path)
        assert.ok(range, `${where} has no known range`)
        assert.ok(v >= range[0] && v <= range[1], `${where} = ${v} is outside ${range}`)
      }
    }
  }
})

test('every curve a look draws runs left to right and never falls', () => {
  for (const l of LOOKS) {
    for (const p of CURVE_PATHS) {
      const pts = at(l.recipe, p.split('.')) as { x: number; y: number }[]
      assert.ok(pts.length >= 2 && pts.length <= 16, `${l.name} ${p}`)
      for (let i = 0; i < pts.length; i++) {
        const { x, y } = pts[i]
        assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${l.name} ${p} point ${i}`)
        if (i > 0) {
          assert.ok(x > pts[i - 1].x, `${l.name} ${p} x not increasing at ${i}`)
          assert.ok(y >= pts[i - 1].y, `${l.name} ${p} falls at ${i}`)
        }
      }
    }
  }
})

test('every look compiles on a RAW and on a rendered photo', () => {
  for (const isRaw of [false, true]) {
    for (const l of LOOKS) {
      const r = applyFields(defaultRecipe(isRaw), l.recipe, l.fields)
      const out = compile(r, ctx(isRaw))
      assert.ok(out.grade, `${l.name} (${isRaw ? 'RAW' : 'rendered'}) has no grade`)
    }
  }
})

test('every look sits in a known collection, and every collection has looks', () => {
  for (const l of LOOKS) {
    assert.ok(COLLECTION_BY_ID.has(l.meta.collection), `${l.name}: ${l.meta.collection}`)
    assert.equal(l.group, COLLECTION_BY_ID.get(l.meta.collection)!.label)
    assert.ok(l.meta.tags.length > 0, `${l.name} has no tags`)
    for (const t of l.meta.tags) assert.equal(t, t.toLowerCase(), `${l.name} tag ${t}`)
    assert.equal(l.meta.author.kind, 'pixl')
    if (l.recipe.treatment === 'bw') assert.ok(l.meta.tags.includes('bw'), `${l.name} is mono`)
    const family = COLLECTION_BY_ID.get(l.meta.collection)!.family
    if (family !== 'essentials' && family !== 'bw' && family !== 'creative')
      assert.ok(l.meta.inspiredBy, `${l.name} says what inspired it`)
  }
  const used = new Set(LOOKS.map((l) => l.meta.collection))
  // Collections fill in as the catalog grows; those with looks are all known.
  for (const c of used) assert.ok(COLLECTIONS.some((x) => x.id === c))
})

test('starters and aliases name real looks', () => {
  for (const id of STARTER_LOOK_IDS) assert.ok(LOOK_BY_ID.has(id), id)
  for (const [from, to] of Object.entries(LOOK_ALIASES)) {
    assert.ok(LOOK_BY_ID.has(to), `${from} → ${to}`)
    assert.ok(!LOOK_BY_ID.has(from), `${from} is retired`)
  }
  assert.equal(resolveLook('builtin:portrait')?.name, 'Soft portrait')
  assert.equal(resolveLook('builtin:nothing'), undefined)
})

test('a look written with the words keeps its whole grain and mix, and its fade', () => {
  const [l] = collection('essentials', [
    look(
      't',
      'T',
      { tags: ['t'] },
      sCurve(40),
      fade(0.05),
      grain(20),
      mono({ red: 30 }),
      tone({ contrast: 10 })
    )
  ])
  const keys = l.fields.map((f) => f.join('.'))
  // Size and roughness at their defaults still come with the amount.
  assert.ok(keys.includes('effects.grainSize') && keys.includes('effects.grainRoughness'))
  // Every band of the mix, the ones left at 0 too.
  assert.ok(keys.includes('bwMix.blue'))
  assert.ok(l.groups.includes('treatment') && l.groups.includes('hsl'))
  assert.equal(l.recipe.toneCurve.master[0].y, 0.05)
  assert.equal(l.recipe.toneCurve.master.at(-1)!.y, 1)
  const photo = defaultRecipe(false)
  photo.effects.grainSize = 80
  photo.bwMix.blue = -50
  const on = applyLook(photo, l, { wb: { isRaw: false, asShot: null }, lensResolved: 'keep' })
  assert.equal(on.effects.grainSize, 25)
  assert.equal(on.bwMix.blue, 0)
  assert.equal(on.basic.exposure, 0)
})

test('a look moves only its own sliders; Amount sees just those', () => {
  const photo: Recipe = defaultRecipe(true)
  photo.basic.exposure = 0.7
  photo.basic.whites = 12
  const film = LOOK_BY_ID.get('builtin:warm-film')!
  const on = applyLook(photo, film, { wb: { isRaw: true, asShot: null }, lensResolved: 'keep' })
  assert.equal(on.basic.exposure, 0.7)
  assert.equal(on.basic.whites, 12)
  assert.equal(on.effects.grainAmount, 18)
  const changed = lookFields(photo, on).map((f) => f.join('.'))
  assert.ok(changed.includes('effects.grainAmount'))
  assert.ok(!changed.some((c) => c.startsWith('basic.')))
})

test('search finds by name, source, tag and a typo, best match first', () => {
  const names = (q: string): string[] => searchLooks(LOOKS, q).map((l) => l.name)
  assert.equal(names('classic chrome')[0], 'Documentary Chrome')
  assert.equal(names('batman')[0], 'Rain City Noir')
  assert.equal(names('odyssey')[0], 'Bronze Age Epic')
  // A stock's name beats the start of a longer word in a look's name.
  assert.deepEqual(names('portra').slice(0, 3), [
    'Fine Portrait 160',
    'Warm Portrait 400',
    'Warm Portrait 800'
  ])
  assert.deepEqual(names('tri-x'), ['Gritty Press 400', 'Pushed Press 1600'])
  assert.ok(names('teal').includes('Teal & orange'))
  assert.ok(names('portriat').includes('Soft portrait'))
  assert.ok(names('sunset').includes('Golden hour'))
  assert.ok(names('bw soft').includes('Soft B&W'))
  assert.deepEqual(names('zzzz'), [])
  assert.equal(searchLooks(LOOKS, '').length, LOOKS.length)
  assert.deepEqual(
    searchLooks(LOOKS, '', { ids: ['builtin:vivid'] }).map((l) => l.id),
    ['builtin:vivid']
  )
  assert.ok(
    searchLooks(LOOKS, '', { collections: ['camera/fujifilm'] }).every(
      (l) => l.meta?.collection === 'camera/fujifilm'
    )
  )
})

test('the catalog is large and every collection is stocked', () => {
  assert.ok(LOOKS.length >= 200, `${LOOKS.length} looks`)
  for (const c of COLLECTIONS)
    assert.ok(
      LOOKS.some((l) => l.meta.collection === c.id),
      `${c.label} is empty`
    )
})
