// The loupe's planes on another lens frame (renderer lib/planes.ts): the
// main process re-warps a plane and makes a grid once for each pair of
// frames, not once for each stroke painted. The bridge is a fake here.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Distortion } from '../src/shared/engine-types'
import { makeGrid, type LensFrame, type P } from '../src/shared/lensframe'
import type { BrushComponent } from '../src/shared/recipe'

const asked = { planeOnFrame: 0, maskGrid: 0, putPlane: 0 }
let failNext = false
const shift = (p: P): P => ({ x: p.x + 0.01, y: p.y })
;(globalThis as { window?: unknown }).window = {
  playroom: {
    develop: {
      planeOnFrame: async (_key: string, ref: string): Promise<string> => {
        asked.planeOnFrame++
        if (failNext) {
          failNext = false
          throw new Error('no map')
        }
        return `warped:${ref}`
      },
      maskGrid: async () => {
        asked.maskGrid++
        return makeGrid(shift, shift)
      },
      putPlane: async (png: string) => {
        asked.putPlane++
        return `ref-of-${png}`
      },
      getPlane: async (ref: string) => `png-of-${ref}`
    }
  }
}
const { brushOn, planePngOn } = await import('../src/renderer/src/lib/planes')

const LENS: Distortion = {
  model: { Poly3: { k1: -0.03 } },
  geometry: { centre: { x: 0.5, y: 0.5 }, unit: 'HalfDiagonal' },
  amount: 1,
  scale: 1
}

function brush(lensFrame?: LensFrame): BrushComponent {
  return {
    id: 'b',
    kind: 'brush',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: 30,
    height: 20,
    png: '',
    ref: 'a'.repeat(64),
    ...(lensFrame !== undefined ? { lensFrame } : {}),
    strokes: [{ id: 's1', dabs: [0.3, 0.4, 0.02, 1], softness: 0, flow: 1 }]
  }
}

test('a plane re-warped onto another frame is asked for once, and again after a failure', async () => {
  const c = brush(null)
  // On the frame asked for: no question.
  assert.equal(await planePngOn('photo', c, null), 'png-of-' + 'a'.repeat(64))
  assert.equal(asked.planeOnFrame, 0)
  // Each stroke painted redraws the mask: the plane under it is re-warped once.
  for (let i = 0; i < 3; i++) assert.equal(await planePngOn('photo', c, LENS), `warped:${c.ref}`)
  assert.equal(asked.planeOnFrame, 1)
  // Another photo, or the other way round, is another plane.
  await planePngOn('other', c, LENS)
  await planePngOn('photo', brush(LENS), null)
  assert.equal(asked.planeOnFrame, 3)
  // A failure is not kept.
  const d = { ...c, ref: 'c'.repeat(64) }
  failNext = true
  await assert.rejects(planePngOn('photo', d, LENS))
  assert.equal(await planePngOn('photo', d, LENS), `warped:${d.ref}`)
  assert.equal(asked.planeOnFrame, 5)
})

test('strokes carried onto another frame ask for its grid once', async () => {
  const c = brush()
  // Strokes on the frame shown stay as they are.
  assert.equal(await brushOn('photo', c, LENS, LENS), c)
  assert.equal(asked.maskGrid, 0)
  const a = await brushOn('photo', c, LENS, null)
  const b = await brushOn('photo', { ...c, strokes: [...c.strokes!] }, LENS, null)
  assert.equal(asked.maskGrid, 1)
  assert.ok(Math.abs(a.strokes![0].dabs[0] - 0.31) < 1e-9)
  assert.deepEqual(a.strokes, b.strokes)
})
