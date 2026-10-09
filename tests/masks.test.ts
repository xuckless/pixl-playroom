import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compile,
  isP3Floor,
  layerMask,
  scaleSettings,
  smoothnessFeather,
  smoothnessRadius,
  type CompileContext
} from '../src/shared/compile'
import {
  defaultRecipe,
  newLocalLayer,
  normaliseRecipe,
  neutralSettings,
  settingsFromAdjust,
  ZERO_LOCAL,
  type PolygonComponent,
  type RangeComponent
} from '../src/shared/recipe'
import type { GradeOp } from '../src/shared/engine-types'
import {
  copyName,
  dropIndex,
  geometricCentre,
  effectiveMode,
  moveItem,
  nextMaskMode,
  nextMaskName,
  nextOf
} from '../src/shared/masks'

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

test('Amount 100% leaves the settings as they are', () => {
  const s = neutralSettings()
  s.basic.exposure = 0.5
  assert.equal(scaleSettings(s, 100), s)
})

test('Amount scales every strength, not which colour or where', () => {
  const s = neutralSettings()
  s.basic.exposure = 0.5
  s.basic.contrast = 20
  s.colorGrade.global = { hue: 210, saturation: 30, luminance: 0 }
  s.colorGrade.add = { hue: 30, saturation: 60, amount: 20 }
  s.toneCurve.master = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.7 },
    { x: 1, y: 1 }
  ]
  s.detail.sharpenAmount = 40
  const half = scaleSettings(s, 50)
  assert.equal(half.basic.exposure, 0.25)
  assert.equal(half.basic.contrast, 10)
  assert.equal(half.colorGrade.global.saturation, 15)
  assert.equal(half.colorGrade.global.hue, 210)
  assert.equal(half.colorGrade.add.amount, 10)
  assert.equal(half.colorGrade.add.hue, 30)
  assert.equal(half.colorGrade.add.saturation, 60)
  // A point curve's outputs move halfway back toward its inputs.
  assert.ok(Math.abs(half.toneCurve.master[1].y - 0.6) < 1e-9)
  assert.equal(half.toneCurve.master[1].x, 0.5)
  assert.equal(half.detail.sharpenAmount, 20)
  assert.equal(half.detail.sharpenRadius, s.detail.sharpenRadius)
  assert.equal(scaleSettings(s, 0).basic.exposure, 0)
  assert.equal(scaleSettings(s, 200).basic.contrast, 40)
})

test('a neutral mask changes nothing, and its layer only stays inspectable', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(range(0))
  r.layers.push(l)
  const c = compile(r, ctx)
  const ops = c.grade!.layers[c.layerIndex[l.id]].stages.flatMap((s) => s.ops)
  assert.deepEqual(
    ops.map((o: GradeOp) => Object.keys(o)[0]),
    ['Primary']
  )
})

test('a version 1 mask becomes settings that give the engine the same operations', () => {
  const a = {
    ...ZERO_LOCAL,
    temperature: 20,
    exposure: 0.5,
    contrast: 10,
    highlights: -30,
    texture: 15,
    clarity: 20,
    dehaze: 10,
    hue: 5,
    saturation: -20,
    sharpness: 30,
    noise: 40,
    tintHue: 200,
    tintAmount: 25,
    addHue: 30,
    addSaturation: 50,
    addAmount: 20
  }
  const s = settingsFromAdjust(a)
  assert.equal(s.wb.temperature, 20)
  assert.equal(s.basic.exposure, 0.5)
  assert.equal(s.presence.hue, 5)
  assert.equal(s.detail.sharpenAmount, 30)
  assert.equal(s.detail.noiseLuminance, 40)
  assert.deepEqual(s.colorGrade.global, { hue: 200, saturation: 25, luminance: 0 })
  assert.deepEqual(s.colorGrade.add, { hue: 30, saturation: 50, amount: 20 })
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(range(0))
  l.settings = s
  r.layers.push(l)
  // At 1:1, where sharpening shows.
  const stages = compile(r, { ...ctx, scale: 1 }).grade!.layers[0].stages
  const kinds = (i: number): string[] =>
    stages[i].ops.filter((o: GradeOp) => !isP3Floor(o)).map((o: GradeOp) => Object.keys(o)[0])
  assert.deepEqual(kinds(0), ['WhiteBalance', 'Primary', 'AddColor'])
  assert.deepEqual(
    [...kinds(1)].sort(),
    [
      'ColorGrade',
      'Dehaze',
      'Denoise',
      'LocalContrast',
      'LocalContrast',
      'Primary',
      'Primary',
      'Primary',
      'Sharpen',
      'Tone'
    ].sort()
  )
  // No profile, no shoulder: a mask is a change on top of the photo.
  assert.ok(!kinds(0).includes('Lut') && !kinds(1).includes('Curves'))
})

