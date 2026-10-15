/**
 * The Metrics tab's gamut coverage (E76's chromaticity): the shares from
 * the engine's u′v′ density, and its render as the engine takes it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gamutCoverage } from '../src/shared/scopemetrics'
import { PIXLRGB, REFERENCE_GAMUTS, SPECTRAL_LOCUS, WHITE_POINT, inLocus } from '../src/shared/cie'

/** A density with every count in the cell holding `u′v′`. */
function densityAt(
  points: { u: number; v: number; n: number }[],
  size = 256,
  outside = 0
): { size: number; counts: Float64Array; outside: number } {
  const counts = new Float64Array(size * size)
  for (const p of points) {
    const x = Math.min(size - 1, Math.floor((p.u / 0.65) * size))
    const y = Math.min(size - 1, Math.floor((p.v / 0.65) * size))
    counts[y * size + x] += p.n
  }
  return { size, counts, outside }
}

test('a grey photo is held whole by every space', () => {
  const c = gamutCoverage(densityAt([{ ...WHITE_POINT, n: 1000 }]))
  assert.equal(c.pixels, 1000)
  for (const share of [c.srgb, c.p3, c.rec2020, c.pixlrgb]) assert.equal(share, 1)
  assert.equal(c.outside, 0)
})

test('a colour near Rec.2020’s green is outside P3 and sRGB, inside Rec.2020 and PixlRGB', () => {
  const g = REFERENCE_GAMUTS.find((x) => x.id === 'rec2020')!.g
  // A little toward white from the primary, so the cell's centre is inside.
  const p = { u: g.u + (WHITE_POINT.u - g.u) * 0.08, v: g.v + (WHITE_POINT.v - g.v) * 0.08 }
  const c = gamutCoverage(
    densityAt([
      { ...p, n: 30 },
      { ...WHITE_POINT, n: 70 }
    ])
  )
  assert.ok(Math.abs(c.srgb - 0.7) < 1e-9 && Math.abs(c.p3 - 0.7) < 1e-9, JSON.stringify(c))
  assert.equal(c.rec2020, 1)
  assert.equal(c.pixlrgb, 1)
  assert.equal(c.outside, 0)
})

test('a space’s own primaries are held by it, wherever their cell’s centre falls', () => {
  // A clipped picture piles up on its space's corners: a centre-only test
  // put most of a cell there outside the very space that made it.
  for (const id of ['srgb', 'p3', 'rec2020'] as const) {
    const g = REFERENCE_GAMUTS.find((x) => x.id === id)!
    for (const p of [g.r, g.g, g.b]) {
      const c = gamutCoverage(densityAt([{ ...p, n: 10 }]))
      assert.equal(c[id], 1, `${id} at ${JSON.stringify(p)}`)
      assert.equal(c.outside, 0)
    }
  }
  // A cell well past an edge is still outside it.
  const r = REFERENCE_GAMUTS.find((x) => x.id === 'p3')!.r
  assert.equal(gamutCoverage(densityAt([{ ...r, n: 1 }])).srgb, 0)
})

test('light outside the locus, or past the grid, is no real colour', () => {
  assert.ok(inLocus(WHITE_POINT))
  assert.ok(!inLocus({ u: 0.05, v: 0.05 }))
  // The locus's own points lie on its edge; just inside the middle of it is in.
  assert.ok(inLocus({ u: SPECTRAL_LOCUS[16].u + 0.01, v: SPECTRAL_LOCUS[16].v - 0.01 }))
  const c = gamutCoverage(
    densityAt(
      [
        { ...WHITE_POINT, n: 60 },
        { u: 0.05, v: 0.05, n: 20 }
      ],
      256,
      20
    )
  )
  assert.equal(c.pixels, 100)
  assert.ok(Math.abs(c.outside - 0.4) < 1e-9)
  assert.ok(Math.abs(c.srgb - 0.6) < 1e-9)
  // PixlRGB's triangle is the chart's frame: everything on the grid but its own corners.
  assert.ok(c.pixlrgb >= 0.6 && c.pixlrgb <= 0.8)
  assert.ok(PIXLRGB.g.u < 0)
  assert.equal(gamutCoverage({ size: 2, counts: new Float64Array(4), outside: 0 }).srgb, 0)
})

/** The native engine, where it is built (not in CI: this check skips). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{
        stats: {
          scopes: { chromaticity: Parameters<typeof gamutCoverage>[0] | null } | null
        } | null
      }>
    }
  } catch {
    return null
  }
})()

test(
  'the coverage reads the graded float buffer; a photo with no grade is refused by the field main falls back on',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { coverageRequest } = await import('../src/main/proofing')
    const { withRequiredFields } = await import('../src/main/engine/required')
    const { CICP_DISPLAY_P3, encodePng8 } = await import('../src/main/pngio')
    const { compile } = await import('../src/shared/compile')
    const { defaultRecipe } = await import('../src/shared/recipe')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'coverage-'))
    // A Display P3 green past sRGB's on the left half (inside P3), a mid grey on the right.
    const w = 32
    const h = 16
    const rgba = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++)
      rgba.set(i % w < w / 2 ? [40, 250, 40, 255] : [128, 128, 128, 255], i * 4)
    const path = join(dir, 'p3.png')
    writeFileSync(path, encodePng8(rgba, w, h, 1, [CICP_DISPLAY_P3]))
    const info = { is_hdr: false } as never
    const src = { path, input: 'Png' as const }
    // An edit (a little exposure): the coverage reads its float buffer.
    const edited = defaultRecipe(false)
    edited.basic.exposure = 0.1
    const graded = compile(edited, {
      isRaw: false,
      asShot: null,
      sourceOrientation: 'Normal',
      frameWidth: w,
      frameHeight: h,
      scale: 1,
      seed: 7,
      brushPaths: {},
      applyCrop: true
    })
    assert.ok(graded.grade)
    const send = (r: unknown): ReturnType<NonNullable<typeof realEngine>['convert']> =>
      realEngine!.convert(withRequiredFields('convert', [r])[0])
    try {
      const plain = { grade: null, framing: null, lens: null, retouch: null }
      await assert.rejects(send(coverageRequest(src, info, plain, false, 2)), (err) =>
        /field `measure\.at`/.test(String((err as Error).message))
      )
      const cov = await send(coverageRequest(src, info, graded, false, 2))
      const c = gamutCoverage(cov.stats!.scopes!.chromaticity!)
      assert.ok(Math.abs(c.pixels - w * h) < 1, String(c.pixels))
      assert.ok(c.srgb > 0.45 && c.srgb < 0.55, `half the photo in sRGB: ${c.srgb}`)
      assert.ok(c.p3 > 0.99, `all of it in P3: ${c.p3}`)
      assert.equal(c.outside, 0)
      // P3's own primaries, clipped as a picture's are: held by P3 whole.
      const corners = new Uint8Array(w * h * 4)
      const primaries = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255]
      ]
      for (let i = 0; i < w * h; i++) corners.set(primaries[i % 3], i * 4)
      writeFileSync(path, encodePng8(corners, w, h, 1, [CICP_DISPLAY_P3]))
      const full = gamutCoverage(
        (await send(coverageRequest(src, info, graded, false, 2))).stats!.scopes!.chromaticity!
      )
      assert.equal(full.p3, 1, JSON.stringify(full))
      // P3's blue is sRGB's own: a third of the photo.
      assert.ok(full.srgb > 0.3 && full.srgb < 0.37, `sRGB holds the blue alone: ${full.srgb}`)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
