/**
 * Small pictures sized from what is decoded (engine 0.21, OBS-1): a RAW's
 * embedded preview from the preview, not the sensor; a JPEG's decode reduced
 * where that still leaves the edge; and a JPEG proxy at half size only when
 * the JPEG is twice the proxy's edge.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  previewPlan,
  proxyReduce,
  reduceFor,
  reducedSide,
  uprightSize
} from '../src/shared/thumbsize'
import {
  noPreview,
  reduceRefused,
  type PixlErrorDetail,
  type RawPreview
} from '../src/shared/engine-types'

const preview = (width: number, height: number, more: Partial<RawPreview> = {}): RawPreview => ({
  format: 'Jpeg',
  width,
  height,
  orientation: 1,
  bytes: 1,
  decodable: true,
  reducible: true,
  ...more
})
type PlanInfo = Parameters<typeof previewPlan>[0]
const rawInfo = (
  raw_previews: RawPreview[] | undefined,
  width = 6000,
  height = 4000
): PlanInfo => ({ input: 'Raw', width, height, raw_previews, gain_map: null })

test('a Canon preview to a thumbnail decodes at an eighth', () => {
  const plan = previewPlan(rawInfo([preview(5472, 3648)], 5568, 3708), true, 400)
  assert.notEqual(plan, 'develop')
  if (plan === 'develop') return
  assert.equal(plan.reduce, 'Eighth')
  assert.equal(reducedSide(5472, plan.reduce), 684)
  assert.ok(Math.abs(plan.factor - 400 / 684) < 1e-9)
  assert.equal(plan.long, 5472)
})

test('a small preview is sized from itself, not from the sensor', () => {
  const plan = previewPlan(rawInfo([preview(1616, 1080)]), true, 400)
  if (plan === 'develop') return assert.fail('a preview is there')
  assert.equal(plan.reduce, 'Quarter')
  assert.equal(reducedSide(1616, 'Quarter'), 404)
  assert.ok(plan.factor > 0.98 && plan.factor < 1)
  // The sensor's factor would have made a thumbnail of about 108 px.
  assert.ok(Math.round(1616 * (400 / 6000)) < 110)
})

test('a picture already near the edge is not reduced or scaled up', () => {
  const plan = previewPlan(rawInfo([preview(1616, 1080)]), true, 2048)
  if (plan === 'develop') return assert.fail('a preview is there')
  assert.equal(plan.reduce, null)
  assert.equal(plan.factor, 1)
})

test('a preview decode_reduce cannot read (a DNG’s, a bitmap) is decoded whole', () => {
  for (const p of [
    preview(1024, 683, { reducible: false }),
    preview(1024, 683, { format: 'Bitmap', reducible: false })
  ]) {
    const plan = previewPlan(rawInfo([p]), true, 400)
    if (plan === 'develop') return assert.fail('a preview is there')
    assert.equal(plan.reduce, null)
    assert.ok(Math.abs(plan.factor - 400 / 1024) < 1e-9)
  }
})

test('the first decodable preview is the one sized; none means develop at once', () => {
  const plan = previewPlan(
    rawInfo([preview(6000, 4000, { decodable: false }), preview(1600, 1067)]),
    true,
    400
  )
  if (plan === 'develop') return assert.fail('a preview is there')
  assert.equal(plan.long, 1600)
  assert.equal(
    previewPlan(rawInfo([preview(6000, 4000, { decodable: false })]), true, 400),
    'develop'
  )
  assert.equal(previewPlan(rawInfo([]), true, 400), 'develop')
})

test('a probe from before 0.21 sizes from the sensor, as before', () => {
  const plan = previewPlan(rawInfo(undefined), true, 400)
  assert.deepEqual(plan, { reduce: null, long: 6000, factor: 400 / 6000 })
})

test('a JPEG reduces from its own size; other formats never', () => {
  const jpeg = previewPlan(
    { input: 'Jpeg', width: 6000, height: 4000, gain_map: null },
    false,
    1024
  )
  assert.deepEqual(jpeg, { reduce: 'Quarter', long: 6000, factor: 1024 / 1500 })
  const heif = previewPlan({ input: 'Heif', width: 6000, height: 4000, gain_map: null }, false, 400)
  assert.deepEqual(heif, { reduce: null, long: 6000, factor: 400 / 6000 })
})

test('the largest reduction that keeps the edge', () => {
  assert.equal(reduceFor(1616, 256), 'Quarter')
  assert.equal(reduceFor(5472, 256), 'Eighth')
  assert.equal(reduceFor(5472, 256, 2), 'Half')
  assert.equal(reduceFor(500, 256), null)
})

test('a JPEG proxy decodes at half size only at twice the proxy’s edge', () => {
  const jpeg = (
    width: number,
    height: number,
    is_hdr = false
  ): Parameters<typeof proxyReduce>[0] => ({
    input: 'Jpeg',
    width,
    height,
    is_hdr
  })
  assert.equal(proxyReduce(jpeg(6000, 4000), 2560), 'Half')
  assert.equal(proxyReduce(jpeg(4000, 6000), 2560), 'Half')
  assert.equal(proxyReduce(jpeg(5120, 3413), 2560), 'Half')
  assert.equal(proxyReduce(jpeg(5000, 3333), 2560), null)
  assert.equal(proxyReduce(jpeg(2600, 1733), 2560), null)
  // Never a quarter, however large; never an HDR JPEG or another format.
  assert.equal(proxyReduce(jpeg(12000, 8000), 2560), 'Half')
  assert.equal(proxyReduce(jpeg(6000, 4000, true), 2560), null)
  assert.equal(proxyReduce({ input: 'Tiff', width: 6000, height: 4000, is_hdr: false }, 2560), null)
})

test('a reduced proxy’s frame is the probe’s, upright', () => {
  assert.deepEqual(uprightSize({ width: 6000, height: 4000 }, 'Normal'), {
    width: 6000,
    height: 4000
  })
  assert.deepEqual(uprightSize({ width: 6000, height: 4000 }, 'Rotate90'), {
    width: 4000,
    height: 6000
  })
  assert.deepEqual(uprightSize({ width: 2601, height: 1733 }, 'Transverse'), {
    width: 1733,
    height: 2601
  })
})

test('only the no-preview refusal develops instead; a refused reduction is retried whole', () => {
  const unsupported = (operation: string): PixlErrorDetail => ({
    Unsupported: { operation, detail: 'x' }
  })
  assert.equal(noPreview('Unsupported', unsupported('raw embedded preview')), true)
  assert.equal(noPreview('Unsupported', unsupported('raw decode')), false)
  assert.equal(noPreview('Io', { Io: { detail: 'cut short' } }), false)
  assert.equal(noPreview('TooLarge', { TooLarge: { field: 'limits' } }), false)
  assert.equal(noPreview('Unsupported', undefined), false)
  const invalid = (field: string): PixlErrorDetail => ({ InvalidRequest: { field, detail: 'x' } })
  assert.equal(reduceRefused('InvalidRequest', invalid('decode_reduce')), true)
  assert.equal(reduceRefused('InvalidRequest', invalid('resize')), false)
  assert.equal(reduceRefused('Decode', invalid('decode_reduce')), false)
})

/** The native engine, where it is built (not in CI: this check skips). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{ width: number; height: number; frame_width: number }>
    }
  } catch {
    return null
  }
})()

test(
  'the engine decodes a JPEG reduced as planned, and the scale lands on the edge',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { blankRequest } = await import('../src/main/source')
    const { encodePng16 } = await import('../src/main/pngio')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'thumbsize-'))
    try {
      const w = 1700
      const h = 1100
      const px = new Uint16Array(w * h * 3).map((_, i) => (i * 7919) % 60000)
      const png = join(dir, 'in.png')
      const jpg = join(dir, 'in.jpg')
      writeFileSync(png, encodePng16(px, w, h, 3))
      await realEngine!.convert({
        ...blankRequest(png, jpg, 'Png'),
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Jpeg: { quality: 90, subsampling: 'Quarter', optimize: false } },
        threads: 2
      })
      const plan = previewPlan({ input: 'Jpeg', width: w, height: h, gain_map: null }, false, 400)
      if (plan === 'develop') return assert.fail('a JPEG is never developed')
      assert.equal(plan.reduce, 'Quarter')
      const report = await realEngine!.convert({
        ...blankRequest(jpg, join(dir, 'out.jpg'), 'Jpeg'),
        decode_reduce: plan.reduce,
        resize: { Scale: { factor: plan.factor } },
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Jpeg: { quality: 85, subsampling: 'Quarter', optimize: true } },
        threads: 2
      })
      assert.equal(report.frame_width, reducedSide(w, 'Quarter'))
      assert.equal(Math.max(report.width, report.height), 400)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
