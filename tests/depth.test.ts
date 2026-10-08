// The Depth range (engine 0.18's DepthRange on Depth Anything V2's map).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, DEPTH_SOFTNESS_MAX, type CompileContext } from '../src/shared/compile'
import {
  defaultRecipe,
  hydrateRecipe,
  newLocalLayer,
  normaliseComponent,
  slimRecipe,
  type DepthComponent
} from '../src/shared/recipe'
import { previewable } from '../src/shared/maskpreview'
import { coverage, depthOf } from '../src/shared/depth'

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 6000,
  frameHeight: 4000,
  scale: 1,
  seed: 7,
  brushPaths: { d: '/cache/depth-x-Normal.png' },
  applyCrop: true
}

const depth = (over: Partial<DepthComponent> = {}): DepthComponent => ({
  id: 'd',
  kind: 'depth',
  mode: 'Add',
  opacity: 100,
  invert: false,
  feather: 0,
  width: 512,
  height: 341,
  png: 'iVBOR',
  near: 10,
  far: 40,
  softness: 20,
  ...over
})

function shapeOf(c: DepthComponent, paths = ctx.brushPaths): unknown {
  const r = defaultRecipe(false)
  const l = newLocalLayer('Near')
  l.components.push(c)
  l.settings.basic.exposure = 1
  r.layers.push(l)
  const g = compile(r, { ...ctx, brushPaths: paths }).grade
  const layer = g?.layers.find((x) => x.name === 'Near')
  return layer?.mask?.components[0]?.shape ?? null
}

test('a Depth range reaches the engine as a disparity band on its map, bilinear', () => {
  assert.deepEqual(shapeOf(depth()), {
    DepthRange: {
      depth: { Raster: { Png: '/cache/depth-x-Normal.png' } },
      quantity: 'Disparity',
      // Disparity runs the other way: the nearer end is the larger value.
      near: 0.9,
      far: 0.6,
      softness: 0.2 * DEPTH_SOFTNESS_MAX,
      resampler: 'Bilinear'
    }
  })
  // Near and Far given the wrong way round still make the same band.
  assert.deepEqual(shapeOf(depth({ near: 40, far: 10 })), shapeOf(depth()))
  // No map written (a plane missing): nothing, never a broken shape.
  assert.equal(shapeOf(depth(), {}), null)
})

test('a saved Depth range is read back, held to its ranges', () => {
  const c = normaliseComponent({ kind: 'depth', png: 'x', near: -5, far: 140, softness: 250 })
  assert.equal(c?.kind, 'depth')
  if (c?.kind !== 'depth') return
  assert.deepEqual([c.near, c.far, c.softness], [0, 100, 100])
  assert.equal(normaliseComponent({ kind: 'depth', near: 10 }), null)
  const swapped = normaliseComponent({ kind: 'depth', png: 'x', near: 60, far: 20 })
  assert.ok(swapped?.kind === 'depth' && swapped.far >= swapped.near)
})

test('its map travels as a brush plane does: by reference, filled back in', () => {
  const r = defaultRecipe(false)
  const l = newLocalLayer('m')
  l.components.push(depth({ png: 'PNGDATA' }))
  r.layers.push(l)
  const kept = new Map<string, string>()
  const slim = slimRecipe(
    r,
    () => 'ref1',
    (ref, png) => kept.set(ref, png)
  )
  const c = slim.layers[0].components[0] as DepthComponent
  assert.deepEqual([c.png, c.ref], ['', 'ref1'])
  assert.equal(kept.get('ref1'), 'PNGDATA')
  const back = hydrateRecipe(slim, (ref) => kept.get(ref))
  assert.equal((back.layers[0].components[0] as DepthComponent).png, 'PNGDATA')
})

test('a mask with a Depth range shows its overlay from the render, not the GL preview', () => {
  const l = newLocalLayer('m')
  l.components.push(depth())
  assert.equal(previewable(l), false)
})

test('the map’s grey is depth the other way round; the band fades as the engine keys it', () => {
  assert.equal(depthOf(255), 0)
  assert.equal(depthOf(0), 100)
  assert.equal(coverage(25, 10, 40, 10), 1)
  assert.equal(coverage(55, 10, 40, 10), 0)
  assert.equal(coverage(45, 10, 40, 10), 0.5)
  assert.equal(coverage(41, 10, 40, 0), 0)
})
