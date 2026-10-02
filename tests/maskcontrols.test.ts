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
import {
  AI_EDGE_RADIUS,
  defaultEdgeRadius,
  DRAWN_EDGE_RADIUS,
  modelRefine,
  PROMPT_EDGE_RADIUS
} from '../src/shared/refine'

const base = { id: 'c', mode: 'Add' as const, opacity: 100, invert: false, feather: 0 }
const brush: MaskComponentSetting = { ...base, kind: 'brush', width: 4, height: 4, png: '' }
/** A model's mask as made since engine 0.16: it says where it came from, and snaps. */
const ai: MaskComponentSetting = {
  ...base,
  kind: 'brush',
  width: 4,
  height: 4,
  png: '',
  source: { kind: 'segment', target: 'subject' },
  refine: { on: true, radius: 0.4 }
}
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
    range: false,
    snap: true
  })
  assert.equal(componentControls(radial).softness, true)
  assert.equal(componentControls(radial).snap, false)
  assert.equal(componentControls(range).range, true)
  assert.equal(componentControls(range).snap, false)
  // A painted brush: Snap to edges, and its Shift edge only while it snaps.
  assert.deepEqual(componentControls(brush), {
    feather: false,
    shift: false,
    softness: false,
    range: false,
    snap: true
  })
  assert.equal(componentControls({ ...brush, refine: { on: true, radius: 0.6 } }).shift, true)
  // A model's mask, old or new: Snap and Shift edge.
  assert.equal(componentControls({ ...brush, edge: { ...AI_MASK_EDGE } }).shift, true)
  assert.equal(componentControls(ai).shift, true)
  assert.equal(hasControls(brush), true)
})

test("new components and an AI mask's default edge are not flagged", () => {
  for (const c of [brush, lasso, radial, range, ai]) assert.equal(hiddenAdjusted(c), false, c.kind)
  // One made before Snap to edges keeps its harden; its Shift edge shows.
  assert.equal(hiddenAdjusted({ ...brush, edge: { ...AI_MASK_EDGE } }), false)
  assert.equal(hiddenAdjusted({ ...brush, edge: { shift: -30, harden: 35 } }), false)
  assert.equal(hiddenAdjusted({ ...ai, edge: { shift: 20, harden: 0 } }), false)
  assert.equal(hiddenAdjusted({ ...lasso, edge: { shift: 40, harden: 0, inside: true } }), false)
})

test("an older recipe's hidden settings are flagged", () => {
  assert.equal(hiddenAdjusted({ ...brush, feather: 10 }), true)
  assert.equal(hiddenAdjusted({ ...radial, opacity: 60 }), true)
  assert.equal(hiddenAdjusted({ ...radial, edge: { shift: 0, harden: 20 } }), true)
  assert.equal(hiddenAdjusted({ ...range, feather: 12 }), true)
  assert.equal(hiddenAdjusted({ ...lasso, edge: undefined }), true)
  assert.equal(hiddenAdjusted({ ...brush, edge: { shift: -30, harden: 60 } }), true)
  // Snapped, a harden is the old way of firming the edge up: flagged.
  assert.equal(hiddenAdjusted({ ...ai, edge: { shift: 0, harden: 35 } }), true)
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
  // An older AI mask: its harden back to the default, its Shift edge as it is.
  const old = resetHidden({ ...brush, feather: 4, edge: { shift: -40, harden: 60 } })
  assert.deepEqual(old.edge, { shift: -40, harden: AI_MASK_EDGE.harden })
  const snapped = resetHidden({ ...ai, edge: { shift: 10, harden: 35 } })
  assert.deepEqual(snapped.edge, { shift: 10, harden: 0 })
  assert.equal(resetHidden({ ...range, feather: 12 }).feather, 5)
  for (const c of [r, l, old, snapped]) assert.equal(hiddenAdjusted(c), false)
})

test("SAM's masks snap lighter than a saliency map's, and the radius slider starts there", () => {
  const sam: MaskComponentSetting = {
    ...ai,
    source: { kind: 'prompt', via: 'click' },
    refine: modelRefine({ kind: 'prompt', via: 'click' })
  }
  assert.deepEqual(modelRefine({ kind: 'prompt' }), { on: true, radius: PROMPT_EDGE_RADIUS })
  assert.deepEqual(modelRefine({ kind: 'segment', target: 'subject' }), {
    on: true,
    radius: AI_EDGE_RADIUS
  })
  assert.ok(PROMPT_EDGE_RADIUS < AI_EDGE_RADIUS)
  assert.equal(defaultEdgeRadius(sam), PROMPT_EDGE_RADIUS)
  assert.equal(defaultEdgeRadius(ai), AI_EDGE_RADIUS)
  // An older recipe's model mask (no source, a harden) is a model's too.
  assert.equal(defaultEdgeRadius({ ...brush, edge: { shift: 0, harden: 40 } }), AI_EDGE_RADIUS)
  assert.equal(defaultEdgeRadius(brush), DRAWN_EDGE_RADIUS)
  assert.equal(defaultEdgeRadius(lasso), DRAWN_EDGE_RADIUS)
  // Each call its own object: a component's refine is edited in place.
  assert.notEqual(modelRefine({ kind: 'prompt' }), modelRefine({ kind: 'prompt' }))
})