test('Amount 0 still leaves the mask inspectable', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(range(0))
  l.settings.basic.exposure = 1
  l.amount = 0
  r.layers.push(l)
  const c = compile(r, ctx)
  const ops = c.grade!.layers[c.layerIndex[l.id]].stages.flatMap((s) => s.ops)
  assert.deepEqual(
    ops.map((o: GradeOp) => Object.keys(o)[0]),
    ['Primary']
  )
})

test('Range smoothness softens by feather: the engine refuses a blur on a Range mask', () => {
  assert.equal(smoothnessRadius(0, { width: 6000, height: 4000, scale: 0.4 }), 0)
  assert.equal(smoothnessRadius(100, { width: 6000, height: 4000, scale: 0.4 }), 16)
  assert.equal(smoothnessRadius(100, { width: 40, height: 30, scale: 0.1 }), 0)
  assert.equal(smoothnessFeather(0), 0)
  assert.equal(smoothnessFeather(100), 0.01)
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(range(50))
  r.layers.push(l)
  const c = compile(r, ctx).grade!.layers[0].mask!.components[0] as {
    feather: { radius: number }
    shape: { Range: { blur_radius: number } }
  }
  assert.equal(c.shape.Range.blur_radius, 0)
  assert.equal(c.feather.radius, 0.005)
})

test('gradients reach the engine as its own shapes; only an older edge needs a plane', () => {
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
  l.settings.basic.exposure = -1
  r.layers.push(l)
  // No plane needed: the engine draws it.
  const c = compile(r, ctx)
  const mask = c.grade!.layers[0].mask!
  assert.deepEqual(mask.components[0].shape, {
    LinearGradient: { from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 0.5 }, ramp: 'Smoothstep' }
  })
  assert.equal(mask.components[0].refine, null)
  assert.equal(mask.space, null)
  // An edge from an older version: a plane, drawn by the main process.
  l.components[0].edge = { shift: 20, harden: 0 }
  assert.equal(compile(r, ctx).grade, null)
  const edged = compile(r, { ...ctx, brushPaths: { lin: '/tmp/lin.png' } })
  const shape = edged.grade!.layers[0].mask!.components[0].shape as {
    Raster: { source: { Png: string } }
  }
  assert.equal(shape.Raster.source.Png, '/tmp/lin.png')
})

test('a snapped component reads the luminance, so its mask states a space', () => {
  const l = newLocalLayer('m')
  l.components.push({
    id: 'b',
    kind: 'brush',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: 4,
    height: 4,
    png: 'x',
    source: { kind: 'segment', target: 'subject' },
    refine: { on: true, radius: 0.4 },
    edge: { shift: 50, harden: 0 }
  })
  const m = layerMask(l, 'Normal', { b: '/tmp/b.png' })!
  // Shift edge +50 grows it by 1.5% of the shorter side: the refine's contract, negative.
  assert.deepEqual(m.components[0].refine, { radius: 0.004, epsilon: 0.001, contract: -0.015 })
  assert.notEqual(m.space, null)
  l.components[0].refine = { on: false, radius: 0.4 }
  const off = layerMask(l, 'Normal', { b: '/tmp/b.png' })!
  assert.equal(off.components[0].refine, null)
  assert.equal(off.space, null)
})

test('a Subtract left first by an Add that could not be drawn takes nothing away', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('g')
  // A brush whose plane is not there: it cannot be drawn.
  l.components.push({
    id: 'gone',
    kind: 'brush',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: 4,
    height: 4,
    png: '',
    ref: 'missing-1'
  })
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
  l.settings.exposure = 1
  r.layers.push(l)
  const c = compile(r, { ...ctx, brushPaths: { rad: '/tmp/rad.png' } })
  // Not made an Add (which would light the very part meant to be taken away): no layer.
  assert.equal(c.grade?.layers.length ?? 0, 0)
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
  assert.equal(l.settings.basic.exposure, 1)
  assert.equal(l.settings.basic.contrast, 0)
  assert.equal('adjust' in l, false)
})

test('component names and mask overlay colours survive normalising', () => {
  const r = defaultRecipe(false)
  const layer = newLocalLayer('Sky')
  layer.overlayHue = 400
  layer.components.push({ ...range(20), name: '  Blue sky  ' })
  r.layers.push(layer)
  const back = normaliseRecipe(JSON.parse(JSON.stringify(r)), false)
  assert.equal(back.layers[0].overlayHue, 40)
  assert.equal(back.layers[0].components[0].name, 'Blue sky')
  // Unnamed and uncoloured stay so.
  const plain = defaultRecipe(false)
  plain.layers.push(newLocalLayer('Plain'))
  plain.layers[0].components.push(range(0))
  const p = normaliseRecipe(JSON.parse(JSON.stringify(plain)), false)
  assert.equal('overlayHue' in p.layers[0], false)
  assert.equal('name' in p.layers[0].components[0], false)
})

