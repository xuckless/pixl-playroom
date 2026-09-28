import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultExportSettings,
  metadataPlan,
  outputSharpen,
  outputSharpenGrade,
  type ExportSettings,
  type MetadataPlan,
  type OutputSharpenSetting
} from '../src/shared/export'
import type { PhotoMeta } from '../src/shared/ipc'

const withSharpen = (
  o: Partial<OutputSharpenSetting>,
  hdr: ExportSettings['hdr']['mode'] = 'sdr'
): ExportSettings => {
  const s = defaultExportSettings()
  return {
    ...s,
    outputSharpen: { ...s.outputSharpen, enabled: true, ...o },
    hdr: { ...s.hdr, mode: hdr }
  }
}

test('output sharpening is off by default and when disabled', () => {
  assert.equal(outputSharpen(defaultExportSettings()), null)
  assert.equal(outputSharpen(withSharpen({ enabled: false })), null)
})

test('HDR output is never sharpened', () => {
  assert.equal(outputSharpen(withSharpen({}, 'keep')), null)
  assert.equal(outputSharpen(withSharpen({}, 'expand')), null)
  assert.notEqual(outputSharpen(withSharpen({}, 'sdr')), null)
})

test('the radius follows the media', () => {
  const radius = (media: OutputSharpenSetting['media']): number =>
    outputSharpen(withSharpen({ media }))!.radius
  assert.equal(radius('screen'), 0.6)
  assert.equal(radius('glossy'), 1)
  assert.equal(radius('matte'), 1.3)
})

test('the amount grows with the setting, and matte paper takes more', () => {
  const amount = (o: Partial<OutputSharpenSetting>): number => outputSharpen(withSharpen(o))!.amount
  for (const media of ['screen', 'matte', 'glossy'] as const) {
    assert.ok(amount({ media, amount: 'low' }) < amount({ media, amount: 'standard' }))
    assert.ok(amount({ media, amount: 'standard' }) < amount({ media, amount: 'high' }))
  }
  assert.ok(amount({ media: 'matte', amount: 'high' }) > amount({ media: 'screen', amount: 'low' }))
  assert.ok(
    amount({ media: 'matte', amount: 'standard' }) > amount({ media: 'glossy', amount: 'standard' })
  )
  assert.equal(amount({ media: 'screen', amount: 'standard' }), 0.75)
  assert.equal(amount({ media: 'matte', amount: 'high' }), 1.32)
})

test('every setting stays inside the ranges the compiler gives the engine', () => {
  for (const media of ['screen', 'matte', 'glossy'] as const) {
    for (const amount of ['low', 'standard', 'high'] as const) {
      const sh = outputSharpen(withSharpen({ media, amount }))!
      assert.ok(sh.amount > 0 && sh.amount <= 3)
      assert.ok(sh.radius >= 0.5 && sh.radius <= 3)
      assert.ok(sh.detail >= 0 && sh.detail <= 1)
      assert.equal(sh.masking, 0)
    }
  }
})

test('the sharpening pass runs in the export space as encoded', () => {
  const s = { ...withSharpen({}), colorSpace: 'AdobeRgb' as const }
  const g = outputSharpenGrade(s, outputSharpen(s)!)
  assert.equal(g.layers.length, 1)
  const [layer] = g.layers
  assert.deepEqual(layer.blend, { mode: 'Normal', space: 'LinearWorking' })
  assert.equal(layer.mask, null)
  assert.equal(layer.opacity, 1)
  assert.deepEqual(layer.stages, [
    {
      space: {
        Encoded: {
          space: 'AdobeRgb',
          intent: s.intent,
          black_point_compensation: s.blackPointCompensation
        }
      },
      ops: [{ Sharpen: outputSharpen(s)! }]
    }
  ])
})

test('the defaults carry the sharpening and metadata settings', () => {
  const s = defaultExportSettings()
  assert.deepEqual(s.outputSharpen, { enabled: false, media: 'screen', amount: 'standard' })
  assert.equal(s.metaMode, 'all')
  assert.equal(s.removeLocation, false)
  assert.equal(s.copyright, '')
})

test('settings saved before these fields merge to their defaults', () => {
  // What `export.last` or a preset held before output sharpening existed.
  const old = defaultExportSettings() as Partial<ExportSettings>
  delete old.outputSharpen
  delete old.metaMode
  delete old.removeLocation
  delete old.copyright
  const saved = JSON.parse(JSON.stringify({ ...old, format: 'png', quality: 75 }))
  const merged: ExportSettings = { ...defaultExportSettings(), ...saved }
  assert.equal(merged.format, 'png')
  assert.equal(merged.quality, 75)
  assert.deepEqual(merged.outputSharpen, defaultExportSettings().outputSharpen)
  assert.equal(merged.metaMode, 'all')
  assert.equal(merged.removeLocation, false)
  assert.equal(merged.copyright, '')
  assert.equal(outputSharpen(merged), null)
})

// ── metadata ──

