/**
 * Prepared mask planes (engine 0.21.0, E37): a render names exactly the
 * planes its grade reads, at its frame's size, each prepared once; what the
 * photo's grade no longer reads goes; one refused renders again without.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Grade, MaskComponent, PlaneOp, PlaneResult } from '../src/shared/engine-types'
import { MaskPlanes, planeKey, planeRefused, rasterSources } from '../src/main/maskplanes'

const raster = (path: string): MaskComponent => ({
  shape: { Raster: { source: { Png: path }, resampler: 'Bilinear' } },
  mode: 'Add',
  opacity: 1,
  invert: false,
  feather: { radius: 0, edge: 'Zero' },
  refine: null,
  smooth: 0,
  contrast: 0,
  shift: 0
})

const gradeOf = (...paths: string[]): Grade => ({
  layers: [
    {
      name: 'm',
      enabled: true,
      opacity: 1,
      mask: { components: paths.map(raster), invert: false, space: null, edge: null },
      blend: { mode: 'Normal', space: 'LinearWorking' },
      stages: [
        {
          space: 'LinearWorking',
          ops: [
            {
              Masked: {
                mask: {
                  // The group's plane, beside the layer's own in the photo's folder.
                  components: [raster(paths[0].replace(/[^/]+$/, 'inner.png'))],
                  invert: false,
                  space: null,
                  edge: null
                },
                opacity: 1,
                ops: []
              }
            }
          ]
        }
      ]
    }
  ]
})

/** A host that prepares in memory and says what it was asked. */
function fakeHost(fail = new Set<string>()): {
  calls: PlaneOp[]
  live: Set<string>
  planes(call: PlaneOp): Promise<PlaneResult>
} {
  const calls: PlaneOp[] = []
  const live = new Set<string>()
  return {
    calls,
    live,
    async planes(call) {
      calls.push(call)
      if (call.op === 'release') {
        for (const id of call.ids) live.delete(id)
        return { op: 'release' }
      }
      if ('Png' in call.request.source && fail.has(call.request.source.Png))
        throw Object.assign(new Error('unreadable'), { code: 'InvalidRequest' })
      live.add(call.id)
      const { width, height } = call.request
      return { op: 'prepare', width, height, bytes: width * height * 4 }
    }
  }
}

test('the raster sources a grade reads: its masks’ and its masked groups’, each once', () => {
  const g = gradeOf('/c/1/a.png', '/c/1/a.png', '/c/1/b.png')
  assert.deepEqual(
    rasterSources(g).map((s) => s.path),
    ['/c/1/a.png', '/c/1/b.png', '/c/1/inner.png']
  )
  assert.equal(planeKey(rasterSources(g)[0], 100, 50), '/c/1/a.png|Bilinear|100x50')
  assert.deepEqual(rasterSources(null), [])
})

test('each plane is prepared once a size; what the grade no longer reads goes', async () => {
  const host = fakeHost()
  const mp = new MaskPlanes(host, 1e9, () => 4)
  const a = await mp.namesFor(gradeOf('/c/1/a.png'), 100, 50, '/c/1/')
  assert.equal(a.length, 2, 'the mask’s and the group’s')
  const again = await mp.namesFor(gradeOf('/c/1/a.png'), 100, 50, '/c/1/')
  assert.deepEqual(again, a)
  assert.equal(host.calls.filter((c) => c.op === 'prepare').length, 2)
  // The draft's size is another plane; the proxy's stay.
  const draft = await mp.namesFor(gradeOf('/c/1/a.png'), 50, 25, '/c/1/')
  assert.equal(draft.length, 2)
  assert.equal(host.live.size, 4)
  // Repainted: a new file; the old one at that size goes, the other size's stays.
  const repainted = await mp.namesFor(gradeOf('/c/1/a2.png'), 100, 50, '/c/1/')
  assert.equal(repainted.length, 2)
  assert.equal(host.live.size, 4)
  // Another photo's planes are its own.
  await mp.namesFor(gradeOf('/c/2/x.png'), 100, 50, '/c/2/')
  assert.equal(host.live.size, 6)
  // Its photo closed: its planes go.
  mp.releaseUnder('/c/1/')
  assert.equal(host.live.size, 2)
})

