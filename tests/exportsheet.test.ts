// The one-sheet export: its built-in presets and the edited state, the
// photos' makeup, the size estimate, and the guard for HDR kept of SDR photos.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultExportSettings, estimateBytes, type ExportSettings } from '../src/shared/export'
import { blocked, exportGuards, type ExportSource } from '../src/shared/exportGuards'
import {
  BUILT_IN_PRESETS,
  copyName,
  isBuiltIn,
  sameSettings,
  settingsKey
} from '../src/shared/exportPresets'
import {
  estimateEach,
  estimateExport,
  exportMakeup,
  formatBytes,
  isLossless,
  selectionGuards,
  writesHdr,
  type ExportItem
} from '../src/shared/exportSummary'

const jpg: ExportSource = { ext: 'jpg', isRaw: false, isHdr: false, hasGainMap: false }
const pq: ExportSource = { ext: 'avif', isRaw: false, isHdr: true, hasGainMap: false }

function set(
  more: Partial<ExportSettings>,
  hdr: Partial<ExportSettings['hdr']> = {}
): ExportSettings {
  const d = defaultExportSettings()
  return { ...d, ...more, hdr: { ...d.hdr, ...hdr } }
}

test('the built-ins: their own ids, and each exports a plain JPEG without a block', () => {
  const ids = BUILT_IN_PRESETS.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every(isBuiltIn))
  assert.equal(isBuiltIn('a1b2c3'), false)
  for (const p of BUILT_IN_PRESETS) {
    assert.equal(blocked(exportGuards(p.settings, [jpg])), false, p.name)
    // Stored as normalised settings: what the sheet compares against.
    assert.equal(sameSettings(p.settings, p.settings), true)
  }
  const web = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:web')!.settings
  assert.deepEqual([web.format, web.quality, web.colorSpace], ['jpeg', 85, 'Srgb'])
  assert.deepEqual([web.resize.mode, web.resize.value], ['long', 2048])
  const social = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:social')!.settings
  assert.deepEqual(
    [social.resize.mode, social.resize.value, social.resize.valueH],
    ['box', 1080, 1350]
  )
  const print = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:print')!.settings
  assert.deepEqual([print.format, print.bitDepth, print.colorSpace], ['tiff', 16, 'AdobeRgb'])
  const hdr = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:hdr')!.settings
  assert.deepEqual([hdr.format, hdr.hdr.mode, hdr.hdr.to], ['avif', 'keep', 'Rec2100Pq'])
})

test('the HDR preset says when none of the photos is HDR, and only then', () => {
  const hdr = BUILT_IN_PRESETS.find((p) => p.id === 'builtin:hdr')!.settings
  const ids = (g: ReturnType<typeof exportGuards>): string[] => g.map((x) => x.id)
  assert.ok(ids(exportGuards(hdr, [jpg, jpg])).includes('no-hdr'))
  assert.equal(exportGuards(hdr, [jpg]).find((g) => g.id === 'no-hdr')?.card, 'hdr')
  assert.ok(!ids(exportGuards(hdr, [jpg, pq])).includes('no-hdr'))
  // Photos not read yet might be HDR: nothing is said.
  assert.ok(!ids(exportGuards(hdr, [jpg], true, 2)).includes('no-hdr'))
  // Expand makes them HDR.
  assert.ok(
    !ids(exportGuards({ ...hdr, hdr: { ...hdr.hdr, mode: 'expand' } }, [jpg])).includes('no-hdr')
  )
})

test('settings compare by what they say: key order and missing fields do not make them edited', () => {
  const d = defaultExportSettings()
  const reordered = Object.fromEntries(Object.entries(d).reverse()) as unknown as ExportSettings
  assert.equal(sameSettings(d, reordered), true)
  // An older preset, saved without the newer fields, reads as their defaults.
  const { watermark: _w, outputSharpen: _o, ...older } = d
  void _w
  void _o
  assert.equal(sameSettings(older as ExportSettings, d), true)
  assert.equal(settingsKey(older as ExportSettings), settingsKey(d))
  assert.equal(sameSettings({ ...d, quality: 84 }, d), false)
  assert.equal(sameSettings({ ...d, hdr: { ...d.hdr, peak: 1000 } }, d), false)
})

test('a copy takes a name nobody has', () => {
  assert.equal(copyName('Web 2048', [], 'copy'), 'Web 2048 copy')
  assert.equal(copyName('Web 2048', ['Web 2048 copy'], 'copy'), 'Web 2048 copy 2')
  assert.equal(copyName('A', ['A copy', 'A copy 2'], 'copy'), 'A copy 3')
})

test('the size estimate: exact for an uncompressed TIFF, and moving as it should', () => {
  const tiff = set({ format: 'tiff', tiffCompression: 'None', bitDepth: 8 })
  assert.equal(estimateBytes(tiff, 6000, 4000), 6000 * 4000 * 3)
  assert.equal(estimateBytes({ ...tiff, bitDepth: 16 }, 6000, 4000), 6000 * 4000 * 6)
  const jpeg = set({ format: 'jpeg', quality: 85 })
  const big = estimateBytes(jpeg, 6000, 4000)
  assert.ok(estimateBytes({ ...jpeg, quality: 95 }, 6000, 4000) > big)
  assert.ok(estimateBytes({ ...jpeg, quality: 60 }, 6000, 4000) < big)
  // Resized to a long edge of 2048: about (2048 / 6000)² of the pixels.
  const small = estimateBytes(
    { ...jpeg, resize: { mode: 'long', value: 2048, valueH: 0, enlarge: false } },
    6000,
    4000
  )
  assert.ok(Math.abs(small / big - (2048 / 6000) ** 2) < 0.01)
  // AVIF is smaller than JPEG at one quality; a gain map adds to it.
  assert.ok(estimateBytes({ ...jpeg, format: 'avif' }, 6000, 4000) < big)
  const map = set({ format: 'jpeg', quality: 85 }, { mode: 'gainmap' })
  assert.ok(estimateBytes(map, 6000, 4000, true) > estimateBytes(map, 6000, 4000, false))
})

