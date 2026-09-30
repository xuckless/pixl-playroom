import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile, type CompileContext } from '../src/shared/compile'
import { defaultRecipe, normaliseRecipe } from '../src/shared/recipe'
import {
  compileRetouch,
  featherOf,
  fitOffset,
  newSpot,
  type RetouchSpot
} from '../src/shared/retouch'

const ctx: CompileContext = {
  isRaw: false,
  asShot: null,
  sourceOrientation: 'Normal',
  frameWidth: 6000,
  frameHeight: 4000,
  scale: 0.4,
  seed: 7,
  brushPaths: {},
  applyCrop: true
}

const heal = (): RetouchSpot => ({
  ...newSpot('a1', 'heal', [{ x: 0.4, y: 0.5 }], 0.02, 50, 100),
  source: { x: 0.45, y: 0.5 }
})

test('no spots is no retouch; a spot off is left out', () => {
  assert.equal(compile(defaultRecipe(false), ctx).retouch, null)
  const off = { ...heal(), enabled: false }
  assert.equal(compileRetouch([off], 'Normal', 6000, 4000), null)
})

test('a heal keeps its source as the offset to it', () => {
  const r = compileRetouch([heal()], 'Normal', 6000, 4000)!
  const step = r.steps[0]
  assert.ok('Heal' in step)
  assert.ok(Math.abs(step.Heal.source_offset.x - 0.05) < 1e-9)
  assert.equal(step.Heal.source_offset.y, 0)
  assert.deepEqual(step.Heal.feather, featherOf({ feather: 50, radius: 0.02 }))
})

test('turning the frame turns the spots with it', () => {
  const r = compileRetouch([heal()], 'Rotate90', 6000, 4000)!
  const step = r.steps[0]
  assert.ok('Heal' in step && 'Circle' in step.Heal.shape)
  // A quarter turn clockwise: right becomes down.
  assert.ok(Math.abs(step.Heal.source_offset.x) < 1e-9)
  assert.ok(Math.abs(step.Heal.source_offset.y - 0.05) < 1e-9)
})

test('a source that would read outside the frame is pulled back inside', () => {
  const off = fitOffset({ x: 0.3, y: 0 }, [{ x: 0.9, y: 0.5 }], 0.02, 0.005, 6000, 4000)!
  assert.ok(off.x < 0.3)
  // The spot's reach, moved by the offset, stays inside.
  const reach = ((0.02 + 3 * 0.005) * 4000) / 6000
  assert.ok(0.9 + off.x + reach <= 1)
  // A spot as big as the frame has nowhere to copy from.
  assert.equal(fitOffset({ x: 0.1, y: 0 }, [{ x: 0.5, y: 0.5 }], 0.5, 0, 6000, 4000), null)
})

test('fill, red eye and pet eye compile with their own numbers; a fill is reproducible', () => {
  const spots = [
    newSpot('f00d', 'fill', [{ x: 0.2, y: 0.2 }], 0.03, 40, 80),
    { ...newSpot('e1', 'redeye', [{ x: 0.5, y: 0.3 }], 0.01, 20, 100), radiusY: 0.006, rotate: 20 },
    newSpot('e2', 'peteye', [{ x: 0.6, y: 0.3 }], 0.01, 20, 100)
  ]
  const r = compileRetouch(spots, 'Normal', 6000, 4000)!
  const [fill, red, pet] = r.steps
  assert.ok('Fill' in fill && fill.Fill.seed === 0xf00d && fill.Fill.opacity === 0.8)
  assert.ok('RedEye' in red && red.RedEye.pupils[0].radius_y === 0.006)
  assert.equal(red.RedEye.pupils[0].rotate_degrees, 20)
  assert.ok('PetEye' in pet && pet.PetEye.pupil_level === 0.1)
  // A quarter turn turns an eye's ellipse by a quarter too.
  const turned = compileRetouch([spots[1]], 'Rotate90', 6000, 4000)!.steps[0]
  assert.ok('RedEye' in turned && Math.abs(turned.RedEye.pupils[0].rotate_degrees - 110) < 1e-6)
})

test('a sidecar keeps only spots that read', () => {
  const r = normaliseRecipe({ retouch: [heal(), { id: 'x' }, 'nonsense'] }, false)
  assert.equal(r.retouch.length, 1)
})
