import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'module'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import {
  normalisePixelStep,
  placeStep,
  RAW_DEVELOP_REV,
  stackSignature,
  staleRawStep,
  type PixelStep
} from '../src/shared/pixels'
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
  rect: null,
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
  // A map smaller than the photo (as lens maps are): read by pixel centres,
  // no correction still puts the mask back where it was.
  writeRamp(join(dir, 'small.png'), w / 2, h / 2)
  unwarpMask(join(dir, 'mask.png'), join(dir, 'small.png'), w, h, join(dir, 'small-out.png'))
  const small = decodePng(readFileSync(join(dir, 'small-out.png'))).rows
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) assert.equal(small[y * w + x], plane[y * w + x], `${x},${y}`)
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
    // Asked for at once with and without the master: one build of the
    // proxies, the master after them and kept, nothing half written left.
    const half = [{ ...full, opacity: 50 }]
    const [proxies, withMaster] = await Promise.all([
      ensureWorking(deps, 'v1', plain, half, null),
      ensureWorking(deps, 'v1', plain, half, async () => plain.proxy)
    ])
    assert.equal(proxies.px.proxy.path, withMaster.px.proxy.path)
    assert.ok(withMaster.master)
    const setDir = dirname(withMaster.px.proxy.path)
    assert.ok(JSON.parse(readFileSync(join(setDir, 'set.json'), 'utf8')).master)
    assert.deepEqual(
      readdirSync(setDir).filter((f) => f.includes('.part')),
      []
    )
    assert.ok((await ensureWorking(deps, 'v1', plain, half, null)).master)
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
        amount: 1,
        scale: 1
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

test(
  'a step laid on a proxy of a slightly different shape fits it exactly',
  { skip: engine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const dir = tmp()
    // The step at the photo's size; the proxy rounded (30 × 20 → 22 × 14, where
    // keeping the step's shape would make it 14.67, so 15, rows tall).
    const blobs = join(dir, 'cache', 'blobs')
    mkdirSync(blobs, { recursive: true })
    const blob = H('d')
    writeFileSync(
      join(blobs, `${blob}.png`),
      encodePng16(new Uint16Array(30 * 20 * 3).fill(40000), 30, 20, 3)
    )
    writeFileSync(
      join(dir, 'plain.png'),
      encodePng16(new Uint16Array(22 * 14 * 3).fill(1000), 22, 14, 3)
    )
    const deps: PixelDeps = {
      engine: engine as unknown as PixelDeps['engine'],
      cacheDir: join(dir, 'cache'),
      blobFile: async () => null,
      work: async () => undefined
    }
    const p = { path: join(dir, 'plain.png'), input: 'Png' as const, width: 22, height: 14 }
    const set = await ensureWorking(
      deps,
      'v1',
      { proxy: p, draft: p, frameWidth: 30, frameHeight: 20 },
      [step({ blob, width: 30, height: 20 })],
      null
    )
    assert.equal(set.px.proxy.width, 22)
    assert.equal(set.px.proxy.height, 14)
    rmSync(dir, { recursive: true })
  }
)

test('an upscale step makes the frame its size from then on', async () => {
  const { frameOf } = await import('../src/main/pixels/working')
  const up = step({
    id: 'u',
    kind: 'enhance',
    width: 12000,
    height: 8000,
    params: { resizes: true }
  })
  const dn = step({ id: 'd', width: 6000, height: 4000 })
  assert.deepEqual(frameOf([], 6000, 4000), { width: 6000, height: 4000 })
  assert.deepEqual(frameOf([dn, up], 6000, 4000), { width: 12000, height: 8000 })
  // A denoise made after the upscale is at the upscale's size already.
  assert.deepEqual(frameOf([up, { ...dn, width: 12000, height: 8000 }], 6000, 4000), {
    width: 12000,
    height: 8000
  })
  // An upscale at 0% lays nothing on, and sizes nothing.
  assert.deepEqual(frameOf([{ ...up, opacity: 0 }], 6000, 4000), { width: 6000, height: 4000 })
})

