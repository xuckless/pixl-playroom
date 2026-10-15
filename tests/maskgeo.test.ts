// Masks under geometry edits: the loupe's view of the picture as rendered,
// which mask planes it may show, and the maps between display and base.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import { renderedLens } from '../src/shared/edits'
import { lensCorrection } from '../src/shared/lens'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import {
  applyProjective,
  baseToDisplay,
  baseToDisplayMatrix,
  baseToDisplayMatrixNear,
  displayToBase,
  displayToBaseMatrix,
  displayToBaseMatrixNear,
  displayToRendered,
  glMat3,
  localScale,
  loupeGeometry,
  maskPlacementKey,
  masksToRendered,
  viewGeometry,
  type P,
  type Projective
} from '../src/shared/view'
import {
  makeGrid,
  ownLensFrame,
  placeMasks,
  retagMasks,
  stForward,
  stInverse,
  type StMap
} from '../src/shared/lensframe'
import { nextGeometryRev, planeFits } from '../src/renderer/src/state/maskplanes'
import { nextTarget, type Watched } from '../src/renderer/src/views/loupe/maskgl/handover'

const W = 3000
const H = 2000

const ctx = (applyCrop = true): CompileContext => ({
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: W,
  frameHeight: H,
  scale: 1,
  seed: 1,
  brushPaths: {},
  applyCrop
})

const close = (a: number, b: number, e = 1e-4): boolean => Math.abs(a - b) <= e

/** A recipe with a crop, a straighten and (optionally) an Upright warp. */
function framed(upright: boolean): Recipe {
  const r = defaultRecipe(false)
  r.geometry.crop = { x: 0.15, y: 0.2, width: 0.6, height: 0.6 }
  r.geometry.straighten = 6
  r.geometry.quarterTurns = 1
  if (upright) r.geometry.upright = { ...r.geometry.upright, vertical: 40, horizontal: -10 }
  return r
}

test('the loupe lays out the geometry compile renders, with sections switched off or not', () => {
  for (const upright of [false, true])
    for (const off of [{}, { crop: true }, { geometry: true }, { crop: true, geometry: true }]) {
      const r = framed(upright)
      r.off = off as Recipe['off']
      const g = loupeGeometry(r, false, W, H, false)
      const c = compile(r, ctx())
      const f = c.framing
      const what = `upright ${upright}, off ${JSON.stringify(off)}`
      // The crop the engine is given (before its rounding), and the straighten.
      if (c.crop === null) assert.equal(g.crop, null, what)
      else {
        assert.ok(g.crop, what)
        for (const k of ['x', 'y', 'width', 'height'] as const)
          assert.ok(close(g.crop[k], c.crop[k]), `${what}: crop ${k}`)
      }
      assert.ok(close(g.straighten, f?.rotate_degrees ?? 0), `${what}: straighten`)
      assert.deepEqual(g.transform ?? null, f?.transform ?? null, `${what}: transform`)
      assert.equal(g.user, 'Rotate90', what)
    }
})

test('the placement key moves with the framing and the lens, not with a guide or a slider', () => {
  const r = framed(true)
  const key = (x: Recipe): string => maskPlacementKey(x, false, W, H)
  const k0 = key(r)
  const moved = (change: (x: Recipe) => void): boolean => {
    const x = structuredClone(r)
    change(x)
    return key(x) !== k0
  }
  assert.equal(
    moved((x) => (x.basic.exposure = 1)),
    false
  )
  assert.equal(
    moved((x) => (x.geometry.upright.guides = [{ from: { x: 0, y: 0 }, to: { x: 0, y: 1 } }])),
    false
  )
  assert.equal(
    moved((x) => (x.geometry.straighten = 7)),
    true
  )
  assert.equal(
    moved((x) => (x.geometry.quarterTurns = 2)),
    true
  )
  assert.equal(
    moved((x) => (x.geometry.flipHorizontal = true)),
    true
  )
  assert.equal(
    moved((x) => (x.off = { crop: true })),
    true
  )
  assert.equal(
    moved((x) => (x.off = { geometry: true })),
    true
  )
  assert.equal(
    moved((x) => (x.lens.distortion = 30)),
    true
  )
  const lensed = structuredClone(r)
  lensed.lens.distortion = 30
  const k1 = key(lensed)
  lensed.off = { optics: true }
  assert.notEqual(key(lensed), k1, 'Optics switched off unwarps the picture')
})

