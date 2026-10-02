import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragValue, keyValue, snap } from '../src/renderer/src/lib/sliderDrag'

test('snap lands on the step grid from min, inside the range', () => {
  assert.equal(snap(0.123, -5, 5, 0.01), 0.12)
  assert.equal(snap(7, -5, 5, 0.01), 5)
  assert.equal(snap(5512, 2000, 25000, 10), 5510)
  assert.equal(snap(1.04, 0.5, 3, 0.1), 1)
  assert.equal(snap(0.3, 0, 1, 0), 0.3)
})

test('a drag moves by distance, the width spanning the whole range', () => {
  // 200 px across a 200 px bar is the whole −100…100 range.
  assert.equal(dragValue(0, 50, 200, -100, 100, 1), 50)
  assert.equal(dragValue(10, -50, 200, -100, 100, 1), -40)
  assert.equal(dragValue(90, 100, 200, -100, 100, 1), 100)
})

test('Alt drags a tenth as fast', () => {
  assert.equal(dragValue(0, 50, 200, -100, 100, 1, true), 5)
  assert.equal(dragValue(0, 30, 300, -5, 5, 0.01, true), 0.1)
})

test('keys step once, Shift ten steps, Alt a tenth of one', () => {
  assert.equal(keyValue(0, 1, -100, 100, 1, 'none'), 1)
  assert.equal(keyValue(0, -1, -100, 100, 1, 'coarse'), -10)
  assert.equal(keyValue(0, 1, -5, 5, 0.01, 'fine'), 0.001)
  assert.equal(keyValue(99, 1, -100, 100, 1, 'coarse'), 100)
})
