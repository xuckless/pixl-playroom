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
import {
  cellFactor,
  proxyByCell,
  RAW_DEVELOP,
  sourceOrientation,
  uprightFraming,
  versionStamp
} from '../src/main/source'

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

test("a RAW is upright in every mode, its embedded preview too: the camera's orientation is not applied again", () => {
  const cr2 = { input: 'Raw', orientation: 8 } as unknown as SourceInfo
  assert.equal(sourceOrientation(cr2, 'EmbeddedPreview'), 'Normal')
  assert.equal(sourceOrientation(cr2, RAW_DEVELOP), 'Normal')
})

test('HEIF working copies made before the fix are made again', () => {
  const v = { mtime: 1000.4, size: 42 }
  assert.equal(versionStamp({ ...v, ext: 'jpg' }), '1000-42')
  assert.equal(versionStamp({ ...v, ext: 'HEIC' }), '1000-42-u')
})

test("a RAW's developments are made again on LibRaw, its embedded preview is not", () => {
  const v = { mtime: 1000.4, size: 42 }
  assert.equal(versionStamp({ ...v, ext: 'CR2' }), '1000-42-l')
  assert.equal(versionStamp({ ...v, ext: 'raf' }), '1000-42-l')
  // What no develop made keeps its name: thumbnails from the embedded JPEG.
  assert.equal(versionStamp({ ...v, ext: 'cr2' }, false), '1000-42')
  assert.equal(versionStamp({ ...v, ext: 'jpg' }, true), '1000-42')
})

test("a LUT profile keeps an HDR photo's headroom and clamps an SDR one as before", () => {
  const r = defaultRecipe(false)
  r.profile = { kind: 'lut', name: 'Film', path: '/luts/film.cube' }
  r.profileAmount = 80
  const lut = (c: ReturnType<typeof compile>): Extract<GradeOp, { Lut: unknown }>['Lut'] =>
    (ops(c).find((o) => 'Lut' in o) as Extract<GradeOp, { Lut: unknown }>).Lut
  assert.equal(lut(compile(r, ctx)).out_of_domain, 'Clamp')
  assert.equal(lut(compile(r, { ...ctx, hdr: true })).out_of_domain, 'ScaleHeadroom')
  // The SDR shoulder is a table on 0…1, clamped as it always was.
  const e = defaultRecipe(false)
  e.basic.exposure = 1
  assert.equal(lut(compile(e, ctx)).out_of_domain, 'Clamp')
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

test('a RAW proxy develops at half size when its cells are more than the proxy needs', () => {
  // Fujifilm's X-Trans cells are 3 photosites across; its GFX and everyone else's Bayer, 2.
  assert.equal(cellFactor({ ext: 'RAF', camera: 'FUJIFILM X-T4' }), 3)
  assert.equal(cellFactor({ ext: 'raf', camera: 'FUJIFILM GFX100S' }), 2)
  assert.equal(cellFactor({ ext: 'cr2', camera: 'Canon EOS 80D' }), 2)
  assert.equal(cellFactor({ ext: 'nef', camera: null }), 2)
  // A 24 MP Bayer (6000 across) has 3000 cells: more than a 2560 proxy needs.
  assert.equal(proxyByCell(6288, 2, 2560), true)
  // A 26 MP X-Trans has 2080: fewer, so it develops whole.
  assert.equal(proxyByCell(6240, 3, 2560), false)
  // A 102 MP GFX: half size, by far.
  assert.equal(proxyByCell(11664, 2, 2560), true)
  // A 16 MP Bayer: 2464 cells across, not enough.
  assert.equal(proxyByCell(4928, 2, 2560), false)
})
