// Full HDR's clipping overlay: blown is the display's ceiling, not SDR white.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { halfToFloat, markClippingFloat } from '../src/renderer/src/lib/clipping'

/** A number as a half float (enough for the values here). */
function half(v: number): number {
  if (v === 0) return 0
  const e = Math.floor(Math.log2(v))
  return ((e + 15) << 10) | Math.round((v / 2 ** e - 1) * 1024)
}

test('half floats read back', () => {
  for (const v of [0, 0.25, 1, 1.5, 3.98, 4])
    assert.ok(Math.abs(halfToFloat(half(v)) - v) < 0.005, `${v}`)
  assert.equal(halfToFloat(0x8000 | half(2)), -2)
})

test('light above white is clear until the ceiling; at the ceiling it is blown', () => {
  // Four pixels: SDR white, 2.5× white, at a 4× ceiling, and black.
  const px = [1, 2.5, 4, 0]
  const f16 = new Uint16Array(px.flatMap((v) => [half(v), half(v * 0.8), half(v * 0.5), half(1)]))
  const out = new Uint8ClampedArray(f16.length)
  markClippingFloat(f16, 4, out)
  const alpha = [3, 7, 11, 15].map((i) => out[i])
  assert.deepEqual(alpha, [0, 0, 220, 220])
  // Blown is red, crushed blue.
  assert.deepEqual([...out.subarray(8, 11)], [255, 60, 90])
  assert.deepEqual([...out.subarray(12, 15)], [90, 120, 255])
})
