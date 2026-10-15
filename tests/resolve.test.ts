import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, scaleSettings, type CompileContext } from '../src/shared/compile'
import {
  defaultRecipe,
  neutralSettings,
  newLocalLayer,
  normaliseRecipe
} from '../src/shared/recipe'
import { effective, setSectionOff } from '../src/shared/edits'
import {
  defaultPrimaries,
  discToRgb,
  normalisePrimaries,
  primariesBalance,
  primariesOp,
  rgbToDisc
} from '../src/shared/resolve'
import { apply, invert, opFromRelative, rgbToXyz, whiteXyz, type Xy } from '../src/shared/wb'
import type { GainBalance, GradeOp, Primary } from '../src/shared/engine-types'

const P3: [Xy, Xy, Xy] = [
  [0.68, 0.32],
  [0.265, 0.69],
  [0.15, 0.06]
]

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 4000,
  frameHeight: 3000,
  scale: 0.5,
  seed: 1,
  brushPaths: {},
  applyCrop: true
}

const ops = (r: ReturnType<typeof defaultRecipe>): GradeOp[] =>
  compile(r, ctx).grade?.layers[0].stages.flatMap((s) => s.ops) ?? []

test('the disc moves colour at constant luma, and reads back where it was put', () => {
  for (const [x, y] of [
    [0.1, 0],
    [0, -0.2],
    [-0.13, 0.07]
  ]) {
    const c = discToRgb(x, y)
    assert.ok(Math.abs(0.2289746 * c.r + 0.6917385 * c.g + 0.0792869 * c.b) < 1e-9)
    const back = rgbToDisc(c.r, c.g, c.b)
    assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9)
  }
  // Up is red, right is blue, as the vectorscope draws them.
  assert.ok(discToRgb(0, 0.1).r > 0)
  assert.ok(discToRgb(0.1, 0).b > 0)
})

test('untouched primaries compile to nothing', () => {
  assert.deepEqual(primariesOp(defaultPrimaries()), [])
  const before = JSON.stringify(ops(defaultRecipe(false)))
  const r = defaultRecipe(false)
  r.primaries = normalisePrimaries({})
  assert.equal(JSON.stringify(ops(r)), before)
})

test('Offset folds into lift and gain: the same as adding it after them', () => {
  const p = defaultPrimaries()
  p.lift = { y: 0.05, r: 0.02, g: 0, b: 0 }
  p.gain = { y: 1.2, r: 1, g: 0.9, b: 1 }
  p.offset = { y: 0.03, r: 0, g: 0, b: -0.01 }
  const op = (primariesOp(p)[0] as { Primary: Primary }).Primary
  const run = (v: number, c: 'r' | 'g' | 'b'): number => op.lift[c] + v * (op.gain[c] - op.lift[c])
  for (const c of ['r', 'g', 'b'] as const)
    for (const v of [0, 0.3, 0.8, 1]) {
      const l = p.lift.y + p.lift[c]
      const g = p.gain.y * p.gain[c]
      const want = l + v * (g - l) + p.offset.y + p.offset[c]
      assert.ok(Math.abs(run(v, c) - want) < 1e-3, `${c} at ${v}`)
    }
})

test('the primaries run in the look stage after Colour grading, Temp and Tint a gain balance just before them (E75)', () => {
  const r = defaultRecipe(false)
  r.colorGrade.global = { hue: 30, saturation: 20, luminance: 0 }
  r.primaries.saturation = 60
  r.primaries.temp = 20
  const stages = compile(r, ctx).grade!.layers[0].stages
  // Nothing in linear light any more (the photo's own white is as shot).
  assert.ok(stages.every((s) => s.space !== 'LinearWorking'))
  const ops = stages.at(-1)!.ops
  const look = ops.map((o) => Object.keys(o)[0])
  const grade = look.indexOf('ColorGrade')
  const prim = look.lastIndexOf('Primary')
  assert.ok(grade >= 0 && prim > grade, look.join(' '))
  assert.equal(look[prim - 1], 'GainBalance')
  const gb = (ops[prim - 1] as { GainBalance: GainBalance }).GainBalance
  const w = opFromRelative(20, 0)
  assert.deepEqual(gb, {
    temperature_kelvin: Math.round(w.kelvin * 1e4) / 1e4,
    tint: 0,
    hold_luminance: true
  })
  assert.equal(primariesBalance(defaultPrimaries()), null)
})

