import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sdrCompanion } from '../src/shared/sdrcompanion'

/** RGBA half floats for `values` (one per pixel, grey, opaque). */
function frame(values: number[]): Uint8Array {
  const half = (v: number): number => {
    if (v === 0) return 0
    if (v === 1) return 0x3c00
    if (v === 0.5) return 0x3800
    if (v === 0.25) return 0x3400
    throw new Error(`no half for ${v}`)
  }
  const out = new Uint16Array(values.length * 4)
  values.forEach((v, i) => out.set([half(v), half(v), half(v), 0x3c00], i * 4))
  return new Uint8Array(out.buffer)
}

test('an SDR frame’s companion is its pixels sRGB-encoded, alpha kept', () => {
  const c = sdrCompanion(frame([0, 0.5, 1, 0.25]), 2, 2, 1024)
  assert.deepEqual([c.width, c.height], [2, 2])
  // 0 → 0, linear 0.5 → 188, 1 → 255, 0.25 → 137 (the sRGB curve).
  assert.deepEqual([...c.data.filter((_, i) => i % 4 === 0)], [0, 188, 255, 137])
  assert.deepEqual([...c.data.filter((_, i) => i % 4 === 3)], [255, 255, 255, 255])
})

test('a frame larger than the edge is averaged as light, not as encoded values', () => {
  const c = sdrCompanion(frame([0, 1, 1, 0]), 2, 2, 1)
  assert.deepEqual([c.width, c.height], [1, 1])
  // The mean light is 0.5: 188, not the 128 an average of 0 and 255 would be.
  assert.equal(c.data[0], 188)
})