test('the masks’ lens record moving (a lens edit settling) leaves every plane on hand standing', () => {
  // Rebased or retagged, the masks sit where they did on the picture: the
  // engine draws no new plane or thumbnail for it, so none may be waited for.
  const r = framed(true)
  r.lens.distortion = 40
  r.masks = { lensFrame: null }
  const key = (x: Recipe): string => maskPlacementKey(x, false, W, H)
  assert.equal(key(retagMasks(r)), key(r))
  const own = ownLensFrame(r)
  assert.ok(own)
  const rebased = placeMasks(r, { to: own, maps: {} }, 'rebase')
  assert.notEqual(rebased.masks.lensFrame, r.masks.lensFrame)
  assert.equal(key(rebased), key(r))
})

test('the placement key moves only when what the engine places masks by does', () => {
  // A key that moved where compile's framing and lens did not would wait for
  // a mask thumbnail the engine never draws again (its signature is those).
  const edits: ((x: Recipe) => void)[] = [
    () => {},
    (x) => (x.basic.exposure = 1),
    (x) => (x.geometry.straighten = 7),
    (x) => (x.geometry.quarterTurns = 2),
    (x) => (x.geometry.flipHorizontal = true),
    (x) => (x.geometry.crop = null),
    (x) => (x.off = { crop: true }),
    (x) => (x.off = { geometry: true }),
    (x) => (x.off = { optics: true }),
    (x) => (x.lens.distortion = 30),
    (x) => (x.lens.vignetting = 30),
    (x) => (x.masks = { lensFrame: null }),
    (x) => (x.geometry.upright.guides = [{ from: { x: 0, y: 0 }, to: { x: 0, y: 1 } }])
  ]
  const variants = edits.map((f) => {
    const x = framed(true)
    x.lens.distortion = 10
    x.masks = { lensFrame: ownLensFrame(x) }
    f(x)
    const c = compile(x, ctx())
    return { key: maskPlacementKey(x, false, W, H), placed: JSON.stringify([c.framing, c.lens]) }
  })
  for (const a of variants)
    for (const b of variants)
      if (a.key !== b.key) assert.notEqual(a.placed, b.placed, `${a.key} / ${b.key}`)
})

test('a mask plane shows only over the view and the framing it was drawn for', () => {
  const framedView = { whole: false, geometryRev: 12 }
  // The crop tool's plane after it closes: the whole frame, not the picture.
  assert.equal(planeFits({ cropMode: true, rev: 20 }, framedView), false)
  assert.equal(planeFits({ cropMode: false, rev: 20 }, framedView), true)
  // In the crop tool, the framed picture's plane is the wrong one.
  assert.equal(planeFits({ cropMode: false, rev: 20 }, { whole: true, geometryRev: 0 }), false)
  assert.equal(planeFits({ cropMode: true, rev: 20 }, { whole: true, geometryRev: 0 }), true)
  // Drawn before the straighten (a turn, an Upright…) that moved the masks.
  assert.equal(planeFits({ cropMode: false, rev: 11 }, framedView), false)
  assert.equal(planeFits({ cropMode: false, rev: 12 }, framedView), true)
  assert.equal(planeFits({ rev: 12 }, framedView), true)
})

test('a placement change waits for the edit that made it, the next number sent', () => {
  const was = { key: 'a', rev: 3 }
  assert.equal(nextGeometryRev(was, 'a', 40), was)
  assert.deepEqual(nextGeometryRev(was, 'b', 40), { key: 'b', rev: 41 })
})

test('the loupe keeps its own mask until the engine has drawn the new framing', () => {
  const comps = [{}]
  const was: Watched = { layerId: 'L', components: comps, invert: false, geometryRev: 5 }
  // A straighten: the plane on hand is of the old framing.
  assert.equal(nextTarget(was, { ...was, geometryRev: 9 }, 4, 8), 9)
  // A shape edit waits for the edit itself.
  assert.equal(nextTarget(was, { ...was, components: [{}] }, 4, 8), 9)
  // Both at once: the later of the two.
  assert.equal(nextTarget(was, { ...was, components: [{}], geometryRev: 7 }, 4, 8), 9)
  assert.equal(nextTarget(was, { ...was, geometryRev: 12 }, 10, 8), 12)
  // Another mask: its plane shows as soon as the engine has one.
  assert.equal(nextTarget(was, { ...was, layerId: 'M', geometryRev: 9 }, 4, 8), 0)
})

