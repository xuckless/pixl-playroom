import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildResize, defaultExportSettings, type ExportSettings } from '../src/shared/export'
import {
  blocked,
  exportGuards,
  outputSize,
  type ExportSource,
  type Guard
} from '../src/shared/exportGuards'

const jpg: ExportSource = { ext: 'jpg', isRaw: false, isHdr: false, hasGainMap: false }
const raw: ExportSource = { ext: 'cr3', isRaw: true, isHdr: false, hasGainMap: false }
const pq: ExportSource = { ext: 'avif', isRaw: false, isHdr: true, hasGainMap: false }
const map: ExportSource = { ext: 'heic', isRaw: false, isHdr: false, hasGainMap: true }

function set(
  more: Partial<ExportSettings>,
  hdr: Partial<ExportSettings['hdr']> = {}
): ExportSettings {
  const d = defaultExportSettings()
  return { ...d, ...more, hdr: { ...d.hdr, ...hdr } }
}
const ids = (g: Guard[], severity?: Guard['severity']): string[] =>
  g.filter((x) => !severity || x.severity === severity).map((x) => x.id)

test('the defaults export a JPEG without a block', () => {
  const g = exportGuards(defaultExportSettings(), [jpg])
  assert.equal(blocked(g), false)
})

test('a format that cannot hold what the HDR mode asks is a block, with its step', () => {
  const g = exportGuards(set({ format: 'jpeg' }, { mode: 'keep' }), [pq])
  assert.deepEqual(ids(g, 'block'), ['hdr-format'])
  assert.equal(g.find((x) => x.id === 'hdr-format')!.step, 'delivery')
  assert.deepEqual(ids(exportGuards(set({ format: 'png' }, { mode: 'gainmap' }), [map]), 'block'), [
    'gainmap-format'
  ])
  assert.equal(blocked(exportGuards(set({ format: 'jxl' }, { mode: 'keep' }), [pq])), false)
})

test('HDR output that needs the ICC profile blocks without it, and not otherwise', () => {
  const noIcc = { metadata: { exif: true, icc: false, xmp: true, iptc: true } }
  assert.ok(
    ids(exportGuards(set({ format: 'jpeg', ...noIcc }, { mode: 'gainmap' }), [map])).includes(
      'icc-needed'
    )
  )
  assert.ok(!ids(exportGuards(set({ format: 'jpeg', ...noIcc }), [jpg])).includes('icc-needed'))
})

test('AVIF: speed 10 and lossless with subsampled colour are blocks', () => {
  assert.ok(
    ids(exportGuards(set({ format: 'avif', avifSpeed: 10 }), [jpg]), 'block').includes('avif-speed')
  )
  assert.ok(
    ids(
      exportGuards(set({ format: 'avif', lossless: true, chroma: 'Half' }), [jpg]),
      'block'
    ).includes('avif-lossless-chroma')
  )
})

test('a size of nothing, an empty folder or name, and the original’s own name are blocks', () => {
  const s = defaultExportSettings()
  assert.ok(
    ids(exportGuards({ ...s, resize: { ...s.resize, mode: 'long', value: 0 } }, [jpg])).includes(
      'size-empty'
    )
  )
  assert.ok(
    ids(
      exportGuards({ ...s, resize: { ...s.resize, mode: 'box', value: 800, valueH: 0 } }, [jpg])
    ).includes('size-empty')
  )
  assert.ok(ids(exportGuards({ ...s, folder: '' }, [jpg])).includes('folder-empty'))
  assert.ok(ids(exportGuards({ ...s, template: '  ' }, [jpg])).includes('name-empty'))
  const same = { ...s, template: '{name}', subfolder: '' }
  assert.ok(ids(exportGuards(same, [jpg])).includes('overwrite-original'))
  // Another format, another folder or another name is fine.
  assert.ok(!ids(exportGuards({ ...same, format: 'png' }, [jpg])).includes('overwrite-original'))
  assert.ok(!ids(exportGuards({ ...same, subfolder: 'out' }, [jpg])).includes('overwrite-original'))
  assert.ok(!ids(exportGuards({ ...same, folder: '/tmp/x' }, [jpg])).includes('overwrite-original'))
  // JPEG's two extensions are one format.
  assert.ok(ids(exportGuards(same, [{ ...jpg, ext: 'JPEG' }])).includes('overwrite-original'))
})

