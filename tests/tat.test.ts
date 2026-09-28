import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILTIN_CURVES,
  defaultToneCurve,
  matchingPreset,
  monotone,
  presetCurve
} from '../src/shared/curves'
import { defaultRecipe, HSL_BANDS } from '../src/shared/recipe'
import { applyHslDelta, bandWeights, curveInput, mainBand, nudgeCurve } from '../src/shared/tat'

const near = (a: number, b: number, eps = 1e-9): void =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('a hue between two band centres is shared between them', () => {
  const w = bandWeights(15)
  near(w.red, 0.5)
  near(w.orange, 0.5)
  near(
    HSL_BANDS.reduce((s, b) => s + w[b], 0),
    1
  )
  assert.equal(bandWeights(90).yellow, 0.5)
  assert.equal(bandWeights(240).blue, 1)
  assert.equal(mainBand(bandWeights(250)), 'blue')
})

test('hues past the last band wrap round to red', () => {
  const w = bandWeights(350)
  // Magenta (315°) to red (360°): 350° is 35° of the 45° along.
  near(w.magenta, 10 / 45)
  near(w.red, 35 / 45)
  near(bandWeights(-10).red, w.red)
  near(bandWeights(720).red, 1)
})

test('a drag moves the axis of the tab, weighted and clamped', () => {
  const hsl = defaultRecipe(false).hsl
  hsl.red.saturation = 90
  const out = applyHslDelta(hsl, bandWeights(15), 'all', 40)
  assert.equal(out.red.saturation, 100)
  assert.equal(out.orange.saturation, 20)
  assert.equal(out.orange.hue, 0)
  assert.equal(out.blue.saturation, 0)
  const hue = applyHslDelta(hsl, bandWeights(15), 'hue', -300)
  assert.equal(hue.red.hue, -100)
  // The source is left alone: every move starts again from the press.
  assert.equal(hsl.orange.saturation, 0)
})

test('a curve level with no point near it gains one on the curve', () => {
  const pts = defaultToneCurve().master
  const out = nudgeCurve(pts, 0.5, 0.1)
  assert.deepEqual(out, [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.6 },
    { x: 1, y: 1 }
  ])
  // Inserted where the curve already is, so a zero nudge changes no pixel.
  const s = BUILTIN_CURVES.find((c) => c.name === 'Medium contrast')!.curve.master!
  const flat = nudgeCurve(s, 0.4, 0)
  near(monotone(flat)(0.4), monotone(s)(0.4), 1e-4)
})

test('a curve point near the level moves instead, and y stays in range', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 1 }
  ]
  const out = nudgeCurve(pts, 0.53, 0.2)
  assert.equal(out.length, 3)
  assert.deepEqual(out[1], { x: 0.5, y: 0.7 })
  assert.equal(nudgeCurve(pts, 0.5, 5)[1].y, 1)
  assert.equal(nudgeCurve(pts, 0.5, -5)[1].y, 0)
  // The ends keep their place in x.
  const end = nudgeCurve(pts, 0.98, -0.1)
  assert.deepEqual(end[2], { x: 1, y: 0.9 })
})

test('the points stay in strictly increasing x', () => {
  let pts = defaultToneCurve().master
  for (const x of [0.7, 0.2, 0.45, 0.9, 0.3, 0.21, 0.6]) pts = nudgeCurve(pts, x, 0.03)
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i].x > pts[i - 1].x)
  assert.equal(pts[0].x, 0)
  assert.equal(pts[pts.length - 1].x, 1)
})

test('a sampled level is traced back through the curve', () => {
  const s = BUILTIN_CURVES.find((c) => c.name === 'Strong contrast')!.curve.master!
  const f = monotone(s)
  near(curveInput(s, f(0.3)), 0.3, 1e-4)
  near(curveInput(defaultToneCurve().master, 0.42), 0.42, 1e-4)
})

test('the built-in curves are valid point curves', () => {
  for (const c of BUILTIN_CURVES) {
    const pts = c.curve.master ?? defaultToneCurve().master
    assert.equal(pts[0].x, 0, c.name)
    assert.equal(pts[pts.length - 1].x, 1, c.name)
    for (let i = 1; i < pts.length; i++) {
      assert.ok(pts[i].x > pts[i - 1].x, c.name)
      assert.ok(pts[i].y >= pts[i - 1].y, c.name)
    }
  }
})

test('the preset menu names the preset a curve is, and none once it is edited', () => {
  const strong = BUILTIN_CURVES.find((c) => c.name === 'Strong contrast')!
  assert.equal(matchingPreset(presetCurve(strong), BUILTIN_CURVES)?.name, 'Strong contrast')
  // An untouched curve is the Linear preset.
  assert.equal(matchingPreset(defaultToneCurve(), BUILTIN_CURVES)?.name, 'Linear')
  const edited = presetCurve(strong)
  edited.master[1] = { ...edited.master[1], y: edited.master[1].y + 0.013 }
  assert.equal(matchingPreset(edited, BUILTIN_CURVES), undefined)
  const regions = { ...presetCurve(strong), shadows: 10 }
  assert.equal(matchingPreset(regions, BUILTIN_CURVES), undefined)
  // A saved curve is matched whole, the way it was stored.
  const mine = { name: 'Mine', curve: { ...defaultToneCurve(), highlights: -20 } }
  assert.equal(matchingPreset({ ...defaultToneCurve(), highlights: -20 }, [mine])?.name, 'Mine')
})