test('a plane that could not be prepared is left out; past the cap the least used go', async () => {
  const host = fakeHost(new Set(['/c/1/bad.png']))
  const mp = new MaskPlanes(host, 100 * 50 * 4 * 2, () => 4)
  const names = await mp.namesFor(gradeOf('/c/1/bad.png'), 100, 50, '/c/1/')
  assert.equal(names.length, 1, 'the group’s alone')
  await mp.namesFor(gradeOf('/c/1/a.png'), 100, 50, '/c/1/')
  await mp.namesFor(gradeOf('/c/3/b.png'), 100, 50, '/c/3/')
  assert.ok(mp.bytes <= 100 * 50 * 4 * 2)
  // Refused: forgotten, and prepared again when next asked.
  const n = await mp.namesFor(gradeOf('/c/3/b.png'), 100, 50, '/c/3/')
  mp.forget(n)
  assert.equal(mp.bytes, 0)
  assert.equal((await mp.namesFor(gradeOf('/c/3/b.png'), 100, 50, '/c/3/')).length, 2)
})

test('a frame size refused twice prepares no planes until its photo closes; a lost host is no refusal', async () => {
  const host = fakeHost()
  const mp = new MaskPlanes(host, 1e9, () => 4)
  const g = gradeOf('/c/1/a.png')
  // The host lost: made again, however often.
  for (let i = 0; i < 3; i++) mp.forget(await mp.namesFor(g, 100, 50, '/c/1/'), false)
  assert.equal((await mp.namesFor(g, 100, 50, '/c/1/')).length, 2)
  // Refused once (a file changed since): made again.
  mp.forget(await mp.namesFor(g, 100, 50, '/c/1/'))
  assert.equal((await mp.namesFor(g, 100, 50, '/c/1/')).length, 2)
  // Twice: the engine plans the masks at another size; every render would be made twice.
  mp.forget(await mp.namesFor(g, 100, 50, '/c/1/'))
  const prepares = host.calls.filter((c) => c.op === 'prepare').length
  assert.deepEqual(await mp.namesFor(g, 100, 50, '/c/1/'), [])
  assert.equal(host.calls.filter((c) => c.op === 'prepare').length, prepares)
  // Another size, and another photo, are their own.
  assert.equal((await mp.namesFor(g, 50, 25, '/c/1/')).length, 2)
  assert.equal((await mp.namesFor(gradeOf('/c/2/x.png'), 100, 50, '/c/2/')).length, 2)
  // The photo closed and opened again: tried afresh.
  mp.releaseUnder('/c/1/')
  assert.equal((await mp.namesFor(g, 100, 50, '/c/1/')).length, 2)
})

test('what a refusal for the planes looks like', () => {
  assert.ok(planeRefused({ code: 'InvalidRequest', field: 'mask_planes[0]', message: 'x' }))
  assert.ok(planeRefused({ code: 'Stale', message: 'mask plane p3 is not loaded in this engine' }))
  assert.ok(!planeRefused({ code: 'InvalidRequest', field: 'grade.layers[0]', message: 'x' }))
  assert.ok(!planeRefused(null))
})

/** The native engine, where it is built (not in CI). */
const realEngine = await (async () => {
  try {
    const { createRequire } = await import('node:module')
    const e = createRequire(import.meta.url)('@xuckless/pixl-engine') as {
      convert(r: unknown, o?: unknown): Promise<{ output: Uint8Array | null }>
      prepareRaster?(r: unknown): Promise<{ width: number; height: number; bytes: number }>
    }
    return typeof e.prepareRaster === 'function' ? e : null
  } catch {
    return null
  }
})()