test('JPEG restore must be a photo’s first pixel step', async () => {
  const { jpegRestoreRefusal, DEFAULT_ENHANCE } = await import('../src/shared/enhance')
  const restore = { ...DEFAULT_ENHANCE, jpeg: 'fbcnn' as const }
  assert.equal(jpegRestoreRefusal(restore, true, 0), null)
  assert.match(jpegRestoreRefusal(restore, true, 1) ?? '', /must come first/)
  // Not a JPEG: nothing to restore, nothing refused here.
  assert.equal(jpegRestoreRefusal(restore, false, 1), null)
  assert.equal(jpegRestoreRefusal({ ...DEFAULT_ENHANCE, upscale: 'x2' }, true, 3), null)
})

test(
  'with an upscale, the full-size working frame is the upscale’s, the proxies keep their size',
  { skip: engine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const dir = tmp()
    const blobs = join(dir, 'cache', 'blobs')
    mkdirSync(blobs, { recursive: true })
    const blob = H('e')
    writeFileSync(
      join(blobs, `${blob}.png`),
      encodePng16(new Uint16Array(64 * 48 * 3).fill(30000), 64, 48, 3)
    )
    writeFileSync(
      join(dir, 'base.png'),
      encodePng16(new Uint16Array(32 * 24 * 3).fill(500), 32, 24, 3)
    )
    writeFileSync(
      join(dir, 'proxy.png'),
      encodePng16(new Uint16Array(16 * 12 * 3).fill(500), 16, 12, 3)
    )
    const deps: PixelDeps = {
      engine: engine as unknown as PixelDeps['engine'],
      cacheDir: join(dir, 'cache'),
      blobFile: async () => null,
      work: async () => undefined
    }
    const proxy = { path: join(dir, 'proxy.png'), input: 'Png' as const, width: 16, height: 12 }
    const up = step({ blob, kind: 'enhance', width: 64, height: 48, params: { resizes: true } })
    const set = await ensureWorking(
      deps,
      'v1',
      { proxy, draft: proxy, frameWidth: 32, frameHeight: 24 },
      [up],
      async () => ({ path: join(dir, 'base.png'), input: 'Png' as const, width: 32, height: 24 })
    )
    assert.equal(set.px.frameWidth, 64)
    assert.equal(set.px.proxy.width, 16)
    assert.equal(set.master!.width, 64)
    assert.equal(set.master!.height, 48)
    rmSync(dir, { recursive: true })
  }
)

// ── baked heal strokes ──

test('a patch is what changed between the two renders, clipped by a mask', async () => {
  const { buildPatch } = await import('../src/main/pixels/ops')
  const dir = tmp()
  const w = 10
  const h = 8
  const before = new Uint16Array(w * h * 3).fill(1000)
  const after = before.slice()
  // A 3 × 2 block changed, at (4, 3).
  for (let y = 3; y < 5; y++)
    for (let x = 4; x < 7; x++) after.fill(50000, (y * w + x) * 3, (y * w + x) * 3 + 3)
  writeFileSync(join(dir, 'a.png'), encodePng16(after, w, h, 3))
  writeFileSync(join(dir, 'b.png'), encodePng16(before, w, h, 3))
  const at = buildPatch(join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'p.png'))
  assert.deepEqual(at, { x: 4, y: 3, w: 3, h: 2 })
  const p = pngSamples16(readFileSync(join(dir, 'p.png')))
  assert.equal(p.channels, 4)
  assert.equal(p.data[0], 50000)
  assert.equal(p.data[3], 65535)
  // A mask over the frame that keeps only the block's left column.
  const frame = new Uint8Array(20 * 20)
  for (let y = 0; y < 20; y++) frame[y * 20 + 2 + 4] = 255
  writeFileSync(join(dir, 'm.png'), encodeGreyPng(frame, 20, 20))
  const clipped = buildPatch(join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'q.png'), {
    path: join(dir, 'm.png'),
    at: { x: 2, y: 0 }
  })
  assert.deepEqual(clipped, { x: 4, y: 3, w: 1, h: 2 })
  // Nothing changed: no patch.
  assert.equal(buildPatch(join(dir, 'b.png'), join(dir, 'b.png'), join(dir, 'r.png')), null)
  rmSync(dir, { recursive: true })
})

