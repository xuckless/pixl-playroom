import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compile,
  scaleLocalAdjust,
  smoothnessRadius,
  type CompileContext
} from '../src/shared/compile'
import {
  defaultRecipe,
  newLocalLayer,
  normaliseRecipe,
  ZERO_LOCAL,
  type RangeComponent
} from '../src/shared/recipe'
import type { GradeOp } from '../src/shared/engine-types'

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 6000,
  frameHeight: 4000,
  scale: 0.4,
  seed: 7,
  brushPaths: {},
  applyCrop: true
}

const range = (smoothness: number): RangeComponent => ({
  id: 'r',
  kind: 'range',
  mode: 'Add',
  opacity: 100,
  invert: false,
  feather: 0,
  hue: { centre: 200, width: 40, softness: 20 },
  saturation: null,
  luma: null,
  smoothness
})

test('Amount 100% leaves the adjustments as they are', () => {
  const a = { ...ZERO_LOCAL, exposure: 0.5, contrast: 20, tintHue: 210, tintAmount: 30 }
  assert.equal(scaleLocalAdjust(a, 100), a)
})

test('Amount scales every adjustment but the tint hue', () => {
  const a = { ...ZERO_LOCAL, exposure: 0.5, contrast: 20, tintHue: 210, tintAmount: 30 }
  const half = scaleLocalAdjust(a, 50)
  assert.equal(half.exposure, 0.25)
  assert.equal(half.contrast, 10)
  assert.equal(half.tintAmount, 15)
  assert.equal(half.tintHue, 210)
  const none = scaleLocalAdjust(a, 0)
  assert.equal(none.exposure, 0)
  assert.equal(scaleLocalAdjust(a, 200).contrast, 40)
})

test('Amount 0 still leaves the mask inspectable', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(range(0))
  l.adjust.exposure = 1
  l.amount = 0
  r.layers.push(l)
  const c = compile(r, ctx)
  const ops = c.grade!.layers[c.layerIndex[l.id]].stages.flatMap((s) => s.ops)
  assert.deepEqual(
    ops.map((o: GradeOp) => Object.keys(o)[0]),
    ['Primary']
  )
})

test('Range smoothness becomes the key blur, in buffer pixels, within what the engine accepts', () => {
  assert.equal(smoothnessRadius(0, { width: 6000, height: 4000, scale: 0.4 }), 0)
  assert.equal(smoothnessRadius(100, { width: 6000, height: 4000, scale: 0.4 }), 16)
  assert.equal(smoothnessRadius(100, { width: 40, height: 30, scale: 0.1 }), 0)
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(range(50))
  r.layers.push(l)
  const shape = compile(r, ctx).grade!.layers[0].mask!.components[0].shape as {
    Range: { blur_radius: number }
  }
  assert.equal(shape.Range.blur_radius, 8)
})

test('gradients reach the engine as raster planes, and are dropped without one', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('g')
  l.components.push({
    id: 'lin',
    kind: 'linear',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    start: { x: 0.5, y: 0 },
    end: { x: 0.5, y: 0.5 },
    width: 512,
    height: 341
  })
  l.adjust.exposure = -1
  r.layers.push(l)
  assert.equal(compile(r, ctx).grade, null)
  const c = compile(r, { ...ctx, brushPaths: { lin: '/tmp/lin.png' } })
  const shape = c.grade!.layers[0].mask!.components[0].shape as {
    Raster: { source: { Png: string } }
  }
  assert.equal(shape.Raster.source.Png, '/tmp/lin.png')
})

test('the first component always adds, whatever it was made as', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('g')
  l.components.push({
    id: 'rad',
    kind: 'radial',
    mode: 'Subtract',
    opacity: 100,
    invert: false,
    feather: 0,
    centre: { x: 0.5, y: 0.5 },
    radiusX: 0.2,
    radiusY: 0.2,
    angle: 0,
    softness: 50,
    width: 512,
    height: 341
  })
  r.layers.push(l)
  const c = compile(r, { ...ctx, brushPaths: { rad: '/tmp/rad.png' } })
  assert.equal(c.grade!.layers[0].mask!.components[0].mode, 'Add')
})

test('an older sidecar gets Amount and Smoothness; unknown kinds are dropped', () => {
  const old = {
    layers: [
      {
        id: 'l',
        name: 'old',
        enabled: true,
        opacity: 100,
        blend: 'Normal',
        invert: false,
        adjust: { exposure: 1 },
        components: [
          {
            id: 'a',
            kind: 'range',
            mode: 'Add',
            opacity: 100,
            invert: false,
            feather: 5,
            hue: null,
            saturation: null,
            luma: { centre: 0.5, width: 0.4, softness: 0.1 }
          },
          { id: 'b', kind: 'depth', mode: 'Add' },
          'nonsense'
        ]
      }
    ]
  }
  const r = normaliseRecipe(old, false)
  const l = r.layers[0]
  assert.equal(l.amount, 100)
  assert.equal(l.components.length, 1)
  const c = l.components[0] as RangeComponent
  assert.equal(c.smoothness, 0)
  assert.equal(l.adjust.contrast, 0)
})
