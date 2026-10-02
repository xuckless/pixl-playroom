import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  bidirectionalAt,
  gradientCoverage,
  gradientKey,
  gradientPlaneSize,
  gradientShape,
  linearAt,
  radialAt,
  radialHandles,
  rasteriseGradient
} from '../src/shared/gradients'
import type { Orientation } from '../src/shared/engine-types'
import { transformPoint } from '../src/shared/orientation'
import { normaliseComponent } from '../src/shared/recipe'
import type { BidirectionalComponent, LinearComponent, RadialComponent } from '../src/shared/recipe'

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

const bidirectional = (over: Partial<BidirectionalComponent> = {}): BidirectionalComponent => ({
  ...base,
  kind: 'bidirectional',
  start: { x: 0.5, y: 0.2 },
  end: { x: 0.5, y: 0.8 },
  centre: 0.5,
  width: 200,
  height: 100,
  ...over
})

test("a bidirectional gradient is full on its centre line and gone at both ends (the engine's formula)", () => {
  const c = bidirectional({ centre: 0.25 })
  const y = (t: number): number => (0.2 + 0.6 * t) * 100
  assert.equal(bidirectionalAt(c, { x: 100, y: y(0.25) }), 1)
  assert.equal(bidirectionalAt(c, { x: 100, y: y(0) }), 0)
  assert.equal(bidirectionalAt(c, { x: 100, y: y(1) }), 0)
  // Each side its own width: halfway on each side is half covered (smoothstep at ½).
  assert.ok(Math.abs(bidirectionalAt(c, { x: 100, y: y(0.125) }) - 0.5) < 1e-9)
  assert.ok(Math.abs(bidirectionalAt(c, { x: 100, y: y(0.625) }) - 0.5) < 1e-9)
  assert.equal(bidirectionalAt(c, { x: 100, y: y(1.2) }), 0)
})

test('the engine gets each gradient as the same shape, in the frame the user turned', () => {
  // Upright: the recipe's own numbers.
  assert.deepEqual(gradientShape(linear(), 'Normal'), {
    LinearGradient: { from: { x: 0.5, y: 0.25 }, to: { x: 0.5, y: 0.75 }, ramp: 'Smoothstep' }
  })
  const r = radial({ angle: 30, softness: 40, radiusX: 0.3, radiusY: 0.1 })
  assert.deepEqual(gradientShape(r, 'Normal'), {
    RadialGradient: {
      centre: { x: 0.5, y: 0.5 },
      radii: { x: 0.3, y: 0.1 },
      rotation: 30,
      feather: 0.4,
      ramp: 'Smoothstep'
    }
  })
  // A quarter turn clockwise: a top-down linear runs right to left, an
  // ellipse turns with it, and the radii (of the shorter side) stay.
  const turned = gradientShape(linear(), 'Rotate90') as {
    LinearGradient: { from: { x: number; y: number }; to: { x: number; y: number } }
  }
  assert.deepEqual(turned.LinearGradient.from, { x: 0.75, y: 0.5 })
  assert.deepEqual(turned.LinearGradient.to, { x: 0.25, y: 0.5 })
  const rr = gradientShape(r, 'Rotate90') as { RadialGradient: { rotation: number } }
  assert.equal(rr.RadialGradient.rotation, 120)
  // A mirror turns the ellipse the other way.
  const m = gradientShape(r, 'FlipHorizontal') as { RadialGradient: { rotation: number } }
  assert.ok(Math.abs(Math.abs(m.RadialGradient.rotation) - 150) < 1e-6)
  // A linear with its ends together selects nothing the engine would draw.
  assert.equal(gradientShape(linear({ end: { x: 0.5, y: 0.25 } }), 'Normal'), null)
  const b = gradientShape(bidirectional({ centre: 0.25 }), 'Normal') as {
    BidirectionalGradient: { centre: { x: number; y: number } }
  }
  assert.ok(Math.abs(b.BidirectionalGradient.centre.y - 0.35) < 1e-9)
})

test('in every orientation the engine draws the radial the plane had, on the same picture', () => {
  const r = radial({
    angle: 25,
    radiusX: 0.35,
    radiusY: 0.15,
    softness: 30,
    width: 300,
    height: 200
  })
  const orientations: Orientation[] = [
    'Normal',
    'FlipHorizontal',
    'Rotate180',
    'FlipVertical',
    'Transpose',
    'Rotate90',
    'Transverse',
    'Rotate270'
  ]
  const smooth = (u: number): number => {
    const t = Math.min(1, Math.max(0, u))
    return t * t * (3 - 2 * t)
  }
  for (const o of orientations) {
    const g = (
      gradientShape(r, o) as {
        RadialGradient: {
          centre: { x: number; y: number }
          radii: { x: number; y: number }
          rotation: number
          feather: number
        }
      }
    ).RadialGradient
    const swap = o === 'Transpose' || o === 'Rotate90' || o === 'Transverse' || o === 'Rotate270'
    const w = swap ? r.height : r.width
    const h = swap ? r.width : r.height
    const short = Math.min(w, h)
    const a = (g.rotation * Math.PI) / 180
    // The engine's radial (mask.rs), in the turned frame's pixels.
    const engineAt = (x: number, y: number): number => {
      const dx = x - g.centre.x * w
      const dy = y - g.centre.y * h
      const u = (dx * Math.cos(a) + dy * Math.sin(a)) / (g.radii.x * short)
      const v = (-dx * Math.sin(a) + dy * Math.cos(a)) / (g.radii.y * short)
      return smooth((1 - Math.sqrt(u * u + v * v)) / g.feather)
    }
    for (const p of [
      { x: 0.5, y: 0.5 },
      { x: 0.62, y: 0.55 },
      { x: 0.7, y: 0.6 },
      { x: 0.3, y: 0.42 },
      { x: 0.8, y: 0.66 }
    ]) {
      const q = transformPoint(o, p)
      const base = radialAt(r, { x: p.x * r.width, y: p.y * r.height })
      assert.ok(Math.abs(engineAt(q.x * w, q.y * h) - base) < 1e-6, `${o} at ${p.x},${p.y}`)
    }
  }
})

test('a bidirectional gradient survives a sidecar; an unknown kind still does not', () => {
  const c = normaliseComponent({ ...bidirectional({ centre: 0.3 }) })
  assert.equal(c?.kind, 'bidirectional')
  assert.equal(c?.kind === 'bidirectional' && c.centre, 0.3)
  assert.equal(
    normaliseComponent({ ...bidirectional(), centre: 5 })?.kind === 'bidirectional' &&
      (normaliseComponent({ ...bidirectional(), centre: 5 }) as BidirectionalComponent).centre,
    0.98
  )
  assert.equal(normaliseComponent({ ...linear(), kind: 'spiral' }), null)
  // Snap to edges is kept, in range.
  const snapped = normaliseComponent({ ...linear(), refine: { on: true, radius: 99 } })
  assert.deepEqual(snapped?.refine, { on: true, radius: 5 })
})
