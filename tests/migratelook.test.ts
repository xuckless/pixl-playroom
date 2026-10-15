import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrateLook } from '../src/shared/migratelook'
import { normaliseRecipe } from '../src/shared/recipe'

// A 0.19 layer as a 0.19 Playroom saved it: a refined mask with a contract, and a Tone base.
const old19 = (): Record<string, unknown> => ({
  name: 'custom',
  enabled: true,
  opacity: 1,
  blend: { mode: 'Normal', space: 'LinearWorking' },
  mask: {
    components: [
      {
        shape: { Raster: { source: { Png: '/tmp/a.png' }, resampler: 'Bilinear' } },
        mode: 'Add',
        opacity: 1,
        invert: false,
        feather: { radius: 0, edge: 'Zero' },
        refine: { radius: 0.003, epsilon: 0.001, contract: 0.01 }
      }
    ],
    invert: false,
    space: null
  },
  stages: [
    {
      space: 'LinearWorking',
      ops: [
        {
          Tone: {
            highlights: -0.3,
            shadows: 0.2,
            whites: 0,
            blacks: 0,
            smoothing: null,
            base: { radius: 0.005, epsilon: 0.01 }
          }
        }
      ]
    }
  ]
})

test('migrateLook brings a 0.19 mask and Tone base to 0.19.2’s shapes (Phase A §1.6)', () => {
  const l = migrateLook(old19()) as {
    mask: { edge: unknown; components: Record<string, unknown>[] }
    stages: { ops: { Tone: { base: unknown } }[] }[]
  }
  assert.equal(l.mask.edge, null)
  const c = l.mask.components[0]
  assert.deepEqual(c.refine, { Guided: { radius: 0.003, epsilon: 0.001, guide: 'Luma' } })
  // contract: c → shift: -c
  assert.equal(c.shift, -0.01)
  assert.equal(c.smooth, 0)
  assert.equal(c.contrast, 0)
  assert.deepEqual(l.stages[0].ops[0].Tone.base, { Guided: { radius: 0.005, epsilon: 0.01 } })
})

test('migrateLook is safe to run twice, and leaves 0.19.2 shapes alone', () => {
  const once = migrateLook(old19())
  const twice = migrateLook(structuredClone(once))
  assert.deepEqual(twice, once)
  const now = {
    components: [
      {
        shape: { Polygon: { contours: [], fill_rule: 'NonZero' } },
        mode: 'Add',
        opacity: 1,
        invert: false,
        feather: { radius: 0, edge: 'Zero' },
        refine: { EdgeSnap: { distance: 0.005 } },
        smooth: 0.01,
        contrast: 0.5,
        shift: 0.002
      }
    ],
    invert: false,
    space: null,
    edge: null
  }
  assert.deepEqual(migrateLook(structuredClone(now)), now)
  // A local-Laplacian base has a radius but no epsilon: not the 0.19 shape.
  const ll = { base: { LocalLaplacian: { radius: 0.05, sigma: 0.1, spacing: 0.05 } } }
  assert.deepEqual(migrateLook(structuredClone(ll)), ll)
})

// A 0.20 layer: a parametric curve without a reach, a grain without response or colour (engine 0.21's clean breaks).
const old20 = (): Record<string, unknown> => ({
  name: 'custom',
  enabled: true,
  opacity: 1,
  blend: { mode: 'Normal', space: 'LinearWorking' },
  mask: null,
  stages: [
    {
      space: {
        Encoded: {
          space: 'DisplayP3',
          intent: 'RelativeColorimetric',
          black_point_compensation: false
        }
      },
      ops: [
        {
          ParametricCurve: {
            shadows: 0.2,
            darks: 0,
            lights: 0,
            highlights: -0.1,
            splits: { low: 0.25, mid: 0.5, high: 0.75 }
          }
        },
        { Grain: { amount: 0.3, size: 0.002, roughness: 0.5, seed: 7 } }
      ]
    }
  ]
})

test('migrateLook brings a 0.20 parametric curve and grain to 0.21’s shapes, the same bytes', () => {
  const l = migrateLook(old20()) as {
    stages: { ops: Record<string, Record<string, unknown>>[] }[]
  }
  const [curve, grain] = l.stages[0].ops
  assert.equal(curve.ParametricCurve.reach, 'HalfGap')
  assert.equal(grain.Grain.response, 'Midtones')
  assert.deepEqual(grain.Grain.chroma, { amount: 0, size: 1 })
  // Twice is the same; a stated reach and colour grain are kept.
  assert.deepEqual(migrateLook(structuredClone(l)), l)
  const now = {
    ParametricCurve: { ...curve.ParametricCurve, reach: { Range: 0.25 } },
    Grain: { ...grain.Grain, response: { Curve: { points: [] } }, chroma: { amount: 0.2, size: 2 } }
  }
  assert.deepEqual(migrateLook(structuredClone(now)), now)
})

test('a sidecar’s custom layers are migrated as the recipe loads', () => {
  const r = normaliseRecipe(
    { version: 5, custom: [{ id: 'c1', name: 'old', enabled: true, layer: old19() }] },
    false
  )
  const layer = r.custom[0].layer as { mask: { edge: unknown; components: { shift: number }[] } }
  assert.equal(layer.mask.edge, null)
  assert.equal(layer.mask.components[0].shift, -0.01)
})
