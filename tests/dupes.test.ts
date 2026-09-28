import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dhashFromGrey, groupNear, hamming } from '../src/shared/dupes'

/** A 9×8 picture from a function of (x, y). */
const grey = (f: (x: number, y: number) => number): Uint8Array => {
  const out = new Uint8Array(9 * 8)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 9; x++) out[y * 9 + x] = f(x, y)
  return out
}

test('dHash of gradients: brighter to the left sets every bit, to the right none', () => {
  assert.equal(dhashFromGrey(grey((x) => 255 - x * 20)), 'ffffffffffffffff')
  assert.equal(dhashFromGrey(grey((x) => x * 20)), '0000000000000000')
  // Flat: no step anywhere.
  assert.equal(dhashFromGrey(grey(() => 128)), '0000000000000000')
  // Rows alternate direction: one byte per row.
  assert.equal(
    dhashFromGrey(grey((x, y) => (y % 2 === 0 ? 255 - x * 20 : x * 20))),
    'ff00ff00ff00ff00'
  )
})

test('dHash survives brightness and contrast changes', () => {
  const base = grey((x, y) => 60 + ((x * 37 + y * 91) % 120))
  const brighter = base.map((v) => Math.min(255, Math.round(v * 1.2 + 10)))
  assert.equal(dhashFromGrey(base), dhashFromGrey(brighter))
})

test('hamming counts differing bits', () => {
  assert.equal(hamming('0000000000000000', '0000000000000000'), 0)
  assert.equal(hamming('0000000000000000', 'ffffffffffffffff'), 64)
  assert.equal(hamming('0000000000000001', '0000000000000000'), 1)
  assert.equal(hamming('8000000000000000', '0000000000000000'), 1)
  assert.equal(hamming('f0f0f0f000000000', '0000000000000000'), 16)
})

test('groupNear joins within the threshold, transitively, and keeps order', () => {
  const entries = [
    { key: 'a', hash: '0000000000000000' },
    { key: 'x', hash: 'ffffffffffffffff' },
    { key: 'b', hash: '000000000000000f' }, // 4 from a
    { key: 'c', hash: '00000000000000ff' }, // 4 from b, 8 from a
    { key: 'y', hash: 'fffffffffffffff0' } // 4 from x
  ]
  assert.deepEqual(groupNear(entries, 0), [])
  assert.deepEqual(groupNear(entries, 3), [])
  assert.deepEqual(groupNear(entries, 4), [
    { keys: ['a', 'b', 'c'], distance: 8 },
    { keys: ['x', 'y'], distance: 4 }
  ])
  assert.deepEqual(
    groupNear(entries, 8).map((g) => g.keys),
    [
      ['a', 'b', 'c'],
      ['x', 'y']
    ]
  )
  assert.equal(groupNear(entries, 64).length, 1)
})
