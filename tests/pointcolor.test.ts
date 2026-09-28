import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, pointColorOps, type CompileContext } from '../src/shared/compile'
import type { GradeOp, HslKey, Primary } from '../src/shared/engine-types'
import { applyPatch, diffRecipe } from '../src/shared/history'
import {
  applyGroups,
  defaultRecipe,
  normaliseRecipe,
  type PointColorSetting
} from '../src/shared/recipe'

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

const point = (id: string, p: Partial<PointColorSetting> = {}): PointColorSetting => ({
  id,
  hue: 210,
  saturation: 0.6,
  luminance: 0.5,
  shiftHue: 50,
  shiftSat: 0,
  shiftLum: 0,
  range: 50,
  ...p
})

const lookOps = (r: ReturnType<typeof defaultRecipe>): GradeOp[] => {
  const stages = compile(r, ctx).grade!.layers[0].stages
  return stages[stages.length - 1].ops
}

test('each point colour is a qualifier after the HSL bands and before vibrance', () => {
  const r = defaultRecipe(false)
  r.hsl.blue.saturation = 20
  r.presence.vibrance = 30
  r.pointColors = [point('a'), point('b', { hue: 30, shiftSat: -40 })]
  const ops = kinds(lookOps(r))
  assert.deepEqual(ops, ['HslBands', 'Qualifier', 'Qualifier', 'Vibrance'])
  // The key is smoothed in proportion to the buffer: 0.15% of its short side.
  const q = lookOps(r)[1] as { Qualifier: { key: HslKey } }
  assert.equal(q.Qualifier.key.blur_radius, 2)
})

test('the qualifier keys on the sample and corrects by the shifts', () => {
  const [op] = pointColorOps([point('a', { shiftHue: 50, shiftSat: -50, shiftLum: 100 })])
  const { key, correction } = (op as { Qualifier: { key: HslKey; correction: Primary } }).Qualifier
  assert.deepEqual(key.hue, { centre: 210, width: 25, softness: 16 })
  assert.equal(key.saturation!.centre, 0.6)
  assert.equal(key.luma!.centre, 0.5)
  assert.equal(key.blur_radius, 0)
  assert.equal(correction.hue_shift, 15)
  assert.equal(correction.saturation, 0.5)
  assert.equal(correction.exposure, 0.6)
  assert.equal(correction.contrast, 1)
})

test('a point with no shift, or a black-and-white photo, emits nothing', () => {
  const r = defaultRecipe(false)
  r.pointColors = [point('a', { shiftHue: 0 })]
  assert.equal(compile(r, ctx).grade, null)
  r.pointColors = [point('a')]
  r.treatment = 'bw'
  assert.ok(!kinds(lookOps(r)).includes('Qualifier'))
})

test('a grey sample keys on saturation and luma only, never an empty key', () => {
  const [op] = pointColorOps([point('a', { saturation: 0.03, shiftLum: 20 })])
  const { key } = (op as { Qualifier: { key: HslKey } }).Qualifier
  assert.equal(key.hue, null)
  assert.ok(key.saturation)
  assert.ok(key.luma)
})

test('an old recipe gains no point colours, and bad ones are cleaned', () => {
  const old = defaultRecipe(false) as unknown as Record<string, unknown>
  delete old.pointColors
  assert.deepEqual(normaliseRecipe(old, false).pointColors, [])
  const bad = normaliseRecipe(
    { ...defaultRecipe(false), pointColors: [{ id: 'x', hue: 400, shiftHue: 300 }, 'junk'] },
    false
  )
  assert.equal(bad.pointColors.length, 1)
  assert.equal(bad.pointColors[0].hue, 40)
  assert.equal(bad.pointColors[0].shiftHue, 100)
})

test('copying the HSL group copies the point colours', () => {
  const from = defaultRecipe(false)
  from.pointColors = [point('a')]
  const to = applyGroups(defaultRecipe(false), from, ['hsl'])
  assert.deepEqual(to.pointColors, from.pointColors)
})

test('history adds and removes a point by id', () => {
  const a = defaultRecipe(false)
  a.pointColors = [point('a')]
  const b = structuredClone(a)
  b.pointColors.push(point('b', { hue: 30 }))
  const add = diffRecipe(a, b)
  assert.ok(add.length > 0)
  assert.deepEqual(applyPatch(a, add), b)
  const c = structuredClone(b)
  c.pointColors = c.pointColors.filter((p) => p.id !== 'a')
  c.pointColors[0].shiftSat = 25
  assert.deepEqual(applyPatch(b, diffRecipe(b, c)), c)
  // Patched by id: the same change lands on the same point wherever it sits.
  const reordered = structuredClone(b)
  reordered.pointColors.reverse()
  const moved = applyPatch(reordered, diffRecipe(b, c))
  assert.equal(moved.pointColors.length, 1)
  assert.equal(moved.pointColors[0].id, 'b')
  assert.equal(moved.pointColors[0].shiftSat, 25)
})
