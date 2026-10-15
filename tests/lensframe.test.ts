// The lens frame masks are drawn on (shared/lensframe.ts): carried to the
// frame rendered, rewritten when a lens edit settles, recorded on old
// recipes, pasted, undone, and mapped in the loupe. Pure: synthetic maps.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Distortion } from '../src/shared/engine-types'
import { compile, type CompileContext } from '../src/shared/compile'
import { diffRecipe, applyPatch } from '../src/shared/history'
import {
  carryFrame,
  frameMap,
  framesIn,
  gridPoint,
  lensFrameKey,
  makeGrid,
  normaliseLensFrame,
  ownLensFrame,
  placeMasks,
  planeWarp,
  rebaseNeed,
  retagMasks,
  sameLensFrame,
  spotFramesKey,
  spotsOn,
  stForward,
  stInverse,
  warpPlane,
  type FrameMaps,
  type MaskFrames,
  type P,
  type StMap
} from '../src/shared/lensframe'
import {
  applyGroups,
  defaultRecipe,
  newLocalLayer,
  normaliseRecipe,
  RECIPE_VERSION,
  type MaskComponentSetting,
  type Recipe
} from '../src/shared/recipe'
import type { RetouchSpot } from '../src/shared/retouch'
import { baseToDisplay, displayToBase, viewGeometry } from '../src/shared/view'

/** A barrel-like correction about the centre: where corrected point `p` comes from. */
const barrel =
  (k: number) =>
  (p: P): P => {
    const dx = p.x - 0.5
    const dy = (p.y - 0.5) * (2 / 3)
    const s = 1 + k * (dx * dx + dy * dy)
    return { x: 0.5 + dx * s * 0.96, y: 0.5 + (dy * s * 0.96) / (2 / 3) }
  }

/** An ST map sampled from `f`, as main decodes one (pixel centres). */
function sampled(f: (p: P) => P, w = 300, h = 200): StMap {
  const sx = new Float32Array(w * h)
  const sy = new Float32Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const s = f({ x: (i + 0.5) / w, y: (j + 0.5) / h })
      sx[j * w + i] = s.x
      sy[j * w + i] = s.y
    }
  return { w, h, sx, sy }
}

const FRAME_A: Distortion = {
  model: { Poly3: { k1: -0.03 } },
  geometry: { centre: { x: 0.5, y: 0.5 }, unit: 'HalfDiagonal' },
  amount: 1,
  scale: 1
}
const FRAME_B: Distortion = { ...FRAME_A, model: { Poly3: { k1: 0.04 } } }
const mapA = sampled(barrel(0.12))
const mapB = sampled(barrel(-0.1))
const MAPS: FrameMaps = {
  [lensFrameKey(null)]: null,
  [lensFrameKey(FRAME_A)]: mapA,
  [lensFrameKey(FRAME_B)]: mapB
}

const near = (a: P, b: P, e: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) < e

test('an ST map read back, and inverted by Newton’s method, inside the frame and past it', () => {
  const f = barrel(0.12)
  for (const p of [
    { x: 0.5, y: 0.5 },
    { x: 0.1, y: 0.2 },
    { x: 0.93, y: 0.88 },
    { x: -0.1, y: 0.4 },
    { x: 1.2, y: -0.1 }
  ]) {
    const s = stForward(mapA, p)
    if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
      assert.ok(near(s, f(p), 2e-4), `${p.x},${p.y}`)
    assert.ok(near(stInverse(mapA, s), p, 1e-7), `inverse at ${p.x},${p.y}`)
  }
})