test('Temp and Tint stay inside Display P3 at a mask’s Amount of 200, pulled toward neutral as little as that takes', () => {
  for (const temp of [-200, -100, 0, 100, 200])
    for (const tint of [-200, -100, 0, 100, 200]) {
      const p = { ...defaultPrimaries(), temp, tint }
      const op = primariesBalance(p)
      if (temp === 0 && tint === 0) {
        assert.equal(op, null)
        continue
      }
      const gb = (op as { GainBalance: GainBalance }).GainBalance
      assert.ok(gb.temperature_kelvin >= 1667 && gb.temperature_kelvin <= 25000)
      assert.ok(Math.abs(gb.tint) <= 0.1)
      // Each channel of the white in P3 above 0, as the engine requires.
      const rgb = apply(invert(rgbToXyz(P3)), whiteXyz(gb.temperature_kelvin, gb.tint))
      assert.ok(
        rgb.every((c) => c > 0),
        `${temp}/${tint}: ${gb.temperature_kelvin} K ${gb.tint}`
      )
      // Inside the sliders' own range, the white is the white balance's own.
      if (Math.abs(temp) <= 100 && Math.abs(tint) <= 100) {
        const w = opFromRelative(temp, tint)
        assert.ok(Math.abs(gb.tint - w.tint) < 2e-4, `${temp}/${tint}: tint ${gb.tint}`)
      }
    }
  // The corner Display P3 cannot hold keeps its warmth and gives up tint.
  const corner = (
    primariesBalance({ ...defaultPrimaries(), temp: -200, tint: 200 }) as {
      GainBalance: GainBalance
    }
  ).GainBalance
  assert.ok(Math.abs(corner.temperature_kelvin - opFromRelative(-200, 0).kelvin) < 1)
  assert.ok(corner.tint > 0.01 && corner.tint < 100 / 3000)
})

test('Lum Mix at 0 is the one Primary it always was; above 0 the Y rings are a LumaPrimary (E78)', () => {
  const p = defaultPrimaries()
  p.lift = { y: 0.05, r: 0.02, g: 0, b: 0 }
  p.gamma = { y: 0.2, r: 0, g: 0, b: -0.1 }
  p.gain = { y: 1.1, r: 1, g: 0.95, b: 1 }
  p.offset = { y: 0.01, r: 0, g: 0, b: 0 }
  p.contrast = 1.2
  p.saturation = 55
  const folded = primariesOp(p)
  assert.equal(folded.length, 1)
  const one = (folded[0] as { Primary: Primary }).Primary
  assert.equal(one.lift.r, 0.08)
  assert.equal(one.contrast, 1.2)
  // Normalised, an old recipe has none.
  assert.equal(normalisePrimaries({}).lumMix, 0)
  assert.equal(normalisePrimaries({ lumMix: 250 }).lumMix, 100)

  p.lumMix = 100
  const ops = primariesOp(p)
  assert.deepEqual(
    ops.map((o) => Object.keys(o)[0]),
    ['Primary', 'LumaPrimary', 'Primary']
  )
  const wheels = (ops[0] as { Primary: Primary }).Primary
  // The wheels' own colour and the Offset, no Y.
  assert.deepEqual(wheels.lift, { r: 0.03, g: 0.01, b: 0.01 })
  assert.deepEqual(wheels.gain, { r: 1.01, g: 0.96, b: 1.01 })
  assert.equal(wheels.gamma.r, 1)
  assert.equal(wheels.contrast, 1)
  assert.deepEqual(ops[1], {
    LumaPrimary: { lift: 0.05, gamma: Math.round(2 ** 0.15 * 1e4) / 1e4, gain: 1.1, mix: 1 }
  })
  const after = (ops[2] as { Primary: Primary }).Primary
  assert.equal(after.contrast, 1.2)
  assert.equal(after.saturation, 1.1)
  assert.deepEqual(after.lift, { r: 0, g: 0, b: 0 })
  // No Y ring moved: Lum Mix has nothing to mix, the one Primary as at 0.
  const noY = {
    ...p,
    lift: { ...p.lift, y: 0 },
    gamma: { ...p.gamma, y: 0 },
    gain: { ...p.gain, y: 1 }
  }
  assert.deepEqual(primariesOp(noY), primariesOp({ ...noY, lumMix: 0 }))
  // A mask's Amount leaves it as set; it compiles in the look stage.
  assert.equal(scaleSettings({ ...neutralSettings(), primaries: p }, 50).primaries.lumMix, 100)
  const r = defaultRecipe(false)
  r.primaries = p
  assert.ok(
    ops.length > 0 && ops.every((o) => JSON.stringify(compile(r, ctx)).includes(JSON.stringify(o)))
  )
})

