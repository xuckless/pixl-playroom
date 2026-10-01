import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, transformPoint, userOrientation } from '../src/shared/orientation'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import { flipGeometry, turnGeometry } from '../src/shared/reframe'
import { defaultUpright, frameToCanvas, uprightTransform } from '../src/shared/upright'

const W = 6000
const H = 4000
const close = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) < eps

/** Deep equality, numbers to within float error. */
function near(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return close(a, b, 1e-9)
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a)
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => near((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
    )
  }
  return a === b
}

function geometry(over: Partial<Recipe['geometry']> = {}): Recipe['geometry'] {
  return { ...defaultRecipe(false).geometry, ...over }
}

const POINTS = [
  { x: 0.2, y: 0.3 },
  { x: 0.5, y: 0.5 },
  { x: 0.8, y: 0.6 },
  { x: 0.35, y: 0.9 }
]

/** Every point lands, through the new geometry's warp, where the old one's would, carried by `move`. */
function sameWarp(
  before: Recipe['geometry'],
  after: Recipe['geometry'],
  move: (p: { x: number; y: number }) => { x: number; y: number },
  w: number,
  h: number,
  w2: number,
  h2: number
): void {
  const t1 = uprightTransform(before.upright, w, h)!
  const t2 = uprightTransform(after.upright, w2, h2)!
  for (const p of POINTS) {
    const a = move(frameToCanvas(t1, w, h, p)!)
    const b = frameToCanvas(t2, w2, h2, move(p))!
    assert.ok(
      close(a.x, b.x) && close(a.y, b.y),
      `${JSON.stringify(p)}: ${a.x},${a.y} vs ${b.x},${b.y}`
    )
  }
}

test('a flip mirrors what is shown, and the crop, straighten and Upright with it', () => {
  const u = {
    ...defaultUpright(),
    mode: 'full' as const,
    suggested: {
      vertical: 8,
      horizontal: -5,
      rotate: 1.5,
      focal: 0.8,
      aspect: 0.1,
      scale: 1.05,
      offset: { x: 0.02, y: -0.01 }
    },
    vertical: 10,
    horizontal: 20,
    rotate: -10,
    offsetX: 15,
    guides: [{ from: { x: 0.1, y: 0.2 }, to: { x: 0.15, y: 0.8 } }]
  }
  for (const flipped of [false, true]) {
    const g = geometry({
      quarterTurns: 1,
      flipHorizontal: flipped,
      straighten: 3,
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      upright: u
    })
    const f = flipGeometry(g)
    // What is shown is mirrored left to right.
    assert.equal(
      userOrientation(f.quarterTurns, f.flipHorizontal),
      compose(userOrientation(g.quarterTurns, g.flipHorizontal), 'FlipHorizontal')
    )
    assert.equal(f.straighten, -3)
    assert.ok(close(f.crop!.x, 0.4) && f.crop!.width === 0.5 && f.crop!.y === 0.2)
    assert.deepEqual(f.upright.guides[0].from, { x: 0.9, y: 0.2 })
    // Exactly the warp, mirrored.
    sameWarp(g, f, (p) => ({ x: 1 - p.x, y: p.y }), W, H, W, H)
    // Twice is where it started.
    assert.ok(near(flipGeometry(f), g))
  }
})

test('a quarter turn turns what is shown, the crop, the aspect lock and Upright with it', () => {
  // One tilt, as Upright usually has: carried exactly.
  const u = {
    ...defaultUpright(),
    mode: 'vertical' as const,
    suggested: {
      vertical: 9,
      horizontal: 0,
      rotate: 1,
      focal: 0.8,
      aspect: 0.1,
      scale: 1.05,
      offset: { x: 0.02, y: -0.01 }
    },
    rotate: 20,
    offsetX: 10,
    offsetY: -5,
    guides: [{ from: { x: 0.1, y: 0.2 }, to: { x: 0.15, y: 0.8 } }]
  }
  for (const flipped of [false, true]) {
    const g = geometry({
      flipHorizontal: flipped,
      straighten: 2,
      aspect: 1.5,
      crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 },
      upright: u
    })
    const r = turnGeometry(g, 1)
    // What is shown turns clockwise, flipped or not.
    assert.equal(
      userOrientation(r.quarterTurns, r.flipHorizontal),
      compose(userOrientation(g.quarterTurns, g.flipHorizontal), 'Rotate90')
    )
    assert.equal(r.straighten, 2)
    assert.ok(close(r.aspect!, 1 / 1.5))
    // The crop's corners are the old ones, turned.
    const c = r.crop!
    const turned = transformPoint('Rotate90', { x: 0.1, y: 0.2 })
    const corners = [
      { x: c.x, y: c.y },
      { x: c.x + c.width, y: c.y },
      { x: c.x, y: c.y + c.height },
      { x: c.x + c.width, y: c.y + c.height }
    ]
    assert.ok(corners.some((p) => close(p.x, turned.x) && close(p.y, turned.y)))
    assert.ok(close(c.width, 0.6) && close(c.height, 0.5))
    sameWarp(g, r, (p) => transformPoint('Rotate90', p), W, H, H, W)
    // Back again, and four turns, are where it started.
    assert.ok(near(turnGeometry(r, -1), g))
    let four = g
    for (let i = 0; i < 4; i++) four = turnGeometry(four, 1)
    assert.ok(near(four, g))
  }
})
