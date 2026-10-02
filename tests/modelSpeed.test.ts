import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelSpeed, referenceOf, testFactor, TYPICAL_MP } from '../src/shared/modelSpeed'

test('the roster’s reference time is read per tile or per frame', () => {
  assert.deepEqual(referenceOf('σ = 8 sky crop: … (tests/ai.rs); 392 ms per 256² tile'), {
    tileMs: 392,
    frameMs: null
  })
  assert.deepEqual(referenceOf('IoU 0.995 (tests/segment.rs); 180 ms per frame, 8 CPU threads'), {
    tileMs: null,
    frameMs: 180
  })
  assert.deepEqual(referenceOf('q20 JPEG: +1.88 dB'), { tileMs: null, frameMs: null })
  assert.deepEqual(referenceOf(undefined), { tileMs: null, frameMs: null })
})

test('times from runs on this computer come first', () => {
  const s = modelSpeed({
    reference: { tileMs: 392, frameMs: null },
    learnedMsPerMp: 5000,
    factor: 2
  })
  assert.deepEqual(s, { msPerPhoto: 5000 * TYPICAL_MP, basis: 'runs' })
})

test('the speed test scales every model’s reference by one ratio', () => {
  // The test model ran twice as slow as its reference here.
  const factor = testFactor(360, { tileMs: null, frameMs: 180 })
  assert.equal(factor, 2)
  const tile = modelSpeed({ reference: { tileMs: 256 * 256 * 1e-3, frameMs: null }, factor })!
  // 65.536 ms per 256² tile is 1000 ms per megapixel.
  assert.equal(tile.basis, 'test')
  assert.ok(Math.abs(tile.msPerPhoto - 1000 * TYPICAL_MP * 2) < 1e-6)
  const frame = modelSpeed({ reference: { tileMs: null, frameMs: 380 }, factor })!
  assert.deepEqual(frame, { msPerPhoto: 760, basis: 'test' })
})

test('without a test the reference stands, marked typical', () => {
  const s = modelSpeed({ reference: { tileMs: null, frameMs: 180 }, factor: null })
  assert.deepEqual(s, { msPerPhoto: 180, basis: 'typical' })
})

test('a model the roster has no time for uses its first guess, or shows none', () => {
  const s = modelSpeed({
    reference: { tileMs: null, frameMs: null },
    guessMsPerMp: 1000,
    factor: null
  })
  assert.deepEqual(s, { msPerPhoto: 1000 * TYPICAL_MP, basis: 'typical' })
  assert.equal(modelSpeed({ reference: { tileMs: null, frameMs: null }, factor: null }), null)
})

test('no test, or a broken one, gives no ratio', () => {
  assert.equal(testFactor(null, { tileMs: 100, frameMs: null }), null)
  assert.equal(testFactor(0, { tileMs: 100, frameMs: null }), null)
  assert.equal(testFactor(50, { tileMs: null, frameMs: null }), null)
})
