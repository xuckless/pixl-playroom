/**
 * Engine 0.21.0's colour ops as Playroom compiles them, rendered: the region
 * curve (E19), Hue vs Lum and Sat vs Sat (E71, E72), Temp and Tint as a gain
 * balance (E75) at every corner a mask's Amount reaches, Lum Mix (E78), and
 * the Log wheels in their PixlLog stage (E73, E74), in a mask and on a
 * black-and-white photo too. Each is accepted, and changes the picture.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompileContext } from '../src/shared/compile'
import type { Recipe } from '../src/shared/recipe'

/** The native engine, where it is built (not in CI: this check skips). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown): Promise<{ output: Uint8Array; width: number; height: number }>
    }
  } catch {
    return null
  }
})()

test(
  'the engine renders Playroom’s 0.21 colour ops as compiled, every Temp and Tint corner included',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { blankRequest, displayPolicy } = await import('../src/main/source')
    const { encodePng16 } = await import('../src/main/pngio')
    const { compile } = await import('../src/shared/compile')
    const { defaultRecipe, newLocalLayer, normaliseRecipe } = await import('../src/shared/recipe')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'colour021-'))
    const w = 96
    const h = 64
    // Every hue at every brightness, and a grey ramp along the bottom.
    const px = new Uint16Array(w * h * 3)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3
        const v = (x / (w - 1)) * 65535
        if (y >= h - 8) px.fill(Math.round(v), i, i + 3)
        else {
          const hue = (y / (h - 8)) * 6
          const f = (n: number): number => {
            const k = (n + hue) % 6
            return 1 - Math.max(0, Math.min(k, 4 - k, 1)) * 0.8
          }
          px[i] = Math.round(f(5) * v)
          px[i + 1] = Math.round(f(3) * v)
          px[i + 2] = Math.round(f(1) * v)
        }
      }
    const path = join(dir, 'in.png')
    writeFileSync(path, encodePng16(px, w, h, 3))
    const ctx: CompileContext = {
      isRaw: false,
      asShot: null,
      sourceOrientation: 'Normal',
      frameWidth: w,
      frameHeight: h,
      scale: 1,
      seed: 7,
      brushPaths: {},
      applyCrop: true
    }
    const render = async (r: Recipe): Promise<Uint8Array> => {
      const c = compile(normaliseRecipe(r, false), ctx)
      const o = await realEngine!.convert({
        ...blankRequest(path, '', 'Png'),
        sink: 'Bytes',
        pixel: { depth: 'Eight', channels: 3 },
        encode: { Pixels: { sample: 'U8' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: displayPolicy({ is_hdr: false } as never, 'DisplayP3'),
        grade: c.grade,
        framing: c.framing,
        threads: 2,
        grade_device: 'Cpu',
        hold_refines: false
      })
      return o.output
    }
    const plain = await render(defaultRecipe(false))
    const moved = (a: Uint8Array): number => a.reduce((n, v, i) => n + Math.abs(v - plain[i]), 0)
    const edits: Record<string, (r: Recipe) => void> = {
      'region sliders, opposite and strong': (r) => {
        r.toneCurve.lights = -100
        r.toneCurve.highlights = 100
        r.toneCurve.shadows = 60
      },
      'Hue vs Lum and Sat vs Sat': (r) => {
        r.curvesVs.hueLum = [
          { x: 0.6, y: 0.1 },
          { x: 0.1, y: 0.9 }
        ]
        r.curvesVs.satSat = [
          { x: 0.2, y: 0.7 },
          { x: 0.9, y: 0.3 }
        ]
      },
      'Lum Mix with the Y rings': (r) => {
        r.primaries.lumMix = 70
        r.primaries.lift.y = 0.08
        r.primaries.gamma = { y: -0.2, r: 0.05, g: 0, b: 0 }
        r.primaries.contrast = 1.2
      },
      'Log wheels': (r) => {
        r.logWheels.shadow = { y: 0, r: 0, g: 0, b: 0.03 }
        r.logWheels.highlight = { y: 0.02, r: 0.03, g: 0, b: 0 }
        r.logWheels.low = 0.5
        r.logWheels.high = 0.5
      },
      'Log wheels on a black-and-white photo with a mask': (r) => {
        r.treatment = 'bw'
        r.logWheels.midtone = { y: 0, r: 0.02, g: 0, b: -0.02 }
        const l = newLocalLayer('Top')
        l.components = [
          {
            id: 'c1',
            kind: 'linear',
            mode: 'add',
            opacity: 100,
            invert: false,
            start: { x: 0.5, y: 0 },
            end: { x: 0.5, y: 0.5 },
            width: w,
            height: h
          } as never
        ]
        l.settings.logWheels.offset = { y: 0.03, r: 0, g: 0, b: 0 }
        r.layers = [l]
      }
    }
    try {
      for (const [name, set] of Object.entries(edits)) {
        const r = defaultRecipe(false)
        set(r)
        assert.ok(moved(await render(r)) > 0, `${name} changed nothing`)
      }
      // Temp and Tint at a mask's Amount of 200, each corner: never refused.
      for (const temp of [-200, 0, 200])
        for (const tint of [-200, 0, 200]) {
          if (temp === 0 && tint === 0) continue
          const r = defaultRecipe(false)
          const l = newLocalLayer('All')
          l.components = [
            {
              id: 'c1',
              kind: 'linear',
              mode: 'add',
              opacity: 100,
              invert: false,
              start: { x: 0.5, y: 0 },
              end: { x: 0.5, y: 0.01 },
              width: w,
              height: h
            } as never
          ]
          l.settings.primaries.temp = temp / 2
          l.settings.primaries.tint = tint / 2
          l.amount = 200
          r.layers = [l]
          await assert.doesNotReject(render(r), `Temp ${temp}, Tint ${tint}`)
        }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
