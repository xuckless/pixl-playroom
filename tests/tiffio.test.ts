/**
 * Working-set overlays at a proxy's size as uncompressed TIFFs (engine 0.21,
 * E33): Playroom's TIFF reader and writer, the guard laid on one, and the
 * engine taking `{ Tiff: path }` as it took the PNG.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeTiff16, isTiffPath, readTiff16 } from '../src/main/tiffio'
import { guardOverlay } from '../src/main/pixels/ops'
import { rasterOf } from '../src/main/pixels/working'
import { encodeGreyPng, encodePng16, pngSamples16 } from '../src/main/pngio'

test('a TIFF written is read back as it was, profile and all', () => {
  const px = new Uint16Array(5 * 3 * 4).map((_, i) => (i * 4099) % 65536)
  const icc = Buffer.from('not really a profile, but carried as bytes')
  const back = readTiff16(encodeTiff16(px, 5, 3, 4, icc))
  assert.equal(back.width, 5)
  assert.equal(back.height, 3)
  assert.equal(back.channels, 4)
  assert.deepEqual([...back.samples], [...px])
  assert.deepEqual(back.icc, icc)
  const rgb = readTiff16(encodeTiff16(px.subarray(0, 5 * 3 * 3), 5, 3, 3))
  assert.equal(rgb.channels, 3)
  assert.equal(rgb.icc, null)
})

test('a TIFF it cannot read is refused, not misread', () => {
  assert.throws(() => readTiff16(Buffer.from('PNG and not a TIFF')), /not a TIFF/)
  const cut = encodeTiff16(new Uint16Array(4 * 4 * 3), 4, 4, 3)
  // The strip's last bytes gone: the directory follows the pixels, so cut the count instead.
  const short = Buffer.from(cut)
  const ifd = short.readUInt32LE(4)
  short.writeUInt32LE(10, ifd - 4 + 4)
  assert.throws(() => readTiff16(short.subarray(0, ifd - 20)))
})

test('an overlay names its format by its file', () => {
  assert.deepEqual(rasterOf('/c/blobs/abc-2560x1707.tiff'), { Tiff: '/c/blobs/abc-2560x1707.tiff' })
  assert.deepEqual(rasterOf('/c/blobs/abc.png'), { Png: '/c/blobs/abc.png' })
  assert.ok(isTiffPath('a.TIF') && !isTiffPath('a.png'))
})

test('the guard is laid on a TIFF overlay as on a PNG one, and written as a TIFF', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tiffguard-'))
  try {
    // A 2×1 RGB step at x 1 on a 3×1 frame whose last pixel is clipped.
    const src = join(dir, 'step.tiff')
    const icc = Buffer.from('profile bytes')
    writeFileSync(src, encodeTiff16(new Uint16Array([100, 200, 300, 400, 500, 600]), 2, 1, 3, icc))
    const guard = join(dir, 'guard.png')
    writeFileSync(guard, encodeGreyPng(new Uint8Array([255, 255, 0]), 3, 1))
    const out = join(dir, 'out.tiff')
    guardOverlay(src, guard, out, { x: 1, y: 0 })
    const d = readTiff16(readFileSync(out))
    assert.equal(d.channels, 4)
    assert.deepEqual([...d.samples], [100, 200, 300, 65535, 400, 500, 600, 0])
    assert.deepEqual(d.icc, icc)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/** The native engine, where it is built (not in CI: this check skips). */
const engine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{ width: number; height: number }>
    }
  } catch {
    return null
  }
})()

test(
  'the engine reads Playroom’s TIFF and lays a TIFF overlay as it laid the PNG',
  { skip: engine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { blankRequest } = await import('../src/main/source')
    const dir = mkdtempSync(join(tmpdir(), 'tiffoverlay-'))
    try {
      const w = 8
      const h = 6
      const frame = join(dir, 'frame.png')
      writeFileSync(frame, encodePng16(new Uint16Array(w * h * 3).fill(10000), w, h, 3))
      // The engine writes a TIFF; Playroom reads exactly what a PNG of it holds.
      const px = new Uint16Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 32768 : (i * 997) % 60000))
      writeFileSync(join(dir, 'plain.png'), encodePng16(px, w, h, 4))
      // A step's image as the cache holds it: written by the engine, its profile stated.
      const write = (from: string, to: string, encode: unknown): Promise<unknown> =>
        engine!.convert({
          ...blankRequest(join(dir, from), join(dir, to), 'Png'),
          pixel: { depth: 'Sixteen', channels: 4 },
          encode,
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          threads: 1
        })
      await write('plain.png', 'step.png', { Png: { compression: 'Fast', filter: 'Sub' } })
      await engine!.convert({
        ...blankRequest(join(dir, 'step.png'), join(dir, 'step.tiff'), 'Png'),
        pixel: { depth: 'Sixteen', channels: 4 },
        encode: { Tiff: { compression: 'None' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        threads: 1
      })
      const read = readTiff16(readFileSync(join(dir, 'step.tiff')))
      assert.deepEqual([...read.samples], [...px])
      assert.ok(read.icc)
      // Playroom's TIFF (written back by the guard's worker) read by the engine.
      writeFileSync(join(dir, 'ours.tiff'), encodeTiff16(read.samples, w, h, 4, read.icc))
      const lay = async (source: unknown, out: string): Promise<Uint16Array> => {
        await engine!.convert({
          ...blankRequest(frame, out, 'Png'),
          pixel: { depth: 'Sixteen', channels: 3 },
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          overlays: [
            {
              source,
              rect: { x: 0, y: 0, width: 1 },
              opacity: 1,
              blend: { mode: 'Normal', space: 'LinearWorking' },
              resampler: 'Lanczos3'
            }
          ],
          threads: 1
        })
        return pngSamples16(readFileSync(out)).data
      }
      const viaPng = await lay({ Png: join(dir, 'step.png') }, join(dir, 'a.png'))
      const viaTiff = await lay({ Tiff: join(dir, 'step.tiff') }, join(dir, 'b.png'))
      const viaOurs = await lay({ Tiff: join(dir, 'ours.tiff') }, join(dir, 'c.png'))
      // The engine's PNG states sRGB by cICP, its TIFF by an ICC profile: the
      // same colour to a few codes in 16 bits (a proxy-sized copy only; the
      // full-size blobs, which exports read, stay PNG).
      assert.ok(viaTiff.every((v, i) => Math.abs(v - viaPng[i]) <= 16))
      assert.deepEqual([...viaOurs], [...viaTiff])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test('the overlays an older Playroom sized as PNGs are swept; the blobs and TIFFs stay', async () => {
  const { sweepPhoto } = await import('../src/main/sweep')
  const dir = mkdtempSync(join(tmpdir(), 'sweepblobs-'))
  try {
    const blobs = join(dir, 'cache', 'blobs')
    mkdirSync(blobs, { recursive: true })
    mkdirSync(join(dir, 'renders'))
    const names = [
      'abc.png',
      'abc-2560x1707.png',
      'abc-2560x1707-gq1w-0-0.png',
      'abc-gq1w-0-0.png',
      'abc-2560x1707.tiff',
      'guard-q1w.png'
    ]
    for (const n of names) writeFileSync(join(blobs, n), '')
    await sweepPhoto(join(dir, 'renders'), join(dir, 'cache'))
    assert.deepEqual(readdirSync(blobs).sort(), [
      'abc-2560x1707.tiff',
      'abc-gq1w-0-0.png',
      'abc.png',
      'guard-q1w.png'
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
