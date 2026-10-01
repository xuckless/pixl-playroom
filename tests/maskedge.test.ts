import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyEdge,
  edgeKey,
  hardenLut,
  normaliseEdge,
  offsetPolygon,
  shiftPixels,
  shiftPlane
} from '../src/shared/maskedge'

/** One line's min/max over a window of 2r + 1, the slow way, its ends replicated. */
function bruteLine(
  src: Uint8Array,
  out: Uint8Array,
  start: number,
  stride: number,
  n: number,
  r: number,
  grow: boolean
): void {
  for (let i = 0; i < n; i++) {
    let v = grow ? 0 : 255
    for (let k = -r; k <= r; k++) {
      const x = src[start + Math.min(n - 1, Math.max(0, i + k)) * stride]
      v = grow ? Math.max(v, x) : Math.min(v, x)
    }
    out[start + i * stride] = v
  }
}

/** shiftPlane's passes, each line filtered the slow way. */
function brute(d: Uint8Array, w: number, h: number, r: number, grow: boolean): Uint8Array {
  // Along an axis the square reaches a and the diamond 2t: together exactly r.
  const t = Math.floor((r - Math.round(r * (Math.SQRT2 - 1))) / 2)
  const a = r - 2 * t
  let cur = d
  const pass = (lines: [number, number, number][], rad: number): void => {
    if (rad <= 0) return
    const out = new Uint8Array(cur.length)
    for (const [s, st, n] of lines) bruteLine(cur, out, s, st, n, rad, grow)
    cur = out
  }
  pass(
    Array.from({ length: h }, (_, y) => [y * w, 1, w]),
    a
  )
  pass(
    Array.from({ length: w }, (_, x) => [x, w, h]),
    a
  )
  pass(
    [
      ...Array.from({ length: w }, (_, x): [number, number, number] => [
        x,
        w + 1,
        Math.min(w - x, h)
      ]),
      ...Array.from({ length: h - 1 }, (_, i): [number, number, number] => [
        (i + 1) * w,
        w + 1,
        Math.min(w, h - i - 1)
      ])
    ],
    t
  )
  pass(
    [
      ...Array.from({ length: w }, (_, x): [number, number, number] => [
        x,
        w - 1,
        Math.min(x + 1, h)
      ]),
      ...Array.from({ length: h - 1 }, (_, i): [number, number, number] => [
        (i + 1) * w + w - 1,
        w - 1,
        Math.min(w, h - i - 1)
      ])
    ],
    t
  )
  return cur
}

test('shiftPlane erodes and dilates as its passes say, at any radius', () => {
  let seed = 3
  const rnd = (): number => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32
  for (const [w, h] of [
    [13, 7],
    [1, 9],
    [20, 20]
  ]) {
    const d = new Uint8Array(w * h).map(() => Math.floor(rnd() * 256))
    for (const r of [1, 2, 5, 9])
      for (const grow of [false, true])
        assert.deepEqual(shiftPlane(d, w, h, r, grow), brute(d, w, h, r, grow), `${w}x${h} r${r}`)
  }
})

test('a dot grows into an octagon of the radius asked: round, not square', () => {
  const w = 61
  const d = new Uint8Array(w * w)
  const c = 30
  d[c * w + c] = 255
  const r = 20
  const out = shiftPlane(d, w, w, r, true)
  const lit = (x: number, y: number): boolean => out[(c + y) * w + (c + x)] === 255
  assert.ok(lit(r, 0) && !lit(r + 1, 0), 'its radius along the axis')
  assert.ok(lit(0, -r) && !lit(0, -r - 1))
  // Along the diagonal it reaches about r, not r·√2 as a square would.
  const k = Math.round(r / Math.SQRT2)
  assert.ok(lit(k - 1, k - 1))
  assert.ok(!lit(k + 2, k + 2))
})

test('harden steepens about the middle and leaves the ends', () => {
  const lut = hardenLut(100)
  assert.equal(lut[0], 0)
  assert.equal(lut[255], 255)
  assert.equal(lut[100], 0)
  assert.equal(lut[160], 255)
  assert.deepEqual([...hardenLut(0)], [...Array(256).keys()])
})

test('an edge moves a plane by a share of its shorter side, then hardens it', () => {
  assert.equal(shiftPixels(100, 1000, 500), 15)
  assert.equal(shiftPixels(-50, 1000, 500), 8)
  const w = 40
  const h = 40
  const d = new Uint8Array(w * h)
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) d[y * w + x] = 255
  // −100 on a 40-pixel plane: one pixel in (along the edges; the corners round off).
  const inward = applyEdge(d, w, h, { shift: -100, harden: 0 })
  assert.equal(inward[20 * w + 10], 0)
  assert.equal(inward[20 * w + 11], 255)
  assert.equal(applyEdge(d, w, h, undefined), d)
})

test('a polygon moves out or in by a share of the shorter side, whichever way it winds', () => {
  const square = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.75, y: 0.75 },
    { x: 0.25, y: 0.75 }
  ]
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9
  for (const pts of [square, [...square].reverse()]) {
    const out = offsetPolygon(pts, 0.05, 100, 100)
    const xs = out.map((p) => p.x)
    assert.ok(near(Math.min(...xs), 0.2) && near(Math.max(...xs), 0.8))
    const inn = offsetPolygon(pts, -0.05, 100, 100)
    assert.ok(near(Math.min(...inn.map((p) => p.y)), 0.3))
  }
  // On a 200 × 100 frame the distance is of the shorter side, the same in pixels both ways.
  const wide = offsetPolygon(square, 0.1, 200, 100)
  assert.ok(near(Math.min(...wide.map((p) => p.x)), 0.25 - 10 / 200))
  assert.ok(near(Math.min(...wide.map((p) => p.y)), 0.25 - 10 / 100))
})

test('an edge is stored in range, and an edge that does nothing is not stored', () => {
  assert.deepEqual(normaliseEdge({ shift: -140, harden: 33.4 }), { shift: -100, harden: 33 })
  assert.equal(normaliseEdge({ shift: 0, harden: 0 }), undefined)
  assert.deepEqual(normaliseEdge({ shift: 0, harden: 0, inside: true }), {
    shift: 0,
    harden: 0,
    inside: true
  })
  assert.equal(edgeKey(undefined), '')
  assert.equal(edgeKey({ shift: -20, harden: 40 }), '-e-20h40')
})
