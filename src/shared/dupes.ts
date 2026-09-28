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
 */
export function groupNear(
  entries: { key: string; hash: string }[],
  threshold: number
): NearGroup[] {
  const n = entries.length
  const h = entries.map((e) => halves(e.hash))
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i < n; i++) {
    const [i0, i1] = h[i]
    for (let j = i + 1; j < n; j++) {
      const d = popcount32((i0 ^ h[j][0]) >>> 0) + popcount32((i1 ^ h[j][1]) >>> 0)
      if (d > threshold) continue
      const a = find(i)
      const b = find(j)
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b)
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
    let distance = 0
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        distance = Math.max(distance, hamming(entries[members[a]].hash, entries[members[b]].hash))
      }
    }
    out.push({ keys: members.map((i) => entries[i].key), distance })
  }
  return out
}
