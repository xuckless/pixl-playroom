import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoMaskWeight, composeStroke, deltaE, srgbToLab, stampDab } from '../src/shared/brush'

test('a dab builds up with flow and never passes full', () => {
  const s = new Float32Array(16 * 16)
  stampDab(s, 16, 16, 8, 8, 4, 0, 0.5)
  assert.ok(Math.abs(s[8 * 16 + 8] - 0.5) < 1e-6)
  stampDab(s, 16, 16, 8, 8, 4, 0, 0.5)
  assert.ok(Math.abs(s[8 * 16 + 8] - 0.75) < 1e-6)
  for (let i = 0; i < 20; i++) stampDab(s, 16, 16, 8, 8, 4, 0, 0.5)
  assert.ok(s[8 * 16 + 8] <= 1)
  assert.equal(s[0], 0)
})

test('softness fades a dab to its edge', () => {
  const s = new Float32Array(32 * 32)
  stampDab(s, 32, 32, 16, 16, 10, 100, 1)
  assert.ok(s[16 * 32 + 16] > 0.95)
  assert.ok(s[16 * 32 + 24] > 0 && s[16 * 32 + 24] < s[16 * 32 + 18])
})

test('density caps a stroke; painting unites, erasing removes', () => {
  const plane = new Float32Array([0, 0.5, 1])
  const stroke = new Float32Array([1, 1, 1])
  const painted = composeStroke(plane, stroke, 0.6, false)
  assert.ok(Math.abs(painted[0] - 0.6) < 1e-6)
  assert.ok(Math.abs(painted[1] - 0.8) < 1e-6)
  assert.equal(painted[2], 1)
  const erased = composeStroke(plane, stroke, 1, true)
  assert.deepEqual([...erased], [0, 0, 0])
})

test('Auto Mask keeps similar colours and drops different ones', () => {
  const sky = srgbToLab(170, 190, 220)
  const nearSky = srgbToLab(172, 188, 224)
  const leaf = srgbToLab(70, 110, 40)
  assert.ok(autoMaskWeight(deltaE(sky, nearSky)) > 0.95)
  assert.equal(autoMaskWeight(deltaE(sky, leaf)), 0)
  const s = new Float32Array(8 * 8)
  stampDab(s, 8, 8, 4, 4, 4, 0, 1, (x) => (x < 4 ? 1 : 0))
  assert.ok(s[4 * 8 + 2] > 0.9)
  assert.equal(s[4 * 8 + 6], 0)
})