test('the makeup: HDR from the library, else as probed; offline and unread counted apart', () => {
  const items: ExportItem[] = [
    { key: 'a', ext: 'jpg', isRaw: false, hdr: null },
    { key: 'b', ext: 'heic', isRaw: false, hdr: 'gainmap' },
    { key: 'c', ext: 'avif', isRaw: false },
    { key: 'd', ext: 'cr3', isRaw: true },
    { key: 'e', ext: 'jpg', isRaw: false, hdr: null, offline: true }
  ]
  const sample = [{ key: 'c', width: 10, height: 10, isHdr: true, hasGainMap: false }]
  const m = exportMakeup(items, sample)
  assert.deepEqual([m.photos, m.hdr, m.offline, m.unread], [5, 2, 1, 1])
  // The guards hear of the photos known, and of nothing assumed.
  assert.deepEqual(
    m.sources.map((s) => [s.ext, s.isHdr, s.hasGainMap]),
    [
      ['jpg', false, false],
      ['heic', false, true],
      ['avif', true, false]
    ]
  )
})

test('the estimate in all is the sample’s mean for every photo written', () => {
  const s = set({ format: 'tiff', tiffCompression: 'None' })
  const sample = [
    { key: 'a', width: 100, height: 100, isHdr: false, hasGainMap: false },
    { key: 'b', width: 300, height: 100, isHdr: false, hasGainMap: false }
  ]
  const e = estimateExport(s, sample, 10)!
  assert.equal(e.each, 60000)
  assert.equal(e.all, 600000)
  assert.equal(e.sampled, 2)
  assert.equal(estimateExport(s, [], 10), null)
  assert.equal(estimateExport(s, sample, 0), null)
})

test('an HDR photo tone mapped to SDR is estimated as SDR, by the sheet and the disk check alike', () => {
  const hdr = { key: 'h', width: 4000, height: 3000, isHdr: true, hasGainMap: false }
  const sdr = set({ format: 'avif' }, { mode: 'sdr' })
  const keep = set({ format: 'avif' }, { mode: 'keep' })
  assert.equal(writesHdr(sdr, hdr), false)
  assert.equal(writesHdr(keep, hdr), true)
  assert.equal(writesHdr(set({}, { mode: 'expand' }), { isHdr: false, hasGainMap: false }), true)
  assert.equal(estimateEach(sdr, [hdr]), estimateBytes(sdr, 4000, 3000, false))
  assert.ok(estimateEach(keep, [hdr]) > estimateEach(sdr, [hdr]))
  assert.equal(estimateEach(sdr, []), 0)
})

test('lossless is the format’s own switch, never another format’s', () => {
  // AVIF's Lossless left on says nothing of a JPEG.
  assert.equal(isLossless(set({ format: 'jpeg', lossless: true, webpLossless: true })), false)
  assert.equal(isLossless(set({ format: 'avif', lossless: true })), true)
  assert.equal(isLossless(set({ format: 'webp', webpLossless: true })), true)
  assert.equal(isLossless(set({ format: 'jxl', jxlLossless: true })), true)
  assert.equal(isLossless(set({ format: 'webp', lossless: true })), false)
})

test('Export with previous blocks only where exports are saved beside the originals', () => {
  const s = set({ format: 'jpeg', subfolder: '', template: '{name}' })
  const items: ExportItem[] = [{ key: 'a', ext: 'jpg', isRaw: false, hdr: null }]
  assert.equal(blocked(selectionGuards(s, items, true)), true)
  // A folder of their own: the original is never in the way.
  assert.equal(blocked(selectionGuards(s, items, false)), false)
})

test('a photo not read yet is never taken for SDR by the guards', () => {
  const s = set({ format: 'avif' }, { mode: 'keep' })
  const unread: ExportItem[] = [{ key: 'a', ext: 'heic', isRaw: false }]
  assert.equal(
    selectionGuards(s, unread, false).some((g) => g.id === 'no-hdr'),
    false
  )
  // Read by the sheet's sample as SDR: then it is said.
  const sample = [{ key: 'a', width: 10, height: 10, isHdr: false, hasGainMap: false }]
  assert.equal(
    selectionGuards(s, unread, false, sample).some((g) => g.id === 'no-hdr'),
    true
  )
})

test('bytes as a person reads them', () => {
  assert.equal(formatBytes(500), '1 KB')
  assert.equal(formatBytes(840 * 1024), '840 KB')
  assert.equal(formatBytes(1.15 * 1024 ** 2), '1.1 MB')
  assert.equal(formatBytes(13.4 * 1024 ** 2), '13 MB')
  assert.equal(formatBytes(1.44 * 1024 ** 3), '1.4 GB')
})
