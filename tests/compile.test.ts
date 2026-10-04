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

test('a straighten too small to say is none: no outside the engine would refuse', () => {
  const r = defaultRecipe(false)
  r.geometry.straighten = 3e-5
  const f = compile(r, ctx).framing
  assert.ok(!f || (f.rotate_degrees === 0 && f.outside === undefined))
})

test('a RAW starts with its profile look, capture sharpening and colour noise reduction', () => {
  const c = compile(defaultRecipe(true), { ...ctx, isRaw: true, scale: 1 })
  const stages = c.grade!.layers[0].stages
  assert.deepEqual(kinds(stages[0].ops), ['Denoise'])
  assert.equal(stages[0].space, 'LinearWorking')
  // Playroom Standard: Vivid's curve and vibrance, and a little more saturation.
  assert.deepEqual(kinds(stages[1].ops), ['Curves', 'Vibrance', 'Primary', 'Sharpen'])
})

test('AI-denoised pixels get no classic noise reduction on top', () => {
  const r = defaultRecipe(true)
  r.detail.noiseLuminance = 40
  const c = compile(r, { ...ctx, isRaw: true, scale: 1, aiDenoised: true })
  const ops = c.grade!.layers[0].stages.flatMap((s) => kinds(s.ops))
  assert.ok(!ops.includes('Denoise'))
  assert.ok(ops.includes('Sharpen'))
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
  l.settings.basic.exposure = -0.5
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
  l.settings.colorGrade.add = { hue: 120, saturation: 80, amount: 30 }
  r.layers.push(l)
  const c = compile(r, ctx)
  const stages = c.grade!.layers[c.layerIndex[l.id]].stages
  assert.equal(stages[0].space, 'LinearWorking')
  assert.ok(kinds(stages[0].ops).includes('AddColor'))
})

test('on a black-and-white photo the masks run before the conversion, which stays grey', () => {
  const r = defaultRecipe(false)
  r.treatment = 'bw'
  r.colorGrade.shadows = { ...r.colorGrade.shadows, saturation: 30 }
  const grey = (ops: GradeOp[]): boolean =>
    ops.some(
      (o) => 'Primary' in o && (o as { Primary: { saturation: number } }).Primary.saturation === 0
    )
  // No masks: one layer, as it always was.
  const plain = compile(r, ctx).grade!
  assert.equal(plain.layers.length, 1)
  assert.ok(grey(plain.layers[0].stages.flatMap((s) => s.ops)))
  // A mask warming part of it: base, the mask, then the conversion and toning over both.
  const l = newLocalLayer('warm')
  l.components.push({
    id: 'p',
    kind: 'polygon',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.5, y: 0.9 }
    ]
  })
  l.settings.wb = { mode: 'custom', temperature: 30, tint: 0, preset: null }
  r.layers.push(l)
  const g = compile(r, ctx).grade!
  const names = g.layers.map((x) => x.name)
  // (The base has nothing left before the conversion here, so it is left out.)
  assert.deepEqual(names.slice(-2), ['warm', 'black & white'])
  for (const x of g.layers.slice(0, -1)) assert.ok(!grey(x.stages.flatMap((st) => st.ops)))
  const finish = g.layers[g.layers.length - 1].stages.flatMap((s) => s.ops)
  assert.ok(grey(finish))
  // The toning is on the grey, after the conversion.
  assert.ok(kinds(finish).indexOf('ColorGrade') > kinds(finish).indexOf('Primary'))
})

test('an aspect lock at the photo’s own shape is no crop: nothing to frame', () => {
  const r = defaultRecipe(false)
  r.geometry.aspect = 6000 / 4000
  assert.equal(compile(r, ctx).framing, null)
})

test('a custom layer written before 0.16 gets each LUT its old domain rule', async () => {
  const { withLutDomains } = await import('../src/shared/compile')
  const layer = {
    name: 'mine',
    stages: [
      {
        space: 'LinearWorking',
        ops: [
          { Lut: { lut: { Path: '/a.cube' }, amount: 1 } },
          { Lut: { lut: { Path: '/b.cube' }, amount: 1, out_of_domain: 'ExtendSlope' } },
          {
            Masked: {
              mask: null,
              opacity: 1,
              ops: [{ Lut: { lut: { Cube: 'x' }, amount: 0.5 } }]
            }
          }
        ]
      }
    ]
  }
  const out = withLutDomains(layer) as typeof layer
  const ops = out.stages[0].ops as Record<string, Record<string, unknown>>[]
  assert.equal(ops[0].Lut.out_of_domain, 'Clamp')
  assert.equal(ops[1].Lut.out_of_domain, 'ExtendSlope')
  const inner = (ops[2].Masked.ops as Record<string, Record<string, unknown>>[])[0]
  assert.equal(inner.Lut.out_of_domain, 'Clamp')
  assert.equal(out.name, 'mine')
})

test('a RAW the engine refuses by name is said plainly', async () => {
  const { unsupportedRaw } = await import('../src/shared/engine-types')
  assert.match(
    unsupportedRaw({ Unsupported: { operation: 'raw frames', detail: '2 frames' } })!,
    /several frames/
  )
  assert.match(
    unsupportedRaw({ Unsupported: { operation: 'raw decode', detail: 'Foveon' } })!,
    /isn't supported \(Foveon\)/
  )
  assert.equal(unsupportedRaw({ Unsupported: { operation: 'resize', detail: 'x' } }), null)
  assert.equal(unsupportedRaw(undefined), null)
})

test('a picture past the limits, and a stale cache, are said plainly', async () => {
  const { describeEngineError } = await import('../src/shared/engine-types')
  assert.match(
    describeEngineError('TooLarge', { TooLarge: { field: 'limits', pixels: 900e6, side: 40000 } })!,
    /900 megapixels \(40000 px on its longest side\), more than Playroom opens/
  )
  assert.match(describeEngineError('StaleCache', undefined)!, /another engine/)
  assert.equal(describeEngineError('Decode', undefined), null)
})
