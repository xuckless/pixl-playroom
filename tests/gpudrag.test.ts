// The GPU drag path's decisions (shared/gpudrag.ts, Phase A §4.3–4.4).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Grade, GradeLayer, GradeOp } from '../src/shared/engine-types'

const P3: GradeLayer['blend'] = { mode: 'Normal', space: 'LinearWorking' }
const PRIMARY: GradeOp = {
  Primary: {
    exposure: 0.5,
    lift: { r: 0, g: 0, b: 0 },
    gamma: { r: 1, g: 1, b: 1 },
    gain: { r: 1, g: 1, b: 1 },
    contrast: 1,
    contrast_pivot: 0.18,
    saturation: 1,
    hue_shift: 0
  }
}
const tone = (base: unknown = null, strength = 0): GradeOp =>
  ({
    Tone: {
      highlights: -0.3,
      shadows: 0.2,
      whites: 0,
      blacks: 0,
      smoothing: strength > 0 ? { radius: 0.02, strength } : null,
      base
    }
  }) as GradeOp
const layer = (ops: GradeOp[], over: Partial<GradeLayer> = {}): GradeLayer => ({
  name: 'base',
  enabled: true,
  opacity: 1,
  mask: null,
  blend: P3,
  stages: [{ space: 'LinearWorking', ops }],
  ...over
})
const grade = (...layers: GradeLayer[]): Grade => ({ layers })

test('the backend: Metal on a Mac, Direct3D 12 on Windows, none elsewhere', async () => {
  const { gpuBackend } = await import('../src/shared/gpudrag')
  assert.deepEqual(gpuBackend('darwin'), { backend: 'Metal', adapter: 'HighPerformance' })
  assert.deepEqual(gpuBackend('win32'), { backend: 'Dx12', adapter: 'HighPerformance' })
  assert.equal(gpuBackend('linux'), null)
})

test('the switch is on unless turned off', async () => {
  const { gpuDragOn } = await import('../src/shared/gpudrag')
  assert.equal(gpuDragOn(null), true)
  assert.equal(gpuDragOn(undefined), true)
  assert.equal(gpuDragOn(true), true)
  assert.equal(gpuDragOn(false), false)
})

test('the constrained Mac: the plain M1, or 8 GB', async () => {
  const { constrainedMac } = await import('../src/shared/gpudrag')
  assert.equal(constrainedMac('darwin', 'Apple M1', 16384), true)
  assert.equal(constrainedMac('darwin', 'Apple M2', 8192), true)
  assert.equal(constrainedMac('darwin', 'Apple M1 Pro', 16384), false)
  assert.equal(constrainedMac('darwin', 'Apple M2 Pro', 32768), false)
  // Not a Mac: its GPU memory is its own.
  assert.equal(constrainedMac('win32', 'Apple M1', 8192), false)
})

test('what the GPU takes: Primary, Tone (no base or the local Laplacian), HSL bands, Dehaze', async () => {
  const { gpuRefusal } = await import('../src/shared/gpudrag')
  // No grade: nothing to run on the device (the engine refuses it by `grade_device`).
  assert.equal(gpuRefusal(null), 'grade_device')
  assert.equal(gpuRefusal(grade(layer([PRIMARY, tone()]))), null)
  const ll = { LocalLaplacian: { radius: 0.05, sigma: 0.1, spacing: 0.05 } }
  assert.equal(gpuRefusal(grade(layer([tone(ll)]))), null)
  const dehaze = { Dehaze: { amount: 0.4, radius: 0.01, smoothing: null } } as GradeOp
  assert.equal(gpuRefusal(grade(layer([dehaze, PRIMARY]))), null)
})

