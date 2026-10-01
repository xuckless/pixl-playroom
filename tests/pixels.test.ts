import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { normalisePixelStep, stackSignature, type PixelStep } from '../src/shared/pixels'
import { diffRecipe, replay, type Step } from '../src/shared/history'
import { defaultRecipe, normaliseRecipe, isEdited } from '../src/shared/recipe'
import { composeMasked, unwarpMask, writeRamp } from '../src/main/pixels/ops'
import { decodePng, encodeGreyPng, encodePng16, pngSamples16 } from '../src/main/pngio'
import { ensureWorking, type PixelDeps } from '../src/main/pixels/working'
import { blankRequest } from '../src/main/source'

const tmp = (): string => mkdtempSync(join(tmpdir(), 'pixl-px-'))
const H = (c: string): string => c.repeat(64)

const step = (over: Partial<PixelStep> = {}): PixelStep => ({
  id: 's1',
  kind: 'denoise',
  label: 'AI Denoise · SCUNet',
  blob: H('a'),
  alpha: null,
  scope: null,
  opacity: 100,
  width: 8,
  height: 6,
  params: { model: 'scunet-color-real' },
  ...over
})

test('a step is read back only when it is one', () => {
  assert.deepEqual(normalisePixelStep(step()), step())
  assert.equal(normalisePixelStep({ ...step(), blob: 'nope' }), null)
  assert.equal(normalisePixelStep({ ...step(), kind: 'mystery' }), null)
  assert.equal(normalisePixelStep({ ...step(), opacity: 250 })?.opacity, 100)
  assert.equal(normalisePixelStep({ ...step(), alpha: 'x' })?.alpha, null)
})

test('a recipe carries its steps, and with one it is edited', () => {
  const r = defaultRecipe(false)
  assert.equal(isEdited(r, false), false)
  r.pixels.push(step())
  assert.equal(isEdited(r, false), true)
  const back = normaliseRecipe(JSON.parse(JSON.stringify(r)), false)
  assert.equal(back.pixels.length, 1)
  // An older recipe has none.
  assert.deepEqual(normaliseRecipe({}, false).pixels, [])
})

test('steps are entities in history: hiding one leaves the others', () => {
  const base = defaultRecipe(false)
  const one = structuredClone(base)
  one.pixels.push(step({ id: 'a', blob: H('a') }))
  const two = structuredClone(one)
  two.pixels.push(step({ id: 'b', blob: H('b') }))
  const steps: Step[] = [
    { seq: 2, label: 'one', at: '', patch: diffRecipe(base, one), hidden: false },
    { seq: 3, label: 'two', at: '', patch: diffRecipe(one, two), hidden: false }
  ]
  assert.deepEqual(
    replay(base, steps).pixels.map((p) => p.id),
    ['a', 'b']
  )
  const hidden = steps.map((s) => (s.seq === 2 ? { ...s, hidden: true } : s))
  assert.deepEqual(
    replay(base, hidden).pixels.map((p) => p.id),
    ['b']
  )
  // What names the working pixels follows the steps, and their strength.
  const strong = stackSignature(two.pixels)
  two.pixels[1].opacity = 40
  assert.notEqual(stackSignature(two.pixels), strong)
})

test('a masked step is its image with its mask as alpha', () => {
  const dir = tmp()
  const w = 4
  const h = 2
  const rgb = new Uint16Array(w * h * 3).map((_, i) => i * 1000)
  writeFileSync(join(dir, 'img.png'), encodePng16(rgb, w, h, 3))
  writeFileSync(
    join(dir, 'mask.png'),
    encodeGreyPng(Uint8Array.from([0, 255, 128, 0, 255, 255, 0, 0]), w, h)
  )
  composeMasked(join(dir, 'img.png'), join(dir, 'mask.png'), join(dir, 'out.png'))
  const out = pngSamples16(readFileSync(join(dir, 'out.png')))
  assert.equal(out.channels, 4)
  assert.deepEqual([...out.data.subarray(4, 8)], [3000, 4000, 5000, 65535])
  assert.equal(out.data[3], 0)
  assert.equal(out.data[2 * 4 + 3], 128 * 257)
  rmSync(dir, { recursive: true })
})

test('a mask is put back on the photo through the lens map', () => {
  const dir = tmp()
  const w = 40
  const h = 30
  // A block in the corrected picture.
  const plane = new Uint8Array(w * h)
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) plane[y * w + x] = 255
  writeFileSync(join(dir, 'mask.png'), encodeGreyPng(plane, w, h))
  // No correction: the map is the ramp itself, and the mask comes back as it was.
  writeRamp(join(dir, 'identity.png'), w, h)
  unwarpMask(join(dir, 'mask.png'), join(dir, 'identity.png'), w, h, join(dir, 'same.png'))
  const same = decodePng(readFileSync(join(dir, 'same.png'))).rows
  assert.deepEqual([...same], [...plane])
  // A correction that takes each corrected pixel from 5 to its right: the
  // block lands 5 to the right on the photo.
  const map = new Uint16Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      map[i] = Math.round((Math.min(w - 1, x + 5) / (w - 1)) * 65535)
      map[i + 1] = Math.round((y / (h - 1)) * 65535)
    }
  writeFileSync(join(dir, 'shift.png'), encodePng16(map, w, h, 3))
  unwarpMask(join(dir, 'mask.png'), join(dir, 'shift.png'), w, h, join(dir, 'moved.png'))
  const moved = decodePng(readFileSync(join(dir, 'moved.png'))).rows
  assert.equal(moved[15 * w + 17], 255)
  assert.equal(moved[15 * w + 12], 0)
  assert.equal(moved[15 * w + 24], 255)
  rmSync(dir, { recursive: true })
})

