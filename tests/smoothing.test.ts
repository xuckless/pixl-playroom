// The Smoothing slider (engine 0.18's `smoothing`): on release, never in a
// draft; one value for six op types; 0 for edits made before it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, SMOOTHING_RADIUS, type CompileContext } from '../src/shared/compile'
import {
  defaultRecipe,
  isEdited,
  newLocalLayer,
  normaliseRecipe,
  type Recipe
} from '../src/shared/recipe'
import type { GradeOp } from '../src/shared/engine-types'

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

/** A photo that moves every op Smoothing reaches. */
function busy(): Recipe {
  const r = defaultRecipe(false)
  r.presence.dehaze = 40
  r.presence.vibrance = 20
  r.basic.highlights = -30
  r.hsl.blue.luminance = -60
  r.colorGrade.shadows.saturation = 30
  r.pointColors = [
    {
      id: 'a',
      hue: 200,
      saturation: 0.5,
      luminance: 0.5,
      shiftHue: 10,
      shiftSat: 0,
      shiftLum: 0,
      range: 50
    } as Recipe['pointColors'][number]
  ]
  return r
}

// HslBands is left unsmoothed until E53 (the owner's stopgap, 2026-10-08).
const SMOOTHED = ['Dehaze', 'Vibrance', 'Tone', 'Qualifier', 'ColorGrade']

function smoothings(ops: GradeOp[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const op of ops) {
    const [k, v] = Object.entries(op)[0] as [string, { smoothing?: unknown }]
    if (SMOOTHED.includes(k)) out[k] = v.smoothing
  }
  return out
}

const opsOf = (r: Recipe, c: CompileContext, layer = 0): GradeOp[] =>
  compile(r, c).grade!.layers[layer].stages.flatMap((s) => s.ops)

test('a new photo smooths its ops at the engine’s calibration point; HSL waits for E53', () => {
  assert.equal(defaultRecipe(false).presence.smoothing, 100)
  const hsl = opsOf(busy(), ctx).find((o) => 'HslBands' in o) as {
    HslBands: { smoothing: unknown }
  }
  assert.equal(hsl.HslBands.smoothing, null)
  const got = smoothings(opsOf(busy(), ctx))
  assert.deepEqual(Object.keys(got).sort(), [...SMOOTHED].sort())
  for (const v of Object.values(got)) assert.deepEqual(v, { radius: SMOOTHING_RADIUS, strength: 1 })
})

test('a draft renders bare; the slider maps to strength; 0 sends none', () => {
  for (const v of Object.values(smoothings(opsOf(busy(), { ...ctx, smoothing: false }))))
    assert.equal(v, null)
  const r = busy()
  r.presence.smoothing = 35
  assert.deepEqual(smoothings(opsOf(r, ctx)).Dehaze, { radius: SMOOTHING_RADIUS, strength: 0.35 })
  r.presence.smoothing = 0
  for (const v of Object.values(smoothings(opsOf(r, ctx)))) assert.equal(v, null)
})

test('a mask has its own Smoothing, which its Amount leaves alone', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(polygon)
  l.settings.presence.dehaze = 30
  l.settings.presence.smoothing = 60
  l.amount = 200
  r.layers.push(l)
  assert.equal(newLocalLayer('n').settings.presence.smoothing, 100)
  const c = compile(r, ctx)
  const ops = c.grade!.layers[c.layerIndex[l.id]].stages.flatMap((s) => s.ops)
  assert.deepEqual(smoothings(ops).Dehaze, { radius: SMOOTHING_RADIUS, strength: 0.6 })
})

test('an edit made before Smoothing keeps its look (0, masks too); an untouched one takes 100', () => {
  const edited = normaliseRecipe(
    {
      version: 3,
      presence: { dehaze: 30 },
      layers: [{ id: 'a', settings: { presence: { vibrance: 10 } } }]
    },
    false
  )
  assert.equal(edited.presence.smoothing, 0)
  assert.equal(edited.layers[0].settings.presence.smoothing, 0)
  const untouched = normaliseRecipe({ version: 3 }, false)
  assert.equal(untouched.presence.smoothing, 100)
  assert.ok(!isEdited(untouched, false))
  // From version 4 on the value is the user's, 0 included; out of range is held.
  assert.equal(
    normaliseRecipe({ version: 4, presence: { smoothing: 0 } }, false).presence.smoothing,
    0
  )
  assert.equal(
    normaliseRecipe({ version: 4, presence: { smoothing: 250 } }, false).presence.smoothing,
    100
  )
})
