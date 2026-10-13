// E63 (engine 0.19.2): a smoothed Tone with Shadows or Blacks moved paints
// patches of pure white over dark and mid tones, and the colour ops after it
// turn its output into magenta and green blocks. Found by the owner
// 2026-10-12 (Full HDR and exports; a draft, unsmoothed, is clean). The
// stopgap: Tone leaves the Smoothing slider alone (`TONE_SMOOTHING`,
// compile.ts).
//
// The RAW is the owner's, never in the repository: name a folder holding
// IMG_3198.CR2 in PIXL_E53_RAWS to run it (the folder tests/e53.test.ts reads).
//
// - Today's compile (Tone unsmoothed) renders clean.
// - Tone smoothed still breaks: when that check fails, E63 is fixed and the
//   stopgap can go.
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

/** The grade as it would be with Tone on the Smoothing slider (at 100). */
function smoothTone(grade: Grade): Grade {
  const g = structuredClone(grade)
  for (const l of g.layers)
    for (const s of l.stages)
      for (const o of s.ops)
        if ('Tone' in o) o.Tone.smoothing = { radius: SMOOTHING_RADIUS, strength: 1 }
  return g
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
  const graded = (r: Recipe): { grade: Grade; framing: unknown } => {
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
      hdr: false
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
  const untouched = graded(defaultRecipe(true))
  const plain = await render(untouched.grade, untouched.framing)
  let stillBroken = 0
  for (const [name, set] of Object.entries(EDITS)) {
    const r = defaultRecipe(true)
    set(r)
    const { grade, framing } = graded(r)
    const now = broken(plain, await render(grade, framing))
    assert.ok(now.white < 50, `${name}: ${now.white} whitened pixels`)
    assert.ok(now.garish < 500, `${name}: ${now.garish} garish pixels`)
    stillBroken += broken(plain, await render(smoothTone(grade), framing)).white
  }
  // Measured on 0.19.2: 798, 19 019 and 3834. Clean here means E63 is fixed:
  // turn TONE_SMOOTHING on and give the tip its "Highlights and Shadows" back.
  assert.ok(stillBroken > 1000, `Tone smoothed left only ${stillBroken} whitened pixels`)
})
