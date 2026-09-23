import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  absoluteFromOp,
  opFromAbsolute,
  opFromRelative,
  relativeFromOp,
  temperatureTintOf,
  whiteBalanceMatrix,
  whiteXy
} from '../src/shared/wb'

const close = (a: number, b: number, eps: number): void =>
  assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`)

test('the reference white is D65 and its matrix is the identity', () => {
  const [x, y] = whiteXy(6504, 0)
  close(x, 0.3127, 2e-4)
  close(y, 0.329, 3e-4)
  const m = whiteBalanceMatrix(6504, 0)
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) close(m[i][j], i === j ? 1 : 0, 1e-9)
})

test('temperature and tint invert whiteXy across the range', () => {
  for (const k of [1800, 2500, 3500, 3999, 4001, 5000, 6504, 9000, 15000, 24000]) {
    for (const t of [-0.03, -0.01, 0, 0.012, 0.03]) {
      const xy = whiteXy(k, t)
      const back = temperatureTintOf(xy)
      // The white itself always comes back; the numbers do too, except right
      // at the 4000 K join, where the locus bends and a large tint can be
      // reached from either side of it.
      const again = whiteXy(back.kelvin, back.tint)
      close(again[0], xy[0], 2e-5)
      close(again[1], xy[1], 2e-5)
      assert.equal(back.clamped, false)
      if (Math.abs(k - 4000) > 300) {
        close(back.kelvin, k, k * 0.002)
        close(back.tint, t, 2e-4)
      }
    }
  }
})

test('a RAW set to its own as-shot white needs no correction', () => {
  const asShot = { temperature_kelvin: 5200, tint: 0.004 }
  const op = opFromAbsolute(5200, 0.004, asShot)
  close(op.kelvin, 6504, 3)
  close(op.tint, 0, 1e-4)
  const back = absoluteFromOp({ kelvin: 6504, tint: 0 }, asShot)
  close(back.kelvin, 5200, 5)
})

test('a warmer absolute setting warms the op the same way a RAW converter would', () => {
  const asShot = { temperature_kelvin: 5200, tint: 0 }
  // Telling the converter the light was warmer than recorded (higher K)
  // makes the picture warmer: an op white above 6504 K.
  assert.ok(opFromAbsolute(6500, 0, asShot).kelvin > 6504)
  assert.ok(opFromAbsolute(4000, 0, asShot).kelvin < 6504)
})

test('relative sliders are the identity at zero and invert', () => {
  const id = opFromRelative(0, 0)
  close(id.kelvin, 6504, 1e-6)
  assert.equal(id.tint, 0)
  for (const [t, n] of [
    [40, 10],
    [-60, -25],
    [99, 0]
  ]) {
    const back = relativeFromOp(opFromRelative(t, n))
    close(back.temperature, t, 1e-6)
    close(back.tint, n, 1e-6)
  }
})