test('what it refuses, by the field the engine would name', async () => {
  const { gpuRefusal } = await import('../src/shared/gpudrag')
  const guided = { Guided: { radius: 0.005, epsilon: 0.01 } }
  assert.equal(
    gpuRefusal(grade(layer([tone(guided)]))),
    'grade.layers[0].stages[0].ops[0].Tone.base'
  )
  assert.equal(
    gpuRefusal(grade(layer([PRIMARY, tone(null, 0.5)]))),
    'grade.layers[0].stages[0].ops[1].Tone.smoothing'
  )
  // Every other op.
  const wb = { WhiteBalance: { temperature_kelvin: 5000, tint: 0 } } as GradeOp
  assert.equal(gpuRefusal(grade(layer([PRIMARY, wb]))), 'grade.layers[0].stages[0].ops[1]')
  // A layer's mask, opacity and blend.
  const mask = { components: [], invert: false } as unknown as GradeLayer['mask']
  assert.equal(
    gpuRefusal(grade(layer([PRIMARY]), layer([PRIMARY], { mask }))),
    'grade.layers[1].mask'
  )
  assert.equal(gpuRefusal(grade(layer([PRIMARY], { opacity: 0.5 }))), 'grade.layers[0].opacity')
  assert.equal(
    gpuRefusal(grade(layer([PRIMARY], { blend: { mode: 'Screen', space: 'LinearWorking' } }))),
    'grade.layers[0].blend'
  )
  // A stage through an ICC profile, or in an HDR signal.
  const icc = layer([PRIMARY], {
    stages: [
      {
        space: {
          Encoded: { space: { Icc: [1, 2] }, intent: 'Perceptual', black_point_compensation: false }
        },
        ops: [PRIMARY]
      }
    ]
  })
  assert.equal(gpuRefusal(grade(icc)), 'grade.layers[0].stages[0].space')
  // A log stage (engine 0.21), such as the Log wheels': every log space, by the stage's space.
  for (const space of ['PixlLog', 'AcesCct', 'DavinciIntermediate'] as const) {
    const log = layer([PRIMARY], {
      stages: [
        { space: 'LinearWorking', ops: [PRIMARY] },
        {
          space: {
            Encoded: { space, intent: 'RelativeColorimetric', black_point_compensation: false }
          },
          ops: [PRIMARY]
        }
      ]
    })
    assert.equal(gpuRefusal(grade(log)), 'grade.layers[0].stages[1].space')
  }
  // A disabled layer is left to the engine (it isn't graded).
  assert.equal(gpuRefusal(grade(layer([PRIMARY]), layer([wb], { enabled: false }))), null)
})

test('a grade shape ignores values: a slider drag stays one shape', async () => {
  const { gradeShape } = await import('../src/shared/gpudrag')
  const a = grade(layer([PRIMARY, tone()]))
  const b = structuredClone(a)
  ;(b.layers[0].stages[0].ops[1] as { Tone: { highlights: number } }).Tone.highlights = 0.9
  assert.equal(gradeShape(a), gradeShape(b))
  // Another op, or another base, is another shape.
  assert.notEqual(gradeShape(a), gradeShape(grade(layer([PRIMARY]))))
  const guided = { Guided: { radius: 0.005, epsilon: 0.01 } }
  assert.notEqual(gradeShape(a), gradeShape(grade(layer([PRIMARY, tone(guided)]))))
  assert.equal(gradeShape(null), 'none')
})

test('Dehaze and Denoise measure the photo (held measurements, §4.4)', async () => {
  const { measuresPhoto } = await import('../src/shared/gpudrag')
  assert.equal(measuresPhoto(grade(layer([PRIMARY]))), false)
  const dehaze = { Dehaze: { amount: 0.4, radius: 0.01, smoothing: null } } as GradeOp
  assert.equal(measuresPhoto(grade(layer([dehaze]))), true)
  const denoise = { Denoise: { luminance: 0.3 } } as unknown as GradeOp
  assert.equal(measuresPhoto(grade(layer([denoise]))), true)
  assert.equal(measuresPhoto(grade(layer([denoise], { enabled: false }))), false)
  assert.equal(measuresPhoto(null), false)
})

