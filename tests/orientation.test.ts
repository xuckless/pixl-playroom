import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compose,
  fromExif,
  inverse,
  orientPlane,
  sourceOf,
  swapsAxes,
  toExif,
  transformPoint,
  userOrientation
} from '../src/shared/orientation'
import type { Orientation } from '../src/shared/engine-types'

const ALL: Orientation[] = [1, 2, 3, 4, 5, 6, 7, 8].map(fromExif)

test('EXIF values round-trip', () => {
  for (const o of ALL) assert.equal(fromExif(toExif(o)), o)
})

test('transformPoint agrees with the engine pixel mapping', () => {
  const w = 5
  const h = 3
  for (const o of ALL) {
    const [ow, oh] = swapsAxes(o) ? [h, w] : [w, h]
    for (let dy = 0; dy < oh; dy++) {
      for (let dx = 0; dx < ow; dx++) {
        const [sx, sy] = sourceOf(o, dx, dy, w, h)
        const p = transformPoint(o, { x: (sx + 0.5) / w, y: (sy + 0.5) / h })
        assert.ok(
          Math.abs(p.x - (dx + 0.5) / ow) < 1e-9 && Math.abs(p.y - (dy + 0.5) / oh) < 1e-9,
          o
        )
      }
    }
  }
})

test('composition is the group law and inverses cancel', () => {
  for (const a of ALL) {
    assert.equal(compose(a, inverse(a)), 'Normal')
    for (const b of ALL) {
      const p = { x: 0.2, y: 0.7 }
      const q1 = transformPoint(b, transformPoint(a, p))
      const q2 = transformPoint(compose(a, b), p)
      assert.ok(Math.abs(q1.x - q2.x) < 1e-12 && Math.abs(q1.y - q2.y) < 1e-12)
    }
  }
})

test('four quarter turns are the identity; a turn then a flip is a transverse', () => {
  assert.equal(userOrientation(4, false), 'Normal')
  assert.equal(userOrientation(1, false), 'Rotate90')
  assert.equal(compose('Rotate90', 'FlipHorizontal'), userOrientation(1, true))
})

test('orientPlane turns a painted plane like the engine turns pixels', () => {
  const data = new Uint8Array([0, 1, 2, 3, 4, 5])
  assert.deepEqual([...orientPlane('Rotate90', data, 3, 2).data], [3, 0, 4, 1, 5, 2])
})
