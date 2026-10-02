import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandOutline, bandPart, bandValue, dragBand, inPlateau } from '../src/shared/keyband'

const hue = { centre: 350, width: 40, softness: 20 }
const luma = { centre: 0.5, width: 0.4, softness: 0.1 }

test('hue folds round 360; saturation and luminance clamp', () => {
  assert.equal(bandValue(370, 360, true), 10)
  assert.equal(bandValue(-10, 360, true), 350)
  assert.equal(bandValue(1.4, 1, false), 1)
  assert.equal(bandValue(-0.2, 1, false), 0)
})

test('the plateau wraps through 0 on hue', () => {
  assert.equal(inPlateau(hue, 5, 360, true), true)
  assert.equal(inPlateau(hue, 15, 360, true), false)
  assert.equal(inPlateau(luma, 0.69, 1, false), true)
  assert.equal(inPlateau(luma, 0.71, 1, false), false)
})

test('a press takes the nearest handle in reach, else the centre', () => {
  // Plateau edges at 330 and 10 (370), shoulders' ends at 310 and 30.
  assert.equal(bandPart(hue, 9, 360, true, 3), 'width-right')
  assert.equal(bandPart(hue, 331, 360, true, 3), 'width-left')
  assert.equal(bandPart(hue, 29, 360, true, 3), 'soft-right')
  assert.equal(bandPart(hue, 311, 360, true, 3), 'soft-left')
  assert.equal(bandPart(hue, 350, 360, true, 3), 'centre')
  assert.equal(bandPart(luma, 0.305, 1, false, 0.01), 'width-left')
})

test('dragging moves, widens and softens the band', () => {
  assert.equal(dragBand(hue, 'centre', 20, 360, true).centre, 10)
  assert.equal(dragBand(hue, 'width-right', 5, 360, true).width, 50)
  assert.equal(dragBand(hue, 'width-left', 5, 360, true).width, 30)
  assert.equal(dragBand(hue, 'soft-right', -30, 360, true).softness, 0)
  assert.equal(dragBand(luma, 'soft-left', -0.05, 1, false).softness, 0.15000000000000002)
  assert.equal(dragBand(luma, 'centre', 0.8, 1, false).centre, 1)
})

test('the outline draws hue copies either side so a band through 0 shows whole', () => {
  assert.equal(bandOutline(hue, 360, true, 360, 18).length, 3)
  assert.deepEqual(bandOutline(luma, 1, false, 100, 10), ['20.0,10.0 30.0,0.0 70.0,0.0 80.0,10.0'])
})
