// Held refine planes on the 1:1 view (engine 0.21.0, E62), as render.ts
// `region` uses them: the first tile over a mask refined across the whole
// frame renders the whole frame anyway, so it asks to hold its refines
// (`hold_refines`, no `held`) and keeps them; every later tile reads them,
// its reach the shift's, and is that render's pixels, cut; a mask changed
// since is refused by `held`, which the tile reads as "make them again".
// Measured on an owner's 24 MP master (2026-10-14): 3.7 s for the first
// tile, 0.3–0.4 s a pan after it, 0 samples apart.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CompileContext } from '../src/shared/compile'

const engine = await (async () => {
  try {
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown, o?: unknown): Promise<{ held?: { fields: string[]; close(): void } }>
      regionReach(r: unknown, o?: unknown): { pixels: number; measured: string[] }
    }
  } catch {
    return null
  }
})()

test(
  'a tile that renders the whole frame keeps its refines; later tiles read them, exactly',
  { skip: engine === null ? 'the engine is not built for this platform' : false },
  async () => {
    const e = engine!
    const { blankRequest } = await import('../src/main/source')
    const { compile } = await import('../src/shared/compile')
    const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
    const { encodePng16, pngSamples16 } = await import('../src/main/pngio')
    const { dragVerdict } = await import('../src/shared/gpudrag')
    const W = 600
    const H = 400
    // Two flat greys with an edge between them, for Edge snap to find.
    const px = new Uint16Array(W * H * 3)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        px.fill(x < 260 ? 12000 : 40000, (y * W + x) * 3, (y * W + x) * 3 + 3)
    const dir = mkdtempSync(join(tmpdir(), 'heldrefine-'))
    const src = join(dir, 'frame.png')
    writeFileSync(src, encodePng16(px, W, H, 3))
    const recipe = defaultRecipe(false)
    const layer = newLocalLayer('Left')
    const shape = {
      id: 'p',
      kind: 'polygon',
      mode: 'Add',
      opacity: 100,
      invert: false,
      feather: 10,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.48, y: 0.1 },
        { x: 0.48, y: 0.9 },
        { x: 0.1, y: 0.9 }
      ],
      refine: { on: true, radius: 0.6, method: 'edgeSnap' }
    }
    layer.components = [shape as never]
    ;(layer.settings as Record<string, unknown>)['exposure'] = 1
    recipe.layers = [layer]
    const ctx: CompileContext = {
      isRaw: false,
      asShot: null,
      sourceOrientation: 'Normal',
      frameWidth: W,
      frameHeight: H,
      scale: 1,
      seed: 7,
      brushPaths: {},
      applyCrop: true
    }
    const c = compile(recipe, ctx)
    const reach = (held?: unknown): { pixels: number; measured: string[] } =>
      e.regionReach(
        {
          grade: c.grade,
          sdr_grade: null,
          frame_width: W,
          frame_height: H,
          output_width: W,
          output_height: H
        },
        held ? { held } : undefined
      )
    // Without them, nothing short of the whole frame covers the refine.
    assert.ok(reach().pixels >= Math.max(W, H))
    assert.ok(reach().measured.some((m) => m.includes('.refine')))
    const tile = (
      out: string,
      margin: number,
      hold: boolean,
      held?: unknown
    ): Promise<{ held?: { fields: string[]; close(): void } }> =>
      e.convert(
        {
          ...blankRequest(src, out, 'Png'),
          pixel: { depth: 'Sixteen', channels: 3 },
          grade: c.grade,
          region: { x: 200, y: 120, width: 128, height: 96, margin },
          hold_refines: hold
        },
        held ? { held } : undefined
      )
    const whole = join(dir, 'whole.png')
    const first = await tile(whole, Math.max(W, H), true)
    const held = first.held!
    assert.ok(
      held.fields.some((f) => f.endsWith('.refine')),
      held.fields.join(', ')
    )
    // With them: a finite reach, and the tile is the whole render's, cut.
    const r = reach(held)
    assert.ok(r.pixels < Math.max(W, H))
    assert.ok(!r.measured.some((m) => m.includes('.refine')))
    const cut = join(dir, 'held.png')
    await tile(cut, Math.max(64, Math.ceil(r.pixels)), false, held)
    const a = pngSamples16(readFileSync(whole))
    const b = pngSamples16(readFileSync(cut))
    assert.deepEqual(Buffer.from(a.data.buffer), Buffer.from(b.data.buffer))
    // A mask changed since: refused by `held`, which a tile reads as "let them go".
    layer.components = [{ ...shape, feather: 30 } as never]
    const changed = compile(recipe, ctx)
    const refused = await e
      .convert(
        {
          ...blankRequest(src, join(dir, 'x.png'), 'Png'),
          grade: changed.grade,
          region: { x: 0, y: 0, width: 64, height: 64, margin: 64 },
          hold_refines: false
        },
        { held }
      )
      .then(
        () => null,
        (err: { code?: string; detail?: { InvalidRequest?: { field?: string } } }) => err
      )
    assert.ok(refused, 'the changed mask is refused')
    assert.equal(
      dragVerdict({ code: refused!.code, field: refused!.detail?.InvalidRequest?.field }),
      'held'
    )
    held.close()
  }
)
