import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ENHANCE,
  chainSubject,
  enhanceRefusal,
  estimateMs,
  fbcnnQuality,
  learnRates,
  neededModels,
  planSteps,
  reconstructParams,
  scaleOf,
  type EnhanceSettings
} from '../src/shared/enhance'

const all: EnhanceSettings = {
  ...DEFAULT_ENHANCE,
  jpeg: 'fbcnn-qf',
  deblur: true,
  upscale: 'x4-wdn'
}

test('the chain runs in the engine order: JPEG restore, deblur, then the upscaler', () => {
  assert.deepEqual(
    planSteps(all, true).map((p) => p.kind),
    ['fbcnn-qf', 'deblur', 'x4-wdn']
  )
  assert.deepEqual(neededModels(all, true), [
    'fbcnn-color-qf',
    'nafnet-gopro-w32',
    'realesr-general-wdn-x4v3'
  ])
})

test('a rebuild needs no model, and comes first', () => {
  const s = { ...all, jpeg: 'reconstruct' as const }
  const steps = planSteps(s, true)
  assert.equal(steps[0].kind, 'reconstruct')
  assert.equal(steps[0].model, null)
  assert.deepEqual(neededModels(s, true), ['nafnet-gopro-w32', 'realesr-general-wdn-x4v3'])
})

test('JPEG restore is left out for any other format', () => {
  assert.deepEqual(
    planSteps(all, false).map((p) => p.kind),
    ['deblur', 'x4-wdn']
  )
  const only = { ...DEFAULT_ENHANCE, jpeg: 'fbcnn' as const, upscale: 'off' as const }
  assert.match(enhanceRefusal(only, { isJpeg: false, isHdr: false }) ?? '', /JPEG files/)
  assert.equal(enhanceRefusal(only, { isJpeg: true, isHdr: false }), null)
})

test('nothing chosen, or an HDR photo, is refused', () => {
  const none = { ...DEFAULT_ENHANCE, upscale: 'off' as const }
  assert.match(enhanceRefusal(none, { isJpeg: true, isHdr: false }) ?? '', /at least one/)
  assert.match(enhanceRefusal(all, { isJpeg: true, isHdr: true }) ?? '', /HDR/)
})

test('scale follows the upscaler', () => {
  assert.equal(scaleOf({ ...all, upscale: 'off' }), 1)
  assert.equal(scaleOf({ ...all, upscale: 'x2' }), 2)
  assert.equal(scaleOf({ ...all, upscale: 'x4' }), 4)
})

test('Smoothing 50 is the engine’s measured choice, and the ends span two decades', () => {
  assert.deepEqual(reconstructParams(50), { iterations: 40, second_order: 0.5, fidelity: 500 })
  assert.equal(reconstructParams(100).fidelity, 5)
  assert.equal(reconstructParams(0).fidelity, 50000)
  assert.ok(reconstructParams(80).fidelity < reconstructParams(20).fidelity)
})

test('FBCNN is told 1 − quality/100', () => {
  assert.equal(fbcnnQuality(20), 0.8)
  assert.equal(fbcnnQuality(100), 0)
  assert.equal(fbcnnQuality(0), 0.99)
})

test('the estimate sums each step over the input’s megapixels, and learns from a run', () => {
  const steps = planSteps({ ...DEFAULT_ENHANCE, deblur: true, upscale: 'x2' }, true)
  const rates = { deblur: 1000, x2: 3000 }
  assert.equal(estimateMs(steps, 2000, 1000, rates), 2 * 4000)
  const slower = learnRates(steps, rates, 16000, 8000)
  assert.equal(slower.deblur, 1600)
  assert.equal(slower.x2, 4800)
  assert.equal(chainSubject(steps), 'Deblur + ×2')
})
