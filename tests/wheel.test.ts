import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  WHEEL,
  cyclicOffset,
  dragPlaces,
  wheelItem,
  wheelStep,
  wrapIndex
} from '../src/renderer/src/lib/wheel'

test('the name at the pointer sits centred, upright and clear', () => {
  const p = wheelItem(0)
  assert.equal(p.y, 0)
  assert.equal(Math.abs(p.rx), 0)
  assert.equal(p.opacity, 1)
  assert.equal(p.blur, 0)
  assert.equal(p.hidden, false)
})

test('names roll away symmetrically, fading and frosting, within the small drum', () => {
  const up = wheelItem(-1)
  const down = wheelItem(1)
  assert.ok(Math.abs(up.y + down.y) < 1e-9)
  assert.ok(down.y > 0 && down.y < WHEEL.radius)
  assert.ok(down.opacity < 1 && down.blur > 0)
  assert.ok(wheelItem(2).opacity < down.opacity)
  assert.ok(Math.abs(wheelItem(3).y) <= WHEEL.radius + 1e-9)
  assert.equal(wheelItem(3.5).hidden, true)
})

test('the drum wraps: the last tool sits just above the first', () => {
  assert.equal(cyclicOffset(9, 0, 10), -1)
  assert.equal(cyclicOffset(1, 0, 10), 1)
  assert.equal(cyclicOffset(0, 9, 10), 1)
  assert.equal(cyclicOffset(4, 4.4, 10).toFixed(2), '-0.40')
  assert.equal(wrapIndex(-1, 10), 9)
  assert.equal(wrapIndex(10, 10), 0)
  assert.equal(wrapIndex(3.6, 10), 4)
})

test('wheel deltas accumulate into single steps', () => {
  let s = wheelStep(0, 20)
  assert.deepEqual(s, { acc: 20, step: 0 })
  s = wheelStep(s.acc, 20)
  assert.deepEqual(s, { acc: 0, step: 1 })
  assert.deepEqual(wheelStep(0, -100), { acc: 0, step: -1 })
})

test('dragging up turns the drum forward', () => {
  assert.equal(dragPlaces(-WHEEL.dragPx * 2), 2)
  assert.equal(dragPlaces(WHEEL.dragPx), -1)
})