test('a mask carries primaries, scaled by its Amount; switched off they compile as defaults', () => {
  const s = neutralSettings()
  s.primaries.lift = { y: 0.1, r: 0, g: 0, b: 0 }
  s.primaries.gain = { y: 2, r: 1, g: 1, b: 1 }
  s.primaries.saturation = 70
  const half = scaleSettings(s, 50).primaries
  assert.ok(Math.abs(half.lift.y - 0.05) < 1e-9)
  assert.ok(Math.abs(half.gain.y - Math.SQRT2) < 1e-9)
  assert.equal(half.saturation, 60)
  assert.deepEqual(primariesOp(scaleSettings(s, 0).primaries), [])

  const r = defaultRecipe(false)
  r.primaries.contrast = 1.3
  setSectionOff(r, 'primaries', true)
  assert.equal(effective(r, false).primaries.contrast, 1)
})

test('a hue curve wraps across red with no seam; the others hold level past their ends', async () => {
  const { vsPoints } = await import('../src/shared/resolve')
  const pts = [
    { x: 0.1, y: 0.7 },
    { x: 0.8, y: 0.4 }
  ]
  const w = vsPoints(pts, true)
  assert.equal(w[0].x, 0)
  assert.equal(w[w.length - 1].x, 1)
  assert.equal(w[0].y, w[w.length - 1].y)
  // Between 0.4 (at 0.8) and 0.7 (at 1.1), a third of the way along at 1.0.
  assert.ok(Math.abs(w[0].y - (0.4 + (0.3 * 0.2) / 0.3)) < 1e-9)
  const l = vsPoints(pts, false)
  assert.deepEqual([l[0].y, l[l.length - 1].y], [0.7, 0.4])
  // Red at either end is kept, just inside.
  assert.ok(vsPoints([{ x: 0, y: 0.8 }], true).every((p) => p.y === 0.8))
})

