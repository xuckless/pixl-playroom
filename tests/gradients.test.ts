import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gradientCoverage,
  gradientKey,
  gradientPlaneSize,
  linearAt,
  radialAt,
  radialHandles,
  rasteriseGradient
} from '../src/shared/gradients'
import type { LinearComponent, RadialComponent } from '../src/shared/recipe'

const base = { id: 'g', mode: 'Add' as const, opacity: 100, invert: false, feather: 0 }

const linear = (over: Partial<LinearComponent> = {}): LinearComponent => ({
  ...base,
  kind: 'linear',
  start: { x: 0.5, y: 0.25 },
  end: { x: 0.5, y: 0.75 },
  width: 200,
  height: 100,
  ...over
})

const radial = (over: Partial<RadialComponent> = {}): RadialComponent => ({
  ...base,
  kind: 'radial',
  centre: { x: 0.5, y: 0.5 },
  radiusX: 0.3,
  radiusY: 0.3,
  angle: 0,
  softness: 50,
  width: 200,
  height: 100,
  ...over
})

test('a plane keeps the frame aspect on its long edge', () => {
  assert.deepEqual(gradientPlaneSize(6000, 4000), { width: 512, height: 341 })
  assert.deepEqual(gradientPlaneSize(4000, 6000), { width: 341, height: 512 })
})

test('a linear gradient is full before its start, gone past its end, half way between', () => {
  const c = linear()
  assert.equal(linearAt(c, { x: 100, y: 10 }), 1)
  assert.equal(linearAt(c, { x: 100, y: 95 }), 0)
  assert.ok(Math.abs(linearAt(c, { x: 100, y: 50 }) - 0.5) < 1e-9)
  // Constant along lines at right angles to start→end.
  assert.equal(linearAt(c, { x: 3, y: 40 }), linearAt(c, { x: 197, y: 40 }))
})

test('a radial gradient is full at its centre and nothing outside it', () => {
  const c = radial()
  assert.equal(radialAt(c, { x: 100, y: 50 }), 1)
  assert.equal(radialAt(c, { x: 199, y: 50 }), 0)
  // Softness 0 is a hard edge.
  const hard = radial({ softness: 0 })
  assert.equal(radialAt(hard, { x: 100 + 29, y: 50 }), 1)
  assert.equal(radialAt(hard, { x: 100 + 31, y: 50 }), 0)
})

test('an ellipse turned a quarter swaps its axes', () => {
  const wide = radial({ radiusX: 0.4, radiusY: 0.1, softness: 0 })
  const turned = { ...wide, angle: 90 }
  // 30 px right of centre: inside the wide one (rx 40), outside the turned one (rx now vertical).
  assert.equal(radialAt(wide, { x: 130, y: 50 }), 1)
  assert.equal(radialAt(turned, { x: 130, y: 50 }), 0)
  assert.equal(radialAt(turned, { x: 100, y: 50 + 30 }), 1)
  const [right] = radialHandles(turned)
  assert.ok(Math.abs(right.x - 100) < 1e-9 && Math.abs(right.y - 90) < 1e-9)
})

test('rasterising is deterministic and dithered, not banded', () => {
  const c = linear()
  const a = rasteriseGradient(c)
  const b = rasteriseGradient(c)
  assert.deepEqual(a, b)
  assert.equal(a.length, 200 * 100)
  assert.equal(a[5 * 200 + 100], 255)
  assert.equal(a[95 * 200 + 100], 0)
  // Along the ramp neighbours differ by at most a code value or two.
  const row = 50
  const v = a[row * 200 + 100]
  assert.ok(v > 110 && v < 145)
})

test('the plane key follows the geometry, not the mode or opacity', () => {
  const c = linear()
  assert.equal(gradientKey(c), gradientKey({ ...c, mode: 'Subtract', opacity: 40, id: 'x' }))
  assert.notEqual(gradientKey(c), gradientKey({ ...c, end: { x: 0.5, y: 0.8 } }))
})

test('the plane rasteriser computes exactly what linearAt and radialAt say', () => {
  // A seeded walk over shapes, including a zero-length linear and a turned ellipse.
  let s = 12345
  const rnd = (): number => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 2 ** 32
  const shapes: (LinearComponent | RadialComponent)[] = [linear({ end: { x: 0.5, y: 0.25 } })]
  for (let i = 0; i < 25; i++) {
    shapes.push(
      linear({
        start: { x: rnd(), y: rnd() },
        end: { x: rnd(), y: rnd() },
        width: 512,
        height: 341
      })
    )
    shapes.push(
      radial({
        centre: { x: rnd(), y: rnd() },
        radiusX: rnd() * 0.5,
        radiusY: rnd() * 0.5,
        angle: rnd() * 360 - 180,
        softness: rnd() * 120 - 10,
        width: 341,
        height: 512
      })
    )
  }
  for (const c of shapes) {
    const at = gradientCoverage(c)
    for (let k = 0; k < 400; k++) {
      const p = { x: Math.floor(rnd() * c.width) + 0.5, y: Math.floor(rnd() * c.height) + 0.5 }
      const want = c.kind === 'linear' ? linearAt(c, p) : radialAt(c, p)
      assert.equal(at(p.x, p.y), want)
    }
  }
})