// ── Phase 2: the map as one projective matrix ────────────────────────────────

const ORIENTATIONS: [number, boolean][] = [
  [0, false],
  [1, false],
  [2, false],
  [3, false],
  [0, true],
  [1, true],
  [2, true],
  [3, true]
]

type ViewCase = [string, Recipe, { cropMode?: boolean; guides?: boolean }]

/** The geometries the loupe shows a mask through, by name. */
function geometries(): ViewCase[] {
  const make = (f: (r: Recipe) => void): Recipe => {
    const r = defaultRecipe(false)
    f(r)
    return r
  }
  const out: ViewCase[] = [
    ['none', make(() => {}), {}],
    ['crop', make((r) => (r.geometry.crop = { x: 0.15, y: 0.2, width: 0.7, height: 0.65 })), {}],
    ['straighten 10', make((r) => (r.geometry.straighten = 10)), {}]
  ]
  for (const [turns, flip] of ORIENTATIONS)
    out.push([
      `turns ${turns}${flip ? ' flipped' : ''}`,
      make((r) => {
        r.geometry.quarterTurns = turns
        r.geometry.flipHorizontal = flip
        r.geometry.straighten = 3
        r.geometry.crop = { x: 0.1, y: 0.05, width: 0.75, height: 0.8 }
      }),
      {}
    ])
  out.push(['Upright V20', make((r) => (r.geometry.upright.vertical = 50)), {}])
  const full = make((r) => {
    Object.assign(r.geometry.upright, {
      vertical: 30,
      horizontal: 15,
      rotate: 3,
      aspect: 10,
      scale: 90
    })
    r.geometry.quarterTurns = 3
    r.geometry.flipHorizontal = true
    r.geometry.straighten = 4
    r.geometry.crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
  })
  out.push(['Upright V30 H15 rotate aspect scale, turned', full, {}])
  out.push(['the crop tool open', full, { cropMode: true }])
  out.push(['Upright’s guides', full, { guides: true }])
  return out
}

test('the display ↔ base matrices are the per-point maps, Upright and all', () => {
  for (const [name, r, o] of geometries()) {
    const g = viewGeometry(r, 6000, 4000, o.cropMode ?? false, o.guides ?? false)
    const m = displayToBaseMatrix(g)
    const mi = baseToDisplayMatrix(g)
    let worst = 0
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 20; j++) {
        const d = { x: i / 20, y: j / 20 }
        const b = displayToBase(g, d)
        const viaM = applyProjective(m, d)
        const back = applyProjective(mi, b)
        const exact = baseToDisplay(g, b)
        worst = Math.max(
          worst,
          Math.hypot(viaM.x - b.x, viaM.y - b.y),
          Math.hypot(back.x - exact.x, back.y - exact.y)
        )
      }
    assert.ok(worst < 1e-6, `${name}: ${worst}`)
    // The GPU's "in front" test holds over the picture.
    assert.ok(m[6] * 0.5 + m[7] * 0.5 + m[8] > 0, name)
  }
})

test('as GLSL takes it: column by column', () => {
  const m: Projective = [1, 2, 3, 4, 5, 6, 7, 8, 9]
  assert.deepEqual([...glMat3(m)], [1, 4, 7, 2, 5, 8, 3, 6, 9])
})

