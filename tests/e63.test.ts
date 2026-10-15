// E63 (engine 0.19.2): a smoothed Tone with Shadows or Blacks moved paints
// patches of pure white over dark and mid tones, and the colour ops after it
// turn its output into magenta and green blocks. Found by the owner
// 2026-10-12 (Full HDR and exports; a draft, unsmoothed, is clean). Engine
// 0.21 fixed it (smoothing near zero takes the change whole as remainder,
// and the smoothed gain is held in its footprint's range), and Tone takes
// the Smoothing slider again.
//
// The RAW is the owner's, never in the repository: name a folder holding
// IMG_3198.CR2 in PIXL_E53_RAWS to run it (the folder tests/e53.test.ts reads).
//
// - Today's compile (Tone smoothed) renders clean, as the draft (unsmoothed)
//   does, in SDR and in Full HDR (blue patches were Full HDR's form of it).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile, SMOOTHING_RADIUS } from '../src/shared/compile'
import { defaultRecipe, type Recipe } from '../src/shared/recipe'
import type { Grade } from '../src/shared/engine-types'

const RAWS = process.env['PIXL_E53_RAWS']
const skip = !RAWS ? 'set PIXL_E53_RAWS to a folder holding IMG_3198.CR2' : false

/** Proxy size, as Playroom's develop view grades. */
const PROXY_EDGE = 2443

interface Engine {
  probe(path: string): Promise<{
    as_shot_white: { temperature_kelvin: number; tint: number; x: number; y: number } | null
    camera_colour: { as_shot_white: unknown; pixl_versions: number[] } | null
  }>
  convert(req: Record<string, unknown>): Promise<{ width: number; height: number; output: Buffer }>
}

const EDITS: Record<string, (r: Recipe) => void> = {
  'Shadows −100': (r) => {
    r.basic.shadows = -100
  },
  'Blacks −100': (r) => {
    r.basic.blacks = -100
  },
  'Shadows −50, Vibrance 100, Saturation +100': (r) => {
    r.basic.shadows = -50
    r.presence.vibrance = 100
    r.presence.saturation = 100
  }
}

/** Whether Tone is on the Smoothing slider in a grade (as a new photo's, at 100). */
const toneSmoothed = (grade: Grade): boolean =>
  grade.layers.some((l) =>
    l.stages.some((s) =>
      s.ops.some((o) => 'Tone' in o && o.Tone.smoothing?.radius === SMOOTHING_RADIUS)
    )
  )

/** The grade with Tone off the Smoothing slider, every other op as it is. */
function toneUnsmoothed(grade: Grade): Grade {
  const g = structuredClone(grade)
  for (const l of g.layers)
    for (const s of l.stages) for (const o of s.ops) if ('Tone' in o) o.Tone.smoothing = null
  return g
}

/**
 * Full HDR's form of it, on extended linear Display P3 floats: what the edit
 * (which only darkens) took from dark to at or past white, and blue patches
 * the same grade with Tone unsmoothed (`unsmoothed`) does not have: a
 * photo's own sky, saturated by the edit, is blue either way.
 */
function brokenHdr(
  plain: Float32Array,
  unsmoothed: Float32Array,
  edit: Float32Array
): { white: number; blue: number } {
  const isBlue = (a: Float32Array, i: number): boolean =>
    a[i + 2] > 0.5 && a[i + 2] > 3 * Math.max(a[i], a[i + 1], 0.01)
  let white = 0
  let blue = 0
  for (let i = 0; i < edit.length; i += 3) {
    const [R, G, B] = [edit[i], edit[i + 1], edit[i + 2]]
    const was = 0.2289746 * plain[i] + 0.6917385 * plain[i + 1] + 0.0792869 * plain[i + 2]
    if (was < 0.2 && R >= 0.98 && G >= 0.98 && B >= 0.98) white++
    if (isBlue(edit, i) && !isBlue(unsmoothed, i)) blue++
  }
  return { white, blue }
}

/**
 * What E63 paints: pixels the plain photo has dark that the edit (which only
 * darkens) has at white, and E53's saturated magenta and green.
 */
function broken(plain: Buffer, edit: Buffer): { white: number; garish: number } {
  let white = 0
  let garish = 0
  for (let i = 0; i < edit.length; i += 3) {
    const [R, G, B] = [edit[i], edit[i + 1], edit[i + 2]]
    const was = 0.2126 * plain[i] + 0.7152 * plain[i + 1] + 0.0722 * plain[i + 2]
    if (was < 128 && R >= 250 && G >= 250 && B >= 250) white++
    if ((R > 220 && B > 220 && G < 60) || (G > 220 && R < 120 && B < 60)) garish++
  }
  return { white, garish }
}

