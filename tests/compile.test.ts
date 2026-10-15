import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  autoCrop,
  calibrationMatrix,
  compile,
  cropFits,
  regionCurveOp,
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

test('a RAW starts with its profile look, capture sharpening, colour noise reduction and its shoulder', () => {
  const c = compile(defaultRecipe(true), { ...ctx, isRaw: true, scale: 1 })
  const stages = c.grade!.layers[0].stages
  // The Scene master's headroom rolled onto white for SDR (engine 0.18).
  assert.deepEqual(kinds(stages[0].ops), ['Denoise', 'Lut'])
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
  assert.ok(c.notes.some((n) => n.includes('100%')))
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

test('the region sliders are the engine’s monotone parametric curve, a quarter of the range at ±100 (E19)', () => {
  const tc = defaultRecipe(false).toneCurve
  assert.equal(regionCurveOp(tc), null)
  const op = regionCurveOp({ ...tc, highlights: -50, lights: 20, shadows: 40 })
  assert.deepEqual(op, {
    ParametricCurve: {
      shadows: 0.4,
      darks: 0,
      lights: 0.2,
      highlights: -0.5,
      splits: { low: 0.25, mid: 0.5, high: 0.75 },
      reach: { Range: 0.25 }
    }
  })
  // Strong opposite moves are still sent (the engine keeps the curve
  // monotone); a mask's Amount past ±100 is held to the engine's ±1.
  const strong = regionCurveOp({ ...tc, lights: -100, highlights: 200 }) as {
    ParametricCurve: { lights: number; highlights: number }
  }
  assert.deepEqual([strong.ParametricCurve.lights, strong.ParametricCurve.highlights], [-1, 1])
  // Splits held strictly in order inside 0…1.
  const s = (regionCurveOp({ ...tc, shadows: 10, splits: [2, 3, 3] }) as {
    ParametricCurve: { splits: { low: number; mid: number; high: number } }
  }).ParametricCurve.splits
  assert.ok(0 < s.low && s.low < s.mid && s.mid < s.high && s.high < 1, JSON.stringify(s))
  // In the look stage, the same on an HDR pipeline (the identity above white).
  const r = defaultRecipe(false)
  r.toneCurve.darks = -30
  for (const hdr of [false, true]) {
    const look = compile(r, { ...ctx, hdr }).grade!.layers[0].stages.at(-1)!
    assert.notEqual(look.space, 'LinearWorking')
    assert.deepEqual(kinds(look.ops), ['ParametricCurve'])
  }
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
  // Engine 0.21 (E43): the response and colour grain it requires, as 0.20's grain was.
  const grain = look.ops.at(-1)
  assert.ok(grain && 'Grain' in grain)
  assert.equal(grain.Grain.response, 'Midtones')
  assert.deepEqual(grain.Grain.chroma, { amount: 0, size: 1 })
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

test('Denoise sends one reach at every size (engine 0.18, HR-0.18-3)', async () => {
  const { DENOISE_REACH } = await import('../src/shared/compile')
  const r = defaultRecipe(true)
  r.detail.noiseLuminance = 40
  const reachAt = (scale: number): unknown => {
    const op = compile(r, { ...ctx, isRaw: true, scale })
      .grade!.layers[0].stages.flatMap((s) => s.ops)
      .find((o) => 'Denoise' in o) as { Denoise: { reach: number } }
    return op.Denoise.reach
  }
  assert.equal(DENOISE_REACH, 0.03)
  // The preview's proxy and the export's full size: the same fraction.
  assert.equal(reachAt(0.4), DENOISE_REACH)
  assert.equal(reachAt(1), DENOISE_REACH)
})

test('a custom layer’s Denoise saved before 0.18 gets the reach; a stated one is kept', async () => {
  const { withLutDomains, DENOISE_REACH } = await import('../src/shared/compile')
  const denoise = { luminance: 0.5, luminance_detail: 0.5, color: 0.5, color_detail: 0.5 }
  const layer = {
    stages: [
      {
        ops: [
          { Denoise: denoise },
          { Denoise: { ...denoise, reach: 0.1 } },
          { Masked: { mask: null, opacity: 1, ops: [{ Denoise: denoise }] } }
        ]
      }
    ]
  }
  const ops = (withLutDomains(layer) as typeof layer).stages[0].ops as Record<
    string,
    Record<string, unknown>
  >[]
  assert.equal(ops[0].Denoise.reach, DENOISE_REACH)
  assert.equal(ops[1].Denoise.reach, 0.1)
  const inner = (ops[2].Masked.ops as Record<string, Record<string, unknown>>[])[0]
  assert.equal(inner.Denoise.reach, DENOISE_REACH)
})

test('a custom layer saved before engine 0.21 gets its clean breaks’ fields; stated ones are kept', async () => {
  const { withLutDomains } = await import('../src/shared/compile')
  const curve = {
    shadows: 0.2,
    darks: 0,
    lights: -0.1,
    highlights: 0,
    splits: { low: 0.25, mid: 0.5, high: 0.75 }
  }
  const grain = { amount: 0.3, size: 0.002, roughness: 0.5, seed: 7 }
  const layer = {
    stages: [
      {
        ops: [
          { ParametricCurve: curve },
          { ParametricCurve: { ...curve, reach: { Range: 0.25 } } },
          { Grain: grain },
          { Grain: { ...grain, response: 'Midtones', chroma: { amount: 0.2, size: 2 } } },
          { Masked: { mask: null, opacity: 1, ops: [{ Grain: grain }] } }
        ]
      }
    ]
  }
  const ops = (withLutDomains(layer) as typeof layer).stages[0].ops as Record<
    string,
    Record<string, unknown>
  >[]
  // The same bytes as 0.20: HalfGap, Midtones and no colour grain.
  assert.equal(ops[0].ParametricCurve.reach, 'HalfGap')
  assert.deepEqual(ops[1].ParametricCurve.reach, { Range: 0.25 })
  assert.equal(ops[2].Grain.response, 'Midtones')
  assert.deepEqual(ops[2].Grain.chroma, { amount: 0, size: 1 })
  assert.deepEqual(ops[3].Grain.chroma, { amount: 0.2, size: 2 })
  const inner = (ops[4].Masked.ops as Record<string, Record<string, unknown>>[])[0]
  assert.deepEqual(inner.Grain.chroma, { amount: 0, size: 1 })
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

test('a RAW’s Scene headroom rolls onto white for SDR, whatever the exposure; HDR keeps it', async () => {
  const { RAW_SCENE_STOPS, gradeKey } = await import('../src/shared/compile')
  const shoulderOf = (exposure: number, hdr: boolean, isRaw = true): string | null => {
    const r = defaultRecipe(isRaw)
    r.basic.exposure = exposure
    const ops = compile(r, { ...ctx, isRaw, scale: 1, hdr }).grade?.layers[0].stages[0].ops ?? []
    const lut = ops.find((o) => 'Lut' in o)
    return lut
      ? (JSON.parse(gradeKey(lut)) as { Lut: { lut: { Cube: string } } }).Lut.lut.Cube
      : null
  }
  assert.equal(shoulderOf(0, false), `shoulder:${RAW_SCENE_STOPS}:1024`)
  assert.equal(shoulderOf(-1, false), `shoulder:${RAW_SCENE_STOPS}:1024`)
  assert.equal(shoulderOf(1, false), `shoulder:${1 + RAW_SCENE_STOPS}:1024`)
  assert.equal(shoulderOf(0, true), null)
  // Any other photo: only a positive exposure brings one, as before.
  assert.equal(shoulderOf(0, false, false), null)
})

test('engine 0.19.2: the look stage no longer floors Scene’s wide colours first (Phase A §2)', () => {
  const r = defaultRecipe(true)
  r.presence.dehaze = 30
  const look = compile(r, { ...ctx, isRaw: true, scale: 1 }).grade!.layers[0].stages.at(-1)!
  assert.ok(!look.ops.some((o) => 'Lut' in o))
  assert.ok('Dehaze' in look.ops[0])
  // Nothing in the look stage, no floor either.
  assert.equal(compile(defaultRecipe(false), ctx).grade, null)
})

test('colourForm v0 is engine 0.20’s colour maths, for scripts/look-delta.mjs --maths only', () => {
  const r = defaultRecipe(false)
  r.basic.shadows = -30
  r.hsl.blue.luminance = -20
  r.toneCurve.lights = 40
  r.primaries.temp = 20
  r.primaries.lumMix = 100
  r.primaries.lift.y = 0.05
  r.logWheels.shadow = { y: 0, r: 0.02, g: 0, b: 0 }
  r.curvesVs.hueLum = [{ x: 0.6, y: 0.8 }]
  const stages = compile(r, { ...ctx, colourForm: 'v0' }).grade!.layers[0].stages
  assert.deepEqual(
    stages.map((s) => (s.space === 'LinearWorking' ? s.space : 'look')),
    ['LinearWorking', 'look']
  )
  assert.deepEqual(kinds(stages[0].ops), ['WhiteBalance'])
  const look = stages[1].ops
  const tone = look.find((o) => 'Tone' in o) as { Tone: { smoothing: unknown } }
  assert.equal(tone.Tone.smoothing, null)
  const hsl = look.find((o) => 'HslBands' in o) as { HslBands: { smoothing: unknown } }
  assert.equal(hsl.HslBands.smoothing, null)
  assert.ok(look.some((o) => 'Curves' in o && o.Curves.master?.points.length === 17))
  for (const k of ['ParametricCurve', 'GainBalance', 'LumaPrimary', 'LogWheels'])
    assert.ok(!kinds(look).includes(k), k)
  assert.ok(look.some((o) => 'Qualifier' in o && o.Qualifier.key.luma?.centre === 0))
  assert.ok(!look.some((o) => 'Curves' in o && o.Curves.hue_vs_luma))
})
