/**
 * Engine 0.21.0's masks as Playroom sends them: the overlay from the picture's
 * own render (E38), a mask's plane under the picture's colour (E39), a
 * qualifier's key where it sits (E77). Against the real engine where it is
 * built (not in CI: these skip).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CompileContext } from '../src/shared/compile'

interface Plane {
  width: number
  height: number
  data: Uint8Array
}
interface Report {
  width: number
  height: number
  output: Uint8Array | null
  inspected: string | null
  beside?: (Plane & { inspected: string }) | null
}

/** The native engine, where it is built. */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    return createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown, o?: unknown): Promise<Report>
      prepareRaster?(r: unknown): Promise<{ width: number; height: number; close(): void }>
    }
  } catch {
    return null
  }
})()

const skip = realEngine === null ? 'the engine is not built for this platform' : false

/** A small picture with every tone in it, and what renders it. */
async function fixture(): Promise<{
  dir: string
  path: string
  ctx: CompileContext
  picture(grade: unknown, extra?: Record<string, unknown>): Record<string, unknown>
  plane(grade: unknown, inspect: unknown, extra?: Record<string, unknown>): Record<string, unknown>
  /** The plane the last `plane` render wrote. */
  read(): Plane
  done(): void
}> {
  const { blankRequest, displayPolicy } = await import('../src/main/source')
  const { encodePng16, grey8 } = await import('../src/main/pngio')
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = mkdtempSync(join(tmpdir(), 'masks021-'))
  const w = 96
  const h = 64
  const px = new Uint16Array(w * h * 3).map((_, i) => (i * 7919) % 60000)
  const path = join(dir, 'in.png')
  writeFileSync(path, encodePng16(px, w, h, 3))
  const color = displayPolicy({ is_hdr: false } as never, 'DisplayP3')
  return {
    dir,
    path,
    ctx: {
      isRaw: false,
      asShot: null,
      sourceOrientation: 'Normal',
      frameWidth: w,
      frameHeight: h,
      scale: 1,
      seed: 7,
      brushPaths: {},
      applyCrop: true
    },
    picture: (grade, extra = {}) => ({
      ...blankRequest(path, '', 'Png'),
      sink: 'Bytes',
      pixel: { depth: 'Eight', channels: 4 },
      encode: { Pixels: { sample: 'U8' } },
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color,
      grade,
      threads: 2,
      ...extra
    }),
    // A plane is a grey PNG with no metadata (as renderMask writes it).
    plane: (grade, inspect, extra = {}) => ({
      ...blankRequest(path, join(dir, 'plane.png'), 'Png'),
      pixel: { depth: 'Eight', channels: 1 },
      color,
      grade,
      inspect,
      threads: 2,
      ...extra
    }),
    read: () => grey8(readFileSync(join(dir, 'plane.png'))),
    done: () => rmSync(dir, { recursive: true, force: true })
  }
}

test(
  'the picture carries its mask’s plane and its qualifier’s key, as the planes alone are',
  { skip },
  async () => {
    const e = realEngine!
    const f = await fixture()
    const { compile, maskProbe, probeInspect } = await import('../src/shared/compile')
    const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
    const { qualifierFromSample, qualifierLayerId } = await import('../src/shared/resolve')
    try {
      const r = defaultRecipe(false)
      r.basic.exposure = 0.3
      r.effects.grainAmount = 40
      r.qualifiers = [qualifierFromSample('q1', { hue: 30, saturation: 0.4, luminance: 0.5 })]
      r.qualifiers[0].sat = 80
      const l = newLocalLayer('Mid')
      l.components = [
        {
          id: 'r1',
          kind: 'range',
          mode: 'add',
          opacity: 100,
          invert: false,
          feather: 0,
          hue: null,
          saturation: null,
          luma: { centre: 0.5, width: 0.4, softness: 0.1 },
          smoothness: 20
        } as never
      ]
      l.settings.basic.exposure = 1
      const mq = qualifierFromSample('mq', { hue: 200, saturation: 0.3, luminance: 0.4 })
      l.settings.qualifiers = [mq]
      r.layers = [l]
      const c = compile(r, f.ctx)
      for (const id of [l.id, qualifierLayerId('q1'), qualifierLayerId('mq')]) {
        const probe = maskProbe(c, id)
        assert.ok(probe, id)
        // The picture with the plane beside it is the picture alone (E38)…
        const alone = await e.convert(f.picture(c.grade))
        const both = await e.convert(
          f.picture(c.grade, { inspect: { Beside: { mask: probe, depth: 'Eight' } } })
        )
        assert.deepEqual(both.output, alone.output, `${id}: the picture as it is`)
        assert.equal(both.inspected, null)
        // …and the plane is the standalone inspection's, byte for byte.
        await e.convert(f.plane(c.grade, probeInspect(probe!)))
        const plane = f.read()
        assert.ok(both.beside, id)
        assert.equal(both.beside!.width, plane.width)
        assert.equal(both.beside!.height, plane.height)
        assert.deepEqual(new Uint8Array(both.beside!.data), plane.data, `${id}: the plane as alone`)
      }
    } finally {
      f.done()
    }
  }
)