test('a point carried from one lens frame to another, and back', () => {
  const ab = frameMap(MAPS, FRAME_A, FRAME_B)
  const ba = frameMap(MAPS, FRAME_B, FRAME_A)
  const an = frameMap(MAPS, FRAME_A, null)
  for (const p of [
    { x: 0.2, y: 0.3 },
    { x: 0.8, y: 0.75 }
  ]) {
    assert.ok(near(ba(ab(p)), p, 1e-7))
    // Onto no correction: where the photo's pixel is.
    assert.ok(near(an(p), stForward(mapA, p), 1e-12))
    assert.notDeepEqual(ab(p), p)
  }
  // The same frame: the identity, whatever its map.
  const same = frameMap({}, FRAME_A, { ...FRAME_A })
  assert.deepEqual(same({ x: 0.3, y: 0.4 }), { x: 0.3, y: 0.4 })
})

test('a frame’s key does not depend on how its fields were written', () => {
  const reordered = JSON.parse(
    '{"scale":1,"amount":1,"geometry":{"unit":"HalfDiagonal","centre":{"y":0.5,"x":0.5}},"model":{"Poly3":{"k1":-0.03}}}'
  ) as Distortion
  assert.ok(sameLensFrame(FRAME_A, reordered))
  assert.ok(!sameLensFrame(FRAME_A, FRAME_B))
  assert.ok(sameLensFrame(null, undefined))
  assert.equal(normaliseLensFrame({ model: 3 }), undefined)
  assert.equal(normaliseLensFrame(null), null)
  assert.deepEqual(normaliseLensFrame(FRAME_A), FRAME_A)
})

/** A recipe with one of each placed mask, and a spot, on frame `on`. */
function withMasks(on: Distortion | null): Recipe {
  const r = defaultRecipe(false)
  r.masks = { lensFrame: on }
  const l = newLocalLayer('m')
  l.id = 'L'
  const base = { mode: 'Add' as const, opacity: 100, invert: false, feather: 0 }
  l.components = [
    {
      ...base,
      id: 'rad',
      kind: 'radial',
      centre: { x: 0.2, y: 0.25 },
      radiusX: 0.05,
      radiusY: 0.08,
      angle: 10,
      softness: 20,
      width: 512,
      height: 341
    },
    {
      ...base,
      id: 'lin',
      kind: 'linear',
      start: { x: 0.7, y: 0.2 },
      end: { x: 0.8, y: 0.3 },
      width: 512,
      height: 341
    },
    {
      ...base,
      id: 'poly',
      kind: 'polygon',
      points: [
        { x: 0.1, y: 0.8 },
        { x: 0.2, y: 0.8 },
        { x: 0.15, y: 0.9 }
      ]
    },
    { ...base, id: 'brush', kind: 'brush', width: 10, height: 7, png: '', ref: 'p' },
    {
      ...base,
      id: 'range',
      kind: 'range',
      hue: { centre: 30, width: 20, softness: 5 },
      saturation: null,
      luma: null,
      smoothness: 0
    }
  ]
  r.layers = [l]
  r.retouch = [
    {
      id: 's',
      kind: 'clone',
      enabled: true,
      points: [{ x: 0.85, y: 0.85 }],
      radius: 0.02,
      radiusY: 0.02,
      rotate: 0,
      source: { x: 0.6, y: 0.6 },
      feather: 0,
      opacity: 100,
      desaturate: 0,
      darken: 0,
      amount: 0,
      pupilLevel: 0
    }
  ]
  return r
}

const comp = (r: Recipe, id: string): MaskComponentSetting =>
  r.layers[0].components.find((c) => c.id === id)!

