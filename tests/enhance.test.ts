import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ENHANCE,
  chainSubject,
  enhanceRefusal,
  estimateMs,
  learnRates,
  neededModels,
  normaliseEnhance,
  planSteps,
  reconstructParams,
  scaleOf,
  type EnhanceSettings
} from '../src/shared/enhance'

const all: EnhanceSettings = {
  ...DEFAULT_ENHANCE,
  jpeg: 'fbcnn',
  deblur: true,
  upscale: 'x4',
  upscaleSource: 'texture'
}

test('the chain runs in the engine order: JPEG restore, deblur, then the upscaler', () => {
  assert.deepEqual(
    planSteps(all, true).map((p) => p.kind),
    ['fbcnn', 'deblur', 'texture']
  )
  assert.deepEqual(neededModels(all, true), [
    'fbcnn-color-blind',
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
    ['deblur', 'texture']
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

test('×2 is SPAN ×4 brought down: engine 0.18 retired its own ×2 model', () => {
  assert.deepEqual(neededModels({ ...DEFAULT_ENHANCE, upscale: 'x2' }, false), ['span-x4-ch48'])
  assert.ok(!neededModels(all, true).includes('real-esrgan-x2plus'))
})

test('Source picks the ×4 model; ×2 and ×4 run the same one', () => {
  const at = (upscale: 'x2' | 'x4', upscaleSource: 'clean' | 'damaged' | 'texture'): string[] =>
    neededModels({ ...DEFAULT_ENHANCE, upscale, upscaleSource }, false)
  assert.deepEqual(at('x2', 'clean'), ['span-x4-ch48'])
  assert.deepEqual(at('x4', 'clean'), ['span-x4-ch48'])
  assert.deepEqual(at('x2', 'damaged'), ['realesr-general-x4v3'])
  assert.deepEqual(at('x4', 'texture'), ['realesr-general-wdn-x4v3'])
  assert.equal(chainSubject(planSteps({ ...DEFAULT_ENHANCE, upscale: 'x4' }, false)), '×4')
})

test('an upscale saved before Source keeps the model it ran', () => {
  const old = (upscale: string): Partial<EnhanceSettings> =>
    ({ upscale }) as unknown as Partial<EnhanceSettings>
  assert.deepEqual(
    [normaliseEnhance(old('x4')).upscale, normaliseEnhance(old('x4')).upscaleSource],
    ['x4', 'damaged']
  )
  assert.deepEqual(
    [normaliseEnhance(old('x4-wdn')).upscale, normaliseEnhance(old('x4-wdn')).upscaleSource],
    ['x4', 'texture']
  )
  assert.equal(normaliseEnhance(old('x2')).upscaleSource, 'clean')
  assert.equal(normaliseEnhance(old('nonsense')).upscale, 'x2')
  assert.equal(normaliseEnhance({ upscale: 'x4', upscaleSource: 'clean' }).upscaleSource, 'clean')
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

test('a saved FBCNN-at-a-quality (retired in engine 0.17) reads as FBCNN', () => {
  const saved = { jpeg: 'fbcnn-qf', jpegQuality: 40 } as unknown as Partial<EnhanceSettings>
  assert.equal(normaliseEnhance(saved).jpeg, 'fbcnn')
  assert.equal(normaliseEnhance({ jpeg: 'reconstruct' }).jpeg, 'reconstruct')
  assert.equal(normaliseEnhance(undefined).jpeg, 'off')
})

test('the estimate sums each step over the input’s megapixels, and learns from a run', () => {
  const steps = planSteps({ ...DEFAULT_ENHANCE, deblur: true, upscale: 'x2' }, true)
  const rates = { deblur: 1000, clean: 3000 }
  assert.equal(estimateMs(steps, 2000, 1000, rates), 2 * 4000)
  const slower = learnRates(steps, rates, 16000, 8000)
  assert.equal(slower.deblur, 1600)
  assert.equal(slower.clean, 4800)
  assert.equal(chainSubject(steps), 'Deblur + ×2')
})
