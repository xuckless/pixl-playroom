import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, scaleSettings, type CompileContext } from '../src/shared/compile'
import {
  defaultRecipe,
  neutralSettings,
  newLocalLayer,
  normaliseRecipe
} from '../src/shared/recipe'
import { CARDS, cardShows } from '../src/shared/cards'
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

test('each colour card belongs to one set, and the rest show with both', () => {
  const lightroom = CARDS.filter((c) => cardShows(c, 'lightroom')).map((c) => c.id)
  const resolve = CARDS.filter((c) => cardShows(c, 'resolve')).map((c) => c.id)
  assert.ok(lightroom.includes('grading') && !lightroom.includes('primaries'))
  assert.ok(resolve.includes('primaries') && !resolve.includes('grading'))
  for (const id of ['wb', 'light', 'detail', 'effects'] as const)
    assert.ok(lightroom.includes(id) && resolve.includes(id), id)
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
