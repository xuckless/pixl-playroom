import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoTone } from '../src/shared/auto'
import type { ImageStats } from '../src/shared/engine-types'

/** The luma percentiles autoTone reads, as encoded values 0…1. */
interface Scene {
  p005: number
  p2: number
  p10: number
  p50: number
  p90: number
  p95: number
  p995: number
  sigma: number
  clippedHigh?: number
  clippedLow?: number
}

function stats(s: Scene): ImageStats {
  const pts: [number, number][] = [
    [0.5, s.p005],
    [2, s.p2],
    [10, s.p10],
    [50, s.p50],
    [90, s.p90],
    [95, s.p95],
    [99.5, s.p995]
  ]
  return {
    luma_percentiles: pts.map(([percentile, value]) => ({ percentile, value })),
    luma_stddev: s.sigma,
    clipped_high: [s.clippedHigh ?? 0, s.clippedHigh ?? 0, s.clippedHigh ?? 0],
    clipped_low: [s.clippedLow ?? 0, s.clippedLow ?? 0, s.clippedLow ?? 0]
  } as unknown as ImageStats
}

const MID: Scene = {
  p005: 0.03,
  p2: 0.07,
  p10: 0.16,
  p50: 0.45,
  p90: 0.76,
  p95: 0.83,
  p995: 0.93,
  sigma: 0.21
}

test('a well-exposed scene gets small moves', () => {
  const t = autoTone(stats(MID))
  assert.ok(Math.abs(t.exposure) < 0.2, `exposure ${t.exposure}`)
  for (const k of ['contrast', 'highlights', 'shadows', 'whites', 'blacks'] as const)
    assert.ok(Math.abs(t[k]) <= 15, `${k} ${t[k]}`)
})

test('a flat, bright overcast frame gains contrast and keeps its highlights', () => {
  const t = autoTone(
    stats({
      p005: 0.28,
      p2: 0.32,
      p10: 0.4,
      p50: 0.58,
      p90: 0.74,
      p95: 0.79,
      p995: 0.86,
      sigma: 0.1
    })
  )
  assert.ok(t.highlights > -15, `highlights ${t.highlights}`)
  assert.ok(t.contrast > 0, `contrast ${t.contrast}`)
  assert.equal(t.shadows, 0)
  assert.ok(Math.abs(t.exposure) <= 1, `exposure ${t.exposure}`)
})

test('a clipped sky pulls highlights down, within the cap', () => {
  const t = autoTone(
    stats({
      p005: 0.02,
      p2: 0.05,
      p10: 0.14,
      p50: 0.46,
      p90: 0.9,
      p95: 0.96,
      p995: 1,
      sigma: 0.28,
      clippedHigh: 0.04
    })
  )
  assert.ok(t.highlights >= -50 && t.highlights <= -20, `highlights ${t.highlights}`)
  assert.ok(t.whites <= 0, `whites ${t.whites}`)
  assert.ok(t.contrast >= 0, `contrast ${t.contrast}`)
})

test('a dark frame is brightened, by at most two stops', () => {
  const t = autoTone(
    stats({
      p005: 0.0,
      p2: 0.01,
      p10: 0.03,
      p50: 0.15,
      p90: 0.35,
      p95: 0.42,
      p995: 0.6,
      sigma: 0.12
    })
  )
  assert.ok(t.exposure > 0.5 && t.exposure <= 2, `exposure ${t.exposure}`)
})

test('a low-key frame with a lit subject is not pushed to mid-grey', () => {
  const t = autoTone(
    stats({
      p005: 0.01,
      p2: 0.02,
      p10: 0.04,
      p50: 0.12,
      p90: 0.35,
      p95: 0.5,
      p995: 0.9,
      sigma: 0.15
    })
  )
  assert.ok(t.exposure >= 0 && t.exposure <= 0.4, `exposure ${t.exposure}`)
})

test('clipped shadows are never deepened', () => {
  const t = autoTone(stats({ ...MID, p005: 0, p2: 0.01, clippedLow: 0.02 }))
  assert.ok(t.blacks >= 0, `blacks ${t.blacks}`)
})

test('no scene breaks the caps', () => {
  // A small seeded generator (mulberry32) so a failure reproduces.
  let seed = 0x5eed
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < 500; i++) {
    const v = Array.from({ length: 7 }, rand).sort((a, b) => a - b)
    const scene: Scene = {
      p005: v[0],
      p2: v[1],
      p10: v[2],
      p50: v[3],
      p90: v[4],
      p95: v[5],
      p995: v[6],
      sigma: rand() * 0.4,
      clippedHigh: rand() < 0.3 ? rand() * 0.1 : 0,
      clippedLow: rand() < 0.3 ? rand() * 0.1 : 0
    }
    const t = autoTone(stats(scene))
    const at = `case ${i}: ${JSON.stringify(scene)} → ${JSON.stringify(t)}`
    assert.ok(t.exposure >= -2 && t.exposure <= 2, at)
    assert.ok(t.highlights >= -50 && t.highlights <= 0, at)
    assert.ok(t.whites >= -30 && t.whites <= 40, at)
    assert.ok(t.blacks >= -35 && t.blacks <= 25, at)
    assert.ok(t.shadows >= 0 && t.shadows <= 40, at)
    assert.ok(t.contrast >= -20 && t.contrast <= 30, at)
    for (const x of Object.values(t)) assert.ok(Number.isFinite(x), at)
  }
})
