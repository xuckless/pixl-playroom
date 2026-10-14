import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, scaleSettings, type CompileContext } from '../src/shared/compile'
import { defaultRecipe, neutralSettings } from '../src/shared/recipe'
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
