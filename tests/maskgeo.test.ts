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
  displayToBase,
  displayToBaseMatrix,
  glMat3,
  localScale,
  loupeGeometry,
  maskPlacementKey,
  viewGeometry,
  type Projective
} from '../src/shared/view'
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

test('the brush worker’s Auto Mask lookup lands where the exact map puts a dab', () => {
  // cpuDabs and the dab shader read the picture at baseToDisplayMatrix(plane point).
  const found = geometries().find(([n]) => n.startsWith('Upright V30'))
  assert.ok(found)
  const g = viewGeometry(found[1], 6000, 4000, false)
  const m = baseToDisplayMatrix(g)
  for (const d of [
    { x: 0.2, y: 0.3 },
    { x: 0.5, y: 0.5 },
    { x: 0.85, y: 0.1 }
  ]) {
    const back = applyProjective(m, displayToBase(g, d))
    assert.ok(Math.hypot(back.x - d.x, back.y - d.y) < 1e-9)
  }
})
