import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PIXLRGB,
  REFERENCE_GAMUTS,
  SPECTRAL_LOCUS,
  WHITE_POINT,
  chartBounds,
  gamutPoints,
  inTriangle,
  uvToRgb,
  xyToUv
} from '../src/shared/cie'
import { deltaE, dominantColours, hexOf, hslToRgb, rgbToLab } from '../src/shared/palette'
import {
  collidingHues,
  contrastVerdict,
  hueShares,
  scopeMetrics,
  simulateVision,
  visionFilterValues
} from '../src/shared/scopemetrics'
import type { ImageStats } from '../src/shared/engine-types'

test('D65 is where u′v′ puts it, and the locus is a closed horseshoe', () => {
  assert.ok(Math.abs(WHITE_POINT.u - 0.1978) < 5e-4)
  assert.ok(Math.abs(WHITE_POINT.v - 0.4683) < 5e-4)
  assert.equal(SPECTRAL_LOCUS.length, 33)
  // Green sits high, the blue end low and left, the red end right.
  const maxV = SPECTRAL_LOCUS.reduce((a, p) => (p.v > a.v ? p : a))
  assert.ok(maxV.v > 0.58 && maxV.u < 0.12)
  assert.ok(SPECTRAL_LOCUS[SPECTRAL_LOCUS.length - 1].u > 0.55)
  // The equal-energy point.
  const e = xyToUv(1 / 3, 1 / 3)
  assert.ok(Math.abs(e.u - 0.2105) < 5e-4 && Math.abs(e.v - 0.4737) < 5e-4)
})

test('PixlRGB encloses the locus and every reference gamut: the chart’s frame', () => {
  const frame = gamutPoints(PIXLRGB)
  for (const p of SPECTRAL_LOCUS) assert.ok(inTriangle(p, frame), `locus point ${p.u},${p.v}`)
  for (const g of REFERENCE_GAMUTS)
    for (const p of gamutPoints(g)) assert.ok(inTriangle(p, frame), g.name)
  assert.ok(inTriangle(WHITE_POINT, frame))
  const b = chartBounds()
  assert.ok(b.u0 < -0.06 && b.u1 > 0.62 && b.v0 < 0 && b.v1 > 0.6)
})

test('the reference gamuts relate as they should: sRGB inside the wider ones, Rec.2020 beyond P3', () => {
  const [srgb, p3, adobe, rec] = REFERENCE_GAMUTS
  for (const wider of [p3, adobe, rec])
    for (const p of gamutPoints(srgb)) assert.ok(inTriangle(p, gamutPoints(wider)), wider.name)
  // Rec.2020's green is beyond P3's, and Adobe RGB's beyond sRGB's.
  assert.ok(!inTriangle(rec.g, gamutPoints(p3)))
  assert.ok(!inTriangle(adobe.g, gamutPoints(srgb)))
})

test('Lab, ΔE and hex', () => {
  const white = rgbToLab([255, 255, 255])
  assert.ok(
    Math.abs(white[0] - 100) < 0.05 && Math.abs(white[1]) < 0.05 && Math.abs(white[2]) < 0.05
  )
  assert.deepEqual(
    rgbToLab([0, 0, 0]).map((v) => Math.round(v)),
    [0, 0, 0]
  )
  assert.ok(deltaE(rgbToLab([255, 0, 0]), rgbToLab([250, 0, 0])) < 3)
  assert.ok(deltaE(rgbToLab([255, 0, 0]), rgbToLab([0, 0, 255])) > 100)
  assert.equal(hexOf([255, 0, 128]), '#ff0080')
  assert.deepEqual(hslToRgb(0, 1, 0.5).map(Math.round), [255, 0, 0])
  assert.deepEqual(hslToRgb(120, 1, 0.5).map(Math.round), [0, 255, 0])
})

test('the palette is the picture’s dominant colours, most first, shares adding to one', () => {
  // 75% sky blue, 25% orange.
  const px: number[] = []
  for (let i = 0; i < 400; i++) px.push(...(i < 300 ? [90, 150, 230, 255] : [240, 130, 20, 255]))
  const p = dominantColours(px, 4)
  assert.equal(p.length, 2)
  assert.equal(p[0].hex, hexOf([90, 150, 230]))
  assert.ok(Math.abs(p[0].share - 0.75) < 1e-9)
  assert.equal(p[1].hex, hexOf([240, 130, 20]))
  assert.ok(Math.abs(p.reduce((a, s) => a + s.share, 0) - 1) < 1e-9)
  assert.equal(p[0].lab.length, 3)
})

test('transparent pixels are left out, and an empty picture has no palette', () => {
  const px = [10, 20, 30, 0, 200, 100, 50, 255]
  const p = dominantColours(px, 3)
  assert.equal(p.length, 1)
  assert.equal(p[0].hex, hexOf([200, 100, 50]))
  assert.deepEqual(dominantColours([], 3), [])
})

function stats(more: Partial<ImageStats> = {}): ImageStats {
  return {
    domain: 'Encoded',
    luma_percentiles: [
      { percentile: 0.5, value: 0.02 },
      { percentile: 10, value: 0.15 },
      { percentile: 50, value: 0.45 },
      { percentile: 90, value: 0.8 },
      { percentile: 99.5, value: 0.98 }
    ],
    clipped_low: [0.001, 0.002, 0],
    clipped_high: [0, 0.03, 0.01],
    luma_mean: 0.47,
    luma_stddev: 0.22,
    mean_saturation: 0.31,
    channel_mean: [0.5, 0.46, 0.4],
    grey_world_gain: [0.92, 1, 1.15],
    hue_histogram: [],
    neutral_pixels: 0,
    ...more
  } as unknown as ImageStats
}

