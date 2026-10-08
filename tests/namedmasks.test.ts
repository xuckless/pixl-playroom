// Engine 0.19's named masks: the sky, vegetation and water (DINOv2-S+ADE),
// and a person's hair, face, skin and clothes (Selfie Multiclass). Numbers
// only: no picture of anyone.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { Plane8 } from '../src/main/ai/parts'

const plane = (
  name: string,
  w: number,
  h: number,
  fill: (x: number, y: number) => number
): Plane8 => {
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fill(x, y)
  return { name, data, width: w, height: h }
}

test('each target runs its model', async () => {
  const { segmentModel, isSceneTarget, isPartTarget } = await import('../src/shared/ai')
  assert.equal(segmentModel('sky'), 'dinov2-s-ade')
  assert.equal(segmentModel('vegetation'), 'dinov2-s-ade')
  assert.equal(segmentModel('water'), 'dinov2-s-ade')
  for (const t of ['face', 'hair', 'skin', 'clothes'] as const)
    assert.equal(segmentModel(t), 'selfie-multiclass')
  assert.equal(segmentModel('subject'), 'u2netp')
  assert.equal(segmentModel('subject', true), 'birefnet-lite')
  assert.equal(segmentModel('depth'), 'depth-anything-v2-small')
  assert.ok(isSceneTarget('water') && !isSceneTarget('subject'))
  assert.ok(isPartTarget('hair') && !isPartTarget('eyes'))
})

test('the person’s box, and the square the model reads around it', async () => {
  const { personBox, squareAround } = await import('../src/main/ai/parts')
  const W = 300
  const H = 200
  const hair = plane('hair', W, H, (x, y) => (x >= 100 && x < 140 && y >= 50 && y < 90 ? 200 : 0))
  const clothes = plane('clothes', W, H, (x, y) =>
    x >= 90 && x < 150 && y >= 90 && y < 190 ? 180 : 0
  )
  // Under even odds is nobody.
  const faint = plane('face_skin', W, H, () => 100)
  const box = personBox([hair, clothes, faint], W, H)
  assert.deepEqual(box, { x0: 90, y0: 50, x1: 149, y1: 189 })
  assert.equal(personBox([faint], W, H), null)
  // 140 tall, 15 % more: 161, within the frame's 200, centred, kept inside.
  const sq = squareAround(box!, W, H)
  assert.equal(sq.side, 161)
  assert.ok(sq.x >= 0 && sq.x + sq.side <= W && sq.y >= 0 && sq.y + sq.side <= H)
  // A box near the edge: the square moves in, never past it.
  const edge = squareAround({ x0: 280, y0: 0, x1: 299, y1: 30 }, W, H)
  assert.equal(edge.x + edge.side, W)
  assert.equal(edge.y, 0)
})

test('a plane made on the square goes back where the square was', async () => {
  const { pasted } = await import('../src/main/ai/parts')
  const sq = { x: 10, y: 5, side: 4 }
  const p = plane('hair', 4, 4, (x, y) => (x === 0 && y === 0 ? 255 : x === 3 && y === 3 ? 7 : 0))
  const out = pasted(p, sq, 20, 12)
  assert.equal(out[5 * 20 + 10], 255)
  assert.equal(out[8 * 20 + 13], 7)
  assert.equal(
    out.reduce((n, v) => n + (v > 0 ? 1 : 0), 0),
    2
  )
  // A crop a pixel larger than the square, from rounding: scaled onto it.
  const big = plane('hair', 5, 5, () => 9)
  assert.equal(pasted(big, sq, 20, 12)[8 * 20 + 13], 9)
})

test('a part is kept where it beats the person’s other parts', async () => {
  const { partPlane } = await import('../src/main/ai/parts')
  const n = 4
  const hair = { name: 'hair', data: Uint8Array.from([200, 100, 60, 0]), width: 4, height: 1 }
  const clothes = { name: 'clothes', data: Uint8Array.from([20, 100, 200, 0]), width: 4, height: 1 }
  const face = { name: 'face_skin', data: Uint8Array.from([0, 0, 0, 90]), width: 4, height: 1 }
  const body = { name: 'body_skin', data: Uint8Array.from([0, 0, 0, 80]), width: 4, height: 1 }
  const all = [hair, clothes, face, body]
  const h = partPlane(all, ['hair'], n)
  assert.equal(h[0], 200, 'clearly hair')
  assert.equal(h[1], 50, 'a tie: half')
  assert.equal(h[2], 0, 'a jumper read as some hair stays clothes')
  // Skin is the face's and the body's together.
  const skin = partPlane(all, ['face_skin', 'body_skin'], n)
  assert.equal(skin[3], 170)
})

test('a named mask is saved as what to ask for again', async () => {
  const { normaliseRecipe, defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
  for (const source of [
    { kind: 'segment', target: 'water' },
    { kind: 'segment', target: 'vegetation' },
    { kind: 'person', part: 'hair' }
  ]) {
    const r = defaultRecipe(false)
    const l = newLocalLayer('M')
    l.components = [
      {
        id: 'c1',
        kind: 'brush',
        mode: 'Add',
        opacity: 100,
        invert: false,
        feather: 0,
        width: 4,
        height: 4,
        png: 'AAAA',
        source
      } as never
    ]
    r.layers = [l]
    const back = normaliseRecipe(JSON.parse(JSON.stringify(r)), false)
    const c = back.layers[0].components[0] as { source?: unknown }
    assert.deepEqual(c.source, source)
  }
})