test('the vs curves compile to one Curves op, all five (engine 0.21: E71, E72)', async () => {
  const { curvesVsOp } = await import('../src/shared/resolve')
  const r = defaultRecipe(false)
  assert.equal(curvesVsOp(r.curvesVs), null)
  r.curvesVs.hueHue = [{ x: 0.5, y: 0.75 }]
  r.curvesVs.lumSat = [
    { x: 0.2, y: 0.25 },
    { x: 0.8, y: 0.5 }
  ]
  r.curvesVs.hueLum = [
    { x: 0.3, y: 0.75 },
    { x: 0.6, y: 0.4 }
  ]
  r.curvesVs.satSat = [{ x: 0.5, y: 0.5 }]
  const op = curvesVsOp(r.curvesVs)
  const c = (op as { Curves: import('../src/shared/engine-types').Curves }).Curves
  assert.ok(
    c.hue_vs_hue!.points.every((p) => p.y === 90),
    'a quarter up is +90°'
  )
  assert.equal(c.luma_vs_saturation!.points[0].y, 0.5, 'a quarter down halves saturation')
  assert.equal(c.hue_vs_saturation, null)
  // Hue vs Lum in stops, ±1 at the top and bottom: a quarter up is half a
  // stop; the curve wraps across red with its ends equal.
  const lum = c.hue_vs_luma!.points
  assert.equal(lum.find((p) => p.x === 0.3)!.y, 0.5)
  assert.equal(lum.find((p) => p.x === 0.6)!.y, -0.2)
  assert.equal(lum[0].x, 0)
  assert.equal(lum.at(-1)!.x, 1)
  assert.equal(lum[0].y, lum.at(-1)!.y)
  // A flat Sat vs Sat sends none.
  assert.equal(c.saturation_vs_saturation, null)
  assert.deepEqual(compile(r, ctx).notes, [])
  assert.ok(ops(r).some((o) => 'Curves' in o && o.Curves.hue_vs_hue && o.Curves.hue_vs_luma))
})

test('Sat vs Sat is a multiplier, its ends held level; Hue vs Lum alone makes the op', async () => {
  const { curvesVsOp, VS_PRESETS, defaultCurvesVs } = await import('../src/shared/resolve')
  const c = defaultCurvesVs()
  c.satSat = VS_PRESETS.satSat.find((p) => p.name === 'Tame strong colour')!.points
  const sat = (curvesVsOp(c) as { Curves: import('../src/shared/engine-types').Curves }).Curves
    .saturation_vs_saturation!.points
  assert.equal(sat.at(-1)!.y, 0.76, 'the richest colours at 0.76×')
  assert.equal(sat[0].y, 1)
  assert.deepEqual([sat[0].x, sat.at(-1)!.x], [0, 1])
  const lumOnly = defaultCurvesVs()
  lumOnly.hueLum = [{ x: 0.6, y: 0.25 }]
  const op = curvesVsOp(lumOnly) as { Curves: import('../src/shared/engine-types').Curves }
  assert.ok(op.Curves.hue_vs_luma!.points.every((p) => p.y === -0.5))
  assert.equal(op.Curves.hue_vs_hue, null)
})

test('a black-and-white photo keeps its vs curves but does not apply them; a mask’s feed the mix', () => {
  const r = defaultRecipe(false)
  r.treatment = 'bw'
  r.curvesVs.hueSat = [{ x: 0.6, y: 0.8 }]
  r.curvesVs.hueLum = [{ x: 0.6, y: 0.2 }]
  assert.ok(
    !ops(r).some((o) => 'Curves' in o && (o.Curves.hue_vs_saturation || o.Curves.hue_vs_luma))
  )
  assert.equal(normaliseRecipe(r, false).curvesVs.hueLum.length, 1)
  const l = newLocalLayer('Sky')
  l.components = [
    {
      id: 'c1',
      kind: 'linear',
      mode: 'add',
      opacity: 100,
      invert: false,
      start: { x: 0.5, y: 0 },
      end: { x: 0.5, y: 0.4 },
      width: 512,
      height: 512
    } as never
  ]
  l.settings.curvesVs.hueLum = [{ x: 0.6, y: 0.2 }]
  r.layers = [l]
  const c = compile(normaliseRecipe(r, false), ctx)
  const mask = c.grade!.layers[c.layerIndex[l.id]].stages.flatMap((s) => s.ops)
  assert.ok(mask.some((o) => 'Curves' in o && o.Curves.hue_vs_luma))
  // …and run before the mono conversion, the last layer.
  assert.equal(c.grade!.layers.at(-1)!.name, 'black & white')
})