test(
  'the engine takes the planes a turned photo’s render names, and renders the same',
  { skip: realEngine === null ? 'no engine with prepared planes here' : false },
  async () => {
    const e = realEngine!
    const { blankRequest } = await import('../src/main/source')
    const { encodePng16, encodeGreyPng } = await import('../src/main/pngio')
    const { compile } = await import('../src/shared/compile')
    const { swapsAxes } = await import('../src/shared/orientation')
    const { defaultRecipe, newLocalLayer } = await import('../src/shared/recipe')
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join, sep } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'maskplanes-'))
    try {
      const w = 96
      const h = 64
      const path = join(dir, 'in.png')
      writeFileSync(
        path,
        encodePng16(
          new Uint16Array(w * h * 3).map((_, i) => (i * 7919) % 60000),
          w,
          h,
          3
        )
      )
      // A plane already turned into the user's frame (main/brushes.ts writes it so).
      const plane = join(dir, 'brush.png')
      writeFileSync(
        plane,
        encodeGreyPng(
          new Uint8Array(32 * 48).map((_, i) => (i % 32) * 8),
          32,
          48
        )
      )
      const r = defaultRecipe(false)
      r.geometry.quarterTurns = 1
      const l = newLocalLayer('Brush')
      l.components = [
        {
          id: 'b',
          kind: 'brush',
          mode: 'Add',
          opacity: 100,
          invert: false,
          feather: 0,
          width: 48,
          height: 32,
          png: 'x'
        }
      ]
      l.settings.basic.exposure = 1
      r.layers = [l]
      const c = compile(r, {
        isRaw: false,
        asShot: null,
        sourceOrientation: 'Normal',
        frameWidth: w,
        frameHeight: h,
        scale: 1,
        seed: 1,
        brushPaths: { b: plane },
        applyCrop: true
      })
      const turned = c.framing !== null && swapsAxes(c.framing.orientation)
      assert.ok(turned, 'the photo is turned')
      const kept = new Map<string, unknown>()
      const mp = new MaskPlanes(
        {
          async planes(call) {
            if (call.op === 'release') return { op: 'release' }
            const p = await e.prepareRaster!(call.request)
            kept.set(call.id, p)
            return { op: 'prepare', width: p.width, height: p.height, bytes: p.bytes }
          }
        },
        1e9,
        () => 2
      )
      const names = await mp.namesFor(c.grade, turned ? h : w, turned ? w : h, dir + sep)
      assert.equal(names.length, 1)
      const request = {
        ...blankRequest(path, '', 'Png'),
        sink: 'Bytes',
        pixel: { depth: 'Eight', channels: 4 },
        encode: { Pixels: { sample: 'U8' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        grade: c.grade,
        framing: c.framing,
        threads: 2
      }
      const plain = await e.convert(request)
      const prepared = await e.convert(request, { maskPlanes: names.map((n) => kept.get(n)) })
      assert.deepEqual(prepared.output, plain.output)
      // Cropped and straightened too: the masks are planned on the turned
      // source, not the crop, so the same planes serve.
      r.geometry.crop = { x: 0.1, y: 0.2, width: 0.6, height: 0.5 }
      r.geometry.straighten = 3
      const cropped = compile(r, {
        isRaw: false,
        asShot: null,
        sourceOrientation: 'Normal',
        frameWidth: w,
        frameHeight: h,
        scale: 1,
        seed: 1,
        brushPaths: { b: plane },
        applyCrop: true
      })
      assert.ok(cropped.framing?.crop, 'the photo is cropped')
      const again = await mp.namesFor(cropped.grade, h, w, dir + sep)
      assert.deepEqual(again, names)
      const cut = { ...request, grade: cropped.grade, framing: cropped.framing }
      const cutPlain = await e.convert(cut)
      const cutPrepared = await e.convert(cut, { maskPlanes: again.map((n) => kept.get(n)) })
      assert.deepEqual(cutPrepared.output, cutPlain.output)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
