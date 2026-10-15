// Masks under geometry edits: the loupe's view of the picture as rendered,
// which mask planes it may show, and the maps between display and base.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import { loupeGeometry, maskPlacementKey } from '../src/shared/view'
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