test('a dab keeps its area through the map; along x alone it would not under Upright', () => {
  const r = defaultRecipe(false)
  r.geometry.crop = { x: 0.2, y: 0.2, width: 0.5, height: 0.5 }
  const g = viewGeometry(r, 6000, 4000, false)
  // Half the frame across 1000 screen pixels: 3 frame pixels a screen pixel.
  const screen = { w: 1000, h: 1000 * (2000 / 3000) }
  const s = localScale(g, { x: 0.3, y: 0.6 }, screen, { w: 6000, h: 4000 })
  assert.ok(Math.abs(s - 3) < 1e-9, `${s}`)
  // Under an Upright warp: the local Jacobian's area, by finite differences.
  const u = defaultRecipe(false)
  u.geometry.upright.vertical = 60
  const gu = viewGeometry(u, 6000, 4000, false)
  const p = { x: 0.5, y: 0.15 }
  const e = 1e-5
  const a = displayToBase(gu, p)
  const bx = displayToBase(gu, { x: p.x + e, y: p.y })
  const by = displayToBase(gu, { x: p.x, y: p.y + e })
  const det = ((bx.x - a.x) * (by.y - a.y) - (bx.y - a.y) * (by.x - a.x)) / (e * e)
  const want = Math.sqrt(Math.abs(det))
  const got = localScale(gu, p, { w: 1, h: 1 }, { w: 1, h: 1 })
  assert.ok(Math.abs(got - want) / want < 1e-4, `${got} vs ${want}`)
  const alongX = Math.hypot(bx.x - a.x, bx.y - a.y) / e
  assert.ok(Math.abs(alongX - want) / want > 0.02, 'the warp stretches one way more')
})

// ── Phase 3: models see the photo through the lens it is rendered with ──────

test('with Optics switched off a model sees the uncorrected frame, as the render does', () => {
  const r = defaultRecipe(false)
  r.lens.distortion = 40
  const on = renderedLens(r, false)
  assert.deepEqual(on, lensCorrection(r.lens))
  assert.ok(on?.distortion)
  r.off = { optics: true }
  assert.equal(renderedLens(r, false), null)
  assert.equal(compile(r, ctx()).lens, null, 'the render has no correction either')
  // The other sections leave the lens as it is.
  r.off = { crop: true, geometry: true }
  assert.deepEqual(renderedLens(r, true), on)
})

test('every model request and snap places its frame with the rendered lens', async () => {
  const { readFileSync } = await import('node:fs')
  for (const file of [
    'src/main/ai/segment.ts',
    'src/main/select/service.ts',
    'src/main/brushes.ts'
  ]) {
    const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.ok(!/lensCorrection\(\s*recipe\.lens\s*\)/.test(src), `${file} reads the recipe's lens`)
    assert.ok(src.includes('renderedLens('), file)
  }
})

// ── The masks on another lens than the one rendered (Optics switched off) ──

/** A barrel-like correction about the centre: where corrected point `p` comes from. */
const barrel =
  (k: number) =>
  (p: P): P => {
    const dx = p.x - 0.5
    const dy = (p.y - 0.5) * (2 / 3)
    const s = 1 + k * (dx * dx + dy * dy)
    return { x: 0.5 + dx * s * 0.96, y: 0.5 + (dy * s * 0.96) / (2 / 3) }
  }

/** An ST map sampled from `f`, as main decodes one. */
function sampled(f: (p: P) => P, w = 300, h = 200): StMap {
  const sx = new Float32Array(w * h)
  const sy = new Float32Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const q = f({ x: (i + 0.5) / w, y: (j + 0.5) / h })
      sx[j * w + i] = q.x
      sy[j * w + i] = q.y
    }
  return { w, h, sx, sy }
}

/** The loupe's grid with the masks on a +0.12 barrel and nothing rendered (Optics off). */
function opticsOffGrid(): ReturnType<typeof makeGrid> {
  const m = sampled(barrel(0.12))
  return makeGrid(
    (p) => stInverse(m, p),
    (p) => stForward(m, p)
  )
}

/** The Upright V30 H15… geometry, turned and flipped, with the lens grid. */
function uprightWithGrid(): ReturnType<typeof viewGeometry> {
  const found = geometries().find(([n]) => n.startsWith('Upright V30'))
  assert.ok(found)
  return { ...viewGeometry(found[1], 6000, 4000, false), lens: opticsOffGrid() }
}