test('log wheels are one LogWheels op in a PixlLog stage of their own, untouched none (E74, E73)', async () => {
  const { LOG_HIGH, LOG_LOW, LOG_TRANSITION, logWheelsOps, normaliseLogWheels, toPixlLog } =
    await import('../src/shared/resolve')
  const { LOG_GRADE_SPACE, LOOK_SPACE } = await import('../src/shared/compile')
  const l = normaliseLogWheels({})
  assert.deepEqual(logWheelsOps(l), [])
  // Resolve's ACEScct defaults at the same stops from grey: 1.41 under, 2.39 over.
  assert.equal(LOG_LOW, 0.268)
  assert.equal(LOG_HIGH, 0.66)
  assert.ok(Math.abs(toPixlLog(0.18) - 0.405) < 1e-3)
  assert.ok(Math.abs(toPixlLog(1) - 0.669) < 1e-3)
  assert.ok(Math.abs(toPixlLog(0.18 * 2 ** -1.4119) - LOG_LOW) < 1e-3)

  l.shadow = { y: 0.01, r: 0.02, g: 0, b: -0.02 }
  l.offset = { y: 0.01, r: 0, g: 0, b: 0 }
  const ops = logWheelsOps(l)
  assert.equal(ops.length, 1)
  const w = (ops[0] as { LogWheels: import('../src/shared/engine-types').LogWheels }).LogWheels
  // Y folds into each channel.
  assert.deepEqual(w.shadow, { r: 0.03, g: 0.01, b: -0.01 })
  assert.deepEqual(w.offset, { r: 0.01, g: 0.01, b: 0.01 })
  assert.deepEqual(w.midtone, { r: 0, g: 0, b: 0 })
  assert.deepEqual([w.low_range, w.high_range, w.transition], [LOG_LOW, LOG_HIGH, LOG_TRANSITION])
  // The engine's rule, low + t ≤ high − t, holds however close the sliders go.
  const n = normaliseLogWheels({ low: 0.8, high: 0.5 })
  assert.ok(n.low + LOG_TRANSITION < n.high - LOG_TRANSITION)
  const tight = logWheelsOps({ ...l, low: 0.5, high: 0.52 })[0] as {
    LogWheels: import('../src/shared/engine-types').LogWheels
  }
  const t = tight.LogWheels
  assert.ok(t.low_range + t.transition < t.high_range - t.transition, JSON.stringify(t))

  // Compiled: P3, then PixlLog for the wheels, then P3 again for what follows.
  const r = defaultRecipe(false)
  r.primaries.contrast = 1.2
  r.logWheels = { ...l }
  r.curvesVs.hueSat = [{ x: 0.6, y: 0.8 }]
  r.effects.vignetteAmount = -20
  const stages = compile(r, ctx).grade!.layers[0].stages
  assert.deepEqual(
    stages.map((s) => s.space),
    [LOOK_SPACE, LOG_GRADE_SPACE, LOOK_SPACE]
  )
  assert.deepEqual(
    stages[1].ops.map((o) => Object.keys(o)[0]),
    ['LogWheels']
  )
  assert.ok(stages[2].ops.some((o) => 'Curves' in o))
  assert.ok(stages[2].ops.some((o) => 'Vignette' in o))
  // Contrast stays display-referred, in the Primary before the wheels.
  const prim = stages[0].ops.find((o) => 'Primary' in o) as { Primary: Primary }
  assert.equal(prim.Primary.contrast, 1.2)
  assert.equal(prim.Primary.contrast_pivot, 0.435)
  // Contrast alone makes no log stage.
  r.logWheels = normaliseLogWheels({})
  assert.ok(compile(r, ctx).grade!.layers[0].stages.every((s) => s.space !== LOG_GRADE_SPACE))
})

