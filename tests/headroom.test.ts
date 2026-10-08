// A float RAW master's headroom under AI steps (engine 0.18, Pass 95).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GUARD_LOW, guardOverlay, headroomGuard } from '../src/main/pixels/ops'
import { decodePng, encodeGreyPng, encodePng16 } from '../src/main/pngio'

test('the guard keeps the step where the frame is under white, the frame where it is over', () => {
  // Four pixels: dark, just under the ramp, in it, clipped (one channel over 1).
  const rgb = new Float32Array([0.2, 0.2, 0.2, GUARD_LOW, 0.5, 0.5, 0.975, 0.9, 0.9, 0.4, 1.6, 0.4])
  const g = [...headroomGuard(rgb, 4, 1)]
  assert.deepEqual([g[0], g[1], g[3]], [255, 255, 0])
  // Half way up the ramp (f32 rounding: 127 or 128).
  assert.ok(Math.abs(g[2] - 127.5) <= 1)
})

test('a step’s overlay takes the guard as alpha, at its place on the frame', () => {
  const dir = mkdtempSync(join(tmpdir(), 'guard-'))
  // A 2×1 RGB step at x 1 on a 3×1 frame whose last pixel is clipped.
  const src = join(dir, 'step.png')
  writeFileSync(src, encodePng16(new Uint16Array([100, 200, 300, 400, 500, 600]), 2, 1, 3))
  const guard = join(dir, 'guard.png')
  writeFileSync(guard, encodeGreyPng(new Uint8Array([255, 255, 0]), 3, 1))
  const out = join(dir, 'out.png')
  guardOverlay(src, guard, out, { x: 1, y: 0 })
  const d = decodePng(readFileSync(out))
  assert.equal(d.colorType, 6)
  const px = (i: number, c: number): number =>
    (d.rows[i * 8 + c * 2] << 8) | d.rows[i * 8 + c * 2 + 1]
  assert.deepEqual([px(0, 0), px(0, 3)], [100, 65535])
  // Over the clipped pixel: transparent, the frame's own value shows.
  assert.deepEqual([px(1, 2), px(1, 3)], [600, 0])
})
