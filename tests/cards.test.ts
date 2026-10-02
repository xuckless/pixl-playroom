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
  // Vibrance and Clarity share `presence`, but not a card.
  assert.equal(cardChanged(cardSpec('colour'), r, base, false), false)
  assert.equal(cardChanged(cardSpec('light'), r, base, false), false)
})

test('reset puts back a card’s fields and nothing else', () => {
  const r = photo()
  r.presence.clarity = 20
  r.presence.vibrance = 15
  r.basic.exposure = 1
  assignFields(r, cardBase(r, true, false), cardFields(cardSpec('presence'), false))
  assert.equal(r.presence.clarity, 0)
  assert.equal(r.presence.vibrance, 15)
  assert.equal(r.basic.exposure, 1)
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
  // A mask has no B&W mix of its own.
  assert.deepEqual(cardFields(cardSpec('mixer'), true), [['hsl'], ['pointColors']])
  assert.ok(CARDS.filter((c) => !c.inMask).every((c) => c.id === 'optics' || c.id === 'geometry'))
})
