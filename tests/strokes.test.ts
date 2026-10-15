/**
 * Brush strokes as vectors (engine 0.21.0, E36): how a brush reaches the
 * engine (its pieces in place, first in the mask, or one plane), the
 * strokes as the engine takes them, the recipe and history keeping them,
 * and what the brush keeps of a stroke while it is painted.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { layerMask } from '../src/shared/compile'
import { applyPatch, diffRecipe } from '../src/shared/history'
import {
  defaultRecipe,
  newLocalLayer,
  normaliseComponent,
  type BrushComponent,
  type BrushStrokeSetting,
  type MaskComponentSetting
} from '../src/shared/recipe'
import {
  MAX_COVER,
  MAX_DABS,
  basePlaneId,
  brushRoute,
  carryBrush,
  engineStrokes,
  keepsDab,
  keptDab,
  paintsLive,
  strokeRuns,
  strokesCover,
  withStroke
} from '../src/shared/strokes'

const stroke = (id: string, dabs: number[], erase = false): BrushStrokeSetting => ({
  id,
  dabs,
  softness: 0.5,
  flow: 0.8,
  ...(erase ? { erase: true as const } : {})
})

const brush = (
  strokes: BrushStrokeSetting[],
  more: Partial<BrushComponent> = {}
): BrushComponent => ({
  id: 'b',
  kind: 'brush',
  mode: 'Add',
  opacity: 100,
  invert: false,
  feather: 0,
  width: 1024,
  height: 683,
  png: '',
  strokes,
  ...more
})

const radial = (id: string, mode: 'Add' | 'Subtract' = 'Add'): MaskComponentSetting =>
  ({
    id,
    kind: 'radial',
    mode,
    opacity: 100,
    invert: false,
    feather: 0,
    centre: { x: 0.5, y: 0.5 },
    radiusX: 0.2,
    radiusY: 0.2,
    angle: 0,
    softness: 50,
    width: 64,
    height: 64
  }) as MaskComponentSetting

const paint = stroke('s1', [0.2, 0.3, 0.04, 1, 0.6, 0.5, 0.05, 0.5])
const erase = stroke('s2', [0.4, 0.4, 0.02, 1], true)
const again = stroke('s3', [0.7, 0.2, 0.03, 0.9])

test('paint, erase, paint: an Add, a Subtract and an Add, the dabs turned as a lasso’s points', () => {
  const l = newLocalLayer('Brush')
  l.components = [brush([paint, erase, again])]
  const m = layerMask(l, 'Rotate90', {}, { width: 683, height: 1024 })!
  assert.deepEqual(
    m.components.map((c) => c.mode),
    ['Add', 'Subtract', 'Add']
  )
  const first = m.components[0].shape
  assert.ok('Strokes' in first)
  const d = first.Strokes.strokes[0].dabs[0]
  // Rotate90 takes (x, y) to (1 − y, x); the radius, of the shorter side, stays.
  assert.deepEqual(d, { x: 0.7, y: 0.2, radius: 0.04, pressure: 1 })
  assert.equal(first.Strokes.strokes[0].softness, 0.5)
  assert.equal(first.Strokes.strokes[0].flow, 0.8)
  // A Strokes component reads no pixels: no mask space.
  assert.equal(m.space, null)
})

test('a brush of paint strokes is one component, every option its own', () => {
  const l = newLocalLayer('Brush')
  l.components = [
    radial('r'),
    brush([paint, again], { mode: 'Subtract', opacity: 50, invert: true })
  ]
  assert.equal(brushRoute(l.components, 1), 'strokes')
  const m = layerMask(l, 'Normal', {})!
  assert.equal(m.components.length, 2)
  assert.equal(m.components[1].mode, 'Subtract')
  assert.equal(m.components[1].opacity, 0.5)
  assert.equal(m.components[1].invert, true)
  const shape = m.components[1].shape
  assert.ok('Strokes' in shape && shape.Strokes.strokes.length === 2)
})

test('an eraser takes from the brush alone: the brush leads a union, else it is one plane', () => {
  const l = newLocalLayer('Brush')
  // After an Add: a union in any order, so the brush goes first.
  l.components = [radial('r'), brush([paint, erase])]
  assert.equal(brushRoute(l.components, 1), 'lead')
  const m = layerMask(l, 'Normal', {})!
  assert.ok('Strokes' in m.components[0].shape)
  assert.equal(m.components[1].mode, 'Subtract')
  assert.ok('RadialGradient' in m.components[2].shape)
  // After a Subtract: its eraser would take from more than the brush.
  l.components = [radial('r'), radial('s', 'Subtract'), brush([paint, erase])]
  assert.equal(brushRoute(l.components, 2), 'plane')
  assert.equal(layerMask(l, 'Normal', {})!.components.length, 2, 'waits for its plane')
  const planed = layerMask(l, 'Normal', { b: '/tmp/b.png' })!
  assert.deepEqual(planed.components[2].shape, {
    Raster: { source: { Png: '/tmp/b.png' }, resampler: 'Bilinear' }
  })
  // Opacity, inversion, feather or Smooth apply to the brush, not each piece.
  for (const more of [{ opacity: 60 }, { invert: true }, { feather: 10 }, { smooth: 20 }]) {
    l.components = [brush([paint, erase], more)]
    assert.equal(brushRoute(l.components, 0), 'plane', JSON.stringify(more))
  }
  // Kept to its object (SAM snaps a plane): a plane.
  l.components = [brush([paint], { refine: { on: true, radius: 0.4 } })]
  assert.equal(brushRoute(l.components, 0), 'plane')
})

test('an eraser never takes from another component: a brush erasing alone is nothing, one brush leads', () => {
  const l = newLocalLayer('Brush')
  // Erase strokes alone paint nothing: no Subtract takes from the gradient.
  l.components = [radial('r'), brush([erase])]
  assert.notEqual(brushRoute(l.components, 1), 'strokes')
  const m = layerMask(l, 'Normal', {})!
  assert.deepEqual(
    m.components.map((c) => [Object.keys(c.shape)[0], c.mode]),
    [['RadialGradient', 'Add']]
  )
  // A subtracting brush that only erases: its plane (nothing taken away).
  l.components = [radial('r'), brush([erase], { mode: 'Subtract' })]
  assert.equal(brushRoute(l.components, 1), 'plane')
  // Two brushes that erase: the first leads, the second is a plane, so
  // neither eraser reaches the other's paint.
  const second = { ...brush([again, erase]), id: 'b2' }
  l.components = [radial('r'), brush([paint, erase]), second]
  assert.equal(brushRoute(l.components, 1), 'lead')
  assert.equal(brushRoute(l.components, 2), 'plane')
  // First in the mask, a brush is already first: a later one can't lead.
  l.components = [brush([paint, erase]), radial('r'), second]
  assert.equal(brushRoute(l.components, 0), 'strokes')
  assert.equal(brushRoute(l.components, 2), 'plane')
  // Painting alone, a later brush still goes as its strokes.
  l.components = [brush([paint, erase]), radial('r'), { ...brush([again]), id: 'b3' }]
  assert.equal(brushRoute(l.components, 2), 'strokes')
})

test('an older brush’s plane goes under its new strokes; a brush with no strokes is its plane', () => {
  const l = newLocalLayer('Brush')
  l.components = [brush([paint], { png: 'iVBOR', ref: 'abc' })]
  assert.equal(brushRoute(l.components, 0), 'strokes')
  assert.equal(layerMask(l, 'Normal', { b: '/tmp/old.png' }), null, 'its plane under its own name')
  const m = layerMask(l, 'Normal', { [basePlaneId('b')]: '/tmp/old.png' })!
  assert.deepEqual(
    m.components.map((c) => Object.keys(c.shape)[0]),
    ['Raster', 'Strokes']
  )
  l.components = [brush([], { png: 'iVBOR' })]
  delete (l.components[0] as BrushComponent).strokes
  assert.equal(brushRoute(l.components, 0), 'plane')
  assert.ok('Raster' in layerMask(l, 'Normal', { b: '/tmp/b.png' })!.components[0].shape)
})

test('past the engine’s limits a brush is painted into one plane', () => {
  const many: number[] = []
  for (let i = 0; i < 120_000; i++) many.push((i % 1000) / 1000, 0.5, 0.001, 1)
  assert.ok(many.length / 4 > MAX_DABS)
  assert.equal(brushRoute([brush([stroke('big', many)])], 0), 'plane')
  // Wide dabs zigzagging across the frame: their boxes cover too many frames.
  const zig: number[] = []
  for (let i = 0; i < 400; i++) zig.push(i % 2, 0.5, 0.5, 1)
  assert.ok(strokesCover([stroke('z', zig)], 1024, 683) > MAX_COVER)
  assert.equal(brushRoute([brush([stroke('z', zig)])], 0), 'plane')
  // A short stroke is well inside.
  assert.ok(strokesCover([paint], 1024, 683) < 1)
})

test('runs of painting and erasing, in order', () => {
  const runs = strokeRuns([paint, again, erase, erase, paint])
  assert.deepEqual(
    runs.map((r) => [r.erase, r.strokes.length]),
    [
      [false, 2],
      [true, 2],
      [false, 1]
    ]
  )
  // A stroke runs off the frame up to its fractions’ −1…2.
  const off = engineStrokes([stroke('o', [2.5, -2, 2, 1.5])], 'Normal')
  assert.deepEqual(off.strokes[0].dabs[0], { x: 2, y: -1, radius: 1, pressure: 1 })
})

test('a recipe keeps a brush’s strokes, whole and in range; history adds a stroke, not the brush', () => {
  const c = normaliseComponent({
    id: 'b',
    kind: 'brush',
    mode: 'Add',
    width: 1024,
    height: 683,
    strokes: [
      { id: 's1', dabs: [0.1, 0.2, 0.03, 1, 9, 0.2, 0.03, 2, 0.3], softness: 3, flow: 0.4 },
      { id: 's1', dabs: [0.5, 0.5, 0, 1], softness: 0.2, flow: 0.4 },
      { dabs: [0.5, 0.5, 0.1, 'x'] },
      { id: 'e', dabs: [0.5, 0.5, 0.1, 0.5], softness: 0.2, flow: 1, erase: true }
    ]
  }) as BrushComponent
  assert.equal(c.png, '')
  assert.equal(c.strokes!.length, 2, 'a stroke of no dab goes')
  // Whole dabs, held to the engine’s ranges.
  assert.deepEqual(c.strokes![0].dabs, [0.1, 0.2, 0.03, 1, 2, 0.2, 0.03, 1])
  assert.equal(c.strokes![0].softness, 1)
  assert.equal(c.strokes![1].erase, true)
  // An older brush: its plane, no strokes.
  const old = normaliseComponent({ id: 'o', kind: 'brush', png: 'iVBOR', width: 4, height: 4 })
  assert.ok(old && old.kind === 'brush' && old.strokes === undefined)
  // History: one stroke added is one op.
  const a = defaultRecipe(false)
  const l = newLocalLayer('Brush')
  l.components = [brush([paint])]
  a.layers = [l]
  const b = structuredClone(a)
  ;(b.layers[0].components[0] as BrushComponent).strokes!.push(again)
  const patch = diffRecipe(a, b)
  assert.equal(patch.length, 1)
  assert.deepEqual((patch[0] as { value: unknown }).value, again)
  assert.deepEqual(applyPatch(a, patch), b)
})

test('a stroke keeps a dab each quarter diameter or step in pressure, and its last', () => {
  const kept: number[] = []
  const at = (x: number, p = 1): { x: number; y: number; r: number; p: number } => ({
    x,
    y: 0.5,
    r: 0.02,
    p
  })
  // Diameter 0.04 of the shorter side (683 px): a quarter is about 6.8 px, 0.0067 of 1024.
  assert.ok(keepsDab(kept, at(0.1), 1024, 683))
  kept.push(...keptDab(at(0.1)))
  assert.ok(!keepsDab(kept, at(0.103), 1024, 683))
  assert.ok(keepsDab(kept, at(0.107), 1024, 683))
  assert.ok(keepsDab(kept, at(0.101, 0.5), 1024, 683), 'a step in pressure')
  assert.deepEqual(keptDab({ x: 0.1234567, y: 0.5, r: 0, p: 0.12345 }), [0.12346, 0.5, 1e-5, 0.123])
})

test('painting shows the adjustment under the brush where the mask does something, quickly', () => {
  assert.equal(paintsLive(true, 50), false, 'an empty mask: the tint')
  assert.equal(paintsLive(false, 50), true)
  assert.equal(paintsLive(false, null), true)
  assert.equal(paintsLive(false, 900), false, 'slow pictures: the tint')
  // The stroke so far goes into its brush, made when new, and is replaced as it grows.
  const r = defaultRecipe(false)
  const l = newLocalLayer('Brush')
  r.layers = [l]
  const made = (): BrushComponent => brush([], { id: 'n' })
  withStroke(r, l.id, 'n', stroke('s', [0.1, 0.1, 0.02, 1]), made)
  withStroke(r, l.id, 'n', stroke('s', [0.1, 0.1, 0.02, 1, 0.2, 0.2, 0.02, 1]), made)
  const c = r.layers[0].components[0] as BrushComponent
  assert.equal(r.layers[0].components.length, 1)
  assert.equal(c.strokes!.length, 1)
  assert.equal(c.strokes![0].dabs.length, 8)
})

test('a brush on another lens frame is carried onto the masks’ before a stroke joins it', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('Brush')
  // Its plane and strokes on the uncorrected frame (a model's mask found with Optics off).
  l.components = [brush([paint, erase], { ref: 'a'.repeat(64), lensFrame: null })]
  r.layers = [l]
  // A live draft has already put the new stroke in.
  withStroke(r, l.id, 'b', again, () => brush([]))
  const carriedPaint = { ...paint, dabs: [0.21, 0.31, 0.041, 1, 0.61, 0.52, 0.051, 0.5] }
  const carriedErase = { ...erase, dabs: [0.41, 0.42, 0.021, 1] }
  carryBrush(r, l.id, 'b', { ref: 'c'.repeat(64), strokes: [carriedPaint, carriedErase] })
  const c = r.layers[0].components[0] as BrushComponent
  assert.equal(c.lensFrame, undefined, 'on the masks’ frame now')
  assert.equal(c.ref, 'c'.repeat(64))
  assert.equal(c.png, '')
  // Its strokes carried, in order, and the one being painted after them.
  assert.deepEqual(
    c.strokes!.map((x) => x.id),
    ['s1', 's2', 's3']
  )
  assert.deepEqual(c.strokes![0], carriedPaint)
  // Again (the next live draft, or the stroke's end): the same brush.
  const before = structuredClone(c)
  carryBrush(r, l.id, 'b', { ref: 'c'.repeat(64), strokes: [carriedPaint, carriedErase] })
  assert.deepEqual(r.layers[0].components[0], before)
  // A brush of strokes alone keeps having no plane.
  const alone = defaultRecipe(false)
  const la = newLocalLayer('Brush')
  la.components = [brush([paint], { lensFrame: null })]
  alone.layers = [la]
  carryBrush(alone, la.id, 'b', { strokes: [carriedPaint] })
  const a = alone.layers[0].components[0] as BrushComponent
  assert.equal(a.ref, undefined)
  assert.deepEqual(a.strokes, [carriedPaint])
  assert.equal(a.lensFrame, undefined)
})
