// AI Remove (MI-GAN, engine 0.18): a stroke over what should go, baked.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compileRetouch,
  REMOVE_CONTEXT,
  removeSpot,
  strokeOver,
  type P
} from '../src/shared/retouch'

/** A grey mask with a filled rectangle. */
function mask(
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): { data: Uint8Array; width: number; height: number } {
  const data = new Uint8Array(w * h)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) data[y * w + x] = 255
  return { data, width: w, height: h }
}

test('a mask becomes a serpentine stroke that covers it, a little past its edge', () => {
  const s = strokeOver(mask(400, 300, 100, 50, 199, 249))!
  assert.ok(s)
  const xs = s.points.map((p) => p.x * 400)
  const ys = s.points.map((p) => p.y * 300)
  // Row ends at the object's sides; rows from its top to its bottom.
  assert.ok(Math.min(...xs) <= 101 && Math.max(...xs) >= 199)
  assert.ok(Math.min(...ys) <= 55 && Math.max(...ys) >= 245)
  // Rows a stroke's width apart, so the sweep leaves no gap.
  const r = s.radius * 300
  const rowYs = [...new Set(ys.map((y) => Math.round(y)))].sort((a, b) => a - b)
  for (let i = 1; i < rowYs.length; i++) assert.ok(rowYs[i] - rowYs[i - 1] <= 2 * r)
  // A serpentine: each row runs the other way to the last.
  assert.ok(xs[1] > xs[0] && xs[3] < xs[2])
  assert.ok(s.points.length <= 4096)
})

test('nothing selected is no stroke; a speck is still a stroke', () => {
  assert.equal(strokeOver(mask(50, 50, 0, 0, -1, -1)), null)
  const dot = strokeOver(mask(50, 50, 20, 20, 20, 20))!
  assert.ok(dot.points.length >= 2)
})

test('a Remove reaches the engine only with the model a bake gives it', () => {
  const pts: P[] = [
    { x: 0.2, y: 0.3 },
    { x: 0.4, y: 0.3 }
  ]
  const spot = removeSpot(pts, 0.02, 25)
  assert.equal(spot.kind, 'remove')
  // Live (no inpainter): left out, never a refusal.
  assert.equal(compileRetouch([spot], 'Normal', 6000, 4000), null)
  const model = { model: { model_path: '/m/migan.onnx' } }
  const r = compileRetouch([spot], 'Normal', 6000, 4000, model)!
  const step = r.steps[0] as { Remove: Record<string, unknown> }
  assert.ok('Remove' in step)
  assert.equal(step.Remove.context, REMOVE_CONTEXT)
  assert.equal(step.Remove.model, model)
  assert.equal(step.Remove.opacity, 1)
  assert.ok('Stroke' in (step.Remove.shape as object))
})