test('masks on the frame rendered are left as they are; on another, their points move', () => {
  const r = withMasks(FRAME_A)
  const onA: MaskFrames = { to: FRAME_A, maps: MAPS }
  assert.equal(placeMasks(r, onA, 'render'), r, 'the fast path: nothing made')
  assert.deepEqual(
    framesIn(r).map((f) => lensFrameKey(f)),
    [lensFrameKey(FRAME_A)]
  )
  const toB = placeMasks(r, { to: FRAME_B, maps: MAPS }, 'render')
  const ab = frameMap(MAPS, FRAME_A, FRAME_B)
  const rad = comp(toB, 'rad') as Extract<MaskComponentSetting, { kind: 'radial' }>
  assert.deepEqual(rad.centre, ab({ x: 0.2, y: 0.25 }))
  assert.ok(rad.radiusX !== 0.05 && Math.abs(rad.radiusX / rad.radiusY - 0.05 / 0.08) < 1e-9)
  assert.equal(rad.angle, 10, 'an ellipse stays an ellipse')
  const lin = comp(toB, 'lin') as Extract<MaskComponentSetting, { kind: 'linear' }>
  assert.deepEqual(lin.end, ab({ x: 0.8, y: 0.3 }))
  const poly = comp(toB, 'poly') as Extract<MaskComponentSetting, { kind: 'polygon' }>
  assert.deepEqual(poly.points[2], ab({ x: 0.15, y: 0.9 }))
  // A plane is re-warped by main, not here; a range has nowhere to be.
  assert.equal(comp(toB, 'brush'), comp(r, 'brush'))
  assert.equal(comp(toB, 'range'), comp(r, 'range'))
  const s = toB.retouch[0]
  assert.deepEqual(s.points[0], ab({ x: 0.85, y: 0.85 }))
  assert.deepEqual(s.source, ab({ x: 0.6, y: 0.6 }))
  // The record is the render's business only in a rebase.
  assert.ok(sameLensFrame(toB.masks.lensFrame, FRAME_A))
  // What compile hands the engine is the moved masks.
  const ctx: CompileContext = {
    isRaw: false,
    asShot: null,
    sourceOrientation: 'Normal',
    frameWidth: 1200,
    frameHeight: 800,
    scale: 1,
    seed: 1,
    brushPaths: { brush: '/b.png' },
    applyCrop: true
  }
  const plain = compile(r, ctx)
  const moved = compile(r, { ...ctx, maskFrames: { to: FRAME_B, maps: MAPS } })
  assert.notDeepEqual(moved.grade, plain.grade)
  assert.deepEqual(moved.grade, compile(toB, ctx).grade)
  assert.notDeepEqual(moved.retouch, plain.retouch)
})

test('a lens edit settling rewrites the points and the record; a plane keeps its pixels and says where', () => {
  const r = withMasks(null)
  r.lens.distortion = 40
  assert.equal(rebaseNeed(r), 'remap')
  const own = ownLensFrame(r)
  assert.ok(own)
  const maps: FrameMaps = { [lensFrameKey(null)]: null, [lensFrameKey(own)]: mapA }
  const rebased = placeMasks(r, { to: own, maps }, 'rebase')
  assert.ok(sameLensFrame(rebased.masks.lensFrame, own))
  assert.equal(rebaseNeed(rebased), 'none')
  const brush = comp(rebased, 'brush') as { lensFrame?: unknown }
  assert.equal(brush.lensFrame, null, 'the plane is on the uncorrected frame it was painted on')
  assert.equal((comp(rebased, 'rad') as { lensFrame?: unknown }).lensFrame, undefined)
  // Rebased again onto the plane's own frame (Optics' correction taken off): the plane's mark goes.
  const back = placeMasks(rebased, { to: null, maps }, 'rebase')
  assert.equal((comp(back, 'brush') as { lensFrame?: unknown }).lensFrame, undefined)
  assert.ok(near((comp(back, 'rad') as { centre: P }).centre, { x: 0.2, y: 0.25 }, 1e-7))
})

test('with no point to move, a lens edit only moves the record', () => {
  const r = defaultRecipe(false)
  r.lens.distortion = 30
  assert.equal(rebaseNeed(r), 'retag')
  assert.ok(sameLensFrame(retagMasks(r).masks.lensFrame, ownLensFrame(r)))
  // A plane alone is no point either: it is marked with the frame it was on.
  const p = withMasks(null)
  p.layers[0].components = p.layers[0].components.filter((c) => c.id === 'brush')
  p.retouch = []
  p.lens.distortion = 30
  assert.equal(rebaseNeed(p), 'retag')
  const t = retagMasks(p)
  assert.equal((comp(t, 'brush') as { lensFrame?: unknown }).lensFrame, null)
  assert.equal(rebaseNeed(defaultRecipe(false)), 'none')
})

