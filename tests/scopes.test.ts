import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HDR_FLOOR_STOPS, stopsBins, stopsX } from '../src/shared/scopes'

test('reference white sits where its stops put it', () => {
  // 4× headroom: 2 stops above white, 8 below.
  assert.equal(stopsX(1, 4), -HDR_FLOOR_STOPS / (2 - HDR_FLOOR_STOPS))
  assert.equal(stopsX(4, 4), 1)
  assert.equal(stopsX(0, 4), 0)
  assert.equal(stopsX(1e-6, 4), 0)
})

test('re-binning onto stops keeps every count', () => {
  const counts = Array.from({ length: 4096 }, (_, i) => (i * 7919) % 13)
  const total = counts.reduce((a, b) => a + b, 0)
  const bins = stopsBins(counts, 4.93, 256)
  assert.equal(bins.length, 256)
  assert.ok(Math.abs(bins.reduce((a, b) => a + b, 0) - total) < 1e-6 * total)
})

test('a lone value lands in the display bin of its stop', () => {
  const n = 4096
  const counts = new Array<number>(n).fill(0)
  // A bin just at reference white (1.0 of a 4.0 range).
  counts[n / 4] = 100
  const bins = stopsBins(counts, 4, 100)
  const at = bins.findIndex((c) => c > 0)
  assert.equal(at, Math.floor(stopsX(1, 4) * 100))
})

// ── Resolve's scopes, binned from the preview ────────────────────────────────

const solid = (
  w: number,
  h: number,
  rgb: [number, number, number],
  float = false
): { width: number; height: number; data: Float32Array | Uint8ClampedArray } => {
  const data = float ? new Float32Array(w * h * 4) : new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([...rgb, float ? 1 : 255], i * 4)
  return { width: w, height: h, data }
}

test('a mid grey picture is one line across the waveform and the parade', async () => {
  const { binScopes } = await import('../src/shared/scopes')
  const b = binScopes(solid(64, 32, [128, 128, 128]), { columns: 16, levels: 256 })
  assert.equal(b.top, 1)
  const row = Math.round((128 / 255) * 255)
  let onRow = 0
  for (let c = 0; c < 16; c++) onRow += b.waveform![row * 16 + c]
  assert.equal(onRow, b.pixels)
  for (let k = 0; k < 3; k++) {
    let n = 0
    for (let c = 0; c < 16; c++) n += b.parade![k * 16 * 256 + row * 16 + c]
    assert.equal(n, b.pixels)
  }
})

/** Where a Cb/Cr pair lands among `size²` bins drawn Cr up (the engine's cells, rows turned over). */
const vectorCell = (cb: number, cr: number, size: number): number =>
  (size - 1 - Math.min(size - 1, Math.floor((cr + 0.5) * size))) * size +
  Math.min(size - 1, Math.floor((cb + 0.5) * size))

test('75% red lands on the vectorscope’s R target; grey at the centre', async () => {
  const { binScopes, vectorTargets } = await import('../src/shared/scopes')
  const size = 256
  const red = binScopes(solid(8, 8, [0.75, 0, 0], true), { vector: size, want: ['vectorscope'] })
  const t = vectorTargets().find((x) => x.name === 'R')!
  assert.equal(red.vector![vectorCell(t.cb, t.cr, size)], red.pixels)
  const grey = binScopes(solid(8, 8, [0.4, 0.4, 0.4], true), {
    vector: size,
    want: ['vectorscope']
  })
  assert.equal(grey.vector![vectorCell(0, 0, size)], grey.pixels)
})

test('the scopes weigh luma and Cb/Cr by BT.709, as the engine does', async () => {
  const { cbcr, vectorTargets, LUMA_709 } = await import('../src/shared/scopes')
  assert.deepEqual([...LUMA_709], [0.2126, 0.7152, 0.0722])
  // An encoded primary reaches 0.5 on its own axis; 75% of it, 0.375.
  const r = vectorTargets().find((x) => x.name === 'R')!
  assert.ok(Math.abs(r.cr - 0.375) < 1e-9 && Math.abs(r.cb + (0.75 * 0.2126) / 1.8556) < 1e-9)
  const b = cbcr(0, 0, 1)
  assert.ok(Math.abs(b.cb - 0.5) < 1e-9)
  assert.ok(Math.abs(cbcr(0.5, 0.5, 0.5).y - 0.5) < 1e-9)
})

test('skin sits near the vectorscope’s skin line', async () => {
  const { cbcr, SKIN_LINE } = await import('../src/shared/scopes')
  for (const [r, g, b] of [
    [224, 172, 140],
    [141, 85, 36],
    [255, 219, 172]
  ]) {
    const c = cbcr(r / 255, g / 255, b / 255)
    const deg = (Math.atan2(c.cr, c.cb) * 180) / Math.PI
    assert.ok(
      Math.abs(deg - (SKIN_LINE * 180) / Math.PI) < 12,
      `${r},${g},${b} at ${deg.toFixed(1)}°`
    )
  }
})

