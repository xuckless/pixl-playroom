// The display the HDR preview renders for (engine 0.18: Ceiling::Display).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DISPLAY_SETTING,
  displayChanged,
  normaliseDisplaySetting,
  resolveDisplay
} from '../src/shared/hdrdisplay'

test('a Mac screen’s headroom becomes white 203, peak 203 · H (the engine’s recipe)', () => {
  const d = resolveDisplay(DEFAULT_DISPLAY_SETTING, { current: 4, potential: 16 })
  assert.deepEqual(d, {
    hdr: true,
    whiteNits: 203,
    peakNits: 812,
    headroom: 4,
    potential: 16,
    source: 'screen'
  })
  // No headroom now (macOS raises it only while HDR shows): SDR, the potential kept.
  const idle = resolveDisplay(DEFAULT_DISPLAY_SETTING, { current: 1, potential: 16 })
  assert.equal(idle.hdr, false)
  assert.equal(idle.potential, 16)
})

test('stated numbers win; nothing read and nothing stated is SDR', () => {
  const stated = resolveDisplay({ mode: 'stated', whiteNits: 240, peakNits: 1200 }, null)
  assert.deepEqual([stated.hdr, stated.headroom, stated.source], [true, 5, 'stated'])
  const sdr = resolveDisplay(DEFAULT_DISPLAY_SETTING, null)
  assert.deepEqual([sdr.hdr, sdr.peakNits, sdr.source], [false, 203, 'none'])
})

test('a stored setting is held to what a display can be', () => {
  assert.deepEqual(normaliseDisplaySetting({ mode: 'stated', whiteNits: 5, peakNits: 99999 }), {
    mode: 'stated',
    whiteNits: 80,
    peakNits: 10000
  })
  assert.deepEqual(normaliseDisplaySetting('junk'), DEFAULT_DISPLAY_SETTING)
})

test('a reading renders again only when it moves enough', () => {
  const a = resolveDisplay(DEFAULT_DISPLAY_SETTING, { current: 3, potential: 16 })
  assert.ok(displayChanged(null, a))
  assert.ok(
    !displayChanged(a, resolveDisplay(DEFAULT_DISPLAY_SETTING, { current: 3.02, potential: 16 }))
  )
  assert.ok(
    displayChanged(a, resolveDisplay(DEFAULT_DISPLAY_SETTING, { current: 3.2, potential: 16 }))
  )
})

test('Full HDR renders for the display while on; a Mac with headroom to reach asks for it first', async () => {
  const { renderDisplay, canShowHdr } = await import('../src/shared/hdrdisplay')
  const mac = resolveDisplay(DEFAULT_DISPLAY_SETTING, { current: 1, potential: 16 })
  assert.ok(canShowHdr(mac))
  assert.deepEqual(renderDisplay(true, mac), { whiteNits: 203, peakNits: 406 })
  assert.equal(renderDisplay(false, mac), null)
  const raised = resolveDisplay(DEFAULT_DISPLAY_SETTING, { current: 5, potential: 16 })
  // 5× in quarter stops, rounded down: 2^2.25 = 4.76×.
  assert.deepEqual(renderDisplay(true, raised), { whiteNits: 203, peakNits: 966 })
  const sdr = resolveDisplay(DEFAULT_DISPLAY_SETTING, null)
  assert.ok(!canShowHdr(sdr))
  assert.equal(renderDisplay(true, sdr), null)
})

test('Full HDR keeps its SDR companion as a Display P3 PNG the engine reads', async () => {
  const { encodePng8, decodePng, CICP_DISPLAY_P3 } = await import('../src/main/pngio')
  const w = 3
  const h = 2
  const rgba = new Uint8Array(w * h * 4).map((_, i) => (i * 37) % 256)
  const png = encodePng8(rgba, w, h, 1, [CICP_DISPLAY_P3])
  const d = decodePng(png)
  assert.equal(d.width, w)
  assert.equal(d.colorType, 6)
  // Unfiltered rows: each one's filter byte, then the pixels as given.
  for (let y = 0; y < h; y++)
    assert.deepEqual(
      [...d.rows.subarray(y * w * 4, (y + 1) * w * 4)],
      [...rgba.subarray(y * w * 4, (y + 1) * w * 4)]
    )
  const { createRequire } = await import('node:module')
  const { mkdtempSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const engine = createRequire(import.meta.url)('@xuckless/pixl-engine') as {
    probe(p: string): Promise<{ width: number; color_space?: unknown }>
  }
  const file = join(mkdtempSync(join(tmpdir(), 'companion-')), 'c.png')
  writeFileSync(file, png)
  const info = await engine.probe(file)
  assert.equal(info.width, w)
})

test('a drifting headroom renders again only a quarter stop on', async () => {
  const { renderDisplay, steppedHeadroom } = await import('../src/shared/hdrdisplay')
  assert.equal(steppedHeadroom(4), 4)
  assert.equal(steppedHeadroom(4.6), 4)
  assert.equal(steppedHeadroom(1), 1)
  const at = (current: number): ReturnType<typeof renderDisplay> =>
    renderDisplay(true, resolveDisplay(DEFAULT_DISPLAY_SETTING, { current, potential: 16 }))
  assert.deepEqual(at(3.5), at(3.6))
  assert.notDeepEqual(at(3.5), at(4.1))
  // A stated display is rendered for as stated.
  const stated = resolveDisplay(
    { mode: 'stated', whiteNits: 203, peakNits: 1000 },
    { current: 3.3, potential: 16 }
  )
  assert.deepEqual(renderDisplay(true, stated), { whiteNits: 203, peakNits: 1000 })
})
