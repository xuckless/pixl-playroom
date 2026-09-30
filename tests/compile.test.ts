import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  autoCrop,
  calibrationMatrix,
  compile,
  cropFits,
  parametricCurve,
  shoulderCube,
  vignettePlacement,
  type CompileContext
} from '../src/shared/compile'
import { defaultRecipe, newLocalLayer } from '../src/shared/recipe'
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

const kinds = (ops: GradeOp[]): string[] => ops.map((o) => Object.keys(o)[0])

test('an untouched JPEG compiles to nothing at all', () => {
  const c = compile(defaultRecipe(false), ctx)
  assert.equal(c.grade, null)
  assert.equal(c.framing, null)
})

test('a RAW starts with its profile curve, capture sharpening and colour noise reduction', () => {
  const c = compile(defaultRecipe(true), { ...ctx, isRaw: true, scale: 1 })
  const stages = c.grade!.layers[0].stages
  assert.deepEqual(kinds(stages[0].ops), ['Denoise'])
  assert.equal(stages[0].space, 'LinearWorking')
  assert.deepEqual(kinds(stages[1].ops), ['Curves', 'Sharpen'])
})

test('sharpening is left out where its radius falls under half a pixel', () => {
  const c = compile(defaultRecipe(true), { ...ctx, isRaw: true, scale: 0.3 })
  assert.ok(!kinds(c.grade!.layers[0].stages[1].ops).includes('Sharpen'))
  assert.ok(c.notes.some((n) => n.includes('1:1')))
})

test('physics goes in linear light and the look in Display P3', () => {
  const r = defaultRecipe(false)
  r.basic.exposure = 1
  r.basic.shadows = 40
  r.wb = { mode: 'custom', temperature: 30, tint: 0, preset: null }
  const c = compile(r, ctx)
  const [linear, look] = c.grade!.layers[0].stages
  assert.deepEqual(kinds(linear.ops), ['WhiteBalance', 'Primary', 'Lut'])
  assert.deepEqual(kinds(look.ops), ['Tone'])
  assert.deepEqual(look.space, {
    Encoded: { space: 'DisplayP3', intent: 'RelativeColorimetric', black_point_compensation: false }
  })
})

test('the exposure shoulder is the identity below its knee and reaches white at the new top', () => {
  const lines = shoulderCube(1, 9)
    .split('\n')
    .filter((l) => /^[0-9.]+ /.test(l))
  const ys = lines.map((l) => Number(l.split(' ')[0]))
  assert.equal(ys.length, 9)
  assert.equal(ys[0], 0)
  assert.equal(ys[8], 1)
  assert.ok(Math.abs(ys[2] - 0.5) < 1e-6) // x = 0.5 is below the knee
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] >= ys[i - 1])
})

test('a local layer maps to a masked layer the inspector can find', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('sky')
  l.components.push({
    id: 'p1',
    kind: 'polygon',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 10,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.5, y: 0.6 }
    ]
  })
  l.adjust.exposure = -0.5
  r.layers.push(l)
  const c = compile(r, ctx)
  assert.equal(c.layerIndex[l.id], 0)
  const layer = c.grade!.layers[0]
  assert.equal(layer.mask!.components[0].feather.radius, 0.01)
  assert.equal(layer.mask!.space, null)
})

test('user quarter turns move a polygon with the picture', () => {
  const r = defaultRecipe(false)
  r.geometry.quarterTurns = 1
  const l = newLocalLayer('x')
  l.components.push({
    id: 'p',
    kind: 'polygon',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    points: [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0, y: 0.5 }
    ]
  })
  r.layers.push(l)
  const c = compile(r, ctx)
  const pts = (
    c.grade!.layers[0].mask!.components[0].shape as {
      Polygon: { contours: { points: { x: number; y: number }[] }[] }
    }
  ).Polygon.contours[0].points
  assert.deepEqual(pts[0], { x: 1, y: 0 })
  assert.equal(c.framing!.orientation, 'Rotate90')
  assert.equal(c.orientedWidth, 4000)
})

test('a bare straighten gets the largest crop that fits', () => {
  const crop = autoCrop(5, 6000, 4000)
  assert.ok(cropFits(crop, 5, 6000, 4000))
  const bigger = {
    x: crop.x - 0.01,
    y: crop.y - 0.01,
    width: crop.width + 0.02,
    height: crop.height + 0.02
  }
  assert.ok(!cropFits(bigger, 5, 6000, 4000))
  const r = defaultRecipe(false)
  r.geometry.straighten = 5
  const c = compile(r, ctx)
  assert.equal(c.framing!.rotate_degrees, 5)
  assert.ok(c.framing!.crop)
  // The engine needs `outside` exactly when the framing rotates.
  assert.equal(c.framing!.outside, 'Crop')
})

test('framing that only turns names no outside', () => {
  const r = defaultRecipe(false)
  r.geometry.quarterTurns = 1
  const c = compile(r, ctx)
  assert.equal(c.framing!.rotate_degrees, 0)
  assert.equal(c.framing!.outside, undefined)
})