test('a recipe from before the record takes the lens it renders with', () => {
  const lensed = defaultRecipe(false)
  lensed.lens.distortion = 25
  const { masks: _, ...old } = { ...lensed, version: 5 }
  void _
  const read = normaliseRecipe(old, false)
  assert.equal(read.version, RECIPE_VERSION)
  assert.equal(RECIPE_VERSION, 6)
  assert.ok(sameLensFrame(read.masks.lensFrame, ownLensFrame(lensed)))
  // Optics switched off: the masks were drawn on the uncorrected picture.
  const off = normaliseRecipe({ ...old, off: { optics: true } }, false)
  assert.equal(off.masks.lensFrame, null)
  // No correction that moves pixels: nothing to record.
  assert.equal(normaliseRecipe({ version: 5 }, false).masks.lensFrame, null)
  // A record is kept as written, a component's and a spot's too; a broken one goes.
  const kept = normaliseRecipe(
    {
      ...withMasks(FRAME_A),
      layers: [
        {
          ...withMasks(FRAME_A).layers[0],
          components: [
            { ...comp(withMasks(FRAME_A), 'brush'), lensFrame: FRAME_B },
            { ...comp(withMasks(FRAME_A), 'rad'), lensFrame: { model: 'x' } }
          ]
        }
      ],
      retouch: [{ ...withMasks(FRAME_A).retouch[0], lensFrame: null }]
    },
    false
  )
  assert.ok(sameLensFrame(kept.masks.lensFrame, FRAME_A))
  assert.deepEqual((kept.layers[0].components[0] as { lensFrame?: unknown }).lensFrame, FRAME_B)
  assert.equal('lensFrame' in kept.layers[0].components[1], false)
  assert.equal((kept.retouch[0] as RetouchSpot).lensFrame, null)
})

test('masks pasted from another photo carry its frame; the target maps them', () => {
  const from = withMasks(FRAME_A)
  const to = withMasks(FRAME_B)
  to.layers = []
  const pasted = applyGroups(to, from, ['localAdjustments', 'retouch'])
  assert.ok(sameLensFrame(pasted.masks.lensFrame, FRAME_B))
  for (const c of pasted.layers[0].components)
    assert.ok(sameLensFrame((c as { lensFrame?: Distortion | null }).lensFrame, FRAME_A))
  assert.ok(sameLensFrame(pasted.retouch[0].lensFrame, FRAME_A))
  assert.equal(rebaseNeed({ ...pasted, lens: from.lens }), 'remap')
  // From a photo on the same frame: nothing to say.
  const same = applyGroups(withMasks(FRAME_A), from, ['localAdjustments'])
  assert.equal((same.layers[0].components[0] as { lensFrame?: unknown }).lensFrame, undefined)
  assert.deepEqual(carryFrame([{ lensFrame: null }], FRAME_A, FRAME_B), [{ lensFrame: null }])
})

test('undoing a lens edit brings back its lens, the masks’ points and their record together', () => {
  const before = withMasks(null)
  const after = placeMasks(
    { ...before, lens: { ...before.lens, distortion: 40 } },
    { to: FRAME_A, maps: MAPS },
    'rebase'
  )
  const patch = diffRecipe(before, after)
  assert.deepEqual(applyPatch(before, patch), after)
  assert.ok(patch.some((op) => op.path.join('.') === 'masks.lensFrame'))
  // The step hidden: the base is the photo as it was, record and points.
  assert.equal(before.masks.lensFrame, null)
  assert.deepEqual((comp(before, 'rad') as { centre: P }).centre, { x: 0.2, y: 0.25 })
})

