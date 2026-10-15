// E66 (engine 0.21.0): a region of a PIXL demosaic develop runs the model
// only under the windows the region reads, and its pixels are the whole
// develop's, cut. Playroom fills the first 1:1 wait with it (render.ts
// `regionFromRaw`) on that promise, held here on one of the owner's Bayer
// RAWs: name it in PIXL_E66_RAW (read in place, never in the repository)
// and the folder of downloaded models (`<id>/<version>/`) in PIXL_MODELS.
// Measured 2026-10-14 on IMG_1911.CR2 (an M2 Pro, CoreML): the master in
// 8.1 s (108 windows), a 512 × 384 region in 1.7 s (6 windows), 0 samples
// apart at 16 bits.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const RAW = process.env['PIXL_E66_RAW']
const MODELS = process.env['PIXL_MODELS']
const skip =
  !RAW || !MODELS ? 'set PIXL_E66_RAW to a Bayer RAW and PIXL_MODELS to the models folder' : false

interface Report {
  width: number
  height: number
  frame_width: number
  frame_height: number
  region: { developed?: unknown; output: unknown } | null
  raw: { demosaic_model?: { tiles: number; frame_tiles?: number } | null } | null
}

test('a region developed from the RAW is the PIXL master’s pixels, cut', { skip }, async () => {
  const req = createRequire(import.meta.url)
  const engine = req('@xuckless/pixl-engine') as { convert(r: unknown): Promise<Report> }
  const models = req('@xuckless/pixl-models') as {
    manifest(): { id: string; files: { sha256: string; dimensions: string[] }[] }[]
    ref(id: string, host: unknown, opts: { dir: string }): Record<string, unknown>
  }
  const { blankRequest, rawMaster } = await import('../src/main/source')
  const { staticPlan } = await import('../src/shared/modelshape')
  const { pngSamples16 } = await import('../src/main/pngio')
  const id = 'pixl-demosaic-v1-bayer'
  const entry = models.manifest().find((m) => m.id === id)!
  const dir = join(MODELS!, id, readdirSync(join(MODELS!, id))[0])
  const runtime = join(
    dirname(req.resolve('@xuckless/pixl-engine')),
    readdirSync(dirname(req.resolve('@xuckless/pixl-engine'))).find((f) =>
      f.startsWith('libonnxruntime')
    )!
  )
  const accel = {
    CoreMl: { units: 'All', format: 'MlProgram', static_shapes: false, low_precision_gpu: false }
  } as const
  const onMac = process.platform === 'darwin'
  const plan = onMac ? staticPlan(id, entry.files[0].dimensions, accel) : null
  const ref = {
    ...models.ref(
      id,
      {
        runtime_library: runtime,
        provider: plan?.provider ?? 'Cpu',
        session: {
          threads: 8,
          optimisation: 'All',
          deterministic: false,
          dimensions: plan?.dimensions ?? [],
          intra_op_spinning: false,
          cpu_arena: false
        }
      },
      { dir }
    ),
    ...(plan ? { tiling: plan.tiling } : {})
  }
  const raw = rawMaster('container', { demosaic: { Model: ref } as never, mosaic_denoise: null })
  const out = mkdtempSync(join(tmpdir(), 'e66-'))
  const master = join(out, 'master.tiff')
  const whole = await engine.convert({
    ...blankRequest(RAW!, master, 'Raw'),
    raw,
    pixel: { depth: 'F32', channels: 3 },
    encode: { Tiff: { compression: 'None' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false }
  })
  const region = { x: 2000, y: 1500, width: 512, height: 384, margin: 64 }
  const tile = {
    pixel: { depth: 'Sixteen', channels: 3 },
    encode: { Png: { compression: 'Fast', filter: 'Sub' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    region
  }
  const a = join(out, 'from-raw.png')
  const b = join(out, 'from-master.png')
  const fromRaw = await engine.convert({ ...blankRequest(RAW!, a, 'Raw'), ...tile, raw })
  await engine.convert({ ...blankRequest(master, b, 'Tiff'), ...tile })
  // Developed for the region alone, fewer windows than the whole frame's.
  assert.ok(fromRaw.region?.developed, 'the region was developed alone')
  const counts = fromRaw.raw?.demosaic_model
  assert.ok(counts && counts.frame_tiles && counts.tiles < counts.frame_tiles)
  // The develop's frame, as region() learns it.
  assert.deepEqual([fromRaw.frame_width, fromRaw.frame_height], [whole.width, whole.height])
  const pa = pngSamples16(readFileSync(a))
  const pb = pngSamples16(readFileSync(b))
  assert.deepEqual([pa.width, pa.height], [pb.width, pb.height])
  let apart = 0
  for (let i = 0; i < pa.data.length; i++) if (pa.data[i] !== pb.data[i]) apart++
  assert.equal(apart, 0, 'the region is the master, cut')
})
