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
  assert.equal(gpuRefusal(null), null)
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
  assert.equal(r.sink, 'Bytes')
  assert.equal(r.grade, null)
  assert.equal(r.inspect, 'GradeInput')
  assert.deepEqual(r.encode, { Pixels: { sample: 'F16' } })
  assert.deepEqual(r.pixel, { depth: 'F32', channels: null })
  assert.equal(r.dither, 'None')
  assert.equal(r.upscaler, null)
  assert.deepEqual(r.metadata, { exif: false, icc: true, xmp: false, iptc: false })
  for (const k of ['framing', 'region', 'overlays', 'output_sharpen', 'sdr', 'measure'] as const)
    assert.equal(r[k], null, k)
  assert.equal(r.resize, 'None')
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
  assert.equal(r.pixel.depth, 'Eight')
  assert.equal(r.grade, g)
  // An HDR draft: F16 pixels, F32 working.
  const h = gpuDragRequest({ grade: g, color, hdr: true, region: null, measure: null, threads: 6 })
  assert.deepEqual(h.encode, { Pixels: { sample: 'F16' } })
  assert.equal(h.pixel.depth, 'F32')
})

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