const photo: PhotoMeta = {
  title: 'Lake at dusk',
  caption: 'Winnipeg Beach',
  copyright: '© 2026 Ali',
  keywords: ['Places|Canada', 'Water']
}

const plan = (o: Partial<ExportSettings>, meta: PhotoMeta | null = photo): MetadataPlan =>
  metadataPlan({ ...defaultExportSettings(), ...o }, meta)

test('all: the blocks kept, and the photo’s fields in each', () => {
  const p = plan({})
  assert.deepEqual(p.policy, { exif: true, icc: true, xmp: true, iptc: true })
  assert.equal(p.removeLocation, false)
  assert.deepEqual(p.tags, {
    'EXIF:Copyright': '© 2026 Ali',
    'EXIF:ImageDescription': 'Winnipeg Beach',
    'XMP-dc:Rights': '© 2026 Ali',
    'XMP-dc:Title': 'Lake at dusk',
    'XMP-dc:Description': 'Winnipeg Beach',
    'XMP-dc:Subject': ['Places', 'Canada', 'Water'],
    'XMP-lr:HierarchicalSubject': ['Places|Canada', 'Water'],
    'IPTC:CopyrightNotice': '© 2026 Ali',
    'IPTC:ObjectName': 'Lake at dusk',
    'IPTC:Caption-Abstract': 'Winnipeg Beach',
    'IPTC:Keywords': ['Places', 'Canada', 'Water'],
    'IPTC:CodedCharacterSet': 'UTF8'
  })
})

test('all: nothing is written into a block that was left out', () => {
  const groups = (o: Partial<ExportSettings['metadata']>): string[] => {
    const p = plan({ metadata: { ...defaultExportSettings().metadata, ...o } })
    return [...new Set(Object.keys(p.tags).map((k) => k.split(/[-:]/)[0]))].sort()
  }
  assert.deepEqual(groups({ xmp: false }), ['EXIF', 'IPTC'])
  assert.deepEqual(groups({ iptc: false }), ['EXIF', 'XMP'])
  assert.deepEqual(groups({ exif: false }), ['IPTC', 'XMP'])
  assert.deepEqual(groups({ exif: false, xmp: false, iptc: false }), [])
  // The engine copies what the settings keep.
  const p = plan({ metadata: { exif: false, icc: false, xmp: true, iptc: false } })
  assert.deepEqual(p.policy, { exif: false, icc: false, xmp: true, iptc: false })
})

test('copyright only: the profile at most, and the copyright in all three', () => {
  const p = plan({ metaMode: 'copyrightOnly' })
  assert.deepEqual(p.policy, { exif: false, icc: true, xmp: false, iptc: false })
  assert.deepEqual(p.tags, {
    'EXIF:Copyright': '© 2026 Ali',
    'XMP-dc:Rights': '© 2026 Ali',
    'IPTC:CopyrightNotice': '© 2026 Ali',
    'IPTC:CodedCharacterSet': 'UTF8'
  })
  const noIcc = plan({
    metaMode: 'copyrightOnly',
    metadata: { exif: true, icc: false, xmp: true, iptc: true }
  })
  assert.deepEqual(noIcc.policy, { exif: false, icc: false, xmp: false, iptc: false })
  // No copyright anywhere: nothing to write.
  assert.deepEqual(plan({ metaMode: 'copyrightOnly' }, { ...photo, copyright: null }).tags, {})
})

test('the photo’s copyright first, the dialog’s when it has none', () => {
  assert.equal(plan({ copyright: 'Studio' }).tags['EXIF:Copyright'], '© 2026 Ali')
  const blank = { ...photo, copyright: '  ' }
  assert.equal(plan({ copyright: ' Studio ' }, blank).tags['XMP-dc:Rights'], 'Studio')
  assert.equal(plan({ copyright: 'Studio' }, null).tags['IPTC:CopyrightNotice'], 'Studio')
  assert.equal(plan({}, { ...photo, copyright: null }).tags['EXIF:Copyright'], undefined)
})

test('an unknown photo writes only the dialog’s copyright', () => {
  assert.deepEqual(plan({}, null).tags, {})
  assert.deepEqual(Object.keys(plan({ copyright: 'Studio' }, null).tags).sort(), [
    'EXIF:Copyright',
    'IPTC:CodedCharacterSet',
    'IPTC:CopyrightNotice',
    'XMP-dc:Rights'
  ])
})

test('location is removed only where it could be', () => {
  const keep = (o: Partial<ExportSettings['metadata']>): ExportSettings['metadata'] => ({
    ...defaultExportSettings().metadata,
    ...o
  })
  assert.equal(plan({ removeLocation: true }).removeLocation, true)
  assert.equal(plan({ removeLocation: false }).removeLocation, false)
  assert.equal(plan({ removeLocation: true, metaMode: 'copyrightOnly' }).removeLocation, false)
  assert.equal(plan({ removeLocation: true, metadata: keep({ exif: false }) }).removeLocation, true)
  assert.equal(
    plan({ removeLocation: true, metadata: keep({ exif: false, xmp: false }) }).removeLocation,
    false
  )
})