test('a model is pointed at the picture as rendered, a mask at the masks’ frame', () => {
  const g = uprightWithGrid()
  const plain = { ...g, lens: null }
  for (const d of [
    { x: 0.2, y: 0.3 },
    { x: 0.9, y: 0.85 }
  ]) {
    // SAM's click: where the picture rendered shows it, not where the mask records it.
    assert.deepEqual(displayToRendered(g, d), displayToBase(plain, d))
    const b = displayToBase(g, d)
    assert.ok(Math.hypot(b.x - displayToRendered(g, d).x, b.y - displayToRendered(g, d).y) > 1e-3)
    // A lasso's outline (masks' frame) carried to SAM's frame lands back on the click.
    const r = masksToRendered(g, b)
    const want = displayToRendered(g, d)
    assert.ok(Math.hypot(r.x - want.x, r.y - want.y) < 1e-4)
  }
})

test('a dab painted with the masks on another lens is as big on the picture as the cursor', () => {
  const g = uprightWithGrid()
  const plain = { ...g, lens: null }
  const screen = { w: 1500, h: 1000 }
  const plane = { w: 2048, h: 1365 }
  for (const p of [
    { x: 0.5, y: 0.5 },
    { x: 0.12, y: 0.15 },
    { x: 0.9, y: 0.8 }
  ]) {
    // The grid's own area scale about the point, by finite differences.
    const b = displayToBase(plain, p)
    const e = 1e-4
    const to = (q: P): P => displayToBase(g, q)
    const a = to(p)
    const bx = to({ x: p.x + e, y: p.y })
    const by = to({ x: p.x, y: p.y + e })
    const det = ((bx.x - a.x) * (by.y - a.y) - (bx.y - a.y) * (by.x - a.x)) / (e * e)
    const want = Math.sqrt(Math.abs(det)) * Math.sqrt((plane.w * plane.h) / (screen.w * screen.h))
    const got = localScale(g, p, screen, plane)
    assert.ok(Math.abs(got - want) / want < 1e-3, `${got} vs ${want} at ${b.x},${b.y}`)
    // Without the grid's scale it would be a few per cent off on this strong map.
    const without = localScale(plain, p, screen, plane)
    assert.ok(Math.abs(without - want) / want > 0.005, `${without} vs ${want}`)
  }
})

test('the brush’s GPU matrices follow the lens grid about the stroke: exact there, close nearby', () => {
  // What brush.worker is given: the overlay maps display → masks' frame, Auto
  // Mask masks' frame → display, each a matrix (no grid on the GPU).
  const g = uprightWithGrid()
  const plain = { ...g, lens: null }
  assert.deepEqual(displayToBaseMatrixNear(plain, { x: 0.3, y: 0.3 }), displayToBaseMatrix(plain))
  assert.deepEqual(baseToDisplayMatrixNear(plain, { x: 0.3, y: 0.3 }), baseToDisplayMatrix(plain))
  for (const start of [
    { x: 0.5, y: 0.5 },
    { x: 0.12, y: 0.15 },
    { x: 0.9, y: 0.8 }
  ]) {
    const toBase = displayToBaseMatrixNear(g, start)
    const b0 = displayToBase(g, start)
    const toDisplay = baseToDisplayMatrixNear(g, b0)
    const px = (a: P, b: P): number => Math.hypot((a.x - b.x) * 6000, (a.y - b.y) * 4000)
    assert.ok(px(applyProjective(toBase, start), b0) < 1e-6, 'exact where the stroke starts')
    assert.ok(px(applyProjective(toDisplay, b0), baseToDisplay(g, b0)) < 1e-6)
    // Across a stroke (180 px of 6000 either way): a small part of what the
    // matrix alone is off by, the lens difference (up to 54 px on this strong map).
    let near = 0
    let alone = 0
    for (const [dx, dy] of [
      [0.03, 0],
      [-0.03, 0.03],
      [0, -0.03],
      [0.03, 0.03]
    ]) {
      const d = { x: start.x + dx, y: start.y + dy }
      const b = displayToBase(g, d)
      near = Math.max(near, px(applyProjective(toBase, d), b))
      near = Math.max(near, px(applyProjective(toDisplay, b), baseToDisplay(g, b)))
      alone = Math.max(alone, px(applyProjective(displayToBaseMatrix(g), d), b))
    }
    assert.ok(alone > 5, `the grid matters here: ${alone} px`)
    assert.ok(near < 2 && near < alone / 25, `${near} px about ${start.x},${start.y}`)
  }
})
