import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragCrop } from '../src/shared/crop'
import type { ViewGeometry } from '../src/shared/view'

const g: ViewGeometry = {
  width: 6000,
  height: 4000,
  user: 'Normal',
  crop: null,
  straighten: 0,
  whole: true
}
const full = { x: 0, y: 0, width: 1, height: 1 }

test('a corner drag shrinks the crop from that corner', () => {
  const c = dragCrop('nw', full, { x: 0.1, y: 0.2 }, null, g)
  assert.ok(c)
  assert.ok(Math.abs(c.x - 0.1) < 1e-9 && Math.abs(c.y - 0.2) < 1e-9)
  assert.ok(Math.abs(c.width - 0.9) < 1e-9 && Math.abs(c.height - 0.8) < 1e-9)
})

test('moving the box stays inside the frame', () => {
  const c = dragCrop(
    'move',
    { x: 0.2, y: 0.2, width: 0.5, height: 0.5 },
    { x: 0.9, y: -0.9 },
    null,
    g
  )
  assert.deepEqual(c, { x: 0.5, y: 0, width: 0.5, height: 0.5 })
})

test('an aspect lock holds the pixel ratio', () => {
  const nAspect = 1 * (g.height / g.width) // 1:1 in pixels
  const c = dragCrop('se', { x: 0, y: 0, width: 0.5, height: 0.75 }, { x: -0.1, y: 0 }, nAspect, g)
  assert.ok(c)
  assert.ok(Math.abs((c.width * g.width) / (c.height * g.height) - 1) < 1e-9)
})

test('a crop that would leave a straightened picture is refused', () => {
  const tilted = { ...g, straighten: 10 }
  assert.equal(dragCrop('nw', full, { x: 0, y: 0 }, null, tilted), null)
})