test('D65 white is at u′v′ (0.1978, 0.4683)', async () => {
  const { uvOfLinear } = await import('../src/shared/scopes')
  const uv = uvOfLinear(1, 1, 1)!
  assert.ok(Math.abs(uv.u - 0.1978) < 5e-4 && Math.abs(uv.v - 0.4683) < 5e-4, JSON.stringify(uv))
  assert.equal(uvOfLinear(0, 0, 0), null)
})

test('headroom raises the waveform’s top; the scopes cycle round', async () => {
  const { binScopes, cycleScope, SCOPE_KINDS } = await import('../src/shared/scopes')
  const b = binScopes(solid(8, 8, [1.9, 1.9, 1.9], true), { want: ['waveform'] })
  assert.equal(b.top, 2)
  assert.equal(b.vector, null)
  assert.ok(b.parade, 'the RGB waveform draws the parade')
  assert.equal(cycleScope(SCOPE_KINDS[SCOPE_KINDS.length - 1], 1), SCOPE_KINDS[0])
  assert.equal(cycleScope(SCOPE_KINDS[0], -1), SCOPE_KINDS[SCOPE_KINDS.length - 1])
})

test('saved scope preferences are made whole, unknown values taking their defaults', async () => {
  const { normaliseScopes, DEFAULT_SCOPES, cycleExpanded } = await import('../src/shared/scopes')
  assert.deepEqual(normaliseScopes(undefined), DEFAULT_SCOPES)
  const p = normaliseScopes({
    inline: 'waveform',
    layout: 3,
    slots: ['cie', 'nope'],
    vectorZoom: 2
  })
  assert.equal(p.inline, 'waveform')
  assert.equal(p.layout, DEFAULT_SCOPES.layout)
  assert.deepEqual(p.slots, ['cie', DEFAULT_SCOPES.slots[1], ...DEFAULT_SCOPES.slots.slice(2)])
  assert.equal(p.vectorZoom, 2)
  // The expanded viewer's places also reach the metrics.
  assert.equal(cycleExpanded('cie', 1), 'metrics')
  assert.equal(cycleExpanded('metrics', 1), 'histogram')
})

test('in mask, only the pixels the mask holds are counted', async () => {
  const { binScopes } = await import('../src/shared/scopes')
  const w = 16
  const h = 8
  const px = solid(w, h, [0.5, 0.5, 0.5], true)
  // The left half selected.
  const mask = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) mask[(y * w + x) * 4] = 255
  const all = binScopes(px, { want: ['vectorscope'] })
  const half = binScopes(px, { want: ['vectorscope'], mask })
  assert.equal(half.pixels, all.pixels / 2)
})

test('in mask, a feathered edge counts by how much the mask holds it', async () => {
  const { binScopes } = await import('../src/shared/scopes')
  const px = solid(8, 8, [0.5, 0.5, 0.5], true)
  // Every pixel held at half: each counts half, where it used to count whole or not at all.
  const mask = new Uint8ClampedArray(8 * 8 * 4).fill(0)
  for (let i = 0; i < 64; i++) mask[i * 4] = 51
  const b = binScopes(px, { want: ['waveform'], mask, columns: 8 })
  assert.ok(Math.abs(b.pixels - 64 * 0.2) < 1e-6)
  const sum = b.waveform!.reduce((a, c) => a + c, 0)
  assert.ok(Math.abs(sum - 64 * 0.2) < 1e-4)
})

// ── The engine's scopes of a settled picture (E76) ──────────────────────────

test('the engine is asked for what the charts draw, its waveform never wider than the picture', async () => {
  const { engineScopeSpec, ENGINE_COLUMNS } = await import('../src/shared/scopes')
  const spec = engineScopeSpec(['waveform', 'cie'], 4000)!
  assert.deepEqual(spec.waveform, {
    columns: ENGINE_COLUMNS,
    levels: 256,
    planes: 'LumaAndChannels'
  })
  assert.equal(spec.vectorscope, null)
  // A narrow picture (a tall crop shown small): one column a pixel at most.
  assert.equal(engineScopeSpec(['parade'], 300)!.waveform!.columns, 300)
  assert.equal(engineScopeSpec(['parade'], 300, 2)!.waveform!.columns, 150)
  assert.deepEqual(engineScopeSpec(['vectorscope'], 10)!.vectorscope, {
    size: 256,
    matrix: 'Bt709',
    extent: 0.5
  })
  // The CIE chart and the histogram are not the engine's here.
  assert.equal(engineScopeSpec(['cie', 'histogram'], 4000), null)
})

test('the engine’s grids become the charts’: the vectorscope turned over, the parade side by side', async () => {
  const { engineBins } = await import('../src/shared/scopes')
  const columns = 4
  const levels = 8
  const luma = new Float64Array(columns * levels)
  luma[5 * columns + 2] = 7
  const grey = new Float64Array(columns * levels)
  grey[1 * columns + 0] = 3
  const size = 4
  const counts = new Float64Array(size * size)
  // The engine's row 0 is Cr's bottom: a count there is the chart's last row.
  counts[0 * size + 3] = 9
  const b = engineBins(
    {
      waveform: { columns, levels, luma, channels: [grey] },
      vectorscope: { size, counts, outside: 0 },
      chromaticity: null
    },
    7
  )
  assert.ok(b.exact)
  assert.ok(b.waveform instanceof Float32Array)
  assert.equal(b.waveform![5 * columns + 2], 7)
  // A grey picture's one channel stands for all three.
  for (let k = 0; k < 3; k++) assert.equal(b.parade![k * columns * levels + 1 * columns + 0], 3)
  assert.equal(b.vector![(size - 1) * size + 3], 9)
  assert.equal(b.vector![3], 0)
  assert.equal(b.cie, null)
})

