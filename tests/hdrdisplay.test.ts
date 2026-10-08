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
