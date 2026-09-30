import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import type { Curves, GradeOp, SourceInfo } from '../src/shared/engine-types'
import {
  defaultExportSettings,
  gainMapEncode,
  hdrLimit,
  normaliseExportSettings,
  pq,
  pqNits,
  rolloffKneeMax,
  sdrRendition,
  withGainMap
} from '../src/shared/export'
import { applyGroups, defaultRecipe, normaliseRecipe } from '../src/shared/recipe'
import { sourceOrientation, uprightFraming, versionStamp } from '../src/main/source'

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 4032,
  frameHeight: 3024,
  scale: 0.3,
  seed: 1,
  brushPaths: {},
  applyCrop: true
}

const ops = (c: ReturnType<typeof compile>): GradeOp[] =>
  c.grade?.layers.flatMap((l) => l.stages.flatMap((s) => s.ops)) ?? []

test('positive exposure rolls highlights onto white in SDR, and leaves HDR its headroom', () => {
  const r = defaultRecipe(false)
  r.basic.exposure = 1
  assert.ok(ops(compile(r, ctx)).some((o) => 'Lut' in o))
  assert.ok(!ops(compile(r, { ...ctx, hdr: true })).some((o) => 'Lut' in o))
})

test('on HDR a tonal curve goes on past white at slope 1', () => {
  const r = defaultRecipe(false)
  r.profile = { kind: 'standard' }
  const sdr = ops(compile(r, ctx)).find((o) => 'Curves' in o) as { Curves: Curves }
  const hdr = ops(compile(r, { ...ctx, hdr: true })).find((o) => 'Curves' in o) as {
    Curves: Curves
  }
  const sp = sdr.Curves.master!.points
  const hp = hdr.Curves.master!.points
  assert.equal(sp.at(-1)!.x, 1)
  assert.deepEqual(hp.slice(0, sp.length), sp)
  const [a, b] = hp.slice(-2)
  assert.ok(b.x > 5)
  assert.ok(Math.abs(b.y - a.y - (b.x - a.x)) < 1e-3)
})

test('PQ round-trips, and the roll-off knee is the one BT.2390 allows', () => {
  for (const n of [0.5, 100, 203, 1000, 4000, 10000])
    assert.ok(Math.abs(pqNits(pq(n)) - n) < n * 1e-4)
  // The engine's own figure for a 996 cd/m² peak rolling off from 10 000.
  assert.ok(Math.abs(rolloffKneeMax(996, 10000) - 315.1) < 1)
})

test('the output limit: a clip, or a roll-off inside what BT.2390 allows', () => {
  const s = defaultExportSettings()
  assert.equal(hdrLimit(s, 1000), 'Clip')
  s.hdr.limit = 'rolloff'
  const full = hdrLimit(s, 1000) as { Rolloff: { knee_nits: number; source_max_nits: number } }
  assert.equal(full.Rolloff.source_max_nits, 4000)
  assert.ok(full.Rolloff.knee_nits <= rolloffKneeMax(1000, 4000))
  s.hdr.knee = 50
  const half = hdrLimit(s, 1000) as typeof full
  assert.ok(Math.abs(half.Rolloff.knee_nits - full.Rolloff.knee_nits / 2) <= 1)
  // Nothing to roll off from where PQ already ends.
  assert.equal(hdrLimit(s, 10000), 'Clip')
})

test('a gain map spans the master’s headroom over SDR white, in the formats that carry one', () => {
  const s = defaultExportSettings()
  const map = gainMapEncode(s, 812)
  assert.equal(map.gain_max_log2, 2)
  assert.equal(map.hdr_capacity_max, 2)
  assert.ok(map.gain_min_log2 < 0)
  const jpeg = withGainMap({ Jpeg: { quality: 90, subsampling: 'Quarter', optimize: true } }, map)
  assert.deepEqual((jpeg as { Jpeg: { gain_map: unknown } }).Jpeg.gain_map, map)
  assert.deepEqual(withGainMap({ Png: { compression: 'Fast', filter: 'Sub' } }, map), {
    Png: { compression: 'Fast', filter: 'Sub' }
  })
  const sdr = sdrRendition(s, 812)
  assert.equal(sdr.source_peak_nits, 812)
  assert.equal(sdr.target_peak_nits, 203)
})

test('export settings saved before a field existed take its default', () => {
  const old = { format: 'avif', hdr: { mode: 'keep' } } as never
  const s = normaliseExportSettings(old)
  assert.equal(s.format, 'avif')
  assert.equal(s.hdr.mode, 'keep')
  assert.equal(s.hdr.limit, 'clip')
  assert.equal(s.hdr.gainMapQuality, 85)
  assert.equal(s.hdr.operator, 'Bt2390')
})

const heif = { input: 'Heif', orientation: 6 } as unknown as SourceInfo
const jpeg = { input: 'Jpeg', orientation: 6 } as unknown as SourceInfo

test('a HEIF is upright as decoded: its EXIF tag is not applied again', () => {
  assert.equal(sourceOrientation(heif, null), 'Normal')
  assert.equal(sourceOrientation(jpeg, null), 'Rotate90')
  // …but a new file from it states framing, so the engine resets the tag.
  assert.notEqual(uprightFraming('Normal', heif), null)
  assert.equal(uprightFraming('Normal', jpeg), null)
  assert.equal(uprightFraming('Rotate90', jpeg)?.orientation, 'Rotate90')
})

test('HEIF working copies made before the fix are made again', () => {
  const v = { mtime: 1000.4, size: 42 }
  assert.equal(versionStamp({ ...v, ext: 'jpg' }), '1000-42')
  assert.equal(versionStamp({ ...v, ext: 'HEIC' }), '1000-42-u')
})

test('a recipe edits a gain map on its base unless it says HDR, and sync carries it', () => {
  assert.equal(defaultRecipe(false).gainMap, 'base')
  assert.equal(normaliseRecipe({ gainMap: 'nonsense' }, false).gainMap, 'base')
  assert.equal(normaliseRecipe({ gainMap: 'hdr' }, false).gainMap, 'hdr')
  const from = { ...defaultRecipe(false), gainMap: 'hdr' as const }
  assert.equal(applyGroups(defaultRecipe(false), from, ['hdr']).gainMap, 'hdr')
  // Noise reduction now carries the AI denoise with it.
  from.detail.ai.enabled = true
  assert.equal(applyGroups(defaultRecipe(false), from, ['detailNoise']).detail.ai.enabled, true)
})
