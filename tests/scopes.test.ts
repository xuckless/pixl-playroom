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

// ── Resolve's scopes, binned from the preview ────────────────────────────────

const solid = (
  w: number,
  h: number,
  rgb: [number, number, number],
  float = false
): { width: number; height: number; data: Float32Array | Uint8ClampedArray } => {
  const data = float ? new Float32Array(w * h * 4) : new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...rgb, float ? 1 : 255], i * 4)
  return { width: w, height: h, data }
}

test('a mid grey picture is one line across the waveform and the parade', async () => {
  const { binScopes } = await import('../src/shared/scopes')
  const b = binScopes(solid(64, 32, [128, 128, 128]), { columns: 16, levels: 256 })
  assert.equal(b.top, 1)
  const row = Math.round((128 / 255) * 255)
  let onRow = 0
  for (let c = 0; c < 16; c++) onRow += b.waveform![row * 16 + c]
  assert.equal(onRow, b.pixels)
  for (let k = 0; k < 3; k++) {
    let n = 0
    for (let c = 0; c < 16; c++) n += b.parade![k * 16 * 256 + row * 16 + c]
    assert.equal(n, b.pixels)
  }
})

test('75% red lands on the vectorscope’s R target; grey at the centre', async () => {
  const { binScopes, vectorTargets } = await import('../src/shared/scopes')
  const size = 256
  const red = binScopes(solid(8, 8, [0.75, 0, 0], true), { vector: size, want: ['vectorscope'] })
  const t = vectorTargets().find((x) => x.name === 'R')!
  const at = Math.floor((0.5 - t.cr) * size) * size + Math.floor((t.cb + 0.5) * size)
  assert.equal(red.vector![at], red.pixels)
  const grey = binScopes(solid(8, 8, [0.4, 0.4, 0.4], true), {
    vector: size,
    want: ['vectorscope']
  })
  assert.equal(grey.vector![(size / 2) * size + size / 2], grey.pixels)
})

test('skin sits near the vectorscope’s skin line', async () => {
  const { cbcr, SKIN_LINE } = await import('../src/shared/scopes')
  for (const [r, g, b] of [
    [224, 172, 140],
    [141, 85, 36],
    [255, 219, 172]
  ]) {
    const c = cbcr(r / 255, g / 255, b / 255)
    const deg = (Math.atan2(c.cr, c.cb) * 180) / Math.PI
    assert.ok(
      Math.abs(deg - (SKIN_LINE * 180) / Math.PI) < 12,
      `${r},${g},${b} at ${deg.toFixed(1)}°`
    )
  }
})

test('D65 white is at u′v′ (0.1978, 0.4683)', async () => {
  const { uvOfLinear } = await import('../src/shared/scopes')
  const uv = uvOfLinear(1, 1, 1)!
  assert.ok(Math.abs(uv.u - 0.1978) < 5e-4 && Math.abs(uv.v - 0.4683) < 5e-4, JSON.stringify(uv))
  assert.equal(uvOfLinear(0, 0, 0), null)
})

test('headroom raises the waveform’s top; the scopes cycle round', async () => {
  const { binScopes, cycleScope, SCOPE_KINDS } = await import('../src/shared/scopes')
  const b = binScopes(solid(8, 8, [1.9, 1.9, 1.9], true), { want: ['waveform'] })
  assert.equal(b.top, 2)
  assert.equal(b.vector, null)
  assert.ok(b.parade, 'the RGB waveform draws the parade')
  assert.equal(cycleScope(SCOPE_KINDS[SCOPE_KINDS.length - 1], 1), SCOPE_KINDS[0])
  assert.equal(cycleScope(SCOPE_KINDS[0], -1), SCOPE_KINDS[SCOPE_KINDS.length - 1])
})
