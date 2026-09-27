import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HDR_FLOOR_STOPS, stopsBins, stopsX } from '../src/shared/scopes'

test('reference white sits where its stops put it', () => {
  // 4× headroom: 2 stops above white, 8 below.
  assert.equal(stopsX(1, 4), -HDR_FLOOR_STOPS / (2 - HDR_FLOOR_STOPS))
  assert.equal(stopsX(4, 4), 1)
  assert.equal(stopsX(0, 4), 0)
  assert.equal(stopsX(1e-6, 4), 0)
})

test('re-binning onto stops keeps every count', () => {
  const counts = Array.from({ length: 4096 }, (_, i) => (i * 7919) % 13)
  const total = counts.reduce((a, b) => a + b, 0)
  const bins = stopsBins(counts, 4.93, 256)
  assert.equal(bins.length, 256)
  assert.ok(Math.abs(bins.reduce((a, b) => a + b, 0) - total) < 1e-6 * total)
})

test('a lone value lands in the display bin of its stop', () => {
  const n = 4096
  const counts = new Array<number>(n).fill(0)
  // A bin just at reference white (1.0 of a 4.0 range).
  counts[n / 4] = 100
  const bins = stopsBins(counts, 4, 100)
  const at = bins.findIndex((c) => c > 0)
  assert.equal(at, Math.floor(stopsX(1, 4) * 100))
})