test('the grade input is the guide’s exact request', async () => {
  const { gradeInputRequest } = await import('../src/shared/gpudrag')
  const color = {
    ConvertTo: { to: 'DisplayP3', intent: 'RelativeColorimetric', black_point_compensation: false }
  } as const
  const r = gradeInputRequest({
    path: '/p/proxy.jpg',
    input: 'Jpeg',
    color,
    lens: null,
    retouch: null,
    threads: 6,
    limits: null
  })
  assert.equal(r.grade_device, 'Cpu')
  // Engine 0.21 (E62): required, and no refine planes held for an upload.
  assert.equal(r.hold_refines, false)
  assert.equal(r.sink, 'Bytes')
  assert.equal(r.grade, null)
  assert.equal(r.inspect, 'GradeInput')
  assert.deepEqual(r.encode, { Pixels: { sample: 'F16' } })
  // RGBA from the engine (0.21.0, E61): the upload has alpha, every drag frame too.
  assert.deepEqual(r.pixel, { depth: 'F32', channels: 4 })
  assert.equal(r.dither, 'None')
  assert.equal(r.upscaler, null)
  assert.deepEqual(r.metadata, { exif: false, icc: true, xmp: false, iptc: false })
  for (const k of ['framing', 'region', 'overlays', 'output_sharpen', 'sdr', 'measure'] as const)
    assert.equal(r[k], null, k)
  assert.equal(r.resize, 'None')
  // Full HDR: the master's SDR companion is left out (an inspection plane has none).
  const master = {
    Master: {
      headroom: true,
      peak: 'Measured',
      ceiling: { Display: { white_nits: 203, peak_nits: 812 } },
      reach: 'Measured',
      look: 'Colorimetric',
      float: 'ExtendedLinearDisplayP3',
      companion: { longest_side: 1024, resampler: 'Bilinear' }
    }
  } as unknown as Parameters<typeof gradeInputRequest>[0]['color']
  const m = gradeInputRequest({
    path: '/p/proxy.jpg',
    input: 'Jpeg',
    color: master,
    lens: null,
    retouch: null,
    threads: 6,
    limits: null
  })
  const made = m.color as { Master: { companion: unknown; float: string } }
  assert.equal(made.Master.companion, null)
  assert.equal(made.Master.float, 'ExtendedLinearDisplayP3')
})

test('an upload again only when something before the grade changes', async () => {
  const { gradeInputRequest, inputKey } = await import('../src/shared/gpudrag')
  const parts = {
    path: '/p/proxy.jpg',
    input: 'Jpeg' as const,
    color: 'Preserve' as const,
    lens: null,
    retouch: null,
    threads: 6,
    limits: null
  }
  const a = inputKey(gradeInputRequest(parts))
  assert.equal(a, inputKey(gradeInputRequest({ ...parts })))
  // The working pixels (another proxy), a live retouch: a new upload.
  assert.notEqual(a, inputKey(gradeInputRequest({ ...parts, path: '/p/working.tif' })))
  const retouch = { spots: [] } as unknown as Parameters<typeof gradeInputRequest>[0]['retouch']
  assert.notEqual(a, inputKey(gradeInputRequest({ ...parts, retouch })))
})