test('the vignette is the exposure style, with its highlights', () => {
  const r = defaultRecipe(false)
  r.effects.vignetteAmount = -40
  r.effects.vignetteHighlights = 30
  const op = compile(r, ctx)
    .grade!.layers[0].stages.flatMap((s) => s.ops)
    .find((o) => 'Vignette' in o)
  assert.ok(op && 'Vignette' in op)
  assert.deepEqual(op.Vignette.style, { Exposure: { highlights: 0.3 } })
})

test('a curve point above white is brought down to it', () => {
  const r = defaultRecipe(false)
  r.toneCurve.master = [
    { x: 0, y: 0 },
    { x: 0.5, y: 1.4 },
    { x: 1, y: 1 }
  ]
  const ops = compile(r, ctx).grade!.layers[0].stages.flatMap((s) => s.ops)
  const curves = ops.filter((o): o is Extract<GradeOp, { Curves: unknown }> => 'Curves' in o)
  const master = curves.map((c) => c.Curves.master).find((m) => m !== null)
  assert.ok(master)
  assert.ok(master.points.every((p) => p.y <= 1))
  assert.equal(curves[0].Curves.refine_saturation, null)
})

test('the vignette follows the crop back into the frame', () => {
  const v = vignettePlacement({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 }, 0, 6000, 4000)
  assert.deepEqual(v.centre, { x: 0.75, y: 0.75 })
  assert.deepEqual(v.half, { x: 0.25, y: 0.25 })
  const centred = vignettePlacement({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, 10, 6000, 4000)
  assert.ok(Math.abs(centred.centre.x - 0.5) < 1e-9 && Math.abs(centred.centre.y - 0.5) < 1e-9)
  assert.equal(centred.rotation, -10)
})

test('calibration keeps white white', () => {
  const m = calibrationMatrix({
    shadowsTint: 0,
    redHue: 40,
    redSaturation: -20,
    greenHue: 0,
    greenSaturation: 30,
    blueHue: -50,
    blueSaturation: 0
  })!
  for (const row of m) assert.ok(Math.abs(row.r + row.g + row.b - 1) < 1e-3)
})

test('the parametric curve pins black and white', () => {
  const pts = parametricCurve({
    highlights: -50,
    lights: 20,
    darks: 0,
    shadows: 40,
    splits: [25, 50, 75],
    master: [],
    red: [],
    green: [],
    blue: []
  })!
  assert.equal(pts[0].y, 0)
  assert.equal(pts[pts.length - 1].y, 1)
})

const lookOps = (r: ReturnType<typeof defaultRecipe>, hdr = false): GradeOp[] =>
  compile(r, { ...ctx, hdr }).grade!.layers[0].stages.flatMap((s) => s.ops)

test('refine saturation rides on the RGB point curve, and only below 100', () => {
  const r = defaultRecipe(false)
  r.toneCurve.refineSaturation = 40
  // No RGB curve: nothing to refine.
  assert.equal(compile(r, ctx).grade, null)
  r.toneCurve.master = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.6 },
    { x: 1, y: 1 }
  ]
  const c = lookOps(r).find((o) => 'Curves' in o)
  assert.ok(c && 'Curves' in c)
  assert.equal(c.Curves.refine_saturation, 0.4)
  r.toneCurve.refineSaturation = 100
  const d = lookOps(r).find((o) => 'Curves' in o)
  assert.ok(d && 'Curves' in d && d.Curves.refine_saturation === null)
})

test('paint overlay is the paint style, and highlight priority on an HDR photo', () => {
  const r = defaultRecipe(false)
  r.effects.vignetteAmount = -40
  r.effects.vignetteStyle = 'paint'
  const v = lookOps(r).find((o) => 'Vignette' in o)
  assert.ok(v && 'Vignette' in v && v.Vignette.style === 'PaintOverlay')
  const c = compile(r, { ...ctx, hdr: true })
  const h = c.grade!.layers[0].stages.flatMap((s) => s.ops).find((o) => 'Vignette' in o)
  assert.ok(h && 'Vignette' in h && typeof h.Vignette.style === 'object')
  assert.ok(c.notes.some((n) => /Paint overlay/.test(n)))
})

test('added light ends the linear stage; the wash comes just before the grain', () => {
  const r = defaultRecipe(false)
  r.basic.exposure = 0.5
  r.colorGrade.add = { hue: 30, saturation: 60, amount: 20 }
  r.effects.wash = { hue: 200, saturation: 40, amount: 10 }
  r.effects.grainAmount = 20
  const [linear, look] = compile(r, ctx).grade!.layers[0].stages
  assert.equal(linear.space, 'LinearWorking')
  assert.equal(kinds(linear.ops).at(-1), 'AddColor')
  assert.deepEqual(kinds(look.ops).slice(-2), ['AddColor', 'Grain'])
})

test('a mask adds its colour in linear light', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push({
    id: 'p',
    kind: 'polygon',
    mode: 'Add',
    invert: false,
    feather: 10,
    opacity: 100,
    points: [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.5, y: 0.8 }
    ]
  })
  l.adjust.addHue = 120
  l.adjust.addSaturation = 80
  l.adjust.addAmount = 30
  r.layers.push(l)
  const c = compile(r, ctx)
  const stages = c.grade!.layers[c.layerIndex[l.id]].stages
  assert.equal(stages[0].space, 'LinearWorking')
  assert.ok(kinds(stages[0].ops).includes('AddColor'))
})