test(
  'a heal stroke is baked into a patch where it changed the photo, and laid on in place',
  { skip: engine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { bakeSpot } = await import('../src/main/pixels/heal')
    const { buildPatch } = await import('../src/main/pixels/ops')
    const { newSpot } = await import('../src/shared/retouch')
    const dir = tmp()
    const w = 200
    const h = 150
    // A flat grey photo with a dark blemish at (100, 75).
    const px = new Uint16Array(w * h * 3).fill(30000)
    for (let y = 70; y < 80; y++)
      for (let x = 95; x < 105; x++) px.fill(2000, (y * w + x) * 3, (y * w + x) * 3 + 3)
    writeFileSync(join(dir, 'master.png'), encodePng16(px, w, h, 3))
    const blobs = join(dir, 'cache', 'blobs')
    mkdirSync(blobs, { recursive: true })
    const deps: PixelDeps = {
      engine: engine as unknown as PixelDeps['engine'],
      cacheDir: join(dir, 'cache'),
      blobFile: async (hash, ext) => join(blobs, `${hash}.${ext}`),
      work: async (job) =>
        job.op === 'patch' ? buildPatch(job.withStroke, job.without, job.out, job.mask) : undefined
    }
    const { sha256File } = await import('../src/main/project/pixlfile')
    const { copyFileSync } = await import('fs')
    const spot = newSpot('s1', 'heal', [{ x: 0.5, y: 0.5 }], 0.08, 50, 100)
    spot.source = { x: 0.25, y: 0.5 }
    const step = await bakeSpot(
      {
        deps,
        recipe: defaultRecipe(false),
        lens: null,
        photoId: 1,
        isRaw: false,
        asShot: null,
        seed: 1,
        master: { path: join(dir, 'master.png'), input: 'Png', width: w, height: h },
        freeze: async () => null,
        store: async (file) => {
          const hash = sha256File(file)
          copyFileSync(file, join(blobs, `${hash}.png`))
          return hash
        }
      },
      spot,
      null
    )
    assert.ok(step, 'the stroke changed the photo')
    assert.equal(step!.kind, 'retouch')
    // The patch covers the blemish, and not the whole photo.
    const r = step!.rect!
    assert.ok(r.x <= 95 && r.x + r.w >= 105 && r.y <= 70 && r.y + r.h >= 80, JSON.stringify(r))
    assert.ok(r.w < w && r.h < h)
    // Laid on in place, the blemish is gone.
    const set = await ensureWorking(
      deps,
      'v1',
      {
        proxy: { path: join(dir, 'master.png'), input: 'Png', width: w, height: h },
        draft: { path: join(dir, 'master.png'), input: 'Png', width: w, height: h },
        frameWidth: w,
        frameHeight: h
      },
      [step!],
      null
    )
    const out = join(dir, 'healed.png')
    await engine!.convert({
      ...blankRequest(set.px.proxy.path, out, 'Tiff'),
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: { Png: { compression: 'Fast', filter: 'Sub' } }
    })
    const healed = pngSamples16(readFileSync(out)).data
    assert.ok(healed[(75 * w + 100) * 3] > 20000, `the blemish is ${healed[(75 * w + 100) * 3]}`)
    // Far from the stroke nothing changed.
    assert.equal(healed[(10 * w + 10) * 3], 30000)
    rmSync(dir, { recursive: true })
  }
)

