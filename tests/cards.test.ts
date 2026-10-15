import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cardBase, cardChanged, cardFields, CARDS, cardSpec, CARD_IDS } from '../src/shared/cards'
import { assignFields, defaultRecipe, neutralSettings, type Recipe } from '../src/shared/recipe'

const photo = (): Recipe => defaultRecipe(true)

test('every card is listed once, in Lightroom Classic’s order', () => {
  assert.deepEqual(
    CARDS.map((c) => c.id),
    [...CARD_IDS]
  )
  assert.equal(new Set(CARD_IDS).size, CARD_IDS.length)
})

test('a card changes only with its own fields', () => {
  const r = photo()
  r.presence.clarity = 20
  const base = cardBase(r, true, false)
  assert.equal(cardChanged(cardSpec('presence'), r, base, false), true)
  assert.equal(cardChanged(cardSpec('wb'), r, base, false), false)
  assert.equal(cardChanged(cardSpec('light'), r, base, false), false)
})

test('reset puts back a card’s fields and nothing else', () => {
  const r = photo()
  r.presence.clarity = 20
  r.presence.vibrance = 15
  r.basic.exposure = 1
  assignFields(r, cardBase(r, true, false), cardFields(cardSpec('presence'), false))
  // Presence holds Vibrance and Saturation too, as in Lightroom.
  assert.equal(r.presence.clarity, 0)
  assert.equal(r.presence.vibrance, 0)
  assert.equal(r.basic.exposure, 1)
})

test('Basic corrections, Curves, HSL, then the other colour tools, in one set', async () => {
  const { panelsFor, panelOf, cardSpec, panelTitle } = await import('../src/shared/cards')
  assert.deepEqual(panelsFor(), [
    'basic',
    'curve',
    'mixer',
    'primaries',
    'logwheels',
    'qualifier',
    'calibration',
    'detail',
    'effects',
    'optics',
    'geometry'
  ])
  assert.equal(panelOf('light'), 'basic')
  assert.equal(panelOf('wb'), 'basic')
  assert.equal(panelOf('presence'), 'basic')
  assert.equal(panelTitle('mixer'), 'HSL')
  assert.equal(panelTitle('curve'), 'Curves')
  // Curves holds the tone curve and the vs curves.
  assert.deepEqual(cardSpec('curve').fields, [['toneCurve'], ['curvesVs']])
  // In a mask: no Optics or Geometry.
  assert.ok(!panelsFor(true).includes('optics'))
  assert.equal(panelsFor(true)[0], 'basic')
})

test('Lightroom’s Colour grading is offered only where it holds edits', async () => {
  const { panelsFor } = await import('../src/shared/cards')
  const r = photo()
  const base = cardBase(r, true, false)
  const held = (c: Parameters<typeof cardChanged>[0]): boolean => cardChanged(c, r, base, false)
  assert.ok(!panelsFor(false, held).includes('grading'))
  r.colorGrade.shadows = { hue: 200, saturation: 20, luminance: 0 }
  const shown = panelsFor(false, held)
  assert.equal(shown[shown.indexOf('calibration') + 1], 'grading')
  // Add colour is the Primaries' now: it alone does not bring the old wheels back.
  const r2 = photo()
  r2.colorGrade.add = { hue: 30, saturation: 50, amount: 20 }
  const h2 = (c: Parameters<typeof cardChanged>[0]): boolean =>
    cardChanged(c, r2, cardBase(r2, true, false), false)
  assert.ok(!panelsFor(false, h2).includes('grading'))
  assert.ok(cardChanged(cardSpec('primaries'), r2, cardBase(r2, true, false), false))
})

test('in a mask, a card reads the mask’s settings against neutral', () => {
  const r = photo()
  // The photo's own exposure is no change for a mask.
  r.basic.exposure = 2
  const view = { ...r, ...neutralSettings() }
  assert.equal(cardChanged(cardSpec('light'), view, cardBase(view, true, true), true), false)
  view.basic = { ...view.basic, exposure: 0.5 }
  assert.equal(cardChanged(cardSpec('light'), view, cardBase(view, true, true), true), true)
})

test('in a mask, a card holds only what a mask carries', () => {
  // A mask has no B&W mix of its own; its Density is its own.
  assert.deepEqual(cardFields(cardSpec('mixer'), true), [['hsl'], ['pointColors'], ['density']])
  // Lens and Upright are the photo's own.
  assert.deepEqual(
    CARDS.filter((c) => !c.inMask).map((c) => c.id),
    ['optics', 'geometry']
  )
})

test('a recipe with Resolve’s Curves switched off has Curves off', async () => {
  const { normaliseRecipe } = await import('../src/shared/recipe')
  const r = { ...defaultRecipe(true), off: { rcurves: true } } as unknown as Recipe
  assert.deepEqual(normaliseRecipe(r, true).off, { curve: true })
})
