import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrateUi } from '../src/renderer/src/state/uiMigrate'

test('the old colour overlay default becomes Molten glass', () => {
  const p = migrateUi({ maskOverlay: { mode: 'color', opacity: 50 } }, 1)
  assert.deepEqual(p.maskOverlay, { mode: 'glass', opacity: 50 })
})

test('the wheel’s last tool becomes the open, focused card', () => {
  const p = migrateUi({ panel: 'hsl', previousPanel: 'basic', rail: 'history' }, 2)
  assert.equal(p.focusCard, 'mixer')
  assert.equal((p.cardsOpen as Record<string, boolean>).mixer, true)
  assert.equal(p.panel, undefined)
  assert.equal(p.previousPanel, undefined)
  assert.equal(p.rail, 'history')
})

test('a tool that is not a card (Crop, Heal, Enhance) leaves the cards be', () => {
  const p = migrateUi({ panel: 'crop' }, 2)
  assert.equal(p.focusCard, undefined)
  assert.equal(p.cardsOpen, undefined)
  assert.equal(p.panel, undefined)
})

test('a current layout passes through', () => {
  const saved = { focusCard: 'detail', cardsOpen: { detail: true } }
  assert.deepEqual(migrateUi(saved, 4), saved)
})

test('AI denoise left at the old default (SCUNet) moves to DRUNet, once', () => {
  // From before the cards, and from a layout saved with them (version 3).
  for (const v of [2, 3]) {
    const p = migrateUi({ denoise: { model: 'scunet-color-real', strength: 70 } }, v)
    assert.deepEqual(p.denoise, { model: 'drunet-color', strength: 70 })
  }
  // Chosen again afterwards, it stays.
  const kept = migrateUi({ denoise: { model: 'scunet-color-real', strength: 70 } }, 4)
  assert.deepEqual(kept.denoise, { model: 'scunet-color-real', strength: 70 })
})