test('a drag frame nulls what is before the grade and names a display space', async () => {
  const { gpuDragRequest } = await import('../src/shared/gpudrag')
  const color = {
    ConvertTo: { to: 'DisplayP3', intent: 'RelativeColorimetric', black_point_compensation: false }
  } as const
  const g = grade(layer([PRIMARY]))
  const r = gpuDragRequest({ grade: g, color, hdr: false, region: null, measure: null, threads: 6 })
  assert.deepEqual(r.source, { GpuFrame: null })
  assert.equal(r.input, 'GpuFrame')
  assert.equal(r.grade_device, 'Gpu')
  // The GPU refuses `hold_refines: true` (E62).
  assert.equal(r.hold_refines, false)
  for (const k of [
    'raw',
    'lens',
    'retouch',
    'enhance',
    'gain_map',
    'hdr',
    'upscaler',
    'framing'
  ] as const)
    assert.equal(r[k], null, k)
  assert.equal(r.resize, 'None')
  assert.deepEqual(r.color, color)
  assert.deepEqual(r.encode, { Pixels: { sample: 'U8' } })
  // No channels named: the frame has its own (refused by `pixel.channels` otherwise).
  assert.deepEqual(r.pixel, { depth: 'Eight', channels: null })
  assert.equal(r.grade, g)
  // An HDR draft: F16 pixels, F32 working.
  const h = gpuDragRequest({ grade: g, color, hdr: true, region: null, measure: null, threads: 6 })
  assert.deepEqual(h.encode, { Pixels: { sample: 'F16' } })
  assert.deepEqual(h.pixel, { depth: 'F32', channels: null })
})

test('a convert made without the builders states the required fields', async () => {
  const { withRequiredFields } = await import('../src/main/engine/required')
  const [made] = withRequiredFields('convert', [{ input: 'Jpeg' }]) as Record<string, unknown>[]
  assert.equal(made.grade_device, 'Cpu')
  assert.equal(made.hold_refines, false)
  // What a request states is kept; other calls pass as they are.
  const stated = { grade_device: 'Gpu', hold_refines: false }
  assert.equal(withRequiredFields('convert', [stated])[0], stated)
  const [gpu] = withRequiredFields('convert', [{ grade_device: 'Gpu' }]) as Record<
    string,
    unknown
  >[]
  assert.equal(gpu.grade_device, 'Gpu')
  assert.equal(gpu.hold_refines, false)
  const probe = ['/p/a.jpg']
  assert.equal(withRequiredFields('probe', probe), probe)
})

test('a drag’s RGB pixels are laid out RGBA for the window', async () => {
  const { toRgba } = await import('../src/shared/gpudrag')
  // 8 bits: three bytes a pixel in, four out, opaque.
  const rgb = Uint8Array.from([1, 2, 3, 250, 251, 252])
  assert.deepEqual([...toRgba(rgb, 2, 1)], [1, 2, 3, 255, 250, 251, 252, 255])
  // Half floats: six bytes a pixel in, eight out, alpha 1.0 (0x3C00).
  const half = new Uint16Array([0x3c00, 0x3800, 0x0000, 0x4000, 0x3c00, 0x3555])
  const out = toRgba(new Uint8Array(half.buffer), 2, 1)
  assert.deepEqual(
    [...new Uint16Array(out.buffer, out.byteOffset, 8)],
    [0x3c00, 0x3800, 0x0000, 0x3c00, 0x4000, 0x3c00, 0x3555, 0x3c00]
  )
  // Half floats at an odd offset (a view into a larger buffer) read the same.
  const padded = new Uint8Array(13)
  padded.set(new Uint8Array(half.buffer), 1)
  assert.deepEqual([...toRgba(padded.subarray(1), 2, 1)], [...out])
  // RGBA already (U8 and F16), or a size it does not know: as given.
  const rgba = new Uint8Array(8)
  assert.equal(toRgba(rgba, 2, 1), rgba)
  const rgba16 = new Uint8Array(16)
  assert.equal(toRgba(rgba16, 2, 1), rgba16)
  const odd = new Uint8Array(5)
  assert.equal(toRgba(odd, 2, 1), odd)
})

/** The native engine with its GPU path, where both are there (not in CI: these skip). */
const gpuEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    const e = createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      hasGpu?: () => boolean
      convert(
        r: unknown,
        o?: unknown
      ): Promise<{
        output: Uint8Array
        width: number
        height: number
        pixels: { width: number; height: number; channels: number }
        companion?: { width: number; height: number; data: Uint8Array } | null
      }>
      openGpuSession(spec: unknown): Promise<{ close(): void }>
      uploadGpuFrame(gpu: unknown, spec: unknown, bytes: Uint8Array): Promise<{ close(): void }>
    }
    return e.hasGpu?.() ? e : null
  } catch {
    return null
  }
})()

