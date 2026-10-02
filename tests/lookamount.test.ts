import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monotone } from '../src/shared/curves'
import { applyFields, defaultRecipe, sameValue, type Recipe } from '../src/shared/recipe'
import { LOOKS, LOOK_BY_ID } from '../src/shared/looks/catalog'
import { applyLook, lookFields } from '../src/shared/looks/apply'
import { blendLook } from '../src/shared/looks/amount'
import { rangeOf } from '../src/shared/looks/ranges'

const wb = { isRaw: false, asShot: null }
const on = (before: Recipe, id: string): { after: Recipe; fields: string[][] } => {
  const after = applyLook(before, LOOK_BY_ID.get(id)!, { wb, lensResolved: 'keep' })
  return { after, fields: lookFields(before, after) }
}

/** A photo with edits of its own, under and beside what a look sets. */
function photo(): Recipe {
  const r = defaultRecipe(false)
  r.basic.exposure = 0.7
  r.basic.contrast = -20
  r.presence.saturation = 10
  r.colorGrade.shadows = { hue: 350, saturation: 20, luminance: 0 }
  r.pointColors = [
    {
      id: 'p1',
      hue: 30,
      saturation: 0.5,
      luminance: 0.5,
      shiftHue: 5,
      shiftSat: 0,
      shiftLum: 0,
      range: 30
    }
  ]
  return r
}

test('Amount 0 is the photo as it was; 1 is the whole look', () => {
  const before = photo()
  for (const l of LOOKS) {
    const { after, fields } = on(before, l.id)
    assert.ok(sameValue(blendLook(before, after, fields, 0), before), `${l.id} at 0`)
    assert.ok(sameValue(blendLook(before, after, fields, 1), after), `${l.id} at 1`)
  }
})

test('Amount halfway moves each number half the way', () => {
  const before = photo()
  const { after, fields } = on(before, 'builtin:documentary-chrome')
  const half = blendLook(before, after, fields, 0.5)
  assert.equal(half.basic.contrast, (before.basic.contrast + after.basic.contrast) / 2)
  assert.equal(
    half.presence.saturation,
    (before.presence.saturation + after.presence.saturation) / 2
  )
  assert.equal(half.hsl.green.saturation, after.hsl.green.saturation / 2)
})

test('Amount leaves what the look does not set alone: exposure, point colours', () => {
  const before = photo()
  const { after, fields } = on(before, 'builtin:rain-city-noir')
  for (const t of [0.25, 0.5, 0.9]) {
    const r = blendLook(before, after, fields, t)
    assert.equal(r.basic.exposure, 0.7)
    assert.deepEqual(r.pointColors, before.pointColors)
    assert.deepEqual(r.geometry, before.geometry)
  }
})

test('a wheel hue turns the short way; a wheel with no colour takes the look hue', () => {
  const before = photo()
  const after = structuredClone(before)
  after.colorGrade.shadows = { hue: 10, saturation: 40, luminance: 0 }
  after.colorGrade.highlights = { hue: 200, saturation: 30, luminance: 0 }
  const fields = lookFields(before, after)
  const half = blendLook(before, after, fields, 0.5)
  // 350° to 10° the short way is through 0°, not through 180°.
  assert.equal(half.colorGrade.shadows.hue, 0)
  assert.equal(half.colorGrade.shadows.saturation, 30)
  // No colour before: the look's hue at once, its saturation fading in.
  assert.equal(half.colorGrade.highlights.hue, 200)
  assert.equal(half.colorGrade.highlights.saturation, 15)
})

test('curves of different point counts blend as the curves they draw', () => {
  const before = defaultRecipe(false)
  before.toneCurve.master = [
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ]
  const after = structuredClone(before)
  after.toneCurve.master = [
    { x: 0, y: 0.05 },
    { x: 0.25, y: 0.18 },
    { x: 0.5, y: 0.5 },
    { x: 0.75, y: 0.82 },
    { x: 1, y: 0.95 }
  ]
  const r = blendLook(before, after, [['toneCurve', 'master']], 0.5)
  const a = monotone(before.toneCurve.master)
  const b = monotone(after.toneCurve.master)
  for (const p of r.toneCurve.master) assert.ok(Math.abs(p.y - (a(p.x) + b(p.x)) / 2) < 1e-3)
  assert.equal(r.toneCurve.master.length, 5)
  // Still a curve the editor accepts: x rising, y not falling.
  for (let i = 1; i < r.toneCurve.master.length; i++) {
    assert.ok(r.toneCurve.master[i].x > r.toneCurve.master[i - 1].x)
    assert.ok(r.toneCurve.master[i].y >= r.toneCurve.master[i - 1].y)
  }
})

test('black and white is the look’s at any amount; its mix fades in', () => {
  const before = photo()
  const { after, fields } = on(before, 'builtin:fine-grain-mono-red')
  const r = blendLook(before, after, fields, 0.3)
  assert.equal(r.treatment, 'bw')
  assert.equal(r.bwMix.red, Math.round(after.bwMix.red * 0.3 * 1e4) / 1e4)
})

test('blended values stay in their sliders’ ranges', () => {
  const before = photo()
  for (const l of LOOKS) {
    const { after, fields } = on(before, l.id)
    const r = blendLook(before, after, fields, 0.37)
    for (const f of fields) {
      const range = rangeOf(f)
      const v = f.reduce<unknown>((n, k) => (n as Record<string, unknown>)[k], r)
      if (range && typeof v === 'number')
        assert.ok(v >= range[0] && v <= range[1], `${l.id} ${f.join('.')} ${v}`)
    }
  }
})

test('a saved preset (groups, not fields) scales by the fields it changed', () => {
  const before = photo()
  const preset = structuredClone(defaultRecipe(false))
  preset.basic.contrast = 40
  preset.effects.grainAmount = 30
  const after = applyFields(before, preset, [
    ['basic', 'contrast'],
    ['effects', 'grainAmount']
  ])
  const fields = lookFields(before, after)
  const r = blendLook(before, after, fields, 0.5)
  assert.equal(r.basic.contrast, 10)
  assert.equal(r.effects.grainAmount, 15)
})