test('IMG_3198: Shadows and Blacks render without E63’s white patches', { skip }, async (t) => {
  const req = createRequire(import.meta.url)
  const engine = req('@xuckless/pixl-engine') as Engine
  const { blankRequest, displayPolicy, rawProxyMaster } = await import('../src/main/source')
  const raw = join(RAWS!, 'IMG_3198.CR2')
  assert.ok(existsSync(raw), `${raw} is missing`)
  const dir = mkdtempSync(join(tmpdir(), 'e63-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const info = await engine.probe(raw)
  const pixl = info.camera_colour?.pixl_versions.includes(1) === true
  const proxy = join(dir, 'proxy.tiff')
  // The proxy as Playroom makes it since engine 0.18: Scene, F32, at its size.
  await engine.convert({
    ...blankRequest(raw, proxy, 'Raw'),
    raw: rawProxyMaster(pixl ? 'pixl:1' : 'container'),
    resize: { Scale: { factor: PROXY_EDGE / 3000 } },
    resampler: 'Lanczos3',
    linear_resample: true,
    pixel: { depth: 'F32', channels: 3 },
    encode: { Tiff: { compression: 'None' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    threads: 6
  })
  const asShot = (pixl ? info.camera_colour?.as_shot_white : info.as_shot_white) as {
    temperature_kelvin: number
    tint: number
    x: number
    y: number
  }
  const graded = (r: Recipe, hdr = false): { grade: Grade; framing: unknown } => {
    const c = compile(r, {
      isRaw: true,
      asShot,
      sourceOrientation: 'Normal',
      frameWidth: 6000,
      frameHeight: 4000,
      scale: PROXY_EDGE / 6000,
      seed: 1,
      brushPaths: {},
      applyCrop: true,
      hdr
    })
    return { grade: c.grade!, framing: c.framing }
  }
  const render = async (grade: Grade, framing: unknown): Promise<Buffer> =>
    (
      await engine.convert({
        ...blankRequest(proxy, '', 'Tiff'),
        sink: 'Bytes',
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Pixels: { sample: 'U8' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy({ is_hdr: false } as never, 'DisplayP3'),
        grade,
        framing,
        threads: 6
      })
    ).output
  /** Full HDR's settled picture: the master to a 200 / 1600 nit display, floats. */
  const renderHdr = async (grade: Grade, framing: unknown): Promise<Float32Array> => {
    const o = await engine.convert({
      ...blankRequest(proxy, '', 'Tiff'),
      sink: 'Bytes',
      pixel: { depth: 'F32', channels: 3 },
      encode: { Pixels: { sample: 'F32' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: {
        Master: {
          headroom: true,
          peak: 'Measured',
          ceiling: { Display: { white_nits: 200, peak_nits: 1600 } },
          reach: 'Measured',
          look: 'Colorimetric',
          float: 'ExtendedLinearDisplayP3',
          companion: null
        }
      },
      grade,
      framing,
      threads: 6
    })
    const b = o.output
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4)
  }
  const untouched = graded(defaultRecipe(true))
  const plain = await render(untouched.grade, untouched.framing)
  const untouchedHdr = graded(defaultRecipe(true), true)
  const plainHdr = await renderHdr(untouchedHdr.grade, untouchedHdr.framing)
  for (const [name, set] of Object.entries(EDITS)) {
    const r = defaultRecipe(true)
    set(r)
    const { grade, framing } = graded(r)
    assert.ok(toneSmoothed(grade), `${name}: Tone is smoothed`)
    // Measured on 0.19.2, smoothed: 798, 19 019 and 3834 whitened pixels.
    const now = broken(plain, await render(grade, framing))
    assert.ok(now.white < 50, `${name}: ${now.white} whitened pixels`)
    assert.ok(now.garish < 500, `${name}: ${now.garish} garish pixels`)
    const hdr = graded(r, true)
    const inHdr = brokenHdr(
      plainHdr,
      await renderHdr(toneUnsmoothed(hdr.grade), hdr.framing),
      await renderHdr(hdr.grade, hdr.framing)
    )
    assert.ok(inHdr.white < 50, `${name}, Full HDR: ${inHdr.white} whitened pixels`)
    assert.ok(inHdr.blue < 500, `${name}, Full HDR: ${inHdr.blue} blue pixels`)
  }
})
