import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, within45, type CompileContext } from '../src/shared/compile'
import {
  changedGroups,
  defaultRecipe,
  isNeutral,
  neutralSettings,
  normaliseRecipe,
  sameValue
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

/** A default recipe with `patch` written over it, as a broken sidecar might hold. */
function broken(patch: (r: Record<string, unknown>) => void): unknown {
  const r = JSON.parse(JSON.stringify(defaultRecipe(false))) as Record<string, unknown>
  patch(r)
  return r
}

const finite = (v: unknown): boolean =>
  typeof v === 'number'
    ? Number.isFinite(v)
    : Array.isArray(v)
      ? v.every(finite)
      : v && typeof v === 'object'
        ? Object.values(v).every((x) => x === null || typeof x !== 'number' || finite(x))
        : true

test('a broken sidecar normalises to a recipe that compiles to finite numbers', () => {
  const cases: [string, (r: Record<string, unknown>) => void][] = [
    ['a null layer', (r) => (r.layers = [null])],
    [
      'a layer missing its fields',
      (r) =>
        (r.layers = [
          {
            components: [
              {
                id: 'p',
                kind: 'polygon',
                points: [
                  { x: 0.1, y: 0.1 },
                  { x: 0.9, y: 0.1 },
                  { x: 0.5, y: 0.9 }
                ]
              }
            ],
            settings: { basic: { exposure: 1 } }
          }
        ])
    ],
    ['one split', (r) => ((r.toneCurve as Record<string, unknown>).splits = [25])],
    [
      'splits out of order',
      (r) => ((r.toneCurve as Record<string, unknown>).splits = [75, 25, 25])
    ],
    [
      'a null curve point',
      (r) =>
        ((r.toneCurve as Record<string, unknown>).master = [{ x: 0, y: 0 }, null, { x: 1, y: 1 }])
    ],
    [
      'a one-point curve',
      (r) => ((r.toneCurve as Record<string, unknown>).red = [{ x: 0.5, y: 0.6 }])
    ],
    ['a crop that is a number', (r) => ((r.geometry as Record<string, unknown>).crop = 7)],
    [
      'a crop missing a side',
      (r) => ((r.geometry as Record<string, unknown>).crop = { x: 0.1, y: 0.1, width: 0.5 })
    ]
  ]
  for (const [name, patch] of cases) {
    const r = normaliseRecipe(broken(patch), false)
    for (const l of r.layers) {
      assert.equal(typeof l.enabled, 'boolean', name)
      assert.ok(Number.isFinite(l.opacity), name)
      assert.ok(typeof l.blend === 'string', name)
    }
    for (const ch of ['master', 'red', 'green', 'blue'] as const)
      assert.ok(r.toneCurve[ch].length >= 2, `${name}: ${ch}`)
    const [a, b, c] = r.toneCurve.splits
    assert.ok(a < b && b < c, name)
    const out = compile(r, ctx)
    assert.ok(finite(JSON.parse(JSON.stringify(out.grade))), name)
    assert.ok(finite(JSON.parse(JSON.stringify(out.framing))), name)
  }
})

test('curve points that round to one x are one point (strictly increasing)', () => {
  const r = defaultRecipe(false)
  r.toneCurve.master = [
    { x: 0, y: 0 },
    { x: 0.50001, y: 0.4 },
    { x: 0.50004, y: 0.6 },
    { x: 1, y: 1 }
  ]
  // Every point curve handed to the engine is strictly increasing in x.
  const curves: { x: number }[][] = []
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    const o = v as Record<string, unknown>
    if (Array.isArray(o.points) && o.points.every((p) => p && typeof p === 'object' && 'x' in p))
      curves.push(o.points as { x: number }[])
    Object.values(o).forEach(walk)
  }
  walk(compile(r, ctx).grade)
  assert.ok(curves.length > 0)
  for (const xs of curves.map((c) => c.map((p) => p.x)))
    for (let k = 1; k < xs.length; k++) assert.ok(xs[k] > xs[k - 1], xs.join(','))
})

test('the same values in another key order are the same', () => {
  const a = defaultRecipe(false)
  const b = defaultRecipe(false)
  b.basic = Object.fromEntries(Object.entries(b.basic).reverse()) as typeof b.basic
  assert.deepEqual(changedGroups(a, b), [])
  const s = neutralSettings()
  s.basic = Object.fromEntries(Object.entries(s.basic).reverse()) as typeof s.basic
  assert.equal(isNeutral(s), true)
  assert.equal(sameValue({ a: 1, b: undefined }, { a: 1 }), true)
  assert.equal(sameValue([1, 2], [2, 1]), false)
})

test('a vignette turned past 45° is the same rectangle turned back, its sides swapped', () => {
  const half = { x: 0.4, y: 0.3 }
  assert.deepEqual(within45(half, 30, 6000, 4000), { half, rotation: 30 })
  const t = within45(half, 70, 6000, 4000)
  assert.ok(Math.abs(t.rotation + 20) < 1e-9)
  // Sides swapped in pixels: 0.3 × 4000 across, 0.4 × 6000 down.
  assert.ok(Math.abs(t.half.x * 6000 - 1200) < 1e-9 && Math.abs(t.half.y * 4000 - 2400) < 1e-9)
  assert.ok(Math.abs(within45(half, -170, 6000, 4000).rotation - 10) < 1e-9)
})

test('a built-in preset sets its own sliders and leaves the rest of the photo alone', async () => {
  const { BUILTIN_PRESETS } = await import('../src/shared/presets')
  const { applyFields } = await import('../src/shared/recipe')
  const photo = defaultRecipe(false)
  photo.basic.exposure = 1
  photo.basic.whites = 20
  photo.pointColors = [
    {
      id: 'pc',
      hue: 30,
      saturation: 0.5,
      luminance: 0.5,
      shiftHue: 10,
      shiftSat: 0,
      shiftLum: 0,
      range: 50
    }
  ]
  const portrait = BUILTIN_PRESETS.find((p) => p.id === 'builtin:portrait')!
  const a = applyFields(photo, portrait.recipe, portrait.fields!)
  assert.equal(a.basic.exposure, 1)
  assert.equal(a.basic.whites, 20)
  assert.equal(a.basic.shadows, 15)
  assert.equal(a.presence.texture, -20)
  const film = BUILTIN_PRESETS.find((p) => p.id === 'builtin:warm-film')!
  const b = applyFields(photo, film.recipe, film.fields!)
  assert.equal(b.pointColors.length, 1)
  assert.equal(b.effects.grainAmount, 18)
  assert.deepEqual(b.toneCurve.master, film.recipe.toneCurve.master)
})