test('a new mask is never named like one that exists', () => {
  assert.equal(nextMaskName([]), 'Mask 1')
  assert.equal(nextMaskName(['Mask 1', 'Mask 2']), 'Mask 3')
  // Mask 1 deleted: the next is not a second "Mask 2".
  assert.equal(nextMaskName(['Mask 2']), 'Mask 3')
  assert.equal(nextMaskName(['Sky', 'Face']), 'Mask 3')
  assert.equal(nextMaskName(['Mask 9', 'Sky']), 'Mask 10')
})

test('copies are numbered past the ones already made', () => {
  assert.equal(copyName('Sky', ['Sky']), 'Sky copy')
  assert.equal(copyName('Sky', ['Sky', 'Sky copy']), 'Sky copy 2')
  assert.equal(copyName('Sky copy', ['Sky', 'Sky copy', 'Sky copy 2']), 'Sky copy 3')
})

test('moveItem and dropIndex reorder a list the way a drag reads', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveItem(['a', 'b'], 0, 9), ['b', 'a'])
  assert.deepEqual(moveItem(['a', 'b'], 5, 0), ['a', 'b'])
  // The other rows' middles at 10, 30, 50: above all, between, below all.
  assert.equal(dropIndex([10, 30, 50], 0), 0)
  assert.equal(dropIndex([10, 30, 50], 31), 2)
  assert.equal(dropIndex([10, 30, 50], 99), 3)
})

test('the first component always adds; modes and overlay views cycle', () => {
  assert.equal(effectiveMode(0, 'Subtract'), 'Add')
  assert.equal(effectiveMode(1, 'Subtract'), 'Subtract')
  assert.equal(nextMaskMode('Add'), 'Subtract')
  assert.equal(nextMaskMode('Subtract'), 'Intersect')
  assert.equal(nextMaskMode('Intersect'), 'Add')
  assert.equal(nextOf(['a', 'b', 'c'], 'c'), 'a')
  assert.equal(nextOf(['a', 'b', 'c'], 'a'), 'b')
})

test('a mask of shapes is centred between them; a painted one has no centre of its own', () => {
  const base = { mode: 'Add' as const, opacity: 100, invert: false, feather: 0 }
  const radial = {
    ...base,
    id: 'r',
    kind: 'radial' as const,
    centre: { x: 0.2, y: 0.4 },
    radiusX: 0.1,
    radiusY: 0.1,
    angle: 0,
    softness: 50,
    width: 512,
    height: 341
  }
  const linear = {
    ...base,
    id: 'l',
    kind: 'linear' as const,
    start: { x: 0.5, y: 0 },
    end: { x: 0.9, y: 0.4 },
    width: 512,
    height: 341
  }
  assert.deepEqual(geometricCentre([radial]), { x: 0.2, y: 0.4 })
  const both = geometricCentre([radial, linear])!
  assert.ok(Math.abs(both.x - 0.45) < 1e-9 && Math.abs(both.y - 0.3) < 1e-9)
  assert.equal(geometricCentre([radial, range(0)]), null)
  assert.equal(geometricCentre([]), null)
})

test('a brush plane held by reference keeps its reference through normalising', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push({
    id: 'b',
    kind: 'brush',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: 4,
    height: 4,
    png: '',
    ref: 'abc-12'
  })
  r.layers.push(l)
  const c = normaliseRecipe(JSON.parse(JSON.stringify(r)), false).layers[0].components[0]
  assert.equal(c.kind === 'brush' && c.ref, 'abc-12')
})

test('a lasso moves with its shift, and in by its feather when that stays inside the line', () => {
  const l = newLocalLayer('m')
  const square = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 },
    { x: 0.25, y: 0.75 }
  ]
  const lasso = (edge?: { shift: number; harden: number; inside?: boolean }): PolygonComponent => ({
    id: 'p',
    kind: 'polygon' as const,
    mode: 'Add' as const,
    opacity: 100,
    invert: false,
    feather: 50,
    points: square,
    ...(edge ? { edge } : {})
  })
  const left = (edge?: { shift: number; harden: number; inside?: boolean }): number => {
    l.components = [lasso(edge)]
    const shape = layerMask(l, 'Normal', {}, { width: 100, height: 100 })!.components[0].shape
    if (!('Polygon' in shape)) throw new Error('not a polygon')
    return Math.min(...shape.Polygon.contours[0].points.map((p) => p.x))
  }
  assert.equal(left(), 0.25)
  // −100 is 3% of the shorter side, in.
  assert.equal(left({ shift: -100, harden: 0 }), 0.28)
  // Feather 50 is a radius of 5%: inside, the line moves in by it.
  assert.equal(left({ shift: 0, harden: 0, inside: true }), 0.3)
})
