import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FIT,
  MAX_ZOOM,
  fitRect,
  fitScale,
  normalisedIn,
  panBy,
  visiblePart,
  zoomAt,
  zoomTo,
  zoomedRect
} from '../src/shared/view'

test('fitRect centres a wide picture in a tall box', () => {
  const r = fitRect({ w: 400, h: 400 }, 6000, 4000)
  assert.ok(r)
  assert.equal(r.w, 400)
  assert.ok(Math.abs(r.h - 266.6667) < 1e-3)
  assert.equal(r.x, 0)
  assert.ok(Math.abs(r.y - 66.6667) < 1e-3)
})

test('fitRect does not depend on the render size, only the aspect', () => {
  const a = fitRect({ w: 1000, h: 700 }, 6000, 4000)
  const b = fitRect({ w: 1000, h: 700 }, 1536, 1024)
  assert.deepEqual(a, b)
})

test('fitRect caps enlargement and rejects empty inputs', () => {
  const r = fitRect({ w: 1000, h: 1000 }, 100, 100, 4)
  assert.equal(r?.w, 400)
  assert.equal(fitRect({ w: 0, h: 100 }, 10, 10), null)
  assert.equal(fitRect({ w: 100, h: 100 }, Number.NaN, 10), null)
})

test('normalisedIn maps a pointer into an element box', () => {
  assert.deepEqual(normalisedIn(150, 75, { left: 100, top: 50, width: 100, height: 50 }), {
    x: 0.5,
    y: 0.5
  })
})

// ── zoom ──

const vp = { box: { w: 1000, h: 800 }, width: 6000, height: 4000, dpr: 2 }

test('fit is the fitted rect and its scale', () => {
  assert.deepEqual(zoomedRect(vp, FIT), fitRect(vp.box, 6000, 4000, 4))
  assert.ok(Math.abs(fitScale(vp) - (1000 * 2) / 6000) < 1e-9)
})

test('zoomAt keeps the point under the pointer', () => {
  const at = { x: 700, y: 300 }
  const before = zoomedRect(vp, FIT)!
  const u = (at.x - before.x) / before.w
  const w = zoomAt(vp, FIT, 3, at)
  const r = zoomedRect(vp, w)!
  assert.ok(Math.abs((at.x - r.x) / r.w - u) < 1e-9)
})

test('zoom is clamped between fit and the maximum', () => {
  const big = zoomAt(vp, FIT, 1000, { x: 500, y: 400 })
  assert.equal(big.scale, MAX_ZOOM)
  assert.deepEqual(zoomAt(vp, big, 1e-6, { x: 500, y: 400 }), FIT)
})

test('a zoomed picture always covers the box, and panning stops at its edges', () => {
  const z = zoomTo(vp, FIT, 1, { x: 0, y: 0 })
  const r = zoomedRect(vp, panBy(vp, z, 1e6, 1e6))!
  assert.equal(r.x, 0)
  assert.equal(r.y, 0)
  const r2 = zoomedRect(vp, panBy(vp, z, -1e6, -1e6))!
  assert.ok(Math.abs(r2.x + r2.w - vp.box.w) < 1e-6)
  assert.ok(Math.abs(r2.y + r2.h - vp.box.h) < 1e-6)
})

test('100% maps one photo pixel to one device pixel', () => {
  const r = zoomedRect(vp, zoomTo(vp, FIT, 1, { x: 500, y: 400 }))!
  assert.ok(Math.abs(r.w * vp.dpr - 6000) < 1e-6)
})

test('visiblePart clips a zoomed rect to the box', () => {
  assert.deepEqual(visiblePart({ w: 100, h: 100 }, { x: -50, y: 10, w: 300, h: 50 }), {
    x: 50,
    y: 0,
    w: 100,
    h: 50
  })
})
