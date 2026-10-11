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
import { compileRetouch, newSpot, refineRefused, spotRefine } from '../src/shared/retouch'

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
  const big = { radius: 0.02, feather: 50 }
  assert.equal(spotRefine(undefined, big, 6000, 4000), null)
  assert.ok('Matting' in spotRefine('matting', big, 6000, 4000)!)
  // Edge snap stays inside the spot (the engine refuses a heal snapped as
  // far as its radius): its default where there is room, less on a small
  // brush, and the smallest spots are healed plain.
  const snap = (radius: number, feather: number): number | null => {
    const r = spotRefine('edgeSnap', { radius, feather }, 6000, 4000)
    return r && 'EdgeSnap' in r ? r.EdgeSnap.distance : null
  }
  assert.equal(snap(0.02, 50), 0.005)
  assert.equal(snap(0.004, 0), 0.002)
  assert.ok(snap(0.004, 100)! < 0.002)
  assert.equal(snap(0.001, 0), null)
  assert.ok('Matting' in spotRefine('matting', { radius: 0.001, feather: 0 }, 6000, 4000)!)
  const spot = newSpot('a1', 'heal', [{ x: 0.5, y: 0.5 }], 0.02, 50, 100)
  spot.source = { x: 0.6, y: 0.5 }
  const plain = compileRetouch([spot], 'Normal', 6000, 4000)!
  assert.equal('refine' in (plain.steps[0] as { Heal: object }).Heal, false)
  spot.refine = 'matting'
  const matted = compileRetouch([spot], 'Normal', 6000, 4000)!
  assert.ok('Matting' in (matted.steps[0] as { Heal: { refine: object } }).Heal.refine)
})

test('a heal the engine won’t refine is told from any other refusal', () => {
  // The step itself, by the field the host reads or the message's own.
  assert.ok(refineRefused({ field: 'retouch.steps[0]' }))
  assert.ok(
    refineRefused({
      message: 'invalid request field `retouch.steps[3]`: the heal covers the whole frame'
    })
  )
  // One of its fields (a source past the frame) is another matter, as is anything else.
  assert.ok(!refineRefused({ field: 'retouch.steps[0].source_offset' }))
  assert.ok(!refineRefused({ field: 'grade.layers[0].mask' }))
  assert.ok(!refineRefused(new Error('the disk is full')))
  assert.ok(!refineRefused(null))
})

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
  'the engine takes every refine method across its range, Tone’s base, and each heal edge at the frame’s edge',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { blankRequest, displayPolicy } = await import('../src/main/source')
    const { encodePng16 } = await import('../src/main/pngio')
    const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'phasea-'))
    // The develop view's smallest frame: where a spot's bound is the largest share.
    const w = 1280
    const h = 853
    const px = new Uint16Array(w * h * 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        // Two flat halves with an edge between them, and some texture, for the methods to read.
        const v = (x < w / 2 ? 12000 : 42000) + ((x * 31 + y * 17) % 2000)
        px.fill(v, (y * w + x) * 3, (y * w + x) * 3 + 3)
      }
    const path = join(dir, 'in.png')
    writeFileSync(path, encodePng16(px, w, h, 3))
    const here: CompileContext = { ...ctx, frameWidth: w, frameHeight: h, scale: 1 }
    const render = async (
      grade: unknown,
      retouch: unknown = null
    ): Promise<{ width: number; height: number }> =>
      realEngine!.convert({
        ...blankRequest(path, '', 'Png'),
        sink: 'Bytes',
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Pixels: { sample: 'U8' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy({ is_hdr: false } as never, 'DisplayP3'),
        grade,
        retouch,
        threads: 4
      })
    try {
      // Each method on a lasso mask: at its defaults, and at each parameter's two ends.
      for (const m of REFINE_METHODS) {
        const sets: Record<string, number>[] = [{}]
        for (const p of m.params) sets.push({ [p.key]: p.min }, { [p.key]: p.max })
        for (const params of sets) {
          const r = defaultRecipe(false)
          const l = newLocalLayer('g')
          l.settings.exposure = 1
          l.components.push(lasso({ refine: { on: true, radius: 0.6, method: m.kind, params } }))
          r.layers.push(l)
          const c = compile(r, here)
          await assert.doesNotReject(
            render(c.grade),
            `${m.kind} ${JSON.stringify(params)}: ${JSON.stringify(engineRefine(l.components[0]))}`
          )
        }
      }
      // Smooth, Contrast and a moved edge on a drawn mask.
      const drawn = defaultRecipe(false)
      const dl = newLocalLayer('d')
      dl.settings.exposure = 1
      dl.components.push(lasso({ smooth: 100, contrast: 100 }))
      drawn.layers.push(dl)
      await assert.doesNotReject(render(compile(drawn, here).grade), 'smooth and contrast')
      // Tone on each base: the settled picture's, and a CPU drag's.
      const toned = defaultRecipe(false)
      toned.basic.shadows = 60
      toned.basic.highlights = -60
      toned.toneBase = 'texture'
      await assert.doesNotReject(render(compile(toned, here).grade), 'the local-Laplacian base')
      await assert.doesNotReject(
        render(compile(toned, { ...here, smoothing: false }).grade),
        'the drag’s guided base'
      )
      // A heal on each edge setting, from the smallest brush up, at each
      // feather: mid-frame, and in a corner with its source pulled to the
      // frame's edge. Compiled for the photo (6000 × 4000), rendered on the draft.
      const refused: string[] = []
      for (const refine of [undefined, 'edgeSnap', 'matting'] as const)
        for (const radius of [0.002, 0.0027, 0.004, 0.0073, 0.02, 0.07])
          for (const feather of [0, 37, 100])
            for (const at of [
              { x: 0.5, y: 0.5 },
              { x: 0.04, y: 0.05 },
              { x: 0.96, y: 0.95 },
              { x: 0.013, y: 0.5 }
            ]) {
              const spot = newSpot('s', 'heal', [at], radius, feather, 100)
              spot.source = { x: at.x < 0.5 ? -0.2 : 1.2, y: at.y < 0.5 ? -0.2 : 1.2 }
              if (refine) spot.refine = refine
              const retouch = compileRetouch([spot], 'Normal', 6000, 4000)
              if (!retouch) continue
              await render(null, retouch).catch((err: Error) =>
                refused.push(
                  `${refine ?? 'plain'} r${radius} f${feather} @${at.x},${at.y}: ${err.message}`
                )
              )
            }
      assert.deepEqual(refused, [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
