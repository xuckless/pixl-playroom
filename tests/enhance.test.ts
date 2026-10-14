import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PixelStep } from '../src/shared/pixels'
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
  type EnhanceSettings,
  withPixl
} from '../src/shared/enhance'
import { levelValues, PIXL_ENHANCE } from '../src/shared/pixlenhance'

/** The settings as they were before PIXL Enhance: no level, ×2. */
const PLAIN: EnhanceSettings = { ...DEFAULT_ENHANCE, pixl: 'off', upscale: 'x2' }

const all: EnhanceSettings = {
  ...PLAIN,
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
  const only = { ...PLAIN, jpeg: 'fbcnn' as const, upscale: 'off' as const }
  assert.match(enhanceRefusal(only, { isJpeg: false, isHdr: false }) ?? '', /JPEG files/)
  assert.equal(enhanceRefusal(only, { isJpeg: true, isHdr: false }), null)
})

test('nothing chosen, or an HDR photo, is refused', () => {
  const none = { ...PLAIN, upscale: 'off' as const }
  assert.match(enhanceRefusal(none, { isJpeg: true, isHdr: false }) ?? '', /at least one/)
  assert.match(enhanceRefusal(all, { isJpeg: true, isHdr: true }) ?? '', /HDR/)
})

test('×2 is SPAN ×4 brought down: engine 0.18 retired its own ×2 model', () => {
  assert.deepEqual(neededModels({ ...PLAIN, upscale: 'x2' }, false), ['span-x4-ch48'])
  assert.ok(!neededModels(all, true).includes('real-esrgan-x2plus'))
})

test('Source picks the ×4 model; ×2 and ×4 run the same one', () => {
  const at = (upscale: 'x2' | 'x4', upscaleSource: 'clean' | 'damaged' | 'texture'): string[] =>
    neededModels({ ...PLAIN, upscale, upscaleSource }, false)
  assert.deepEqual(at('x2', 'clean'), ['span-x4-ch48'])
  assert.deepEqual(at('x4', 'clean'), ['span-x4-ch48'])
  assert.deepEqual(at('x2', 'damaged'), ['realesr-general-x4v3'])
  assert.deepEqual(at('x4', 'texture'), ['realesr-general-wdn-x4v3'])
  assert.equal(chainSubject(planSteps({ ...PLAIN, upscale: 'x4' }, false)), '×4')
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
  assert.equal(normaliseEnhance(old('nonsense')).upscale, 'off')
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
  const steps = planSteps({ ...PLAIN, deblur: true, upscale: 'x2' }, true)
  const rates = { deblur: 1000, clean: 3000 }
  assert.equal(estimateMs(steps, 2000, 1000, rates), 2 * 4000)
  const slower = learnRates(steps, rates, 16000, 8000)
  assert.equal(slower.deblur, 1600)
  assert.equal(slower.clean, 4800)
  assert.equal(chainSubject(steps), 'Deblur + ×2')
})

test('PIXL Enhance is the default: its denoise level, no upscale', () => {
  const steps = planSteps(DEFAULT_ENHANCE, true)
  assert.deepEqual(
    steps.map((p) => [p.kind, p.model, p.level]),
    [['pixl', PIXL_ENHANCE, 'denoise']]
  )
  assert.equal(scaleOf(DEFAULT_ENHANCE), 1)
})

test('PIXL Enhance runs before the upscaler; its sharpen level is its own speed', () => {
  const s = { ...DEFAULT_ENHANCE, pixl: 'sharpen' as const, upscale: 'x2' as const }
  assert.deepEqual(
    planSteps(s, false).map((p) => p.kind),
    ['pixl-sharpen', 'clean']
  )
  assert.deepEqual(neededModels(s, false), [PIXL_ENHANCE, 'span-x4-ch48'])
  const mp = estimateMs(planSteps(s, false), 1000, 1000, {})
  assert.equal(mp, 1400 + 6500)
})

test('where PIXL Enhance is offered, a saved JPEG restore or deblur is not run beside it', () => {
  const saved = { ...DEFAULT_ENHANCE, jpeg: 'fbcnn' as const, deblur: true }
  assert.deepEqual(
    planSteps(withPixl(saved), true).map((p) => p.kind),
    ['pixl']
  )
})

test('settings saved before PIXL Enhance take its default; an unknown level is off', () => {
  assert.equal(normaliseEnhance({ upscale: 'x4' }).pixl, 'denoise')
  assert.equal(normaliseEnhance({ pixl: 'clean' }).pixl, 'clean')
  const odd = { pixl: 'extreme' } as unknown as Partial<EnhanceSettings>
  assert.equal(normaliseEnhance(odd).pixl, 'off')
})

test('a level is the roster entry’s planes and tiling, and only those', () => {
  const plane = (v: number): unknown => ({ Channel: { value: { Stated: { value: v } } } })
  const fixed = (overlap: number): unknown => ({
    Fixed: { width: 1024, height: 1024, overlap }
  })
  const entry = {
    levels: [
      { level: 0, conditioning: [plane(0), plane(0)], tiling: fixed(128) },
      { level: 1, conditioning: [plane(1), plane(0)], tiling: fixed(128) },
      { level: 2, conditioning: [plane(1), plane(1)], tiling: fixed(256) }
    ]
  }
  assert.deepEqual(levelValues(entry, 'denoise'), {
    conditioning: [plane(1), plane(0)],
    tiling: fixed(128)
  })
  assert.deepEqual(levelValues(entry, 'sharpen').tiling, fixed(256))
  assert.throws(() => levelValues({ levels: entry.levels.slice(0, 2) }, 'sharpen'), /no level 2/)
  assert.throws(() => levelValues({}, 'clean'), /no level 0/)
})

test('Detail’s AI boxes: one PIXL step, at the highest level ticked', async () => {
  const { nextLevel, pixlStepOf, levelOfStep } = await import('../src/shared/enhance')
  // Ticking asks for its level, or keeps a higher one.
  assert.equal(nextLevel(null, 'denoise', true), 'denoise')
  assert.equal(nextLevel('denoise', 'sharpen', true), 'sharpen')
  assert.equal(nextLevel('sharpen', 'clean', true), 'sharpen')
  // Unticking steps down one level; the last takes the step away.
  assert.equal(nextLevel('sharpen', 'sharpen', false), 'denoise')
  assert.equal(nextLevel('denoise', 'denoise', false), 'clean')
  assert.equal(nextLevel('clean', 'clean', false), null)
  const step = (id: string, settings: object, extra: object = {}): PixelStep => ({
    id,
    kind: 'enhance' as const,
    label: id,
    blob: 'a'.repeat(64),
    alpha: null,
    scope: null,
    opacity: 100,
    width: 10,
    height: 10,
    rect: null,
    params: { settings: JSON.stringify(settings) },
    ...extra
  })
  const pixl = step('p', { pixl: 'denoise', upscale: 'off' })
  // An upscale, a step in a mask and one switched off are not the boxes'.
  const up = step('u', { pixl: 'off', upscale: 'x2' })
  const masked = step('m', { pixl: 'sharpen', upscale: 'off' }, { alpha: 'b'.repeat(64) })
  const off = step('o', { pixl: 'sharpen', upscale: 'off' }, { off: true })
  assert.equal(pixlStepOf([pixl, up, masked, off])?.id, 'p')
  assert.equal(levelOfStep(pixlStepOf([pixl])), 'denoise')
  assert.equal(pixlStepOf([up]), null)
})
