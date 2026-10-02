import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyFields, defaultRecipe } from '../src/shared/recipe'
import { LOOKS } from '../src/shared/looks/catalog'
import {
  LOOK_FILE_FORMAT,
  LookFileError,
  lookFromFile,
  lookToFile,
  type LookFile
} from '../src/shared/looks/schema'
import { LOOK_SCHEMA } from '../src/shared/looks/types'

/** A file as it would arrive from outside: JSON, not the objects that wrote it. */
const wire = (f: LookFile): unknown => JSON.parse(JSON.stringify(f))

const file = (values: Record<string, unknown>, look: Record<string, unknown> = {}): unknown => ({
  format: LOOK_FILE_FORMAT,
  schema: LOOK_SCHEMA,
  recipeVersion: 2,
  look: {
    id: 'market:0f8c2a64-1b2c-4d5e-8f90-123456789abc',
    name: 'Shared',
    version: 1,
    author: { kind: 'community', id: 'u1', name: 'Someone' },
    collection: 'creative',
    tags: ['warm'],
    values,
    ...look
  }
})

test('every catalog look survives a trip through a file', () => {
  for (const l of LOOKS) {
    const { look, dropped, clamped } = lookFromFile(wire(lookToFile(l)), { trusted: true })
    assert.deepEqual(dropped, [], l.id)
    assert.deepEqual(clamped, [], l.id)
    assert.equal(look.id, l.id)
    assert.equal(look.name, l.name)
    assert.deepEqual(look.meta, l.meta, l.id)
    assert.deepEqual(
      look.fields.map((f) => f.join('.')).sort(),
      l.fields.map((f) => f.join('.')).sort(),
      l.id
    )
    assert.deepEqual(look.groups.sort(), [...l.groups].sort(), l.id)
    // On a photo it does exactly what the look does.
    const photo = defaultRecipe(true)
    photo.basic.exposure = 0.4
    assert.deepEqual(
      applyFields(photo, look.recipe, look.fields),
      applyFields(photo, l.recipe, l.fields),
      l.id
    )
  }
})

test('a file that is not a look, or is newer, is refused', () => {
  assert.throws(() => lookFromFile(null), LookFileError)
  assert.throws(() => lookFromFile({ format: 'something-else' }), LookFileError)
  assert.throws(() => lookFromFile({ format: LOOK_FILE_FORMAT, schema: LOOK_SCHEMA + 1 }), /newer/)
  assert.throws(() => lookFromFile(file({}, { name: '  ' })), /no name/)
  assert.throws(
    () => lookFromFile({ format: LOOK_FILE_FORMAT, schema: 1, look: { name: 'x' } }),
    /damaged/
  )
})

test('what is the photo’s, unknown or malformed is dropped; numbers are clamped', () => {
  const { look, dropped, clamped } = lookFromFile(
    file({
      'basic.contrast': 250,
      'basic.exposure': 2,
      'wb.temperature': 9000,
      'geometry.crop': null,
      layers: [],
      'presence.saturation': 'loud',
      'presence.made-up': 5,
      'toneCurve.master': [
        { x: 0, y: 0 },
        { x: 0.6, y: 0.7 },
        { x: 0.5, y: 0.6 }
      ],
      'toneCurve.red': [
        { x: 0, y: 0.05 },
        { x: 1, y: 1 }
      ],
      'colorGrade.shadows': { hue: 10, saturation: 20, luminance: 0 },
      'colorGrade.shadows.hue': 200,
      treatment: 'sepia',
      'effects.grainAmount': 20
    })
  )
  assert.deepEqual(clamped, ['basic.contrast'])
  assert.equal(look.recipe.basic.contrast, 100)
  assert.deepEqual(
    dropped.sort(),
    [
      'basic.exposure',
      'colorGrade.shadows',
      'geometry.crop',
      'layers',
      'presence.made-up',
      'presence.saturation',
      'toneCurve.master',
      'treatment',
      'wb.temperature'
    ].sort()
  )
  assert.deepEqual(
    look.fields.map((f) => f.join('.')).sort(),
    ['basic.contrast', 'colorGrade.shadows.hue', 'effects.grainAmount', 'toneCurve.red'].sort()
  )
  assert.deepEqual(look.groups.sort(), ['basicTone', 'colorGrade', 'effects', 'toneCurve'].sort())
  assert.equal(look.builtin, false)
})

test('a file from outside never keeps a builtin id; a market id stays', () => {
  const ours = lookFromFile(file({ 'basic.contrast': 5 }, { id: 'builtin:vivid' }), {
    newId: () => '11111111-2222-3333-4444-555555555555'
  })
  assert.equal(ours.look.id, 'market:11111111-2222-3333-4444-555555555555')
  const market = lookFromFile(file({ 'basic.contrast': 5 }))
  assert.equal(market.look.id, 'market:0f8c2a64-1b2c-4d5e-8f90-123456789abc')
})

test('meta from a file is tidied: unknown collection, author, approximations', () => {
  const { look } = lookFromFile(
    file(
      { 'basic.contrast': 5 },
      {
        collection: 'nowhere',
        author: { kind: 'admin' },
        approximates: ['halation', 'teleport'],
        tags: ['Warm', 7, 'FILM'],
        version: 0
      }
    )
  )
  assert.equal(look.meta.collection, 'creative')
  assert.deepEqual(look.meta.author, { kind: 'user' })
  assert.deepEqual(look.meta.approximates, ['halation'])
  assert.deepEqual(look.meta.tags, ['warm', 'film'])
  assert.equal(look.meta.version, 1)
})
