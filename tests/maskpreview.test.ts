import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bandWeight,
  combine,
  componentValue,
  featherRadius,
  keyValues,
  layerValue,
  planeKey,
  previewable,
  rangeWeight
} from '../src/shared/maskpreview'
import { newLocalLayer, type RadialComponent, type RangeComponent } from '../src/shared/recipe'

const near = (a: number, b: number, eps = 1e-9): void =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('components join as the engine joins them (measured on its planes)', () => {
  near(combine(0.6, 0.7, 'Add'), 0.88)
  near(combine(0.6, 0.5, 'Subtract'), 0.3)
  near(combine(0.6, 0.5, 'Intersect'), 0.3)
  // Identities: adding nothing, taking nothing, intersecting with everything.
  for (const a of [0, 0.25, 1]) {
    near(combine(a, 0, 'Add'), a)
    near(combine(a, 0, 'Subtract'), a)
    near(combine(a, 1, 'Intersect'), a)
    near(combine(a, 1, 'Add'), 1)
  }
  near(componentValue(0.8, true, 0.5), 0.1)
})

test('a key band is full in its width and eases out over its softness; hue wraps', () => {
  const b = { centre: 350, width: 40, softness: 20 }
  assert.equal(bandWeight(b, 10, 360), 1, '350 ± 20 reaches 10 across 0')
  assert.equal(bandWeight(b, 330, 360), 1)
  near(bandWeight(b, 20, 360), 0.5)
  assert.equal(bandWeight(b, 40, 360), 0)
  assert.equal(bandWeight({ centre: 0.5, width: 0.2, softness: 0 }, 0.61), 0)
})

test('a range keys HSV hue and saturation and P3 luma, band by band', () => {
  const [h, s, l] = keyValues(0.2, 0.8, 0.2)
  near(h, 120)
  near(s, 0.75)
  near(l, 0.2289 * 0.2 + 0.6917 * 0.8 + 0.0793 * 0.2)
  const green: RangeComponent = {
    id: 'g',
    kind: 'range',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    hue: { centre: 120, width: 40, softness: 20 },
    saturation: null,
    luma: null,
    smoothness: 0
  }
  assert.equal(rangeWeight(green, [0.2, 0.8, 0.2]), 1)
  assert.equal(rangeWeight(green, [0.8, 0.2, 0.2]), 0)
})

test('a layer is its components joined in order, the first always adding, then inverted', () => {
  const l = newLocalLayer('M')
  const r = (id: string, over: Partial<RadialComponent>): RadialComponent => ({
    id,
    kind: 'radial',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    centre: { x: 0.5, y: 0.5 },
    radiusX: 0.2,
    radiusY: 0.2,
    angle: 0,
    softness: 50,
    width: 512,
    height: 341,
    ...over
  })
  l.components = [r('a', { mode: 'Subtract', opacity: 60 }), r('b', { mode: 'Subtract' })]
  const at: Record<string, number> = { a: 1, b: 0.5 }
  near(
    layerValue(l, (c) => at[c.id]),
    0.3,
    1e-9
  )
  near(
    layerValue({ ...l, invert: true }, (c) => at[c.id]),
    0.7,
    1e-9
  )
  assert.equal(previewable(l), true)
  assert.equal(previewable({ ...l, components: [] }), false)
})

test("a plane's key ignores how it joins, and follows its shape and feather", () => {
  const c: RadialComponent = {
    id: 'a',
    kind: 'radial',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 10,
    centre: { x: 0.5, y: 0.5 },
    radiusX: 0.2,
    radiusY: 0.2,
    angle: 0,
    softness: 50,
    width: 512,
    height: 341
  }
  assert.equal(
    planeKey(c),
    planeKey({ ...c, id: 'b', mode: 'Subtract', opacity: 20, invert: true })
  )
  assert.notEqual(planeKey(c), planeKey({ ...c, feather: 11 }))
  assert.notEqual(planeKey(c), planeKey({ ...c, centre: { x: 0.51, y: 0.5 } }))
  near(featherRadius(c), 0.01)
})