test('what is lost is warned, once, and only when it applies', () => {
  const sdr = exportGuards(defaultExportSettings(), [jpg])
  assert.ok(!ids(sdr).includes('gamut-narrow'))
  assert.ok(!ids(sdr).includes('hdr-to-sdr'))
  const wideInSrgb = exportGuards(defaultExportSettings(), [raw])
  assert.ok(ids(wideInSrgb, 'warn').includes('gamut-narrow'))
  assert.ok(!ids(exportGuards(set({ colorSpace: 'DisplayP3' }), [raw])).includes('gamut-narrow'))
  assert.ok(ids(exportGuards(defaultExportSettings(), [pq, map]), 'warn').includes('hdr-to-sdr'))
  assert.ok(ids(exportGuards(set({ dither: false }), [raw]), 'warn').includes('banding'))
  assert.ok(!ids(exportGuards(set({ dither: false }), [jpg])).includes('banding'))
  assert.ok(ids(exportGuards(set({ format: 'png' }), [jpg]), 'warn').includes('iptc'))
  assert.ok(!ids(exportGuards(set({ format: 'jpeg' }), [jpg])).includes('iptc'))
  assert.equal(new Set(ids(wideInSrgb)).size, ids(wideInSrgb).length)
})

test('the minor notes are minor, and blocks sort first', () => {
  const g = exportGuards(set({ format: 'jpeg', folder: '' }), [raw])
  assert.equal(g[0].severity, 'block')
  assert.equal(g[g.length - 1].severity, 'minor')
  assert.equal(g.find((x) => x.id === 'chroma-jpeg')!.severity, 'minor')
})

test('Fit inside a box keeps the shape and never enlarges unless allowed', () => {
  const s = (more: Partial<ExportSettings['resize']>): ExportSettings => {
    const d = defaultExportSettings()
    return { ...d, resize: { ...d.resize, mode: 'box', value: 1000, valueH: 500, ...more } }
  }
  // 6000 × 4000 into 1000 × 500: the height decides (0.125).
  assert.deepEqual(buildResize(s({}), 6000, 4000), { Exact: { width: 750, height: 500 } })
  // 800 × 400 is inside it already.
  assert.equal(buildResize(s({}), 800, 400), 'None')
  assert.deepEqual(buildResize(s({ enlarge: true }), 800, 400), {
    Exact: { width: 1000, height: 500 }
  })
  assert.equal(buildResize(s({ valueH: 0 }), 6000, 4000), 'None')
})

test('outputSize is what buildResize writes, or the picture’s own', () => {
  const d = defaultExportSettings()
  assert.deepEqual(outputSize(d, 6000, 4000), { w: 6000, h: 4000 })
  const long = { ...d, resize: { ...d.resize, mode: 'long' as const, value: 3000 } }
  assert.deepEqual(outputSize(long, 6000, 4000), { w: 3000, h: 2000 })
})

test('a preview shows the real colour path: PNG for what the window cannot show, SDR for HDR', async () => {
  const { previewSettings, previewResize, PREVIEW_EDGE } = await import('../src/shared/export')
  const base = defaultExportSettings()
  assert.equal(previewSettings({ ...base, format: 'jxl' }).format, 'png')
  assert.equal(previewSettings({ ...base, format: 'tiff' }).format, 'png')
  assert.equal(previewSettings({ ...base, format: 'avif' }).format, 'avif')
  const hdr = { ...base, format: 'png' as const, hdr: { ...base.hdr, mode: 'keep' as const } }
  assert.equal(previewSettings(hdr).hdr.mode, 'sdr')
  // A gain map's base is already the SDR picture: it stays a gain-map export.
  const gm = { ...base, format: 'jpeg' as const, hdr: { ...base.hdr, mode: 'gainmap' as const } }
  assert.equal(previewSettings(gm).hdr.mode, 'gainmap')
  // Colour is untouched.
  const p3 = { ...base, colorSpace: 'DisplayP3' as const, intent: 'Perceptual' as const }
  assert.equal(previewSettings(p3).colorSpace, 'DisplayP3')
  assert.equal(previewSettings(p3).intent, 'Perceptual')
  assert.equal(previewSettings(p3).metadata.icc, true)
  assert.equal(previewSettings(p3).metadata.exif, false)
  // 6000 × 4000 is shown at the preview edge; a 1200-px export is shown as it is.
  const full = previewResize(base, 6000, 4000)
  assert.deepEqual(full, {
    Exact: { width: PREVIEW_EDGE, height: Math.round((4000 * PREVIEW_EDGE) / 6000) }
  })
  const small = { ...base, resize: { ...base.resize, mode: 'long' as const, value: 1200 } }
  assert.deepEqual(previewResize(small, 6000, 4000), { Exact: { width: 1200, height: 800 } })
  assert.equal(previewResize(base, 1000, 800), 'None')
})

test('the receipt names what did not land and what the engine left out', async () => {
  const { receiptNotes } = await import('../src/shared/exportGuards')
  const all = { exif: true, icc: true, xmp: true, iptc: true }
  assert.deepEqual(receiptNotes(all, all, []), [])
  assert.deepEqual(receiptNotes(all, { ...all, iptc: false }, ['No map: nothing above white']), [
    'IPTC was not written (the original has none, or the format has no place for it)',
    'No map: nothing above white'
  ])
  // Not asked, not written: nothing to say.
  assert.deepEqual(receiptNotes({ ...all, iptc: false }, { ...all, iptc: false }, []), [])
})