test('a mask’s log wheels get their own log stage too; a black-and-white photo’s run after the mono conversion', async () => {
  const { LOG_GRADE_SPACE, LOOK_SPACE } = await import('../src/shared/compile')
  const r = defaultRecipe(false)
  const l = newLocalLayer('Sky')
  l.components = [
    {
      id: 'c1',
      kind: 'linear',
      mode: 'add',
      opacity: 100,
      invert: false,
      start: { x: 0.5, y: 0 },
      end: { x: 0.5, y: 0.4 },
      width: 512,
      height: 512
    } as never
  ]
  l.settings.logWheels.highlight = { y: 0, r: 0, g: 0, b: 0.02 }
  l.settings.presence.saturation = 10
  r.layers = [l]
  r.treatment = 'bw'
  r.logWheels.midtone = { y: 0, r: 0.01, g: 0, b: 0 }
  const c = compile(normaliseRecipe(r, false), ctx)
  const mask = c.grade!.layers[c.layerIndex[l.id]]
  assert.deepEqual(
    mask.stages.map((s) => s.space),
    [LOOK_SPACE, LOG_GRADE_SPACE]
  )
  // The photo's own, after the conversion in the black & white layer: they tone it.
  const finish = c.grade!.layers.at(-1)!
  assert.equal(finish.name, 'black & white')
  const kinds = finish.stages.map((s) => s.ops.map((o) => Object.keys(o)[0]))
  assert.deepEqual(
    finish.stages.map((s) => s.space),
    [LOOK_SPACE, LOG_GRADE_SPACE]
  )
  assert.ok(kinds[0].includes('Primary') && kinds[1][0] === 'LogWheels', JSON.stringify(kinds))
})

test('an older recipe’s log ranges are carried to the same tones; Resolve’s defaults to the new ones', async () => {
  const { LOG_HIGH, LOG_LOW, logRangeBefore021, toPixlLog } = await import('../src/shared/resolve')
  const old = normaliseRecipe({ version: 5, logWheels: { low: 0.333, high: 0.55 } }, false)
  assert.deepEqual([old.logWheels.low, old.logWheels.high], [LOG_LOW, LOG_HIGH])
  // Moved ranges: display-encoded 0.2 is 3.3% light, 0.7 is 44.8%.
  const moved = normaliseRecipe(
    {
      version: 5,
      logWheels: { low: 0.2, high: 0.7, shadow: { y: 0.01, r: 0, g: 0, b: 0 } },
      layers: [{ id: 'm', settings: { logWheels: { low: 0.333, high: 0.55 } } }]
    },
    false
  )
  assert.ok(Math.abs(moved.logWheels.low - toPixlLog(0.0331)) < 2e-3, `${moved.logWheels.low}`)
  assert.ok(Math.abs(moved.logWheels.high - toPixlLog(0.448)) < 2e-3, `${moved.logWheels.high}`)
  assert.equal(moved.logWheels.shadow.y, 0.01)
  assert.deepEqual(
    [moved.layers[0].settings.logWheels.low, moved.layers[0].settings.logWheels.high],
    [LOG_LOW, LOG_HIGH]
  )
  // None saved: the defaults; a recipe from 6 on is taken as it is.
  assert.equal(logRangeBefore021(undefined), null)
  assert.equal(normaliseRecipe({ version: 5 }, false).logWheels.low, LOG_LOW)
  assert.equal(
    normaliseRecipe({ version: 6, logWheels: { low: 0.333, high: 0.55 } }, false).logWheels.low,
    0.333
  )
})

