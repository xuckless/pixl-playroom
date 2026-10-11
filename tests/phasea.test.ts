/**
 * Engine 0.19.2 (Phase A): the refine methods, the drawn edge's Smooth and
 * Contrast, Tone's base and a heal's edge, as Playroom compiles them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compile,
  layerMask,
  TEXTURE_BASE,
  DRAG_BASE,
  type CompileContext
} from '../src/shared/compile'
import {
  defaultRecipe,
  newLocalLayer,
  normaliseComponent,
  normaliseRecipe
} from '../src/shared/recipe'
import type { MaskComponentSetting } from '../src/shared/recipe'
import type { GradeOp, Tone } from '../src/shared/engine-types'
import {
  defaultStrength,
  edgeShaping,
  engineEdge,
  engineRefine,
  paramValue,
  refineMethod,
  REFINE_METHODS,
  strengthOf
} from '../src/shared/refine'
import { compileRetouch, newSpot, spotRefine } from '../src/shared/retouch'

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

const lasso = (extra: Partial<MaskComponentSetting> = {}): MaskComponentSetting =>
  ({
    id: 'p',
    kind: 'polygon',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.6, y: 0.1 },
      { x: 0.4, y: 0.7 }
    ],
    ...extra
  }) as MaskComponentSetting

test('each refine method compiles to its engine shape; a drag frame takes Guided for the whole-frame ones', () => {
  const c = (method?: string): MaskComponentSetting =>
    lasso({ refine: { on: true, radius: 0.6, ...(method ? { method } : {}) } as never })
  assert.deepEqual(engineRefine(c()), { Guided: { radius: 0.006, epsilon: 0.001, guide: 'Luma' } })
  assert.deepEqual(engineRefine(c('guidedColour')), {
    Guided: { radius: 0.006, epsilon: 0.001, guide: 'Colour' }
  })
  assert.ok('EdgeSnap' in engineRefine(c('edgeSnap'))!)
  assert.ok('BilateralSolver' in engineRefine(c('solver'))!)
  assert.ok('Matting' in engineRefine(c('matting'))!)
  for (const m of ['edgeSnap', 'solver', 'matting'])
    assert.deepEqual(engineRefine(c(m), true), {
      Guided: { radius: 0.006, epsilon: 0.001, guide: 'Luma' }
    })
  // Guided runs as it is on a drag too.
  assert.deepEqual(engineRefine(c('guidedColour'), true), engineRefine(c('guidedColour')))
  assert.equal(engineRefine(lasso({ refine: { on: false, radius: 0.6 } })), null)
})

test('Strength drives a method’s main parameter, and an Advanced value wins over it', () => {
  const snap = refineMethod('edgeSnap')
  const p = snap.params.find((x) => x.key === 'distance')!
  assert.equal(paramValue(snap, { on: true, radius: 0.5, method: 'edgeSnap' }, 'distance'), p.def)
  assert.equal(
    paramValue(snap, { on: true, radius: 0.5, method: 'edgeSnap', strength: 100 }, 'distance'),
    p.max
  )
  assert.equal(
    paramValue(
      snap,
      { on: true, radius: 0.5, method: 'edgeSnap', strength: 100, params: { distance: 0.002 } },
      'distance'
    ),
    0.002
  )
  for (const m of REFINE_METHODS.filter((x) => x.strength)) {
    const def = m.params.find((x) => x.key === m.strength)!.def
    assert.equal(strengthOf(m, def), defaultStrength(m))
  }
})

test('a recipe keeps the refine method, strength and Advanced values, and drops what is not a method', () => {
  const c = normaliseComponent({
    ...lasso(),
    refine: {
      on: true,
      radius: 1,
      method: 'matting',
      strength: 140,
      params: { band: 0.02, bad: 'x' }
    }
  })!
  assert.deepEqual(c.refine, {
    on: true,
    radius: 1,
    method: 'matting',
    strength: 100,
    params: { band: 0.02 }
  })
  const old = normaliseComponent({ ...lasso(), refine: { on: true, radius: 1, method: 'nope' } })!
  assert.deepEqual(old.refine, { on: true, radius: 1 })
})

test('Smooth and Contrast reach the engine on drawn edges only, never on a model’s mask', () => {
  const drawn = lasso({ smooth: 40, contrast: 50 })
  assert.ok(edgeShaping(drawn))
  assert.deepEqual(engineEdge(drawn), { smooth: 0.02, contrast: 0.5 })
  const model = {
    ...lasso(),
    kind: 'brush',
    png: 'x',
    width: 4,
    height: 4,
    source: { kind: 'segment', target: 'sky' },
    smooth: 40,
    contrast: 50
  } as MaskComponentSetting
  assert.ok(!edgeShaping(model))
  assert.deepEqual(engineEdge(model), { smooth: 0, contrast: 0 })
  const l = newLocalLayer('m')
  l.components.push(drawn)
  const m = layerMask(l, 'Normal', {})!
  assert.equal(m.components[0].smooth, 0.02)
  assert.equal(m.components[0].contrast, 0.5)
  assert.equal(m.components[0].shift, 0)
  assert.equal(m.edge, null)
  assert.equal(normaliseComponent({ ...drawn, smooth: 300 })!.smooth, 100)
  assert.equal(normaliseComponent({ ...drawn, smooth: 0 })!.smooth, undefined)
})

const toneOf = (r: ReturnType<typeof defaultRecipe>, c: CompileContext): Tone => {
  const ops: GradeOp[] = compile(r, c).grade!.layers.flatMap((l) => l.stages.flatMap((s) => s.ops))
  return (ops.find((o) => 'Tone' in o) as { Tone: Tone }).Tone
}

test('Tone’s base: none by default; Keep texture is the local Laplacian, guided while dragging', () => {
  const r = defaultRecipe(false)
  r.basic.shadows = 40
  assert.equal('base' in toneOf(r, ctx), false)
  r.toneBase = 'texture'
  assert.deepEqual(toneOf(r, ctx).base, TEXTURE_BASE)
  assert.deepEqual(toneOf(r, { ...ctx, smoothing: false }).base, DRAG_BASE)
  assert.equal('base' in toneOf(r, { ...ctx, smoothing: false, dragWithoutBase: true }), false)
  // A mask's Tone follows the photo's base.
  const l = newLocalLayer('m')
  l.components.push(lasso())
  l.settings.basic.highlights = -30
  r.layers.push(l)
  const tones = compile(r, ctx)
    .grade!.layers.flatMap((x) => x.stages.flatMap((s) => s.ops))
    .filter((o) => 'Tone' in o) as { Tone: Tone }[]
  assert.equal(tones.length, 2)
  assert.ok(tones.every((o) => o.Tone.base === TEXTURE_BASE))
  assert.equal(normaliseRecipe({ toneBase: 'weird' }, false).toneBase, 'none')
  assert.equal(normaliseRecipe({ toneBase: 'texture' }, false).toneBase, 'texture')
  assert.equal(normaliseRecipe({}, false).toneBase, 'none')
})

test('a heal’s edge: plain sends no refine; Edge snap and Matting send theirs', () => {
  assert.equal(spotRefine(undefined), null)
  assert.ok('EdgeSnap' in spotRefine('edgeSnap')!)
  assert.ok('Matting' in spotRefine('matting')!)
  const spot = newSpot('a1', 'heal', [{ x: 0.5, y: 0.5 }], 0.02, 50, 100)
  spot.source = { x: 0.6, y: 0.5 }
  const plain = compileRetouch([spot], 'Normal', 6000, 4000)!
  assert.equal('refine' in (plain.steps[0] as { Heal: object }).Heal, false)
  spot.refine = 'matting'
  const matted = compileRetouch([spot], 'Normal', 6000, 4000)!
  assert.ok('Matting' in (matted.steps[0] as { Heal: { refine: object } }).Heal.refine)
})