// ── with the engine itself ──

const engine = (() => {
  try {
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert: (r: unknown) => Promise<{ width: number; height: number }>
    }
  } catch {
    return null
  }
})()

test(
  'the working pixels are the photo with each step laid on, and are found again',
  { skip: engine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const dir = tmp()
    const w = 64
    const h = 48
    const flat = (v: number): Uint16Array => new Uint16Array(w * h * 3).fill(v)
    writeFileSync(join(dir, 'plain.png'), encodePng16(flat(10000), w, h, 3))
    // The step's image, as the project would hand it out (decoded once to a PNG).
    const blobs = join(dir, 'cache', 'blobs')
    mkdirSync(blobs, { recursive: true })
    const blob = H('c')
    writeFileSync(join(blobs, `${blob}.png`), encodePng16(flat(50000), w, h, 3))
    const deps: PixelDeps = {
      engine: engine as unknown as PixelDeps['engine'],
      cacheDir: join(dir, 'cache'),
      blobFile: async () => null,
      work: async () => undefined
    }
    const plain = {
      proxy: { path: join(dir, 'plain.png'), input: 'Png' as const, width: w, height: h },
      draft: { path: join(dir, 'plain.png'), input: 'Png' as const, width: w, height: h },
      frameWidth: w,
      frameHeight: h
    }
    const full = step({ blob, width: w, height: h })
    const set = await ensureWorking(deps, 'v1', plain, [full], null)
    const px = async (file: string): Promise<number> => {
      const png = join(dir, `read-${Math.random()}.png`)
      await engine!.convert({
        ...blankRequest(file, png, 'Tiff'),
        pixel: { depth: 'Sixteen', channels: 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } }
      })
      return pngSamples16(readFileSync(png)).data[(24 * w + 32) * 3]
    }
    // At 100% the step's pixels replace the photo's exactly.
    assert.equal(await px(set.px.proxy.path), 50000)
    // The same steps again: the set made before, not a new one.
    const again = await ensureWorking(deps, 'v1', plain, [full], null)
    assert.equal(again.px.proxy.path, set.px.proxy.path)
    // At 0% nothing is laid on.
    const none = await ensureWorking(deps, 'v1', plain, [{ ...full, opacity: 0 }], null)
    assert.equal(await px(none.px.proxy.path), 10000)
    // No steps: the plain proxies themselves.
    assert.equal((await ensureWorking(deps, 'v1', plain, [], null)).px, plain)
    rmSync(dir, { recursive: true })
  }
)

test(
  'the lens map is the engine’s own correction, read back as where each pixel came from',
  { skip: engine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { lensMap } = await import('../src/main/pixels/lensmap')
    const dir = tmp()
    const deps: PixelDeps = {
      engine: engine as unknown as PixelDeps['engine'],
      cacheDir: dir,
      blobFile: async () => null,
      work: async (job) => {
        if (job.op === 'ramp') writeRamp(job.file, job.w, job.h)
      }
    }
    const w = 300
    const h = 200
    const lens = {
      distortion: {
        model: { Poly3: { k1: -0.05 } },
        geometry: { centre: { x: 0.5, y: 0.5 }, unit: 'HalfDiagonal' as const },
        amount: 1
      },
      lateral_ca: null,
      vignetting: null,
      outside: 'Crop' as const,
      resampler: 'Lanczos3' as const
    }
    const map = await lensMap(deps, lens, w, h)
    const m = pngSamples16(readFileSync(map))
    const at = (x: number, y: number): [number, number] => {
      const i = (y * m.width + x) * 3
      return [(m.data[i] / 65535) * (w - 1), (m.data[i + 1] / 65535) * (h - 1)]
    }
    // The centre comes from the centre; a corner from further out on the photo
    // (the correction pulls the photo's edges in, and crops what is left).
    const [cx, cy] = at(Math.floor(m.width / 2), Math.floor(m.height / 2))
    assert.ok(Math.abs(cx - w / 2) < 2 && Math.abs(cy - h / 2) < 2, `centre ${cx},${cy}`)
    const [x0, y0] = at(0, 0)
    assert.ok(x0 >= 0 && y0 >= 0 && x0 < w / 2 && y0 < h / 2, `corner ${x0},${y0}`)
    // Asked again: the same file, not made again.
    assert.equal(await lensMap(deps, lens, w, h), map)
    // A full mask over the corrected picture covers the photo's middle.
    const cw = m.width
    const ch = m.height
    writeFileSync(join(dir, 'all.png'), encodeGreyPng(new Uint8Array(cw * ch).fill(255), cw, ch))
    unwarpMask(join(dir, 'all.png'), map, w, h, join(dir, 'src.png'))
    const plane = decodePng(readFileSync(join(dir, 'src.png'))).rows
    assert.equal(plane[(h / 2) * w + w / 2], 255)
    rmSync(dir, { recursive: true })
  }
)