test('the loupe maps its pointer through the lens grid, and handles back', () => {
  const toMasks = frameMap(MAPS, null, FRAME_A)
  const toRendered = frameMap(MAPS, FRAME_A, null)
  const grid = makeGrid(toMasks, toRendered)
  for (const p of [
    { x: 0.3, y: 0.4 },
    { x: 0.9, y: 0.1 }
  ]) {
    assert.ok(near(gridPoint(grid.toMasks, grid.n, p), toMasks(p), 2e-4))
    assert.ok(near(gridPoint(grid.toRendered, grid.n, gridPoint(grid.toMasks, grid.n, p)), p, 3e-4))
  }
  const r = defaultRecipe(false)
  r.geometry.straighten = 5
  const g = viewGeometry(r, 3000, 2000, false)
  const withLens = { ...g, lens: grid }
  const d = { x: 0.4, y: 0.6 }
  const b = displayToBase(withLens, d)
  assert.ok(near(b, toMasks(displayToBase(g, d)), 2e-4))
  assert.ok(near(baseToDisplay(withLens, b), d, 3e-4))
})

test('a plane re-warped reads each pixel where the map says it was', () => {
  const w = 60
  const h = 40
  const plane = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (Math.hypot(x + 0.5 - 20, y + 0.5 - 20) < 6) plane[y * w + x] = 255
  // The identity leaves it as it was.
  assert.deepEqual(
    warpPlane(
      plane,
      w,
      h,
      planeWarp((p) => p)
    ),
    plane
  )
  // Each new pixel reading 10 px to its left: the disk moves 10 px right.
  const moved = warpPlane(
    plane,
    w,
    h,
    planeWarp((p) => ({ x: p.x - 10 / w, y: p.y }))
  )
  let sx = 0
  let n = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (moved[y * w + x] > 127) {
        sx += x + 0.5
        n++
      }
  assert.ok(Math.abs(sx / n - 30) < 0.1, `${sx / n}`)
})

test('the spots baked into the corrected proxies are where the lens rendered puts their content', () => {
  // A render from the lens-corrected set leaves the spots out (they are in
  // its pixels): spots drawn under another lens are baked carried over.
  const r = withMasks(FRAME_A)
  r.retouch.push({ ...r.retouch[0], id: 't', lensFrame: FRAME_B, points: [{ x: 0.3, y: 0.7 }] })
  assert.equal(spotsOn(r, null), r.retouch, 'nothing to carry: as drawn')
  assert.equal(
    spotFramesKey(withMasks(FRAME_A), FRAME_A),
    '',
    'on the lens rendered: no key of its own'
  )
  // Optics switched off: rendered with no correction.
  const placed = spotsOn(r, { to: null, maps: MAPS })
  assert.ok(near(placed[0].points[0], frameMap(MAPS, FRAME_A, null)({ x: 0.85, y: 0.85 }), 1e-12))
  assert.ok(near(placed[0].source!, frameMap(MAPS, FRAME_A, null)({ x: 0.6, y: 0.6 }), 1e-12))
  assert.ok(near(placed[1].points[0], frameMap(MAPS, FRAME_B, null)({ x: 0.3, y: 0.7 }), 1e-12))
  assert.ok(placed[0].radius !== r.retouch[0].radius, 'its size by the scale an area keeps')
  // The same points under another lens are another bake.
  const k = spotFramesKey(r, null)
  assert.notEqual(k, '')
  assert.notEqual(k, spotFramesKey(r, FRAME_A))
  assert.notEqual(k, spotFramesKey({ ...r, masks: { lensFrame: FRAME_B } }, null))
  // What the render compiles from them is the carried spots (compile's own placing).
  const ctx: CompileContext = {
    isRaw: false,
    asShot: null,
    sourceOrientation: 'Normal',
    frameWidth: 1200,
    frameHeight: 800,
    scale: 1,
    seed: 1,
    brushPaths: {},
    applyCrop: true
  }
  const live = compile(r, { ...ctx, maskFrames: { to: null, maps: MAPS } })
  const baked = compile({ ...r, retouch: placed }, ctx)
  assert.deepEqual(live.retouch, baked.retouch)
})
