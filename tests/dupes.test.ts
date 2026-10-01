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

test('groupNear finds exactly the groups comparing every pair would', () => {
  // A seeded generator: hashes in clusters (a base with a few bits flipped), and repeats.
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0
    return seed / 2 ** 32
  }
  const hex = (n: bigint): string => n.toString(16).padStart(16, '0')
  const entries: { key: string; hash: string }[] = []
  for (let c = 0; c < 40; c++) {
    const base =
      BigInt(Math.floor(rnd() * 2 ** 32)) * 2n ** 32n + BigInt(Math.floor(rnd() * 2 ** 32))
    for (let m = 0; m < 4; m++) {
      let v = base
      const flips = Math.floor(rnd() * 14)
      for (let f = 0; f < flips; f++) v ^= 1n << BigInt(Math.floor(rnd() * 64))
      entries.push({ key: `k${entries.length}`, hash: hex(v) })
    }
    if (c % 5 === 0) entries.push({ key: `k${entries.length}`, hash: hex(base) })
  }
  const allPairs = (threshold: number): string[][] => {
    const parent = entries.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
    for (let i = 0; i < entries.length; i++)
      for (let j = i + 1; j < entries.length; j++)
        if (hamming(entries[i].hash, entries[j].hash) <= threshold) {
          const a = find(i)
          const b = find(j)
          if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
        }
    const groups = new Map<number, string[]>()
    entries.forEach((e, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), e.key]))
    return [...groups.values()].filter((g) => g.length > 1)
  }
  for (const t of [0, 1, 3, 6, 10, 16]) {
    assert.deepEqual(
      groupNear(entries, t).map((g) => g.keys),
      allPairs(t),
      `threshold ${t}`
    )
  }
})
