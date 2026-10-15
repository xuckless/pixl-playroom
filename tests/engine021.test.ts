/**
 * Engine 0.21.0's clean breaks as Playroom sends them: `hold_refines` on
 * every convert (E62), Grain's response and colour grain (E43) and a
 * parametric curve's reach (E19), for what Playroom compiles and for a
 * custom layer an older Playroom saved.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompileContext } from '../src/shared/compile'

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
  'the engine takes 0.21’s required fields as Playroom states them, and an old custom layer once migrated',
  { skip: realEngine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const { blankRequest, displayPolicy } = await import('../src/main/source')
    const { withRequiredFields } = await import('../src/main/engine/required')
    const { encodePng16 } = await import('../src/main/pngio')
    const { compile } = await import('../src/shared/compile')
    const { defaultRecipe, normaliseRecipe } = await import('../src/shared/recipe')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'engine021-'))
    const w = 96
    const h = 64
    const px = new Uint16Array(w * h * 3).map((_, i) => (i * 7919) % 60000)
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
    const request = (grade: unknown): Record<string, unknown> => ({
      ...blankRequest(path, '', 'Png'),
      sink: 'Bytes',
      pixel: { depth: 'Eight', channels: 3 },
      encode: { Pixels: { sample: 'U8' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: displayPolicy({ is_hdr: false } as never, 'DisplayP3'),
      grade,
      threads: 2
    })
    const render = (r: unknown): Promise<{ width: number }> => realEngine!.convert(r)
    try {
      // Grain as compiled: the response and colour grain stated.
      const grained = defaultRecipe(false)
      grained.effects.grainAmount = 40
      const grade = compile(grained, ctx).grade
      await assert.doesNotReject(render(request(grade)), 'compiled grain')
      // A request without hold_refines is refused when read (`missing field`); the host states it.
      const bare = request(grade)
      delete bare.hold_refines
      await assert.rejects(render(bare), (err) =>
        /missing field `hold_refines`/.test(String((err as Error).message))
      )
      await assert.doesNotReject(render(withRequiredFields('convert', [bare])[0]), 'host shim')
      // A custom layer as 0.20 saved it: refused as it is, rendered once migrated.
      const old = {
        name: 'custom',
        enabled: true,
        opacity: 1,
        mask: null,
        blend: { mode: 'Normal', space: 'LinearWorking' },
        stages: [
          {
            space: {
              Encoded: {
                space: 'DisplayP3',
                intent: 'RelativeColorimetric',
                black_point_compensation: false
              }
            },
            ops: [
              {
                ParametricCurve: {
                  shadows: 0.3,
                  darks: 0,
                  lights: 0,
                  highlights: -0.2,
                  splits: { low: 0.25, mid: 0.5, high: 0.75 }
                }
              },
              { Grain: { amount: 0.3, size: 0.002, roughness: 0.5, seed: 7 } }
            ]
          }
        ]
      }
      await assert.rejects(render(request({ layers: [structuredClone(old)] })), (err) =>
        /reach|response|chroma/.test(String((err as Error).message))
      )
      const loaded = normaliseRecipe(
        { version: 5, custom: [{ id: 'c1', name: 'old', enabled: true, layer: old }] },
        false
      )
      await assert.doesNotReject(render(request(compile(loaded, ctx).grade)), 'migrated layer')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