test('a patch keeps the colour profile of the pixels it came from', async () => {
  const { buildPatch } = await import('../src/main/pixels/ops')
  const { colourChunks } = await import('../src/main/pngio')
  const dir = tmp()
  // A PNG chunk, as a profile would be (the bytes are what matter, not a real ICC).
  const iccp = (() => {
    const data = Buffer.concat([Buffer.from('linear\0\0'), Buffer.from([1, 2, 3, 4])])
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    return Buffer.concat([len, Buffer.from('iCCP'), data, Buffer.alloc(4)])
  })()
  const a = new Uint16Array(4 * 4 * 3).fill(100)
  const b = a.slice()
  a[0] = 60000
  writeFileSync(join(dir, 'a.png'), encodePng16(a, 4, 4, 3, 1, [iccp]))
  writeFileSync(join(dir, 'b.png'), encodePng16(b, 4, 4, 3, 1, [iccp]))
  buildPatch(join(dir, 'a.png'), join(dir, 'b.png'), join(dir, 'p.png'))
  const chunks = colourChunks(readFileSync(join(dir, 'p.png')))
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].toString('ascii', 4, 8), 'iCCP')
  rmSync(dir, { recursive: true })
})

const CR2 = '/Users/ali/photos-card/IMG_3257.CR2'

