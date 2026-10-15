/**
 * Engine 0.21's film effects as Playroom compiles them (E41–E44): the
 * grain's colour and tone response, halation and bloom in their own linear
 * stage, the HSL card's Density, and the looks remade on them.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compile,
  effectsTone,
  glowRadius,
  scaleSettings,
  type CompileContext
} from '../src/shared/compile'
import type { Grade, GradeOp } from '../src/shared/engine-types'
import {
  applyGroups,
  changedGroups,
  defaultRecipe,
  newLocalLayer,
  normaliseRecipe,
  type Recipe
} from '../src/shared/recipe'
import { invariantTouches } from '../src/shared/invariant'
import { cardChanged, cardSpec, cardBase } from '../src/shared/cards'
import { LOOKS, LOOK_BY_ID } from '../src/shared/looks/catalog'
import { lookFromFile, lookToFile } from '../src/shared/looks/schema'
import { blendLook } from '../src/shared/looks/amount'
import {
  collection,
  density,
  grain,
  halation,
  bloom,
  hueCurve,
  look
} from '../src/shared/looks/dsl'
import { curvesVsOp } from '../src/shared/resolve'

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

const ops = (g: Grade | null): GradeOp[] =>
  g?.layers.flatMap((l) => l.stages.flatMap((s) => s.ops)) ?? []
const find = <K extends string>(g: Grade | null, kind: K): Extract<GradeOp, Record<K, unknown>>[] =>
  ops(g).filter((o) => kind in o) as Extract<GradeOp, Record<K, unknown>>[]

test('a saved edit from before the film effects reads with them off, and its pixels stay', () => {
  const old = structuredClone(defaultRecipe(true)) as unknown as Record<string, unknown>
  const effects = old.effects as Record<string, unknown>
  delete effects.grainColour
  delete effects.grainResponse
  delete effects.halation
  delete effects.bloom
  delete old.density
  effects.grainAmount = 30
  const r = normaliseRecipe(old, true)
  assert.equal(r.effects.grainColour, 0)
  assert.equal(r.effects.grainResponse, 'film')
  assert.deepEqual(r.effects.halation, defaultRecipe(true).effects.halation)
  assert.deepEqual(r.effects.bloom, defaultRecipe(true).effects.bloom)
  assert.deepEqual(r.density, defaultRecipe(true).density)
  // 0.20's grain, byte for byte, and nothing new.
  const g = compile(r, { ...ctx, isRaw: true }).grade
  assert.equal(find(g, 'Grain')[0].Grain.response, 'Midtones')
  assert.deepEqual(find(g, 'Grain')[0].Grain.chroma, { amount: 0, size: 1 })
  assert.equal(find(g, 'Halation').length + find(g, 'Bloom').length + find(g, 'Density').length, 0)
})

test('what a sidecar cannot mean is put back in range', () => {
  const r = normaliseRecipe(
    {
      effects: {
        grainColour: 400,
        grainResponse: 'sepia',
        halation: { amount: -3, hue: 300 },
        bloom: { style: 'mist', warmth: -900 }
      },
      density: { amount: 5000, bands: { red: 'x', blue: -400 } }
    },
    false
  )
  assert.equal(r.effects.grainColour, 100)
  assert.equal(r.effects.grainResponse, 'film')
  assert.equal(r.effects.halation.amount, 0)
  assert.equal(r.effects.halation.hue, 45)
  assert.equal(r.effects.bloom.style, 'diffusion')
  assert.equal(r.effects.bloom.warmth, -100)
  assert.equal(r.density.amount, 100)
  assert.equal(r.density.bands.red, 100)
  assert.equal(r.density.bands.blue, -100)
})

test('the grain’s Colour and Response reach the engine; a B&W photo gets no colour grain', () => {
  const r = defaultRecipe(false)
  r.effects.grainAmount = 30
  r.effects.grainColour = 40
  r.effects.grainResponse = 'negative'
  const g = find(compile(r, ctx).grade, 'Grain')[0].Grain
  assert.deepEqual(g.chroma, { amount: 0.4, size: 2 })
  assert.deepEqual(g.response, {
    Curve: {
      points: [
        { x: 0, y: 1.6 },
        { x: 0.5, y: 1 },
        { x: 1, y: 0.3 }
      ]
    }
  })
  r.effects.grainResponse = 'flat'
  assert.deepEqual(find(compile(r, ctx).grade, 'Grain')[0].Grain.response, {
    Curve: {
      points: [
        { x: 0, y: 1 },
        { x: 1, y: 1 }
      ]
    }
  })
  // Colour alone is a grain of its own.
  r.effects.grainAmount = 0
  assert.equal(find(compile(r, ctx).grade, 'Grain')[0].Grain.amount, 0)
  r.effects.grainAmount = 30
  r.treatment = 'bw'
  assert.deepEqual(find(compile(r, ctx).grade, 'Grain')[0].Grain.chroma, { amount: 0, size: 1 })
})

test('halation and bloom: none at 0, the log size, in a linear stage between the look and the grain', () => {
  const r = defaultRecipe(false)
  r.basic.contrast = 10
  r.effects.grainAmount = 20
  assert.equal(compile(r, ctx).grade!.layers[0].stages.length, 1)
  r.effects.halation.amount = 50
  r.effects.bloom.amount = 40
  const stages = compile(r, ctx).grade!.layers[0].stages
  assert.equal(stages.length, 3)
  assert.equal(stages[1].space, 'LinearWorking')
  assert.deepEqual(
    stages[1].ops.map((o) => Object.keys(o)[0]),
    ['Halation', 'Bloom']
  )
  // The grain lies over the glows, as on a print.
  assert.deepEqual(
    stages[2].ops.map((o) => Object.keys(o)[0]),
    ['Grain']
  )
  const [h] = find(compile(r, ctx).grade, 'Halation')
  assert.equal(h.Halation.radius, 0.01)
  assert.equal(h.Halation.amount, 0.25)
  assert.equal(h.Halation.space, 'LinearSrgb')
  const [b] = find(compile(r, ctx).grade, 'Bloom')
  assert.equal(b.Bloom.source, 'All')
  assert.equal(glowRadius(0), 0.001)
  assert.equal(glowRadius(100), 0.1)
  assert.equal(glowRadius(65), 0.02)
  r.effects.bloom.style = 'glow'
  const [glow] = find(compile(r, ctx).grade, 'Bloom')
  assert.ok(typeof glow.Bloom.source === 'object' && 'Highlights' in glow.Bloom.source)
})

test('a glow’s threshold is the brightness shown, on the tone a linear stage reads', () => {
  // SDR: linear luminance; 0.8 shown is about 0.6 of light.
  assert.ok(Math.abs(effectsTone(0.8, false) - 0.6038) < 1e-3)
  assert.equal(effectsTone(1, false), 1)
  // Full HDR: PQ's scale to 1000 cd/m², white at 0.77 (the engine's ToneScale).
  assert.ok(Math.abs(effectsTone(1, true) - 0.7723) < 1e-3)
  assert.ok(effectsTone(0.8, true) < effectsTone(1, true))
  const r = defaultRecipe(false)
  r.effects.halation.amount = 50
  const sdr = find(compile(r, ctx).grade, 'Halation')[0].Halation
  const hdr = find(compile(r, { ...ctx, hdr: true }).grade, 'Halation')[0].Halation
  assert.ok(hdr.threshold > sdr.threshold)
  assert.ok(sdr.softness > 0 && hdr.softness > 0)
})

test('on a B&W photo the glows are grey; a mask has none, and its Amount leaves them', () => {
  const r = defaultRecipe(false)
  r.effects.halation.amount = 50
  r.effects.bloom.amount = 40
  r.effects.bloom.warmth = 80
  r.treatment = 'bw'
  const [h] = find(compile(r, ctx).grade, 'Halation')
  assert.equal(h.Halation.color.r, h.Halation.color.g)
  assert.equal(h.Halation.color.g, h.Halation.color.b)
  assert.deepEqual(find(compile(r, ctx).grade, 'Bloom')[0].Bloom.color, { r: 1, g: 1, b: 1 })
  const m = defaultRecipe(false)
  const layer = newLocalLayer('Mask')
  layer.components.push({
    id: 'g',
    kind: 'linear',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    start: { x: 0.5, y: 0 },
    end: { x: 0.5, y: 1 },
    width: 512,
    height: 512
  })
  layer.settings.effects.halation.amount = 80
  layer.settings.effects.bloom.amount = 80
  layer.settings.basic.exposure = 0.5
  m.layers.push(layer)
  const g = compile(m, ctx).grade
  assert.equal(find(g, 'Halation').length + find(g, 'Bloom').length, 0)
  const scaled = scaleSettings(layer.settings, 50)
  assert.deepEqual(scaled.effects.halation, layer.settings.effects.halation)
  assert.deepEqual(scaled.effects.bloom, layer.settings.effects.bloom)
})

test('a B&W photo with a mask glows in its finishing layer, after the mask, in linear light', () => {
  const r = defaultRecipe(false)
  r.treatment = 'bw'
  r.effects.halation.amount = 50
  r.effects.grainAmount = 20
  const layer = newLocalLayer('Mask')
  layer.components.push({
    id: 'g',
    kind: 'linear',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    start: { x: 0.5, y: 0 },
    end: { x: 0.5, y: 1 },
    width: 512,
    height: 512
  })
  layer.settings.basic.exposure = 0.5
  r.layers.push(layer)
  const g = compile(r, ctx).grade!
  const names = g.layers.map((l) => l.name)
  const finish = g.layers[names.indexOf('black & white')]
  assert.ok(names.indexOf('black & white') > names.indexOf('Mask'))
  // The grey mix, then the glow in light, then the print's grain over it.
  assert.deepEqual(
    finish.stages.map((s) => s.space === 'LinearWorking'),
    [false, true, false]
  )
  assert.deepEqual(
    finish.stages.slice(1).map((s) => s.ops.map((o) => Object.keys(o)[0])),
    [['Halation'], ['Grain']]
  )
  assert.equal(find({ ...g, layers: [g.layers[0]] }, 'Halation').length, 0)
})

test('a glow, a density or a colour grain takes a drag off the GPU, by the op’s field', async () => {
  const { gpuRefusal } = await import('../src/shared/gpudrag')
  const r = defaultRecipe(false)
  r.basic.contrast = 10
  assert.equal(gpuRefusal(compile(r, ctx).grade), null)
  r.effects.halation.amount = 40
  assert.equal(gpuRefusal(compile(r, ctx).grade), 'grade.layers[0].stages[1].ops[0]')
  r.effects.halation.amount = 0
  r.density.amount = 30
  assert.match(
    gpuRefusal(compile(r, ctx).grade) ?? '',
    /^grade\.layers\[0\]\.stages\[0\]\.ops\[\d+\]$/
  )
})

test('Density: after the HSL bands, none at 0 or on B&W, bands by name; a mask scales its amount', () => {
  const r = defaultRecipe(false)
  r.hsl.red.saturation = 20
  r.presence.saturation = 10
  r.density.bands.yellow = 0
  assert.equal(find(compile(r, ctx).grade, 'Density').length, 0)
  r.density.amount = 60
  const look = compile(r, ctx).grade!.layers[0].stages[0].ops.map((o) => Object.keys(o)[0])
  assert.deepEqual(look.slice(look.indexOf('HslBands'), look.indexOf('HslBands') + 3), [
    'HslBands',
    'Density',
    'Primary'
  ])
  const [d] = find(compile(r, ctx).grade, 'Density')
  assert.equal(d.Density.amount, 0.6)
  assert.equal(d.Density.bands.yellow, 0)
  assert.equal(d.Density.bands.aqua, 1)
  for (const b of Object.keys(r.density.bands) as (keyof typeof r.density.bands)[])
    r.density.bands[b] = 0
  assert.equal(find(compile(r, ctx).grade, 'Density').length, 0)
  r.density.bands.blue = 100
  r.treatment = 'bw'
  assert.equal(find(compile(r, ctx).grade, 'Density').length, 0)
  const s = newLocalLayer('Mask').settings
  s.density.amount = 40
  assert.equal(scaleSettings(s, 150).density.amount, 60)
  assert.equal(scaleSettings(s, 150).density.bands.red, 100)
})

test('the HSL card holds Density, copy and paste carry it with HSL, and a broken op names its slider', () => {
  const r = defaultRecipe(false)
  r.density.amount = 30
  r.effects.halation.amount = 20
  const base = cardBase(r, false, false)
  assert.ok(cardChanged(cardSpec('mixer'), r, base, false))
  assert.ok(cardChanged(cardSpec('effects'), r, base, false))
  assert.ok(changedGroups(r, defaultRecipe(false)).includes('hsl'))
  assert.equal(applyGroups(defaultRecipe(false), r, ['hsl']).density.amount, 30)
  assert.ok(
    invariantTouches(
      { layer: 'base', layerName: 'base', op: 'Halation', sdr: false },
      'effects.halation.amount'
    )
  )
  assert.ok(
    invariantTouches(
      { layer: 'base', layerName: 'base', op: 'Bloom', sdr: false },
      'effects.bloom.size'
    )
  )
  assert.ok(
    invariantTouches(
      { layer: 'base', layerName: 'base', op: 'Density', sdr: false },
      'density.bands.red'
    )
  )
  assert.ok(
    invariantTouches(
      { layer: 'base', layerName: 'base', op: 'Grain', sdr: false },
      'effects.grainColour'
    )
  )
})

// ── The looks ────────────────────────────────────────────────────────────────

const HALATION_LOOKS = [
  'tungsten-cine-neg-500',
  'tungsten-night-800',
  'clean-daylight-50',
  'warm-daylight-400',
  'club-purple'
]
const BLOOM_LOOKS = [
  'infrared-mono',
  'cyberpunk-night',
  'honey-haze',
  'instant-colour',
  'infrared-arena',
  'orange-haze-city',
  'cold-smog',
  'neon-drive',
  'crimson-melancholy',
  'neon-grain-nights',
  'coral-warmth',
  'tokyo-hush',
  'vintage-studio-mono',
  'dream',
  'pure'
]
const SLIDE_LOOKS = [
  'standard-slide',
  'vivid-slide',
  'soft-slide',
  'clean-slide-100',
  'classic-slide-64',
  'saturated-slide-50',
  'reversal-slide',
  'positive-film',
  'three-strip-glory'
]
const SWAP_LOOKS = ['two-strip-colour', 'purple-swap', 'ir-false-colour']
const byId = (slug: string): (typeof LOOKS)[number] => LOOK_BY_ID.get(`builtin:${slug}`)!

test('no built-in look stands in for halation, bloom or a hue swap any more', () => {
  for (const l of LOOKS)
    for (const a of ['halation', 'bloom', 'chromaGrain', 'hueSwap'] as const)
      assert.ok(!l.meta.approximates?.includes(a), `${l.name}: ${a}`)
})

test('the remade looks set the real effects, and say they changed', () => {
  const has = (slug: string, prefix: string): boolean =>
    byId(slug).fields.some((f) => f.join('.').startsWith(prefix))
  for (const s of HALATION_LOOKS) {
    assert.ok(has(s, 'effects.halation.'), s)
    assert.ok(byId(s).recipe.effects.halation.amount > 0, s)
  }
  for (const s of BLOOM_LOOKS) {
    assert.ok(has(s, 'effects.bloom.'), s)
    assert.ok(byId(s).recipe.effects.bloom.amount > 0, s)
  }
  for (const s of ['neon-drive', 'neon-grain-nights', 'cyberpunk-night'])
    assert.equal(byId(s).recipe.effects.bloom.style, 'glow', s)
  for (const s of SLIDE_LOOKS) {
    assert.ok(byId(s).recipe.density.amount > 0, s)
    assert.ok(has(s, 'density.'), s)
  }
  for (const s of [...HALATION_LOOKS, ...BLOOM_LOOKS, ...SLIDE_LOOKS, ...SWAP_LOOKS])
    assert.ok(byId(s).meta.version >= 3, `${s} is version ${byId(s).meta.version}`)
  // Colour negatives have colour grain.
  for (const s of ['tungsten-night-800', 'warm-portrait-400', 'tungsten-cine-neg-500'])
    assert.ok(byId(s).recipe.effects.grainColour > 0, s)
})

test('a look’s grain is all of it, colour and response too; its glows and density whole', () => {
  const [l] = collection('creative', [
    look(
      'probe',
      'Probe',
      { tags: [] },
      grain(20, 30, 40, { colour: 30, response: 'negative' }),
      halation(40),
      bloom(20, { style: 'glow' }),
      density(30, { aqua: 50 })
    )
  ])
  const keys = l.fields.map((f) => f.join('.'))
  for (const k of [
    'effects.grainColour',
    'effects.grainResponse',
    'effects.halation.threshold',
    'effects.halation.hue',
    'effects.bloom.style',
    'effects.bloom.warmth',
    'density.amount',
    'density.bands.red',
    'density.bands.aqua'
  ])
    assert.ok(keys.includes(k), k)
  assert.ok(l.groups.includes('hsl') && l.groups.includes('effects'))
  // Half the look: numbers half way, a style the look's.
  const half = blendLook(defaultRecipe(false), l.recipe, l.fields, 0.5)
  assert.equal(half.effects.halation.amount, 20)
  assert.equal(half.effects.halation.hue, 12)
  assert.equal(half.effects.bloom.style, 'glow')
  assert.equal(half.density.amount, 15)
})

test('a look file keeps the effects’ words, and drops ones it does not know', () => {
  const file = lookToFile(byId('neon-drive'))
  assert.equal(lookFromFile(file, { trusted: true }).look.recipe.effects.bloom.style, 'glow')
  const bad = structuredClone(file)
  bad.look.values['effects.bloom.style'] = 'mist'
  bad.look.values['effects.grainResponse'] = 'sepia'
  bad.look.values['density.amount'] = 400
  const read = lookFromFile(bad, { trusted: true })
  assert.ok(read.dropped.includes('effects.bloom.style'))
  assert.ok(read.dropped.includes('effects.grainResponse'))
  assert.ok(read.clamped.includes('density.amount'))
  assert.equal((read.look.recipe as Recipe).density.amount, 100)
})

test('the false-colour looks turn hues past ±30°, on Hue vs Hue', () => {
  for (const s of SWAP_LOOKS) {
    const op = curvesVsOp(byId(s).recipe.curvesVs)
    assert.ok(op && 'Curves' in op && op.Curves.hue_vs_hue, s)
    const most = Math.max(...op.Curves.hue_vs_hue.points.map((p) => Math.abs(p.y)))
    assert.ok(most > 30, `${s}: ${most}°`)
  }
  const r = defaultRecipe(false)
  hueCurve('hueHue', [[120, 150]])(r, {} as never)
  const op = curvesVsOp(r.curvesVs)
  assert.ok(op && 'Curves' in op)
  assert.ok(op.Curves.hue_vs_hue!.points.some((p) => Math.abs(p.y - 150) < 0.05))
})

// ── On the engine ────────────────────────────────────────────────────────────

/** The native engine, where it is built (not in CI: this check skips). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{ output: Uint8Array; width: number; height: number }>
    }
  } catch {
    return null
  }
})()

test(
  'the engine renders every film effect as Playroom compiles it, colour and B&W, and a glow spreads light',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { blankRequest, displayPolicy } = await import('../src/main/source')
    const { encodePng16 } = await import('../src/main/pngio')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'film-'))
    const w = 96
    const h = 64
    // A dark field, coloured patches and one bright spot in the middle.
    const px = new Uint16Array(w * h * 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        const spot = Math.hypot(x - 48, y - 32) < 3
        px[i] = spot ? 65535 : x < 32 ? 40000 : 8000
        px[i + 1] = spot ? 65535 : x >= 64 ? 36000 : 8000
        px[i + 2] = spot ? 65535 : 8000
      }
    const path = join(dir, 'in.png')
    writeFileSync(path, encodePng16(px, w, h, 3))
    const fctx: CompileContext = { ...ctx, frameWidth: w, frameHeight: h, scale: 1 }
    const render = async (r: Recipe): Promise<Uint8Array> =>
      (
        await realEngine!.convert({
          ...blankRequest(path, '', 'Png'),
          sink: 'Bytes',
          pixel: { depth: 'Eight', channels: 3 },
          encode: { Pixels: { sample: 'U8' } },
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          color: displayPolicy({ is_hdr: false } as never, 'DisplayP3'),
          grade: compile(r, fctx).grade,
          threads: 2
        })
      ).output
    try {
      const r = defaultRecipe(false)
      r.basic.contrast = 5
      const plain = await render(r)
      r.effects.halation = { amount: 100, threshold: 60, size: 90, hue: 10 }
      const glowing = await render(r)
      // Beside the spot (6 px right of it), the halation adds red light.
      const at = (y: number, x: number): number => (y * w + x) * 3
      assert.ok(glowing[at(32, 54)] > plain[at(32, 54)], 'halation reaches past the spot')
      r.effects.bloom = { style: 'glow', amount: 60, size: 50, threshold: 70, warmth: 40 }
      r.effects.grainAmount = 30
      r.effects.grainColour = 40
      r.effects.grainResponse = 'negative'
      r.density.amount = 60
      await assert.doesNotReject(render(r), 'colour')
      r.effects.bloom.style = 'diffusion'
      r.treatment = 'bw'
      await assert.doesNotReject(render(r), 'black and white')
      await assert.doesNotReject(render({ ...r, treatment: 'color' }), 'diffusion')
      // Colour grain alone (Amount 0) still grains: the engine's grain is not
      // skipped for a luminance amount of 0 while its colour is above it.
      const flat = defaultRecipe(false)
      flat.basic.contrast = 5
      const clean = await render(flat)
      flat.effects.grainColour = 80
      const coloured = await render(flat)
      let moved = 0
      for (let i = 0; i < clean.length; i++) if (clean[i] !== coloured[i]) moved++
      assert.ok(moved > clean.length / 4, `colour grain moved ${moved} of ${clean.length}`)
      // A B&W photo with a mask: the glows in the finishing layer.
      const masked = structuredClone(r)
      const layer = newLocalLayer('Mask')
      layer.components.push({
        id: 'g',
        kind: 'linear',
        mode: 'Add',
        opacity: 100,
        invert: false,
        feather: 0,
        start: { x: 0.5, y: 0 },
        end: { x: 0.5, y: 1 },
        width: w,
        height: h
      })
      layer.settings.basic.exposure = 0.3
      masked.layers.push(layer)
      await assert.doesNotReject(render(masked), 'black and white, masked')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
