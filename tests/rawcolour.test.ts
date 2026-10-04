import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  asShotFor,
  cameraColourOf,
  defaultRawColour,
  developMark,
  effectiveInfo,
  parseRawColour,
  pixlSupported,
  rawColourLabel,
  rawColourReason,
  resolveRawColour
} from '../src/shared/rawcolour'
import { RAW_DEVELOP_REV } from '../src/shared/pixels'

type CamInfo = Parameters<typeof asShotFor>[0]
const white = (k: number): { x: number; y: number; temperature_kelvin: number; tint: number } => ({
  x: 0.3,
  y: 0.3,
  temperature_kelvin: k,
  tint: 0
})
const cam = (versions: number[], k: number | null = 3327): CamInfo => ({
  camera_colour: {
    form: 'LibRaw' as const,
    make: 'Canon',
    model: 'EOS R5',
    pixl_versions: versions,
    pixl_camera: versions.length ? 'Canon EOS R5' : null,
    as_shot_white: k === null ? null : white(k)
  },
  as_shot_white: white(3671)
})

test('PIXL colour is the default where the database holds the body, else the file’s own', () => {
  assert.equal(defaultRawColour(cam([1])), 'pixl:1')
  assert.equal(defaultRawColour(cam([])), 'container')
  assert.equal(defaultRawColour({ camera_colour: null }), 'container')
  assert.equal(defaultRawColour(null), 'container')
  assert.equal(pixlSupported(cam([1, 2])), true)
  assert.equal(pixlSupported(cam([2])), false)
})

test('the recorded choice wins, but never names a body the database lacks', () => {
  assert.equal(resolveRawColour('container', cam([1])), 'container')
  assert.equal(resolveRawColour('pixl:1', cam([1])), 'pixl:1')
  // A DNG whose names differ, or a changed file: container, not an error.
  assert.equal(resolveRawColour('pixl:1', cam([])), 'container')
  assert.equal(resolveRawColour(null, cam([1])), 'pixl:1')
  assert.equal(resolveRawColour('nonsense', cam([])), 'container')
  assert.equal(parseRawColour('pixl:1'), 'pixl:1')
  assert.equal(parseRawColour('pixl:2'), null)
  assert.equal(parseRawColour(undefined), null)
})

test('the engine’s colour names the version', () => {
  assert.deepEqual(cameraColourOf('pixl:1'), { Pixl: { version: 1 } })
  assert.equal(cameraColourOf('container'), 'Container')
})

test('the develop mark keeps the file’s own colour as it was, and tells PIXL’s apart', () => {
  assert.equal(developMark('container'), RAW_DEVELOP_REV)
  assert.equal(developMark('pixl:1'), `${RAW_DEVELOP_REV}p1`)
  assert.notEqual(developMark('pixl:1'), developMark('container'))
})

test('under PIXL colour the as-shot white is the one through PIXL’s calibrations', () => {
  const info = cam([1])
  assert.equal(asShotFor(info, 'pixl:1')?.temperature_kelvin, 3327)
  assert.equal(asShotFor(info, 'container')?.temperature_kelvin, 3671)
  // None from the database: the file’s own, so the white never vanishes.
  assert.equal(asShotFor(cam([1], null), 'pixl:1')?.temperature_kelvin, 3671)
  assert.equal(asShotFor({ camera_colour: null, as_shot_white: null }, 'pixl:1'), null)
})

test('the effective probe swaps only the white, and is the same object when nothing changes', () => {
  const info = { ...cam([1]), width: 8192 }
  const p = effectiveInfo(info, 'pixl:1')
  assert.equal(p.as_shot_white?.temperature_kelvin, 3327)
  assert.equal(p.width, 8192)
  assert.equal(info.as_shot_white.temperature_kelvin, 3671)
  assert.equal(effectiveInfo(info, 'container'), info)
})

test('the words: the camera by PIXL’s name, and why a body has no PIXL colour', () => {
  assert.equal(rawColourLabel(cam([1]), 'pixl:1'), 'PIXL · Canon EOS R5')
  assert.match(rawColourLabel(cam([1]), 'container'), /Container/)
  assert.equal(rawColourReason(cam([1])), null)
  assert.match(rawColourReason(cam([]))!, /not in PIXL’s database/)
  assert.match(rawColourReason({ camera_colour: null })!, /Only camera RAW/)
})
