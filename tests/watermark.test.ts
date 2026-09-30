import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseExportSettings } from '../src/shared/export'
import {
  DEFAULT_WATERMARK,
  placeMark,
  pngSize,
  watermarkOverlay,
  WATERMARK_ANCHORS,
  type WatermarkSettings
} from '../src/shared/watermark'

const s = (p: Partial<WatermarkSettings> = {}): WatermarkSettings => ({
  ...DEFAULT_WATERMARK,
  enabled: true,
  path: '/logo.png',
  ...p
})

test('size and inset are shares of the shorter edge; the height follows the picture', () => {
  // A 400 × 100 logo at 20% of a 3000 × 2000 output's 2000: 400 wide, 100 high.
  const m = placeMark(s({ size: 20, inset: 3, anchor: 'br' }), 3000, 2000, 400, 100)
  assert.deepEqual(m, { x: 3000 - 60 - 400, y: 2000 - 60 - 100, width: 400, height: 100 })
  // The same settings on the portrait: the same mark.
  const p = placeMark(s({ size: 20, inset: 3, anchor: 'br' }), 2000, 3000, 400, 100)
  assert.equal(p.width, 400)
  assert.equal(p.x, 2000 - 60 - 400)
})

test('every anchor lands inside the output', () => {
  for (const anchor of WATERMARK_ANCHORS) {
    for (const [W, H] of [
      [1920, 1080],
      [640, 960],
      [101, 57]
    ]) {
      const m = placeMark(s({ anchor, size: 35, inset: 5 }), W, H, 300, 120)
      assert.ok(m.x >= 1 && m.y >= 1, `${anchor} ${W}×${H} top-left`)
      assert.ok(
        m.x + m.width <= W - 1 && m.y + m.height <= H - 1,
        `${anchor} ${W}×${H} bottom-right`
      )
    }
  }
  const c = placeMark(s({ anchor: 'c', size: 10 }), 1000, 800, 100, 100)
  assert.deepEqual([c.x, c.y], [(1000 - 80) / 2, (800 - 80) / 2])
  const t = placeMark(s({ anchor: 't', size: 10, inset: 2 }), 1000, 800, 100, 50)
  assert.deepEqual([t.x, t.y], [(1000 - 80) / 2, 16])
})

test('a mark too large for the output shrinks to fit, keeping its shape', () => {
  // A tall mark at 100%: limited by the height.
  const m = placeMark(s({ size: 100, inset: 0 }), 1000, 500, 100, 400)
  assert.ok(m.height <= 498)
  assert.ok(Math.abs(m.height / m.width - 4) < 0.05)
})

test('the overlay is the placed mark in fractions the engine rounds back to the same pixels', () => {
  const W = 2048
  const H = 1365
  const o = watermarkOverlay(
    s({ opacity: 65, blend: 'Screen' }),
    '/logo.png',
    W,
    H,
    512,
    128,
    false
  )
  const m = placeMark(s(), W, H, 512, 128)
  assert.equal(Math.round(o.rect.x * W), m.x)
  assert.equal(Math.round(o.rect.y * H), m.y)
  assert.equal(Math.round(o.rect.width * W), m.width)
  assert.equal(o.opacity, 0.65)
  assert.deepEqual(o.source, { Png: '/logo.png' })
  assert.equal(o.blend.mode, 'Screen')
  assert.deepEqual(o.blend.space, {
    Encoded: { space: 'Srgb', intent: 'RelativeColorimetric', black_point_compensation: false }
  })
  // On an HDR output the display-range blends are computed on the PQ signal.
  const hdr = watermarkOverlay(s({ blend: 'Multiply' }), '/l.png', W, H, 512, 128, true)
  assert.equal((hdr.blend.space as { Encoded: { space: string } }).Encoded.space, 'Rec2100Pq')
})

test('a PNG’s size comes from its header; anything else is refused', () => {
  const head = new Uint8Array(24)
  head.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
  head.set([0, 0, 2, 0, 0, 0, 0, 128], 16)
  assert.deepEqual(pngSize(head), { width: 512, height: 128 })
  assert.equal(pngSize(new Uint8Array([0xff, 0xd8, 0xff])), null)
})

test('settings saved before the watermark existed get it, off', () => {
  const x = normaliseExportSettings({ format: 'jpeg' } as never)
  assert.equal(x.watermark.enabled, false)
  assert.equal(x.watermark.anchor, 'br')
  const y = normaliseExportSettings({ watermark: { enabled: true, path: '/a.png' } } as never)
  assert.equal(y.watermark.opacity, 80)
  assert.equal(y.watermark.path, '/a.png')
})