test(
  'on a RAW’s linear pixels, a baked heal keeps the photo’s brightness',
  {
    skip:
      engine === null
        ? 'the engine is not built for this platform'
        : !(await import('fs')).existsSync(CR2)
          ? 'no RAW to test on here'
          : false
  },
  async () => {
    const { bakeSpot } = await import('../src/main/pixels/heal')
    const { buildPatch } = await import('../src/main/pixels/ops')
    const { newSpot } = await import('../src/shared/retouch')
    const { sha256File } = await import('../src/main/project/pixlfile')
    const { copyFileSync } = await import('fs')
    const { RAW_DEVELOP } = await import('../src/main/source')
    const dir = tmp()
    // The RAW developed as the app's master is (linear, 16-bit, its profile), small.
    const master = join(dir, 'master.tiff')
    const r = await engine!.convert({
      ...blankRequest(CR2, master, 'Raw'),
      raw: RAW_DEVELOP,
      resize: { Scale: { factor: 0.1 } },
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: { Tiff: { compression: 'None' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: 'Preserve'
    })
    const blobs = join(dir, 'cache', 'blobs')
    mkdirSync(blobs, { recursive: true })
    const deps: PixelDeps = {
      engine: engine as unknown as PixelDeps['engine'],
      cacheDir: join(dir, 'cache'),
      blobFile: async (hash, ext) => join(blobs, `${hash}.${ext}`),
      work: async (job) =>
        job.op === 'patch' ? buildPatch(job.withStroke, job.without, job.out, job.mask) : undefined
    }
    const frame = { path: master, input: 'Tiff' as const, width: r.width, height: r.height }
    const spot = newSpot('s', 'clone', [{ x: 0.5, y: 0.5 }], 0.05, 0, 100)
    spot.source = { x: 0.52, y: 0.5 }
    const step = await bakeSpot(
      {
        deps,
        recipe: defaultRecipe(true),
        lens: null,
        photoId: 1,
        isRaw: true,
        asShot: null,
        seed: 1,
        master: frame,
        freeze: async () => null,
        store: async (file) => {
          const hash = sha256File(file)
          copyFileSync(file, join(blobs, `${hash}.png`))
          return hash
        }
      },
      spot,
      null
    )
    assert.ok(step)
    const set = await ensureWorking(
      deps,
      'raw',
      { proxy: frame, draft: frame, frameWidth: frame.width, frameHeight: frame.height },
      [step!],
      null
    )
    // Read the same point of the source and of the cloned spot, as one does.
    const read = async (file: string): Promise<Uint16Array> => {
      const png = join(dir, `read-${Math.random()}.png`)
      await engine!.convert({
        ...blankRequest(file, png, 'Tiff'),
        pixel: { depth: 'Sixteen', channels: 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: 'Preserve'
      })
      return pngSamples16(readFileSync(png)).data
    }
    const before = await read(master)
    const after = await read(set.px.proxy.path)
    const at = (d: Uint16Array, x: number, y: number): number => {
      let s = 0
      for (let c = 0; c < 3; c++) s += d[(y * frame.width + x) * 3 + c]
      return s / 3
    }
    const cy = Math.round(frame.height / 2)
    const dest = at(after, Math.round(frame.width * 0.5), cy)
    const src = at(before, Math.round(frame.width * 0.52), cy)
    // A clone copies: the spot is the source's brightness (not darkened).
    assert.ok(Math.abs(dest - src) / Math.max(1, src) < 0.05, `spot ${dest}, source ${src}`)
    rmSync(dir, { recursive: true })
  }
)

test('a step made over earlier steps goes after them, under any added while it ran', () => {
  const a = step({ id: 'a' })
  const heal = step({ id: 'heal' })
  const made = step({ id: 'denoise' })
  const ids = (l: PixelStep[]): string[] => l.map((s) => s.id)
  // Made over [a]; a heal came meanwhile: the denoise goes under the heal.
  assert.deepEqual(ids(placeStep([a, heal], made, ['a'])), ['a', 'denoise', 'heal'])
  // Made over nothing: first.
  assert.deepEqual(ids(placeStep([heal], made, [])), ['denoise', 'heal'])
  // The step it followed is gone, or no base given: last.
  assert.deepEqual(ids(placeStep([heal], made, ['a'])), ['heal', 'denoise'])
  assert.deepEqual(ids(placeStep([a], made)), ['a', 'denoise'])
})

test('a heal drawn on the corrected picture keeps its size on the photo', async () => {
  const { localScale } = await import('../src/main/pixels/heal')
  // A correction that shrinks the photo 1.2× into the corrected frame: what
  // was drawn there is 1.2× as large on the photo.
  const map = (p: { x: number; y: number }): { x: number; y: number } => ({
    x: 0.5 + (p.x - 0.5) * 1.2,
    y: 0.5 + (p.y - 0.5) * 1.2
  })
  assert.ok(Math.abs(localScale(map, { x: 0.3, y: 0.6 }, 6000, 4000) - 1.2) < 1e-9)
  assert.ok(Math.abs(localScale((p) => p, { x: 0.5, y: 0.5 }, 6000, 4000) - 1) < 1e-9)
})

test('a heal patch on a proxy goes at its own size, not stretched over every pixel it touches', async () => {
  const { overlaysOf } = await import('../src/main/pixels/working')
  const dir = tmp()
  const resized: { width: number; height: number }[] = []
  const deps: PixelDeps = {
    engine: {
      convert: async (r: { sink: { Path: string }; resize: unknown }) => {
        const e = (r.resize as { Exact?: { width: number; height: number } }).Exact
        if (e) resized.push(e)
        writeFileSync(r.sink.Path, '')
        return { width: 0, height: 0 }
      }
    } as unknown as PixelDeps['engine'],
    cacheDir: dir,
    blobFile: async () => join(dir, 'patch.png'),
    work: async () => undefined
  }
  // 40 px at x = 1000 on 6000 px, drawn on a 2370 px proxy: 15.8 px at 395.
  const patch = step({ width: 6000, height: 4000, rect: { x: 1000, y: 1000, w: 40, h: 40 } })
  const [o] = await overlaysOf(deps, [patch], 2370, 1580)
  assert.deepEqual(resized, [{ width: 16, height: 16 }])
  assert.ok(Math.abs(o.rect.x * 2370 - 395) < 1e-9)
  assert.ok(Math.abs(o.rect.width * 2370 - 16) < 1e-9)
  rmSync(dir, { recursive: true })
})

test("a RAW's step made on rawler's develop is told apart from one made on today's", () => {
  const step = (params: PixelStep['params']): PixelStep => ({
    id: 's',
    kind: 'denoise',
    label: 'AI Denoise',
    blob: 'a'.repeat(64),
    alpha: null,
    scope: null,
    opacity: 100,
    width: 10,
    height: 10,
    rect: null,
    params
  })
  assert.equal(staleRawStep(step({ model: 'drunet-color' }), true), true)
  assert.equal(staleRawStep(step({ model: 'drunet-color', develop: RAW_DEVELOP_REV }), true), false)
  // Only a RAW's pixels come from a develop.
  assert.equal(staleRawStep(step({ model: 'drunet-color' }), false), false)
  // The mark survives a round trip through the project.
  assert.equal(
    normalisePixelStep(step({ develop: RAW_DEVELOP_REV }))?.params.develop,
    RAW_DEVELOP_REV
  )
})