test('the metrics read the engine’s numbers: range in stops, contrast, clipping, cast', () => {
  const m = scopeMetrics(stats())
  // 0.98 → 0.955 linear, 0.02 → 0.0015: about 9 stops.
  assert.ok(m.rangeStops! > 8 && m.rangeStops! < 10, String(m.rangeStops))
  // 0.8 → 0.604, 0.15 → 0.0200: (0.654)/(0.07).
  assert.ok(Math.abs(m.contrast! - 9.3) < 0.3, String(m.contrast))
  assert.equal(m.highClip, 0.03)
  assert.equal(m.lowClip, 0.002)
  // Short of blue relative to red gain: red and blue gains 0.92 / 1.15 → warm by 25%.
  assert.equal(m.cast.label, 'warm')
  assert.equal(m.cast.amount, 25)
  assert.deepEqual(m.channelMeans, [0.5, 0.46, 0.4])
})

test('a measurement without the percentiles has no range or contrast, and a neutral one no cast', () => {
  const m = scopeMetrics(stats({ luma_percentiles: [], grey_world_gain: [1, 1, 1] }))
  assert.equal(m.rangeStops, null)
  assert.equal(m.contrast, null)
  assert.deepEqual(m.cast, { label: 'neutral', amount: 0 })
  assert.deepEqual(
    scopeMetrics(stats({ grey_world_gain: [null, 1, null] as unknown as number[] })).cast,
    {
      label: 'neutral',
      amount: 0
    }
  )
})

test('a linear measurement is read as luminance, not decoded again', () => {
  const lin = scopeMetrics(
    stats({
      domain: 'Linear',
      luma_percentiles: [
        { percentile: 0.5, value: 0.01 },
        { percentile: 99.5, value: 4 },
        { percentile: 10, value: 0.05 },
        { percentile: 90, value: 1 }
      ]
    })
  )
  assert.ok(Math.abs(lin.rangeStops! - Math.log2((4 + 1 / 1024) / (0.01 + 1 / 1024))) < 1e-9)
  assert.ok(Math.abs(lin.contrast! - 1.05 / 0.1) < 1e-9)
})

test('contrast verdicts follow WCAG’s thresholds', () => {
  assert.equal(contrastVerdict(8), 'Strong')
  assert.equal(contrastVerdict(5), 'Good')
  assert.equal(contrastVerdict(3.2), 'Moderate')
  assert.equal(contrastVerdict(1.5), 'Flat')
})

test('colour-vision simulation keeps greys, and collapses red and green for protanopes', () => {
  for (const kind of ['protan', 'deutan', 'tritan'] as const) {
    const g = simulateVision([128, 128, 128], kind)
    for (const v of g) assert.ok(Math.abs(v - 128) <= 3, `${kind} ${g}`)
  }
  const red = simulateVision([220, 40, 40], 'protan')
  const green = simulateVision([40, 160, 40], 'protan')
  // They look alike (ΔE small) though they are plainly different.
  assert.ok(deltaE(rgbToLab([220, 40, 40]), rgbToLab([40, 160, 40])) > 60)
  assert.ok(
    deltaE(rgbToLab(red), rgbToLab(green)) <
      deltaE(rgbToLab([220, 40, 40]), rgbToLab([40, 160, 40])) / 2
  )
  assert.equal(visionFilterValues('protan').split(' ').length, 20)
})

test('hues that fall together for a deuteranope are named; a blue and a yellow are not', () => {
  const bins = (spec: [number, number, number][]): ImageStats =>
    stats({
      hue_histogram: spec.map(([s, e, c]) => ({
        hue_start: s,
        hue_end: e,
        count: c,
        mean_saturation: 0.8
      })),
      neutral_pixels: 0
    } as unknown as Partial<ImageStats>)
  const redGreen = hueShares(
    bins([
      [0, 10, 500],
      [110, 120, 500]
    ])
  )
  const c = collidingHues(redGreen, 'deutan')
  assert.equal(c.length, 1)
  assert.ok(c[0].normal >= 40 && c[0].seen < 20)
  assert.deepEqual(
    collidingHues(
      hueShares(
        bins([
          [50, 60, 500],
          [230, 240, 500]
        ])
      ),
      'deutan'
    ),
    []
  )
  // A hue under 2% of the picture is not worth a warning.
  assert.deepEqual(
    collidingHues(
      hueShares(
        bins([
          [0, 10, 5],
          [110, 120, 995]
        ])
      ),
      'deutan'
    ),
    []
  )
  assert.deepEqual(hueShares(null), [])
})

test('the horseshoe is painted white at D65 and saturated at the primaries', () => {
  const white = uvToRgb(WHITE_POINT.u, WHITE_POINT.v)
  for (const c of white) assert.ok(c >= 250, String(white))
  const [srgb] = REFERENCE_GAMUTS
  const red = uvToRgb(srgb.r.u, srgb.r.v)
  assert.ok(red[0] >= 250 && red[1] < 5 && red[2] < 5, String(red))
  const blue = uvToRgb(srgb.b.u, srgb.b.v)
  assert.ok(blue[2] >= 250 && blue[0] < 5 && blue[1] < 5, String(blue))
  assert.deepEqual(uvToRgb(0.2, -1), [0, 0, 0])
})
