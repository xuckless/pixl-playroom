import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fitOverIso,
  KEPT_PER_ISO,
  noiseOfPlanes,
  statedNoiseFor,
  withMeasurement,
  type NoiseBook
} from '../src/shared/rawnoise'

const fit = { bins: 25, r2: 0.9 }
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

test('a frame’s noise is the median of the planes the engine fitted', () => {
  const n = noiseOfPlanes([
    { plane: 'R', k: 3e-4, sigma2: 2e-6, fit },
    { plane: 'Gr', k: 4e-4, sigma2: 1e-5, fit },
    { plane: 'Gb', k: 5e-4, sigma2: 1.2e-5, fit },
    { plane: 'B', k: 9e-4, sigma2: 9e-5, fit: null }
  ])!
  assert.equal(n.k, 4e-4)
  assert.equal(n.sigma2, 1e-5)
  // A stated develop fitted nothing: nothing new to keep.
  assert.equal(noiseOfPlanes([{ plane: 'R', k: 3e-4, sigma2: 2e-6, fit: null }]), null)
  // 0.21.0's MeasuredGreenFloor on Bayer: red and blue carry no fit, so it is the greens'.
  const green = noiseOfPlanes([
    { plane: 'R', k: 4.1e-4, sigma2: 1e-5, fit: null },
    { plane: 'Gr', k: 4e-4, sigma2: 1e-5, fit },
    { plane: 'Gb', k: 4.2e-4, sigma2: 1.2e-5, fit },
    { plane: 'B', k: 4.1e-4, sigma2: 1e-5, fit: null }
  ])!
  assert.ok(near(green.k, 4.1e-4) && near(green.sigma2, 1.1e-5))
})

test('stated noise: this camera at this ISO, unscaled, the median of what was measured there', () => {
  const book: NoiseBook = {
    // A book from before 0.21: one statement per ISO.
    'Canon EOS 200D': { '400': { k: 4e-4, sigma2: 1e-5 } },
    'Nikon Z 6': {
      '800': [
        { k: 8e-4, sigma2: 3e-5 },
        { k: 9e-4, sigma2: 2e-5 },
        { k: 7e-4, sigma2: 9e-5 }
      ]
    }
  }
  const own = statedNoiseFor({ camera: 'Canon EOS 200D', iso: 400 }, book)
  assert.deepEqual(own, { noise: { k: 4e-4, sigma2: 1e-5 }, source: 'Canon EOS 200D at ISO 400' })
  const z = statedNoiseFor({ camera: 'Nikon Z 6', iso: 800 }, book)
  assert.ok('noise' in z)
  assert.deepEqual(z.noise, { k: 8e-4, sigma2: 3e-5 })
})

test('stated noise at another ISO: fitted over two or more of the camera’s, never σ² × ISO²', () => {
  const book: NoiseBook = {
    'Canon EOS 200D': {
      '400': { k: 4e-4, sigma2: 1e-5 },
      '3200': { k: 3.2e-3, sigma2: 3e-4 }
    }
  }
  const s = statedNoiseFor({ camera: 'Canon EOS 200D', iso: 800 }, book)
  assert.ok('noise' in s)
  assert.equal(s.source, 'Canon EOS 200D, fitted over ISO 400, 3200')
  // k grows with the gain: through 0, 1e-6 an ISO here.
  assert.ok(near(s.noise.k, 8e-4))
  // σ² = a·ISO² + b through both points: well under 400's σ² times 4.
  const a = (3e-4 - 1e-5) / (3200 ** 2 - 400 ** 2)
  const b = 1e-5 - a * 400 ** 2
  assert.ok(near(s.noise.sigma2, a * 800 ** 2 + b))
  assert.ok(s.noise.sigma2 < 4e-5)
  // Read noise that does not grow with ISO: a never below 0, b the mean.
  const flat = fitOverIso(
    [
      { iso: 100, noise: { k: 1e-4, sigma2: 2e-5 } },
      { iso: 1600, noise: { k: 1.6e-3, sigma2: 1e-5 } }
    ],
    800
  )
  assert.ok(near(flat.sigma2, 1.5e-5))
  // Read noise all before the amplifier: b never below 0.
  const steep = fitOverIso(
    [
      { iso: 100, noise: { k: 1e-4, sigma2: 1e-8 } },
      { iso: 200, noise: { k: 2e-4, sigma2: 1e-5 } }
    ],
    400
  )
  assert.ok(steep.sigma2 > 0 && Number.isFinite(steep.sigma2))
})

