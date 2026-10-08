// E53 (engine 0.18): adjustment smoothing breaks into red, blue, magenta and
// green blotches. Two of the owner's edits that showed it, as fixtures
// (IMG_2347: a Subject mask at +2.17 EV over a smoothed Color Mixer;
// IMG_3198: a heavy saturation edit, blocks on smoothing's coarse grid). The
// RAWs and IMG_2347's mask planes are the owner's, never in the repository:
// name a folder holding IMG_2347.CR2, IMG_3198.CR2 and the planes
// (IMG_2347.<component id>.png) in PIXL_E53_RAWS to run it.
//
// - Today's compile (the Color Mixer unsmoothed, the stopgap) renders clean.
// - The engine still breaks with the Color Mixer smoothed: when this second
//   check starts failing, E53 is fixed upstream and the stopgap can go.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '../src/shared/compile'
import { normaliseRecipe, type Recipe } from '../src/shared/recipe'
import type { Grade } from '../src/shared/engine-types'

const RAWS = process.env['PIXL_E53_RAWS']
const skip = !RAWS ? 'set PIXL_E53_RAWS to a folder holding the two CR2s' : false

/** Proxy size, as Playroom's develop view grades. */
const PROXY_EDGE = 2443

interface Engine {
  probe(path: string): Promise<{
    as_shot_white: { temperature_kelvin: number; tint: number; x: number; y: number } | null
    camera_colour: { as_shot_white: unknown; pixl_versions: number[] } | null
  }>
  convert(req: Record<string, unknown>): Promise<{ width: number; height: number; output: Buffer }>
}

async function setUp(name: string): Promise<{
  engine: Engine
  proxy: string
  recipe: Recipe
  brushPaths: Record<string, string>
  asShot: { temperature_kelvin: number; tint: number; x: number; y: number }
}> {
  const req = createRequire(import.meta.url)
  const engine = req('@xuckless/pixl-engine') as Engine
  const { blankRequest, rawProxyMaster } = await import('../src/main/source')
  const raw = join(RAWS!, `${name}.CR2`)
  assert.ok(existsSync(raw), `${raw} is missing`)
  const dir = mkdtempSync(join(tmpdir(), 'e53-'))
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
  const saved = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/e53', `${name}.json`), 'utf8')
  )
  const recipe = normaliseRecipe(saved, true)
  // The mask planes stay with the RAWs (they trace the owner's photo; no
  // image of a person goes in the repository): `<name>.<component id>.png`.
  const brushPaths: Record<string, string> = {}
  for (const l of recipe.layers)
    for (const c of l.components)
      if (c.kind === 'brush') {
        brushPaths[c.id] = join(RAWS!, `${name}.${c.id}.png`)
        assert.ok(existsSync(brushPaths[c.id]), `${brushPaths[c.id]} is missing`)
      }
  const asShot = (pixl ? info.camera_colour?.as_shot_white : info.as_shot_white) as {
    temperature_kelvin: number
    tint: number
    x: number
    y: number
  }
  return { engine, proxy, recipe, brushPaths, asShot }
}

/** Saturated magenta, green, pure red or blue pixels: what E53 paints. */
async function blotches(
  engine: Engine,
  proxy: string,
  grade: Grade | null,
  framing: unknown
): Promise<number> {
  const { blankRequest, displayPolicy } = await import('../src/main/source')
  const r = await engine.convert({
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
  const b = r.output
  let n = 0
  for (let i = 0; i < b.length; i += 3) {
    const [R, G, B] = [b[i], b[i + 1], b[i + 2]]
    const magenta = R > 220 && B > 220 && G < 60
    const green = G > 220 && R < 120 && B < 60
    const blue = B > 200 && R < 60 && G < 80
    if (magenta || green || blue) n++
  }
  return n
}

function smoothHsl(grade: Grade): Grade {
  const g = structuredClone(grade)
  for (const l of g.layers)
    for (const s of l.stages)
      for (const o of s.ops)
        if ('HslBands' in o) o.HslBands.smoothing = { radius: 0.02, strength: 1 }
  return g
}

for (const name of ['IMG_2347', 'IMG_3198']) {
  test(`${name}: today's compile renders without E53's blotches`, { skip }, async () => {
    const { engine, proxy, recipe, brushPaths, asShot } = await setUp(name)
    const c = compile(recipe, {
      isRaw: true,
      asShot,
      sourceOrientation: 'Normal',
      frameWidth: 6000,
      frameHeight: 4000,
      scale: PROXY_EDGE / 6000,
      seed: 1,
      brushPaths,
      applyCrop: true,
      hdr: false
    })
    const n = await blotches(engine, proxy, c.grade, c.framing)
    assert.ok(n < 500, `${n} blotched pixels`)
    // The engine still breaks with the Color Mixer smoothed (E53 open), on
    // IMG_3198 even past the look stage's floor (IMG_2347's floor alone
    // clears): when this fails, E53 is fixed and compile.ts can smooth
    // HslBands again.
    if (name === 'IMG_3198') {
      const broken = await blotches(engine, proxy, smoothHsl(c.grade!), c.framing)
      assert.ok(broken > 5 * Math.max(100, n), `E53 may be fixed: ${broken} with HSL smoothed`)
    }
  })
}
