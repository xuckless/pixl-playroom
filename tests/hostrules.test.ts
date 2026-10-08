// Engine 0.18's host rules (HR-0.18-6 to 9): a saved look's values stay
// numbers, and an Invariant the engine still finds is named, not hidden.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calibrationMatrix,
  compile,
  MIXER_ROW_MAX,
  type CompileContext
} from '../src/shared/compile'
import { defaultRecipe, newLocalLayer, normaliseRecipe } from '../src/shared/recipe'
import { displayPeak } from '../src/shared/export'
import type { Grade, GradeOp, Primary } from '../src/shared/engine-types'
import {
  describeInvariant,
  invariantDetail,
  invariantPlace,
  invariantTouches
} from '../src/shared/invariant'
import { readPath } from '../src/renderer/src/lib/readpath'

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 6000,
  frameHeight: 4000,
  scale: 1,
  seed: 7,
  brushPaths: {},
  applyCrop: true
}

const polygon = {
  id: 'p',
  kind: 'polygon' as const,
  mode: 'Add' as const,
  invert: false,
  feather: 10,
  opacity: 100,
  points: [
    { x: 0.2, y: 0.2 },
    { x: 0.8, y: 0.2 },
    { x: 0.5, y: 0.8 }
  ]
}

const allOps = (g: Grade | null, layer: number): GradeOp[] =>
  g!.layers[layer].stages.flatMap((s) => s.ops)

test('HR-0.18-6: a mask at Amount 200 with Contrast −100 sends no negative contrast', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(polygon)
  l.settings.basic.contrast = -100
  l.amount = 200
  r.layers.push(l)
  const c = compile(r, ctx)
  const contrasts = allOps(c.grade, c.layerIndex[l.id])
    .filter((o): o is { Primary: Primary } => 'Primary' in o)
    .map((o) => o.Primary.contrast)
  assert.ok(contrasts.length > 0)
  assert.ok(contrasts.every((k) => k >= 0))
})

test('HR-0.18-7: Calibration past its sliders (a mask at Amount 200) stays a sane matrix', () => {
  // The scan's worst case, doubled by Amount: 533 009 before the bound.
  const doubled = {
    shadowsTint: 0,
    redHue: -200,
    redSaturation: -20,
    greenHue: 200,
    greenSaturation: 180,
    blueHue: -180,
    blueSaturation: -120
  }
  const m = calibrationMatrix(doubled)!
  const big = Math.max(...m.flatMap((r) => [Math.abs(r.r), Math.abs(r.g), Math.abs(r.b)]))
  assert.ok(big <= MIXER_ROW_MAX, `row ${big}`)
  // The same as the sliders' own ends.
  assert.deepEqual(
    m,
    calibrationMatrix({
      ...doubled,
      redHue: -100,
      greenHue: 100,
      greenSaturation: 100,
      blueHue: -100,
      blueSaturation: -100
    })
  )
})

test('HR-0.18-7: saved Calibration is held to ±100 on load, in the photo and its masks', () => {
  const r = normaliseRecipe(
    {
      calibration: { redHue: 250, blueSaturation: -999 },
      layers: [{ id: 'a', settings: { calibration: { greenHue: 140 } } }]
    },
    false
  )
  assert.equal(r.calibration.redHue, 100)
  assert.equal(r.calibration.blueSaturation, -100)
  assert.equal(r.layers[0].settings.calibration.greenHue, 100)
})

test('HR-0.18-8: an HDR peak is a display’s, 100–10 000 cd/m²', () => {
  assert.equal(displayPeak(4), 100)
  assert.equal(displayPeak(1000), 1000)
  assert.equal(displayPeak(40000), 10000)
  assert.equal(displayPeak(Number.NaN), 1000)
})

test('HR-0.18-9: an Invariant names the mask and the op, in the request’s own indices', () => {
  const r = defaultRecipe(false)
  r.presence.dehaze = 50
  const l = newLocalLayer('Sky')
  l.components.push(polygon)
  l.settings.basic.highlights = -80
  r.layers.push(l)
  const c = compile(r, ctx)
  const index = c.layerIndex[l.id]
  const stages = c.grade!.layers[index].stages
  const s = stages.findIndex((st) => st.ops.some((o) => 'Tone' in o))
  const o = stages[s].ops.findIndex((op) => 'Tone' in op)
  const text = `grade.layers[${index}].stages[${s}].ops[${o}]: +∞ at pixel (924, 48) channel 0; 9 sample(s) not finite`
  const place = invariantPlace(text, c.grade, null, c.layerIndex)!
  assert.deepEqual(place, { layer: l.id, layerName: 'Sky', op: 'Tone', sdr: false })
  assert.equal(
    describeInvariant(place, 'grade'),
    'Highlights, Shadows, Whites or Blacks in “Sky” made pixels that are not numbers. Lower it, or undo.'
  )
  assert.ok(invariantTouches(place, 'basic.highlights'))
  assert.ok(!invariantTouches(place, 'presence.dehaze'))
})

test('HR-0.18-9: the photo’s own settings, a layer’s blend, and a stage outside the grade', () => {
  const r = defaultRecipe(false)
  r.presence.dehaze = 50
  const c = compile(r, ctx)
  const stages = c.grade!.layers[0].stages
  const s = stages.findIndex((st) => st.ops.some((op) => 'Dehaze' in op))
  const o = stages[s].ops.findIndex((op) => 'Dehaze' in op)
  const own = invariantPlace(`grade.layers[0].stages[${s}].ops[${o}]: NaN`, c.grade, null, {})!
  assert.equal(own.layer, 'base')
  assert.match(describeInvariant(own, 'grade'), /^Dehaze in the photo’s settings/)
  const blend = invariantPlace('grade.layers[0]: NaN at pixel (1, 1)', c.grade, null, {})!
  assert.equal(blend.op, null)
  assert.match(describeInvariant(blend, 'grade'), /^The layer’s blend/)
  assert.equal(invariantPlace('decode: NaN at pixel (0, 0)', c.grade, null, {}), null)
  assert.match(describeInvariant(null, 'decode'), /after decode/)
  const d = invariantDetail({ Invariant: { stage: 'grade', detail: 'x' } })
  assert.deepEqual(d, { stage: 'grade', text: 'x' })
})

test('a slider’s getter names the recipe field it reads', () => {
  type R = { hsl: Record<string, Record<string, number>>; basic: { exposure: number } }
  const b = 'blue'
  const axis = 'luminance'
  assert.equal(
    readPath((r: R) => r.hsl[b][axis]),
    'hsl.blue.luminance'
  )
  assert.equal(
    readPath((r: R) => r.basic.exposure * 10),
    'basic.exposure'
  )
})