/** The native engine, where it is built (not in CI: these checks skip). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      analyze(r: unknown): Promise<{ scopes: unknown; pixels_measured: number }>
    }
  } catch {
    return null
  }
})()

test(
  'a settled picture’s engine scopes and the drag’s bins put every pixel in the same cell',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { binScopes, engineBins, engineScopeSpec } = await import('../src/shared/scopes')
    const { READ_LIMITS } = await import('../src/shared/limits')
    const { encodePng8 } = await import('../src/main/pngio')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'scopes-'))
    const w = 96
    const h = 40
    const rgba = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      const x = i % w
      const y = Math.floor(i / w)
      rgba.set([(x * 5 + y) % 256, (x * 3 + y * 7) % 256, (y * 11 + x) % 256, 255], i * 4)
    }
    const path = join(dir, 'p.png')
    writeFileSync(path, encodePng8(rgba, w, h))
    try {
      const want = ['waveform', 'vectorscope'] as const
      // As main's `analyzeRequest` states it (main/autowb.ts), with the scopes.
      const stats = (await realEngine!.analyze({
        source: { Path: path },
        input: 'Png',
        raw: null,
        domain: 'Encoded',
        bins: 256,
        percentiles: [50],
        clip_low: 0,
        clip_high: 1,
        hue_bins: 36,
        stride: 1,
        transparent: 'Include',
        threads: 2,
        weights: null,
        noise: false,
        orientation: 'Normal',
        lens: null,
        limits: READ_LIMITS,
        hdr: null,
        gain_map: null,
        phash: false,
        focus: null,
        scopes: engineScopeSpec(want, w)
      })) as { scopes: Parameters<typeof engineBins>[0]; pixels_measured: number }
      const exact = engineBins(stats.scopes, stats.pixels_measured)
      const binned = binScopes(
        { width: w, height: h, data: new Uint8ClampedArray(rgba) },
        { want, columns: exact.columns }
      )
      assert.equal(exact.columns, binned.columns)
      assert.deepEqual([...exact.waveform!], [...binned.waveform!], 'the luma waveform')
      assert.deepEqual([...exact.parade!], [...binned.parade!], 'the parade')
      // Cb/Cr in floats: a value on a cell's edge may round either way.
      let moved = 0
      for (let i = 0; i < exact.vector!.length; i++)
        moved += Math.abs(exact.vector![i] - binned.vector![i])
      assert.ok(moved <= 0.01 * w * h * 2, `${moved} counts in other cells`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)

test(
  'a float picture is measured as linear light: its numbers come from its 8-bit companion',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    // Why render.ts measures a settled SDR picture in float on its companion:
    // the engine reads an F16 output's values as they are, under `Encoded`
    // too. Should it one day encode them, this fails and the workaround goes.
    const { blankRequest } = await import('../src/main/source')
    const { withRequiredFields } = await import('../src/main/engine/required')
    const { encodePng8 } = await import('../src/main/pngio')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const engine = realEngine as unknown as {
      convert(r: unknown): Promise<{ stats: { luma_percentiles: { value: number }[] } }>
    }
    const dir = mkdtempSync(join(tmpdir(), 'floatstats-'))
    const path = join(dir, 'grey.png')
    writeFileSync(path, encodePng8(new Uint8Array(16 * 8 * 4).fill(128), 16, 8))
    const measure = {
      at: 'Output',
      domain: 'Encoded',
      bins: 256,
      percentiles: [50],
      clip_low: 0,
      clip_high: 1,
      hue_bins: 36,
      stride: 1,
      transparent: 'Include',
      noise: false
    }
    const median = async (to: string, depth: string, sample: string): Promise<number> => {
      const r = await engine.convert(
        withRequiredFields('convert', [
          {
            ...blankRequest(path, '', 'Png'),
            sink: 'Bytes',
            pixel: { depth, channels: 4 },
            encode: { Pixels: { sample } },
            metadata: { exif: false, icc: true, xmp: false, iptc: false },
            color: {
              ConvertTo: { to, intent: 'RelativeColorimetric', black_point_compensation: false }
            },
            measure
          }
        ])[0]
      )
      return r.stats.luma_percentiles[0].value
    }
    try {
      const encoded = await median('DisplayP3', 'Eight', 'U8')
      const float = await median('LinearDisplayP3', 'F32', 'F16')
      assert.ok(Math.abs(encoded - 0.5) < 0.01, String(encoded))
      assert.ok(Math.abs(float - 0.214) < 0.01, `linear light: ${float}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