test(
  'a mask’s plane renders under the picture’s colour (E39), Full HDR’s master without its companion',
  { skip },
  async () => {
    const e = realEngine!
    const f = await fixture()
    const { compile, maskProbe, probeInspect } = await import('../src/shared/compile')
    const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
    try {
      const r = defaultRecipe(false)
      const l = newLocalLayer('Mid')
      l.components = [
        {
          id: 'r1',
          kind: 'range',
          mode: 'add',
          opacity: 100,
          invert: false,
          feather: 0,
          hue: null,
          saturation: null,
          luma: { centre: 0.5, width: 0.4, softness: 0.1 },
          smoothness: 0
        } as never
      ]
      l.settings.basic.exposure = 1
      r.layers = [l]
      const c = compile(r, f.ctx)
      const inspect = probeInspect(maskProbe(c, l.id)!)
      const master = {
        Master: {
          headroom: true,
          peak: 'Measured',
          ceiling: { Display: { white_nits: 203, peak_nits: 812 } },
          reach: 'Measured',
          look: 'Colorimetric',
          float: 'ExtendedLinearDisplayP3',
          companion: null
        }
      }
      const p = await e.convert(f.plane(c.grade, inspect))
      assert.equal(p.inspected, `coverage of grade.layers[${c.layerIndex[l.id]}].mask`)
      const m = await e.convert(f.plane(c.grade, inspect, { color: master, gain_map: null }))
      assert.equal(f.read().data.length, m.width * m.height)
    } finally {
      f.done()
    }
  }
)

test(
  'the engine paints strokes as Playroom draws them; an eraser takes from its brush alone',
  { skip },
  async () => {
    const e = realEngine!
    const f = await fixture()
    const { compile } = await import('../src/shared/compile')
    const { paintStrokes } = await import('../src/shared/brush')
    const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
    try {
      const strokes = [
        { id: 's1', dabs: [0.2, 0.3, 0.12, 1, 0.7, 0.6, 0.15, 0.6], softness: 0.4, flow: 0.9 },
        { id: 's2', dabs: [0.45, 0.45, 0.08, 1], softness: 0, flow: 1, erase: true as const },
        { id: 's3', dabs: [0.8, 0.2, 0.1, 1, 0.9, 0.8, 0.05, 1], softness: 0.2, flow: 0.5 }
      ]
      const brush = {
        id: 'b',
        kind: 'brush',
        mode: 'Add',
        opacity: 100,
        invert: false,
        feather: 0,
        width: 96,
        height: 64,
        png: '',
        strokes
      }
      const radial = {
        id: 'r',
        kind: 'radial',
        mode: 'Add',
        opacity: 100,
        invert: false,
        feather: 0,
        centre: { x: 0.3, y: 0.7 },
        radiusX: 0.25,
        radiusY: 0.25,
        angle: 0,
        softness: 0,
        width: 64,
        height: 64
      }
      const planeOf = async (components: unknown[]): Promise<Uint8Array> => {
        const r = defaultRecipe(false)
        const l = newLocalLayer('Brush')
        l.components = components as never
        l.settings.basic.exposure = 1
        r.layers = [l]
        const c = compile(r, f.ctx)
        await e.convert(f.plane(c.grade, { LayerMask: { layer: c.layerIndex[l.id] } }))
        return f.read().data
      }
      // The brush alone: the engine's plane is Playroom's rasteriser's, to a level.
      const engine = await planeOf([brush])
      const ours = new Float32Array(96 * 64)
      paintStrokes(ours, 96, 64, strokes)
      let worst = 0
      for (let i = 0; i < ours.length; i++)
        worst = Math.max(worst, Math.abs(engine[i] - Math.round(ours[i] * 255)))
      assert.ok(worst <= 1, `off by ${worst}`)
      // After a gradient: the brush leads, so its eraser takes from it alone
      // and the mask is their union.
      const both = await planeOf([radial, brush])
      const disc = await planeOf([radial])
      let off = 0
      for (let i = 0; i < both.length; i++) {
        const a = disc[i] / 255
        const b = engine[i] / 255
        off = Math.max(off, Math.abs(both[i] - Math.round((a + b - a * b) * 255)))
      }
      assert.ok(off <= 2, `union off by ${off}`)
    } finally {
      f.done()
    }
  }
)