test('each qualifier is its own layer after the photo’s grade, its key the layer’s Range mask', async () => {
  const { qualifierFromSample, qualifierKey, qualifierLayerId, normaliseQualifiers } =
    await import('../src/shared/resolve')
  const r = defaultRecipe(false)
  r.presence.saturation = 10
  const q = qualifierFromSample('q1', { hue: 210, saturation: 0.5, luminance: 0.6 })
  q.gain = { y: 1, r: 1, g: 1, b: 1.2 }
  const grey = qualifierFromSample('q2', { hue: 0, saturation: 0.02, luminance: 0.5 })
  r.qualifiers = [q, grey]
  r.layers.push(newLocalLayer('Mask'))
  const c = compile(r, ctx)
  const i = c.layerIndex[qualifierLayerId('q1')]
  assert.equal(i, 1, 'right after the base layer')
  const layer = c.grade!.layers[i]
  const shape = layer.mask!.components[0].shape
  assert.ok('Range' in shape)
  assert.deepEqual(shape.Range, qualifierKey(q))
  assert.ok(
    layer.stages.flatMap((s) => s.ops).some((o) => 'Primary' in o && o.Primary.gain.b === 1.2)
  )
  // A grey has no hue to key on; it is still a layer, to look at its key.
  assert.equal(qualifierKey(grey)!.hue, null)
  assert.equal(c.layerIndex[qualifierLayerId('q2')], 2)
  // Switched off, it is still there (its key can be looked at), only not applied.
  r.qualifiers[0].enabled = false
  assert.equal(compile(r, ctx).grade!.layers[1].enabled, false)
  // Saved ones are made whole; duplicates and strays dropped.
  assert.equal(normaliseQualifiers([q, q, { nope: 1 }]).length, 1)
})

test('a mask’s qualifier keys only inside the mask, inverted masks too', async () => {
  const { qualifierFromSample, qualifierLayerId } = await import('../src/shared/resolve')
  const r = defaultRecipe(false)
  const l = newLocalLayer('Sky')
  l.components = [
    {
      id: 'c1',
      kind: 'linear',
      mode: 'add',
      opacity: 100,
      invert: false,
      start: { x: 0.5, y: 0 },
      end: { x: 0.5, y: 0.4 },
      width: 512,
      height: 512
    } as never
  ]
  l.settings.qualifiers = [qualifierFromSample('mq', { hue: 210, saturation: 0.4, luminance: 0.6 })]
  r.layers = [l]
  const c = compile(normaliseRecipe(r, false), ctx)
  const maskIndex = c.layerIndex[l.id]
  const qi = c.layerIndex[qualifierLayerId('mq')]
  assert.equal(qi, maskIndex + 1, 'right after its mask')
  const own = c.grade!.layers[maskIndex].mask!
  const m = c.grade!.layers[qi].mask!
  assert.equal(m.components.length, own.components.length + 1)
  const key = m.components[m.components.length - 1]
  assert.ok('Range' in key.shape)
  assert.equal(key.mode, 'Intersect')
  assert.equal(m.invert, false)
  // Inverted: NOT(mask ∪ NOT key).
  l.invert = true
  const ci = compile(normaliseRecipe(r, false), ctx)
  const mi = ci.grade!.layers[ci.layerIndex[qualifierLayerId('mq')]].mask!
  const ki = mi.components[mi.components.length - 1]
  assert.equal(ki.mode, 'Add')
  assert.equal(ki.invert, true)
  assert.equal(mi.invert, true)
})

test('the vs curves’ presets: each a curve the recipe keeps as written, Flat first', async () => {
  const { VS_PRESETS, VS_CURVES, normaliseCurvesVs, sameVs, curvesVsOp, defaultCurvesVs } =
    await import('../src/shared/resolve')
  for (const vs of VS_CURVES) {
    const list = VS_PRESETS[vs]
    assert.equal(list[0].points.length, 0, `${vs} starts with Flat`)
    assert.equal(new Set(list.map((p) => p.name)).size, list.length)
    for (const p of list) {
      const kept = normaliseCurvesVs({ [vs]: p.points })[vs]
      assert.ok(sameVs(kept, p.points), `${vs} ${p.name} survives normalising`)
      // Gentle: no point far from untouched.
      assert.ok(
        p.points.every((q) => Math.abs(q.y - 0.5) <= 0.2),
        `${vs} ${p.name} is gentle`
      )
    }
  }
  // Every built-in compiles into the engine's Curves op.
  for (const vs of VS_CURVES)
    for (const p of VS_PRESETS[vs].slice(1)) {
      const c = defaultCurvesVs()
      c[vs] = p.points
      assert.ok(curvesVsOp(c), `${vs} ${p.name}`)
    }
})
