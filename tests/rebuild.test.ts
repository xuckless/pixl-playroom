import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ENHANCE } from '../src/shared/enhance'
import type { PixelStep } from '../src/shared/pixels'
import { defaultRecipe, newLocalLayer, type BrushComponent } from '../src/shared/recipe'
import {
  LEGACY,
  legacyBits,
  olderDevelop,
  pixlMark,
  pixlSettingsFor,
  rebuildPlan,
  rebuildReasons,
  type Pipeline
} from '../src/shared/rebuild'

const ALL: Pipeline = { pixlDemosaic: true, pixlEnhance: true }
const NONE: Pipeline = { pixlDemosaic: false, pixlEnhance: false }
const MARK = pixlMark('s', true)

function step(id: string, kind: PixelStep['kind'], params: PixelStep['params'] = {}): PixelStep {
  return {
    id,
    kind,
    label: kind,
    blob: 'a'.repeat(64),
    alpha: null,
    scope: null,
    opacity: 70,
    width: 6000,
    height: 4000,
    rect: null,
    params
  }
}

const enhanceStep = (id: string, s: Partial<typeof DEFAULT_ENHANCE>, develop?: string): PixelStep =>
  step(id, 'enhance', {
    settings: JSON.stringify({ ...DEFAULT_ENHANCE, pixl: 'off', ...s }),
    ...(develop ? { develop } : {})
  })

test('a photo on today’s pipeline, or a computer without a newer one, has nothing to rebuild', () => {
  const r = defaultRecipe(true)
  r.pixels = [step('h', 'retouch', { develop: MARK })]
  assert.deepEqual(rebuildReasons(r, true, ALL, MARK), [])
  r.detail.rawDenoise = true
  assert.deepEqual(rebuildReasons(r, true, NONE, MARK), [])
})

test('a RAW: its denoise goes, its steps from the earlier develop are made again', () => {
  const r = defaultRecipe(true)
  r.detail.rawDenoise = true
  r.pixels = [
    step('d', 'denoise', { develop: 's' }),
    step('h', 'retouch', { develop: 's' }),
    enhanceStep('e', { deblur: true }, 's')
  ]
  const sky = newLocalLayer('Sky')
  const plane: BrushComponent = {
    id: 'c1',
    kind: 'brush',
    name: 'Sky',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: 10,
    height: 10,
    png: '',
    source: { kind: 'segment', target: 'sky' }
  }
  sky.components = [plane]
  r.layers = [sky]
  assert.deepEqual(rebuildReasons(r, true, ALL, MARK).sort(), [
    'denoise',
    'oldEnhance',
    'rawDenoise',
    'staleSteps'
  ])
  const plan = rebuildPlan(r, true, ALL, MARK)
  assert.equal(plan.recipe.detail.rawDenoise, false)
  assert.deepEqual(
    plan.recipe.pixels.map((s) => s.id),
    ['h', 'e']
  )
  assert.deepEqual(
    plan.redo.map((x) => [x.id, x.kind]),
    [
      ['h', 'heal'],
      ['e', 'enhance']
    ]
  )
  const e = plan.redo[1]
  assert.ok(e.kind === 'enhance' && e.settings.pixl === 'sharpen' && !e.settings.deblur)
  assert.deepEqual(plan.masks, [{ layerId: sky.id, componentId: 'c1' }])
  // The recipe given is not changed.
  assert.equal(r.pixels.length, 3)
})

test('another photo: a denoise step becomes PIXL Enhance in its place; masks stay', () => {
  const r = defaultRecipe(false)
  r.pixels = [step('d', 'denoise'), enhanceStep('u', { upscale: 'x2' })]
  assert.deepEqual(rebuildReasons(r, false, ALL, null), ['denoise'])
  const plan = rebuildPlan(r, false, ALL, null)
  assert.deepEqual(
    plan.recipe.pixels.map((s) => s.id),
    ['d', 'u'],
    'kept, made again in place'
  )
  assert.equal(plan.redo.length, 1)
  const d = plan.redo[0]
  assert.ok(d.kind === 'enhance' && d.id === 'd' && d.settings.pixl === 'denoise')
  assert.equal(d.kind === 'enhance' && d.settings.upscale, 'off')
  assert.deepEqual(plan.masks, [])
})

test('an old Enhance becomes PIXL Enhance’s level, its Super resolution kept', () => {
  const s = pixlSettingsFor({ ...DEFAULT_ENHANCE, pixl: 'off', jpeg: 'fbcnn', upscale: 'x4' })
  assert.equal(s.pixl, 'clean')
  assert.equal(s.jpeg, 'off')
  assert.equal(s.upscale, 'x4')
  assert.equal(pixlSettingsFor({ ...DEFAULT_ENHANCE, pixl: 'off', deblur: true }).pixl, 'sharpen')
  assert.equal(pixlSettingsFor({ ...DEFAULT_ENHANCE, pixl: 'denoise' }).pixl, 'denoise')
})

test('the library’s badge: legacy bits, told against the pipeline here', () => {
  const r = defaultRecipe(true)
  r.detail.rawDenoise = true
  r.pixels = [step('h', 'retouch', { develop: 's' })]
  const bits = legacyBits(r, true)
  assert.equal(bits, LEGACY.rawDenoise | LEGACY.notPixl)
  assert.equal(olderDevelop(bits, true, ALL), true)
  assert.equal(olderDevelop(bits, true, NONE), false)
  // Made on the PIXL demosaic: nothing older.
  const today = defaultRecipe(true)
  today.pixels = [step('h', 'retouch', { develop: MARK })]
  assert.equal(legacyBits(today, true), 0)
  // A JPEG's denoise step is older only where PIXL Enhance is.
  const jpeg = defaultRecipe(false)
  jpeg.pixels = [step('d', 'denoise')]
  assert.equal(olderDevelop(legacyBits(jpeg, false), false, { ...NONE, pixlEnhance: true }), true)
  assert.equal(olderDevelop(legacyBits(jpeg, false), false, { ...NONE, pixlDemosaic: true }), false)
})
