import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, effectiveCrop, type CompileContext } from '../src/shared/compile'
import type { Transform } from '../src/shared/engine-types'
import { defaultRecipe } from '../src/shared/recipe'
import {
  canvasToFrame,
  cropFitsWarp,
  defaultUpright,
  focalOf,
  frameToCanvas,
  uprightTransform
} from '../src/shared/upright'
import { displayToOriented, orientedToDisplay, viewGeometry } from '../src/shared/view'

const T: Transform = {
  vertical: 12,
  horizontal: -6,
  rotate: 2,
  focal: 0.8,
  aspect: 0.1,
  scale: 1,
  offset: { x: 0.02, y: 0 }
}

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

test('no Upright and the sliders at rest is no transform', () => {
  assert.equal(uprightTransform(defaultUpright(), 6000, 4000), null)
})

test('the sliders add to the suggestion: angles sum, scales multiply', () => {
  const u = { ...defaultUpright(), suggested: T, vertical: 50, scale: 120 }
  const t = uprightTransform(u, 6000, 4000)!
  assert.equal(t.vertical, 12 + 20)
  assert.equal(t.horizontal, -6)
  assert.equal(t.scale, 1.2)
  assert.equal(t.focal, 0.8)
})

test('the photo centre stays at the canvas centre, whatever the turn', () => {
  const u = { ...defaultUpright(), suggested: { ...T, vertical: 30, offset: { x: 0, y: 0 } } }
  const t = uprightTransform(u, 6000, 4000)!
  const c = frameToCanvas(t, 6000, 4000, { x: 0.5, y: 0.5 })!
  assert.ok(Math.abs(c.x - 0.5) < 1e-4 && Math.abs(c.y - 0.5) < 1e-4)
  // The offset sliders move it from there.
  const moved = uprightTransform({ ...u, offsetX: 40 }, 6000, 4000)!
  assert.ok(Math.abs(frameToCanvas(moved, 6000, 4000, { x: 0.5, y: 0.5 })!.x - 0.6) < 1e-3)
})

test('the focal fraction comes from the 35 mm equivalent, 35 mm when unknown', () => {
  assert.ok(Math.abs(focalOf(43.27) - 1) < 1e-9)
  assert.ok(Math.abs(focalOf(null) - 35 / 43.27) < 1e-9)
})

test('a point through the warp and back lands where it started', () => {
  for (const p of [
    { x: 0.1, y: 0.2 },
    { x: 0.5, y: 0.5 },
    { x: 0.9, y: 0.7 }
  ]) {
    const back = canvasToFrame(T, 6000, 4000, frameToCanvas(T, 6000, 4000, p)!)!
    assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9)
  }
})

test('a warp leaves the full frame with empty corners; the fitted crop has none', () => {
  const full = { x: 0, y: 0, width: 1, height: 1 }
  assert.equal(cropFitsWarp(full, 0, null, 6000, 4000), true)
  assert.equal(cropFitsWarp(full, 0, T, 6000, 4000), false)
  const r = defaultRecipe(false)
  r.geometry.upright = { ...defaultUpright(), mode: 'full', suggested: T }
  const crop = effectiveCrop(r, 6000, 4000)!
  assert.ok(crop.width < 1 && crop.height < 1)
  const t = uprightTransform(r.geometry.upright, 6000, 4000)
  assert.ok(cropFitsWarp(crop, 0, t, 6000, 4000))
  // Centred, the kept crop is a good part of the frame, not a sliver.
  assert.ok(crop.width > 0.5)
})

test('the framing carries the warp: cropped in the picture, transparent in the crop tool, off for guides', () => {
  const r = defaultRecipe(false)
  r.geometry.upright = { ...defaultUpright(), mode: 'full', suggested: T }
  const framed = compile(r, ctx).framing!
  assert.deepEqual(framed.transform, uprightTransform(r.geometry.upright, 6000, 4000))
  assert.equal(framed.outside, 'Crop')
  assert.ok(framed.crop)
  const whole = compile(r, { ...ctx, applyCrop: false }).framing!
  assert.equal(whole.outside, 'Transparent')
  assert.equal(whole.crop, null)
  assert.equal(compile(r, { ...ctx, applyCrop: false, showTransform: false }).framing, null)
})

test('the loupe maps a point to the frame and back through crop, straighten and warp', () => {
  const r = defaultRecipe(false)
  r.geometry.straighten = 3
  r.geometry.upright = { ...defaultUpright(), mode: 'full', suggested: T }
  const g = viewGeometry(r, 6000, 4000, false)
  for (const p of [
    { x: 0.2, y: 0.3 },
    { x: 0.5, y: 0.5 },
    { x: 0.8, y: 0.9 }
  ]) {
    const back = orientedToDisplay(g, displayToOriented(g, p))
    assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9)
  }
  // Guides are drawn on the frame itself.
  const guides = viewGeometry(r, 6000, 4000, false, true)
  assert.deepEqual(displayToOriented(guides, { x: 0.3, y: 0.4 }), { x: 0.3, y: 0.4 })
})

test('a crop in an empty wedge moves in rather than shrink to nothing', () => {
  const r = defaultRecipe(false)
  r.geometry.upright = { ...defaultUpright(), scale: 75 }
  r.geometry.crop = { x: 0.8, y: 0.8, width: 0.2, height: 0.2 }
  const crop = effectiveCrop(r, 6000, 4000)!
  const t = uprightTransform(r.geometry.upright, 6000, 4000)
  assert.ok(cropFitsWarp(crop, 0, t, 6000, 4000))
  // Its size is kept (a crop that size fits nearer the centre), and it stays
  // toward the corner it was drawn in.
  assert.ok(Math.abs(crop.width - 0.2) < 1e-9 && Math.abs(crop.height - 0.2) < 1e-9)
  assert.ok(crop.x + crop.width / 2 > 0.5 && crop.y + crop.height / 2 > 0.5)
})