test(
  'the engine takes the upload and the drag as built, and refuses what Playroom must not send',
  { skip: gpuEngine === null ? 'no engine with a GPU path here' : false },
  async () => {
    const e = gpuEngine!
    const { gradeInputRequest, gpuDragRequest, gpuBackend, toRgba } =
      await import('../src/shared/gpudrag')
    const { encodePng16 } = await import('../src/main/pngio')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'gpudrag-'))
    const w = 64
    const h = 48
    const px = new Uint16Array(w * h * 3).map((_, i) => (i * 7919) % 60000)
    const path = join(dir, 'in.png')
    writeFileSync(path, encodePng16(px, w, h, 3))
    type Color = Parameters<typeof gradeInputRequest>[0]['color']
    const p3 = {
      ConvertTo: { to: 'DisplayP3', intent: 'RelativeColorimetric', black_point_compensation: true }
    } as unknown as Color
    const master = (stated: boolean): Color =>
      ({
        Master: {
          headroom: true,
          peak: stated ? { Nits: 600 } : 'Measured',
          ceiling: { Display: { white_nits: 203, peak_nits: 812 } },
          reach: stated ? { Stated: 1 } : 'Measured',
          look: 'Colorimetric',
          float: 'ExtendedLinearDisplayP3',
          companion: { longest_side: 32, resampler: 'Bilinear' }
        }
      }) as unknown as Color
    const parts = {
      path,
      input: 'Png' as const,
      lens: null,
      retouch: null,
      threads: 2,
      limits: null
    }
    const g = grade(layer([PRIMARY]))
    const field = (err: unknown): string =>
      /field `([^`]+)`/.exec(String((err as Error).message))?.[1] ?? ''
    const gpu = await e.openGpuSession(gpuBackend(process.platform))
    const upload = async (color: Color): Promise<{ close(): void }> => {
      const input = await e.convert(gradeInputRequest({ ...parts, color }))
      return e.uploadGpuFrame(
        gpu,
        {
          width: input.pixels.width,
          height: input.pixels.height,
          sample: 'F16',
          alpha: input.pixels.channels === 4
        },
        input.output
      )
    }
    try {
      // SDR: the upload, then a drag, RGBA from the engine (E61): no pass lays in an alpha.
      const frame = await upload(p3)
      const drag = { grade: g, color: p3, hdr: false, region: null, measure: null, threads: 2 }
      const r = await e.convert(gpuDragRequest(drag), { gpu, frame })
      assert.equal(r.output.byteLength, w * h * 4)
      assert.equal(toRgba(r.output, r.width, r.height), r.output)
      // What 0.19.2 refuses, each by its field: channels on a frame, and no grade.
      await assert.rejects(
        e.convert(
          { ...gpuDragRequest(drag), pixel: { depth: 'Eight', channels: 4 } },
          { gpu, frame }
        ),
        (err) => field(err) === 'pixel.channels'
      )
      await assert.rejects(
        e.convert(gpuDragRequest({ ...drag, grade: null }), { gpu, frame }),
        (err) => field(err) === 'grade_device'
      )
      frame.close()
      // Full HDR: the upload leaves the companion out; the drag keeps it.
      const hdrFrame = await upload(master(false))
      const hdr = {
        grade: g,
        color: master(false),
        hdr: true,
        region: null,
        measure: null,
        threads: 2
      }
      const m = await e.convert(gpuDragRequest(hdr), { gpu, frame: hdrFrame })
      assert.equal(m.output.byteLength, w * h * 8)
      assert.ok(m.companion)
      const c = m.companion!
      assert.equal(toRgba(c.data, c.width, c.height).byteLength, c.width * c.height * 4)
      // A cropped drag states the picture's figures: measured ones are refused.
      const region = { x: 8, y: 8, width: 32, height: 24, margin: 4 }
      await assert.rejects(
        e.convert(gpuDragRequest({ ...hdr, region }), { gpu, frame: hdrFrame }),
        (err) => /^color\.(peak|reach)$/.test(field(err))
      )
      const cut = await e.convert(gpuDragRequest({ ...hdr, color: master(true), region }), {
        gpu,
        frame: hdrFrame
      })
      assert.equal(cut.width, 32)
      assert.equal(cut.height, 24)
      hdrFrame.close()
    } finally {
      gpu.close()
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test('framing on a drag: none, a crop as a region, anything else on the CPU', async () => {
  const { dragRegion } = await import('../src/shared/gpudrag')
  assert.equal(dragRegion(null, 2560, 1707, 0), null)
  const crop = {
    orientation: 'Normal' as const,
    rotate_degrees: 0,
    rotate_resampler: 'Lanczos3' as const,
    crop: { x: 0.1, y: 0.2, width: 0.5, height: 0.5 }
  }
  assert.deepEqual(dragRegion(crop, 2000, 1000, 220.4), {
    x: 200,
    y: 200,
    width: 1000,
    height: 500,
    margin: 221
  })
  assert.equal(dragRegion({ ...crop, crop: null }, 2000, 1000, 0), null)
  assert.equal(dragRegion({ ...crop, rotate_degrees: 1.5 }, 2000, 1000, 0), 'cpu')
  assert.equal(dragRegion({ ...crop, orientation: 'Rotate90' }, 2000, 1000, 0), 'cpu')
  // A crop at the edge stays inside the frame.
  const edge = dragRegion(
    { ...crop, crop: { x: 0.9999, y: 0, width: 0.5, height: 1 } },
    2000,
    1000,
    0
  )
  assert.ok(edge && edge !== 'cpu' && edge.x + edge.width <= 2000)
})

test('what a failed drag means', async () => {
  const { dragVerdict } = await import('../src/shared/gpudrag')
  assert.equal(dragVerdict({ code: 'InvalidRequest', field: 'held' }), 'held')
  assert.equal(dragVerdict({ code: 'InvalidRequest', field: 'held.Dehaze' }), 'held')
  assert.equal(dragVerdict({ code: 'InvalidRequest', field: 'measure' }), 'measure')
  assert.equal(dragVerdict({ code: 'Stale' }), 'stale')
  assert.equal(dragVerdict({ code: 'EngineCrashed' }), 'stale')
  assert.equal(
    dragVerdict({ code: 'InvalidRequest', field: 'grade.layers[0].stages[0].ops[1]' }),
    'refused'
  )
  assert.equal(dragVerdict({ code: 'Unknown' }), 'refused')
})

test('held measurements are kept per pixels and framing', async () => {
  const { heldKey } = await import('../src/shared/gpudrag')
  assert.equal(heldKey('gpu:ab', null), heldKey('gpu:ab', null))
  assert.notEqual(heldKey('gpu:ab', null), heldKey('gpu:cd', null))
  assert.notEqual(heldKey('/d.jpg', null), heldKey('/d.jpg', { crop: { x: 0.1 } }))
})

test('the 1:1 view’s held refines are kept per source, grade, framing, lens and retouch', async () => {
  // Engine 0.21.0 (E62): the engine refuses a held plane only when its mask
  // changed, so a retouch or a lens correction under it must make it again.
  const { refineKey } = await import('../src/shared/gpudrag')
  const src = { path: '/m.tiff', width: 6000, height: 4000 }
  const render = { grade: null, framing: null, lens: null, retouch: null }
  const key = refineKey(src, render)
  assert.equal(refineKey({ ...src }, { ...render }), key)
  assert.notEqual(refineKey({ ...src, path: '/w.tiff' }, render), key)
  assert.notEqual(refineKey({ ...src, width: 5998 }, render), key)
  const retouch = { space: 'Normal', steps: [] } as never
  assert.notEqual(refineKey(src, { ...render, retouch }), key)
  const lens = { distortion: 0.1 } as never
  assert.notEqual(refineKey(src, { ...render, lens }), key)
  const framing = { orientation: 'Rotate90' } as never
  assert.notEqual(refineKey(src, { ...render, framing }), key)
})

test('a GPU drag keeps the local-Laplacian base; the M1 drags without one', async () => {
  const { toneBaseFor, TEXTURE_BASE, DRAG_BASE } = await import('../src/shared/compile')
  const ctx = {
    isRaw: false,
    asShot: null,
    sourceOrientation: 'Normal' as const,
    frameWidth: 100,
    frameHeight: 100,
    scale: 1,
    seed: 1,
    brushPaths: {},
    applyCrop: true,
    toneBase: 'texture' as const
  }
  assert.deepEqual(toneBaseFor({ ...ctx, smoothing: false }), DRAG_BASE)
  assert.deepEqual(toneBaseFor({ ...ctx, smoothing: false, gpuDrag: true }), TEXTURE_BASE)
  assert.equal(
    toneBaseFor({ ...ctx, smoothing: false, gpuDrag: true, dragWithoutBase: true }),
    null
  )
  // The release: the local Laplacian, whatever dragged.
  assert.deepEqual(toneBaseFor({ ...ctx, gpuDrag: true, dragWithoutBase: true }), TEXTURE_BASE)
})

test('engine 0.21’s colour ops leave a drag to the CPU; the Primaries at Lum Mix 0 stay on the GPU', async () => {
  const { compile } = await import('../src/shared/compile')
  const { gpuRefusal } = await import('../src/shared/gpudrag')
  const { defaultRecipe } = await import('../src/shared/recipe')
  type Recipe = ReturnType<typeof defaultRecipe>
  const ctx = {
    isRaw: false,
    asShot: null,
    sourceOrientation: 'Normal' as const,
    frameWidth: 400,
    frameHeight: 300,
    scale: 1,
    seed: 1,
    brushPaths: {},
    applyCrop: true,
    smoothing: false,
    gpuDrag: true
  }
  const drag = (set: (r: Recipe) => void): string | null => {
    const r = defaultRecipe(false)
    set(r)
    return gpuRefusal(compile(r, ctx).grade)
  }
  // The wheels with the Y ring folded in (Lum Mix 0), or Lum Mix with no Y ring moved: one Primary.
  assert.equal(
    drag((r) => (r.primaries.lift.y = 0.1)),
    null
  )
  assert.equal(
    drag((r) => {
      r.primaries.lumMix = 50
      r.primaries.gain.r = 1.1
    }),
    null
  )
  // No GPU kernel for these (migration-0.21.0.md): each is named, so the drag runs on the CPU.
  const cpu: Record<string, (r: Recipe) => void> = {
    LumaPrimary: (r) => {
      r.primaries.lumMix = 50
      r.primaries.lift.y = 0.1
    },
    GainBalance: (r) => (r.primaries.temp = 20),
    ParametricCurve: (r) => (r.toneCurve.lights = 20),
    'Hue vs Lum': (r) => (r.curvesVs.hueLum = [{ x: 0.3, y: 0.8 }]),
    'Sat vs Sat': (r) => (r.curvesVs.satSat = [{ x: 0.3, y: 0.8 }])
  }
  for (const [name, set] of Object.entries(cpu))
    assert.equal(drag(set), 'grade.layers[0].stages[0].ops[0]', name)
  // The Log wheels' PixlLog stage is refused by its space, before its op.
  assert.equal(
    drag((r) => (r.logWheels.midtone.r = 0.02)),
    'grade.layers[0].stages[0].space'
  )
})
