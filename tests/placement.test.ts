import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placePopover, type Rect } from '../src/shared/placement'

const vp = { w: 1000, h: 800 }
const opts = { align: 'left' as const, side: 'bottom' as const, gap: 6, margin: 8 }
const at = (left: number, top: number, w = 24, h = 24): Rect => ({
  left,
  top,
  right: left + w,
  bottom: top + h
})

test('a popover that fits goes under its anchor, lined up with it', () => {
  const p = placePopover(at(100, 100), { w: 200, h: 150 }, vp, opts)
  assert.deepEqual(p, { x: 100, y: 130, side: 'bottom', maxHeight: 800 - 8 - 130 })
})

test('near the bottom it flips over the anchor', () => {
  const p = placePopover(at(100, 700), { w: 200, h: 170 }, vp, opts)
  assert.equal(p.side, 'top')
  assert.equal(p.y, 700 - 6 - 170)
})

test('asked to go over, it stays over when there is room and flips when not', () => {
  const top = { ...opts, side: 'top' as const }
  assert.equal(placePopover(at(100, 400), { w: 200, h: 150 }, vp, top).side, 'top')
  assert.equal(placePopover(at(100, 60), { w: 200, h: 150 }, vp, top).side, 'bottom')
})

test('right alignment lines up right edges, and x is kept inside the viewport', () => {
  const r = placePopover(at(500, 100), { w: 200, h: 100 }, vp, { ...opts, align: 'right' })
  assert.equal(r.x, 524 - 200)
  assert.equal(placePopover(at(900, 100), { w: 200, h: 100 }, vp, opts).x, 1000 - 8 - 200)
  const l = placePopover(at(10, 100), { w: 200, h: 100 }, vp, { ...opts, align: 'right' })
  assert.equal(l.x, 8)
})

test('too tall for either side: the roomier side, capped to scroll', () => {
  const p = placePopover(at(100, 300), { w: 200, h: 900 }, vp, opts)
  assert.equal(p.side, 'bottom')
  assert.equal(p.maxHeight, 800 - 8 - 330)
  assert.equal(p.y, 330)
  const q = placePopover(at(100, 600), { w: 200, h: 900 }, vp, opts)
  assert.equal(q.side, 'top')
  assert.equal(q.maxHeight, 600 - 6 - 8)
  assert.equal(q.y, 8)
})