test('nothing of its own camera to go by: not stated, and never another camera’s', () => {
  const book: NoiseBook = {
    'Canon EOS 200D': { '400': { k: 4e-4, sigma2: 1e-5 } },
    'Other Cam': { '100': { k: 1e-4, sigma2: 1e-6 }, '800': { k: 8e-4, sigma2: 1e-5 } }
  }
  // One other ISO is not enough to fit from.
  assert.deepEqual(statedNoiseFor({ camera: 'Canon EOS 200D', iso: 800 }, book), {
    why: 'not-measured'
  })
  assert.deepEqual(statedNoiseFor({ camera: 'Unknown', iso: 200 }, book), { why: 'not-measured' })
  assert.deepEqual(statedNoiseFor({ camera: 'Canon EOS 200D', iso: null }, book), {
    why: 'no-shot'
  })
  assert.deepEqual(statedNoiseFor({ camera: null, iso: 400 }, book), { why: 'no-shot' })
})

test('the book keeps the last few measurements at each ISO', () => {
  let at = withMeasurement({ k: 1, sigma2: 1 }, { k: 2, sigma2: 2 })
  assert.deepEqual(at, [
    { k: 1, sigma2: 1 },
    { k: 2, sigma2: 2 }
  ])
  for (let i = 3; i < 20; i++) at = withMeasurement(at, { k: i, sigma2: i })
  assert.equal(at.length, KEPT_PER_ISO)
  assert.equal(at[at.length - 1].k, 19)
})

test('the first RAW of a camera and ISO has its noise read into the book, once', async () => {
  const { fillNoiseBook, planesOfRead } = await import('../src/main/ai/noisefill')
  const { statedNoiseFor: stated } = await import('../src/main/ai/noisebook')
  const asked: unknown[] = []
  const engine = {
    rawNoise: async (request: unknown) => {
      asked.push(request)
      return {
        cfa: 'Bayer' as const,
        area: { x: 0, y: 0, width: 10, height: 10 },
        noise_from: 'measured from green, with the floor',
        planes: [
          { plane: 'R', noise: null, unread: 'told the greens’ line' },
          { plane: 'Gr', noise: { plane: 'Gr', k: 5e-4, sigma2: 2e-5, fit }, unread: null },
          { plane: 'Gb', noise: { plane: 'Gb', k: 5e-4, sigma2: 2e-5, fit }, unread: null },
          { plane: 'B', noise: null, unread: 'told the greens’ line' }
        ],
        read_ms: 400
      }
    }
  }
  const row = { path: '/photos/a.cr2', camera: 'Fill Cam', iso: 1600, is_raw: 1 }
  const info = { input: 'Raw' as const, dng: null, raw_cfa: 'Bayer' as const }
  await fillNoiseBook(engine, row, info)
  await fillNoiseBook(engine, { ...row, path: '/photos/b.cr2' }, info)
  assert.equal(asked.length, 1)
  assert.deepEqual((asked[0] as { noise: string; crop: string }).noise, 'MeasuredGreenFloor')
  const s = stated({ camera: 'Fill Cam', iso: 1600 })
  assert.ok('noise' in s)
  assert.deepEqual(s.noise, { k: 5e-4, sigma2: 2e-5 })
  assert.equal(planesOfRead({ planes: [] }).length, 0)
  // Not a mosaic (a JPEG, a linear DNG), or nothing to keep it under: nothing read.
  await fillNoiseBook(engine, { ...row, camera: 'Other', is_raw: 0 }, info)
  await fillNoiseBook(engine, { ...row, camera: 'Other' }, { ...info, raw_cfa: null })
  await fillNoiseBook(engine, { ...row, camera: null }, info)
  assert.equal(asked.length, 1)
})
