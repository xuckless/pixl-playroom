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
  primariesOp,
  rgbToDisc
} from '../src/shared/resolve'
import type { GradeOp, Primary } from '../src/shared/engine-types'

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
  assert.equal(primariesOp(defaultPrimaries()), null)
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
  const op = (primariesOp(p) as { Primary: Primary }).Primary
  const run = (v: number, c: 'r' | 'g' | 'b'): number => op.lift[c] + v * (op.gain[c] - op.lift[c])
  for (const c of ['r', 'g', 'b'] as const)
    for (const v of [0, 0.3, 0.8, 1]) {
      const l = p.lift.y + p.lift[c]
      const g = p.gain.y * p.gain[c]
      const want = l + v * (g - l) + p.offset.y + p.offset[c]
      assert.ok(Math.abs(run(v, c) - want) < 1e-3, `${c} at ${v}`)
    }
})

test('the primaries run in the look stage after Colour grading; Temp and Tint in linear light', () => {
  const r = defaultRecipe(false)
  r.colorGrade.global = { hue: 30, saturation: 20, luminance: 0 }
  r.primaries.saturation = 60
  r.primaries.temp = 20
  const stages = compile(r, ctx).grade!.layers[0].stages
  const look = stages.find((s) => typeof s.space !== 'string')!.ops.map((o) => Object.keys(o)[0])
  const grade = look.indexOf('ColorGrade')
  const prim = look.lastIndexOf('Primary')
  assert.ok(grade >= 0 && prim > grade, look.join(' '))
  const lin = stages.find((s) => s.space === 'LinearWorking')!.ops.map((o) => Object.keys(o)[0])
  assert.ok(lin.includes('WhiteBalance'), lin.join(' '))
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
  assert.equal(primariesOp(scaleSettings(s, 0).primaries), null)

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

test('the vs curves compile to one Curves op; the two the engine lacks wait in the notes', async () => {
  const { curvesVsOp } = await import('../src/shared/resolve')
  const r = defaultRecipe(false)
  assert.equal(curvesVsOp(r.curvesVs).op, null)
  r.curvesVs.hueHue = [{ x: 0.5, y: 0.75 }]
  r.curvesVs.lumSat = [
    { x: 0.2, y: 0.25 },
    { x: 0.8, y: 0.5 }
  ]
  r.curvesVs.hueLum = [{ x: 0.3, y: 0.6 }]
  const { op, waiting } = curvesVsOp(r.curvesVs)
  const c = (op as { Curves: import('../src/shared/engine-types').Curves }).Curves
  assert.ok(
    c.hue_vs_hue!.points.every((p) => p.y === 90),
    'a quarter up is +90°'
  )
  assert.equal(c.luma_vs_saturation!.points[0].y, 0.5, 'a quarter down halves saturation')
  assert.equal(c.hue_vs_saturation, null)
  assert.deepEqual(waiting, ['hueLum'])
  const notes = compile(r, ctx).notes
  assert.ok(
    notes.some((n) => n.includes('E71')),
    notes.join(' | ')
  )
  assert.ok(ops(r).some((o) => 'Curves' in o && o.Curves.hue_vs_hue))
})

test('log wheels key their own part of the tones, and add rather than scale', async () => {
  const { logBand, logWheelsOps, normaliseLogWheels } = await import('../src/shared/resolve')
  const l = normaliseLogWheels({})
  assert.deepEqual(logWheelsOps(l), [])
  // Each band covers its range fully, within low/high.
  const s = logBand('shadow', 0.333, 0.55)
  assert.ok(Math.abs(s.centre + s.width / 2 - 0.333) < 1e-3)
  const m = logBand('midtone', 0.333, 0.55)
  assert.ok(Math.abs(m.centre - m.width / 2 - 0.333) < 1e-3)
  assert.ok(Math.abs(m.centre + m.width / 2 - 0.55) < 1e-3)
  const h = logBand('highlight', 0.333, 0.55)
  assert.ok(Math.abs(h.centre - h.width / 2 - 0.55) < 1e-3)

  l.shadow = { y: 0, r: 0.02, g: 0, b: -0.02 }
  l.offset = { y: 0.01, r: 0, g: 0, b: 0 }
  const ops = logWheelsOps(l)
  assert.equal(ops.length, 2)
  const q = (ops[0] as { Qualifier: { correction: Primary } }).Qualifier.correction
  // v + o: lift o and gain 1 + o.
  assert.equal(q.lift.r, 0.02)
  assert.equal(q.gain.r, 1.02)
  assert.equal(q.gain.b, 0.98)
  // The range sliders keep low under high.
  const n = normaliseLogWheels({ low: 0.8, high: 0.5 })
  assert.ok(n.high > n.low)
})

test('each qualifier is an op in the base layer’s look, before the effects, addressed for its key view', async () => {
  const { qualifierFromSample, qualifierKey, qualifierLayerId, normaliseQualifiers } =
    await import('../src/shared/resolve')
  const { maskProbe, probeInspect } = await import('../src/shared/compile')
  const r = defaultRecipe(false)
  r.presence.saturation = 10
  r.effects.grainAmount = 30
  r.effects.vignetteAmount = -20
  // A point colour is a Qualifier op too, earlier in the look: counted, not named.
  r.pointColors = [
    {
      id: 'p1',
      hue: 30,
      saturation: 0.5,
      luminance: 0.5,
      shiftHue: 10,
      shiftSat: 0,
      shiftLum: 0,
      range: 50
    }
  ]
  const q = qualifierFromSample('q1', { hue: 210, saturation: 0.5, luminance: 0.6 })
  q.gain = { y: 1, r: 1, g: 1, b: 1.2 }
  q.blur = 50
  const grey = qualifierFromSample('q2', { hue: 0, saturation: 0.02, luminance: 0.5 })
  r.qualifiers = [q, grey]
  r.layers.push(newLocalLayer('Mask'))
  const c = compile(r, ctx)
  // No layer of their own: the base and nothing after it but masks.
  assert.equal(c.grade!.layers.length, 1)
  assert.equal(c.layerIndex[qualifierLayerId('q1')], undefined)
  const look = c.grade!.layers[0].stages.flatMap((s) => s.ops)
  const quals = look.filter((o): o is Extract<GradeOp, { Qualifier: unknown }> => 'Qualifier' in o)
  assert.equal(quals.length, 3, 'the point colour and both qualifiers')
  const op = quals[1].Qualifier
  assert.deepEqual(op.key.hue, qualifierKey(q)!.hue)
  // The key's blur: up to 1% of the shorter side, in the buffer's pixels.
  assert.equal(op.key.blur_radius, Math.round(0.5 * 0.01 * 3000 * 0.5))
  assert.equal(op.correction.gain.b, 1.2)
  // Before the effects: grain never gets into a key.
  const at = look.indexOf(quals[2])
  assert.ok(at < look.findIndex((o) => 'Vignette' in o))
  assert.ok(at < look.findIndex((o) => 'Grain' in o))
  // Addressed as the engine counts them: the n-th Qualifier of its layer.
  assert.deepEqual(c.qualifierIndex[qualifierLayerId('q1')], { layer: 0, qualifier: 1 })
  assert.deepEqual(c.qualifierIndex[qualifierLayerId('q2')], { layer: 0, qualifier: 2 })
  const probe = maskProbe(c, qualifierLayerId('q1'))
  assert.deepEqual(probe, { QualifierKey: { layer: 0, qualifier: 1 } })
  assert.deepEqual(probeInspect(probe!), { QualifierKey: { layer: 0, qualifier: 1 } })
  // A grey has no hue to key on; it is still there, to look at its key.
  assert.equal(qualifierKey(grey)!.hue, null)
  // Untouched, its correction is the identity: there, so its key can be looked at.
  assert.equal(quals[2].Qualifier.correction.gain.r, 1)
  // Switched off, it is left out, and has no key to look at.
  r.qualifiers[0].enabled = false
  const off = compile(r, ctx)
  assert.equal(off.qualifierIndex[qualifierLayerId('q1')], undefined)
  assert.equal(maskProbe(off, qualifierLayerId('q1')), null)
  assert.deepEqual(off.qualifierIndex[qualifierLayerId('q2')], { layer: 0, qualifier: 1 })
  // Saved ones are made whole; duplicates and strays dropped.
  assert.equal(normaliseQualifiers([q, q, { nope: 1 }]).length, 1)
})

test('a black-and-white photo with masks keys its qualifiers’ colours before the masks and the conversion', async () => {
  const { qualifierFromSample, qualifierLayerId } = await import('../src/shared/resolve')
  const r = defaultRecipe(false)
  r.treatment = 'bw'
  r.effects.grainAmount = 30
  const q = qualifierFromSample('q1', { hue: 210, saturation: 0.5, luminance: 0.6 })
  q.gain = { y: 1, r: 1, g: 1, b: 0.8 }
  r.qualifiers = [q]
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
  l.settings.basic.exposure = 0.5
  r.layers = [l]
  const c = compile(normaliseRecipe(r, false), ctx)
  const layers = c.grade!.layers
  // The base, the mask, then the conversion and what follows it.
  assert.equal(layers[layers.length - 1].name, 'black & white')
  // The qualifier is the base's: on the colours, as the B&W mix reads them.
  assert.deepEqual(c.qualifierIndex[qualifierLayerId('q1')], { layer: 0, qualifier: 0 })
  const finish = layers[layers.length - 1].stages.flatMap((s) => s.ops)
  assert.ok(!finish.some((o) => 'Qualifier' in o))
  assert.ok(finish.some((o) => 'Grain' in o))
})

test('a mask’s qualifier keys inside the mask’s own layer, scaled by its Amount', async () => {
  const { qualifierFromSample, qualifierLayerId } = await import('../src/shared/resolve')
  const { maskProbe } = await import('../src/shared/compile')
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
  const mq = qualifierFromSample('mq', { hue: 210, saturation: 0.4, luminance: 0.6 })
  mq.sat = 70
  l.settings.qualifiers = [mq]
  l.amount = 50
  r.layers = [l]
  const c = compile(normaliseRecipe(r, false), ctx)
  const maskIndex = c.layerIndex[l.id]
  // In the mask's own layer, which its mask (inverted or not) already bounds.
  assert.equal(c.grade!.layers.length, maskIndex + 1)
  assert.deepEqual(c.qualifierIndex[qualifierLayerId('mq')], { layer: maskIndex, qualifier: 0 })
  assert.deepEqual(maskProbe(c, l.id), { LayerMask: { layer: maskIndex } })
  const op = c
    .grade!.layers[maskIndex].stages.flatMap((s) => s.ops)
    .find((o): o is Extract<GradeOp, { Qualifier: unknown }> => 'Qualifier' in o)!
  // Amount 50: Sat 70 (1.4) halfway to 50 (1.2).
  assert.equal(op.Qualifier.correction.saturation, 1.2)
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
  // A built-in compiles into the engine's Curves op.
  const c = defaultCurvesVs()
  c.hueSat = VS_PRESETS.hueSat[1].points
  assert.ok(curvesVsOp(c).op)
})
