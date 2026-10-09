// Face parts as lasso masks (engine 0.19's `faces`). Numbers only: the
// outlines here are made-up squares, never a face.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FaceFound, Pt } from '../src/shared/faceparts'

const square = (x: number, y: number, s: number): Pt[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s }
]
const ring = (pts: Pt[]): { contours: { points: Pt[] }[] } => ({ contours: [{ points: pts }] })

test('each part takes its outlines: both eyes, both brows, the lips with the mouth, the mouth for teeth', async () => {
  const { partRings } = await import('../src/shared/faceparts')
  const outlines = {
    left_eye: ring(square(0.6, 0.4, 0.05)),
    right_eye: ring(square(0.35, 0.4, 0.05)),
    left_brow: ring(square(0.6, 0.35, 0.05)),
    right_brow: ring(square(0.35, 0.35, 0.05)),
    lips: { contours: [{ points: square(0.45, 0.6, 0.1) }, { points: square(0.47, 0.62, 0.06) }] },
    inner_mouth: ring(square(0.47, 0.62, 0.06)),
    oval: ring(square(0.3, 0.3, 0.4))
  }
  assert.equal(partRings(outlines, 'eyes').length, 2)
  // The subject's left first: the engine's left_*, not mirrored.
  assert.equal(partRings(outlines, 'eyes')[0][0].x, 0.6)
  assert.equal(partRings(outlines, 'brows').length, 2)
  assert.equal(partRings(outlines, 'lips').length, 2)
  assert.deepEqual(partRings(outlines, 'teeth'), [square(0.47, 0.62, 0.06)])
  // A ring under three points is no outline.
  assert.deepEqual(partRings({ lips: ring([{ x: 0, y: 0 }]) }, 'lips'), [])
})

test('a mask shows every face, or the one picked', async () => {
  const { shownRings, leftToRight } = await import('../src/shared/faceparts')
  const right = {
    bounds: [0.6, 0.2, 0.2, 0.3] as [number, number, number, number],
    rings: [square(0.65, 0.3, 0.02)]
  }
  const left = {
    bounds: [0.1, 0.2, 0.2, 0.3] as [number, number, number, number],
    rings: [square(0.15, 0.3, 0.02)]
  }
  const faces = leftToRight([right, left])
  assert.equal(faces[0], left, 'numbered left to right')
  const found: FaceFound = { part: 'eyes', faces, face: null }
  assert.equal(shownRings(found).length, 2)
  assert.deepEqual(shownRings({ ...found, face: 1 }), right.rings)
  // A face that isn't there: every face.
  assert.equal(shownRings({ ...found, face: 7 }).length, 2)
})

test('small faces: four overlapping quarters, a face found twice kept once, a cut one left out', async () => {
  const { faceTiles, mergeFaces } = await import('../src/shared/faceparts')
  const tiles = faceTiles(1000, 800)
  assert.equal(tiles.length, 4)
  for (const t of tiles) {
    assert.equal(t.width, 625)
    assert.equal(t.height, 500)
    assert.ok(t.x + t.width <= 1000 && t.y + t.height <= 800)
  }
  const whole = [{ bounds: [100, 100, 200, 200], id: 'big' }]
  const merged = mergeFaces(
    whole,
    [
      // The same face again: kept once (the whole frame's).
      { tile: tiles[0], faces: [{ bounds: [105, 98, 195, 205], id: 'again' }] },
      // A small face only a quarter saw.
      { tile: tiles[3], faces: [{ bounds: [800, 600, 40, 40], id: 'small' }] },
      // One cut by the quarter's inner edge: the neighbour has it whole.
      { tile: tiles[1], faces: [{ bounds: [376, 300, 60, 60], id: 'cut' }] }
    ],
    1000,
    800
  )
  assert.deepEqual(
    merged.map((f) => f.id),
    ['big', 'small']
  )
})

test('rings compile even-odd: the mouth is cut out of the lips', async () => {
  const { compile } = await import('../src/shared/compile')
  const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
  const r = defaultRecipe(false)
  const l = newLocalLayer('Lips')
  l.components = [
    {
      id: 'p',
      kind: 'polygon',
      mode: 'Add',
      opacity: 100,
      invert: false,
      feather: 3,
      points: square(0.45, 0.6, 0.1),
      rings: [square(0.47, 0.62, 0.06)]
    }
  ]
  l.settings.basic.exposure = 0.5
  r.layers = [l]
  const c = compile(r, {
    isRaw: false,
    asShot: null,
    sourceOrientation: 'Normal',
    frameWidth: 1000,
    frameHeight: 1000,
    scale: 1,
    seed: 0,
    brushPaths: {}
  })
  const text = JSON.stringify(c.grade)
  const m = text.match(/"Polygon":\{"contours":\[(.*?)\],"fill_rule":"(\w+)"\}/)
  assert.ok(m, 'a polygon is sent')
  assert.equal(m![2], 'EvenOdd')
  assert.equal((m![1].match(/"points"/g) ?? []).length, 2)
})

test('a face part reads back whole, and a hand-drawn lasso stays one ring', async () => {
  const { normaliseRecipe, defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
  const r = defaultRecipe(false)
  const l = newLocalLayer('Eyes')
  const found: FaceFound = {
    part: 'eyes',
    faces: [
      { bounds: [0.1, 0.1, 0.3, 0.3], rings: [square(0.2, 0.2, 0.02), square(0.3, 0.2, 0.02)] }
    ],
    face: null
  }
  l.components = [
    {
      id: 'e',
      kind: 'polygon',
      mode: 'Add',
      opacity: 100,
      invert: false,
      feather: 3,
      points: found.faces[0].rings[0],
      rings: [found.faces[0].rings[1]],
      found
    },
    {
      id: 'h',
      kind: 'polygon',
      mode: 'Add',
      opacity: 100,
      invert: false,
      feather: 3,
      points: square(0, 0, 0.5)
    }
  ]
  r.layers = [l]
  const back = normaliseRecipe(JSON.parse(JSON.stringify(r)), false)
  const [e, h] = back.layers[0].components as { rings?: unknown; found?: unknown }[]
  assert.deepEqual(e.found, found)
  assert.equal((e.rings as unknown[]).length, 1)
  assert.equal(h.rings, undefined)
  assert.equal(h.found, undefined)
  // A broken record drops what it can't read, never the lasso.
  const bad = JSON.parse(JSON.stringify(r))
  bad.layers[0].components[0].found = { part: 'nose', faces: [] }
  const b2 = normaliseRecipe(bad, false).layers[0].components[0] as { found?: unknown }
  assert.equal(b2.found, undefined)
})
