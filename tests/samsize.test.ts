import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GUIDED_MIN_GRID, guidedKeeps } from '../src/main/select/size'

test('a kept SAM mask is guided only for an object of 128 grid pixels or more, both ways', () => {
  assert.equal(GUIDED_MIN_GRID, 128)
  // A 2560 × 1707 proxy: 128 grid pixels are 320 frame pixels.
  assert.ok(guidedKeeps({ width: 320, height: 320 }, 2560))
  assert.ok(!guidedKeeps({ width: 319, height: 900 }, 2560))
  assert.ok(!guidedKeeps({ width: 900, height: 80 }, 2560))
  // A 6000 px frame: 750 pixels.
  assert.ok(guidedKeeps({ width: 760, height: 760 }, 6000))
  assert.ok(!guidedKeeps({ width: 500, height: 760 }, 6000))
  // Nothing found: resampled.
  assert.ok(!guidedKeeps(null, 2560))
})
