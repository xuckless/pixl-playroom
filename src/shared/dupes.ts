/**
 * Near duplicates: a 64-bit difference hash (dHash) of each thumbnail, and
 * groups of pictures whose hashes differ in few bits. The hash is the sign
 * of the brightness step between neighbours in a 9×8 greyscale picture, so
 * it survives resizing, recompression and small tone changes, and not much
 * else.
 */

/** The dHash of a `width × height` greyscale picture (one byte per pixel), as 16 hex digits. */
export function dhashFromGrey(data: ArrayLike<number>, width = 9, height = 8): string {
  if (data.length < width * height) throw new Error('dhash: too few pixels')
  let hex = ''
  let nibble = 0
  let bits = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x
      nibble = (nibble << 1) | (data[i] > data[i + 1] ? 1 : 0)
      if (++bits === 4) {
        hex += nibble.toString(16)
        nibble = 0
        bits = 0
      }
    }
  }
  if (bits > 0) hex += (nibble << (4 - bits)).toString(16)
  return hex
}

function popcount32(v: number): number {
  v = v - ((v >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/** A 16-hex-digit hash as two 32-bit halves. */
const halves = (h: string): [number, number] => [
  parseInt(h.slice(0, 8), 16) >>> 0,
  parseInt(h.slice(8, 16), 16) >>> 0
]

/** How many bits two hashes differ in. */
export function hamming(a: string, b: string): number {
  const [a0, a1] = halves(a)
  const [b0, b1] = halves(b)
  return popcount32((a0 ^ b0) >>> 0) + popcount32((a1 ^ b1) >>> 0)
}

export interface NearGroup {
  keys: string[]
  /** The largest distance between two members. */
  distance: number
}

/**
 * Pictures within `threshold` bits of another, joined transitively
 * (union-find): A~B and B~C put all three together. Groups come in the
 * order of their first member; members keep the entries' order.
 *
 * Not every pair is compared. Equal hashes are joined first; then the 64
 * bits are cut into `threshold + 1` blocks, and two hashes within
 * `threshold` bits must agree on at least one whole block (pigeonhole), so
 * only hashes sharing a block's value are compared (multi-index hashing).
 * The groups are exactly the all-pairs ones.
 */
export function groupNear(
  entries: { key: string; hash: string }[],
  threshold: number
): NearGroup[] {
  const n = entries.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  const join = (i: number, j: number): void => {
    const a = find(i)
    const b = find(j)
    if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
  }
  // Equal hashes: one representative each.
  const firstOf = new Map<string, number>()
  const reps: number[] = []
  for (let i = 0; i < n; i++) {
    const hash = entries[i].hash.toLowerCase()
    const seen = firstOf.get(hash)
    if (seen === undefined) {
      firstOf.set(hash, i)
      reps.push(i)
    } else join(seen, i)
  }
  if (threshold > 0) {
    const h = entries.map((e) => halves(e.hash))
    const bits = entries.map((e) => BigInt(`0x${e.hash.padEnd(16, '0').slice(0, 16)}`))
    const blocks = Math.min(64, threshold + 1)
    for (let b = 0; b < blocks; b++) {
      const from = Math.round((b * 64) / blocks)
      const to = Math.round(((b + 1) * 64) / blocks)
      const mask = (1n << BigInt(to - from)) - 1n
      const shift = BigInt(64 - to)
      const buckets = new Map<bigint, number[]>()
      for (const i of reps) {
        const v = (bits[i] >> shift) & mask
        const list = buckets.get(v)
        if (list) list.push(i)
        else buckets.set(v, [i])
      }
      for (const list of buckets.values()) {
        for (let x = 0; x < list.length; x++) {
          const i = list[x]
          const [i0, i1] = h[i]
          for (let y = x + 1; y < list.length; y++) {
            const j = list[y]
            if (find(i) === find(j)) continue
            const d = popcount32((i0 ^ h[j][0]) >>> 0) + popcount32((i1 ^ h[j][1]) >>> 0)
            if (d <= threshold) join(i, j)
          }
        }
      }
    }
  }
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const list = byRoot.get(r)
    if (list) list.push(i)
    else byRoot.set(r, [i])
  }
  const out: NearGroup[] = []
  for (const members of byRoot.values()) {
    if (members.length < 2) continue
    // The largest distance, between the distinct hashes in the group.
    const distinct = [...new Set(members.map((i) => entries[i].hash.toLowerCase()))]
    let distance = 0
    for (let a = 0; a < distinct.length; a++) {
      for (let b = a + 1; b < distinct.length; b++) {
        distance = Math.max(distance, hamming(distinct[a], distinct[b]))
      }
    }
    out.push({ keys: members.map((i) => entries[i].key), distance })
  }
  return out
}
