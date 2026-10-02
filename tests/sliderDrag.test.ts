import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dragValue,
  dragValueLog,
  keyValue,
  keyValueLog,
  logFraction,
  logValue,
  snap
} from '../src/renderer/src/lib/sliderDrag'

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

test('a log slider gives the small end as much of the bar as the large', () => {
  // 0.2…25: 0.2→2.24 and 2.24→25 each take half the bar.
  assert.equal(logFraction(0.2, 0.2, 25), 0)
  assert.equal(logFraction(25, 0.2, 25), 1)
  assert.ok(Math.abs(logFraction(Math.sqrt(0.2 * 25), 0.2, 25) - 0.5) < 1e-9)
  assert.ok(Math.abs(logValue(0.5, 0.2, 25) - Math.sqrt(5)) < 1e-9)
})

test('a log drag moves along the bar, so small sizes move in small steps', () => {
  // A tenth of the bar from the bottom, against a tenth from the middle.
  const low = dragValueLog(0.2, 20, 200, 0.2, 25, 0.01) - 0.2
  const mid = dragValueLog(2.24, 20, 200, 0.2, 25, 0.01) - 2.24
  assert.ok(low > 0 && low < 0.15)
  assert.ok(mid > 0.8)
  assert.equal(dragValueLog(10, 1000, 200, 0.2, 25, 0.01), 25)
})

test('log keys step a hundredth of the bar and never stick', () => {
  const up = keyValueLog(0.2, 1, 0.2, 25, 0.01, 'none')
  assert.ok(up > 0.2)
  assert.equal(keyValueLog(25, 1, 0.2, 25, 0.01, 'none'), 25)
  assert.ok(keyValueLog(5, -1, 0.2, 25, 0.01, 'coarse') < 5 * 0.7)
})
