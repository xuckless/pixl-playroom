import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  defaultExportSettings,
  outputSharpen,
  outputSharpenGrade,
  type ExportSettings,
  type OutputSharpenSetting
} from '../src/shared/export'

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
