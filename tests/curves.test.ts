import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_CURVES, monotone, presetCurve } from '../src/shared/curves'

const curveOf = (name: string): ((x: number) => number) => {
  const p = BUILTIN_CURVES.find((c) => c.name === name)
  assert.ok(p, name)
  return monotone(presetCurve(p).master)
}

test('Medium and Strong contrast are Lightroom’s points', () => {
  const near = (a: number, b: number): void =>
    assert.ok(Math.abs(a - b) < 0.5 / 255, `${a} vs ${b}`)
  const m = curveOf('Medium contrast')
  near(m(32 / 255), 22 / 255)
  near(m(64 / 255), 56 / 255)
  near(m(192 / 255), 196 / 255)
  const s = curveOf('Strong contrast')
  near(s(32 / 255), 16 / 255)
  near(s(64 / 255), 50 / 255)
  near(s(192 / 255), 202 / 255)
})

test('every preset is gentle: rising, in range, no quarter tone moved past 15/255', () => {
  for (const p of BUILTIN_CURVES) {
    const f = monotone(presetCurve(p).master)
    let last = -1
    for (let i = 0; i <= 255; i++) {
      const y = f(i / 255)
      assert.ok(y >= last - 1e-9 && y >= 0 && y <= 1, `${p.name} at ${i}`)
      last = y
    }
    // The old Medium took 64 to 54 and Strong to 43: a darker photo's shadows went.
    for (const x of [0.25, 0.75]) assert.ok(Math.abs(f(x) - x) <= 15 / 255, `${p.name} at ${x}`)
  }
})

test('the contrast presets grow in order and hold the middle', () => {
  const pull = (name: string): number => 0.25 - curveOf(name)(0.25)
  assert.ok(pull('Soft film S') < pull('Medium contrast'))
  assert.ok(pull('Medium contrast') < pull('Strong contrast'))
  for (const n of ['Soft film S', 'Medium contrast', 'Strong contrast'])
    assert.ok(Math.abs(curveOf(n)(0.5) - 0.5) < 1 / 255, n)
})
