import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_MASK_EDGE,
  componentControls,
  hasControls,
  hiddenAdjusted,
  resetHidden
} from '../src/shared/maskcontrols'
import type { MaskComponentSetting } from '../src/shared/recipe'

const base = { id: 'c', mode: 'Add' as const, opacity: 100, invert: false, feather: 0 }
const brush: MaskComponentSetting = { ...base, kind: 'brush', width: 4, height: 4, png: '' }
const lasso: MaskComponentSetting = {
  ...base,
  kind: 'polygon',
  feather: 3,
  edge: { shift: 0, harden: 0, inside: true },
  points: []
}
const radial: MaskComponentSetting = {
  ...base,
  kind: 'radial',
  centre: { x: 0.5, y: 0.5 },
  radiusX: 0.2,
  radiusY: 0.2,
  angle: 0,
  softness: 50,
  width: 512,
  height: 512
}
const range: MaskComponentSetting = {
  ...base,
  kind: 'range',
  feather: 5,
  hue: null,
  saturation: null,
  luma: { centre: 0.5, width: 0.4, softness: 0.15 },
  smoothness: 0
}

test('each kind shows only what it needs', () => {
  assert.deepEqual(componentControls(lasso), {
    feather: true,
    shift: true,
    softness: false,
    range: false
  })
  assert.equal(componentControls(radial).softness, true)
  assert.equal(componentControls(range).range, true)
  assert.equal(hasControls(brush), false)
  assert.equal(hasControls({ ...brush, edge: { ...AI_MASK_EDGE } }), false)
})

test("new components and an AI mask's default edge are not flagged", () => {
  for (const c of [brush, lasso, radial, range]) assert.equal(hiddenAdjusted(c), false, c.kind)
  assert.equal(hiddenAdjusted({ ...brush, edge: { ...AI_MASK_EDGE } }), false)
  assert.equal(hiddenAdjusted({ ...lasso, edge: { shift: 40, harden: 0, inside: true } }), false)
})

test("an older recipe's hidden settings are flagged", () => {
  assert.equal(hiddenAdjusted({ ...brush, feather: 10 }), true)
  assert.equal(hiddenAdjusted({ ...radial, opacity: 60 }), true)
  assert.equal(hiddenAdjusted({ ...radial, edge: { shift: 0, harden: 20 } }), true)
  assert.equal(hiddenAdjusted({ ...range, feather: 12 }), true)
  assert.equal(hiddenAdjusted({ ...lasso, edge: undefined }), true)
  assert.equal(hiddenAdjusted({ ...brush, edge: { shift: -30, harden: 35 } }), true)
})

test('reset puts hidden settings back and keeps what shows', () => {
  const r = resetHidden({ ...radial, opacity: 60, feather: 8, edge: { shift: 5, harden: 20 } })
  assert.equal(r.opacity, 100)
  assert.equal(r.feather, 0)
  assert.equal(r.edge, undefined)
  assert.equal(r.kind === 'radial' && r.softness, 50)
  const l = resetHidden({ ...lasso, feather: 9, edge: { shift: 30, harden: 0 } })
  assert.equal(l.feather, 9)
  assert.deepEqual(l.edge, { shift: 30, harden: 0, inside: true })
  const ai = resetHidden({ ...brush, feather: 4, edge: { shift: -40, harden: 60 } })
  assert.deepEqual(ai.edge, AI_MASK_EDGE)
  assert.equal(resetHidden({ ...range, feather: 12 }).feather, 5)
  for (const c of [r, l, ai]) assert.equal(hiddenAdjusted(c), false)
})
