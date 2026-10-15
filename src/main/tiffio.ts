/**
 * The smallest TIFF reader and writer Playroom needs (engine 0.21, E33): the
 * uncompressed 16-bit RGB and RGBA the engine writes for a step's overlay at
 * a proxy's size, read and written back by the pixels worker when the
 * overlay is guarded. Nothing to deflate or inflate, which is the point:
 * the engine takes the file as `{ Tiff: path }`.
 *
 * One image, chunky, either byte order, any strips; alpha straight
 * (ExtraSamples 2, as the engine writes and PNG's is). The profile
 * (ICCProfile, tag 34675) is carried through as its bytes.
 */

const TAG = {
  width: 256,
  height: 257,
  bits: 258,
  compression: 259,
  photometric: 262,
  stripOffsets: 273,
  samples: 277,
  rowsPerStrip: 278,
  stripBytes: 279,
  planar: 284,
  extraSamples: 338,
  icc: 34675
} as const

/** Bytes per value of each TIFF field type this reader meets. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 7: 1, 16: 8 }

export interface Tiff16 {
  width: number
  height: number
  channels: 3 | 4
  /** Row by row, channel by channel. */
  samples: Uint16Array
  /** The embedded ICC profile, when it has one. */
  icc: Buffer | null
}

/** A 16-bit RGB or RGBA uncompressed TIFF's samples and profile. */
export function readTiff16(buf: Buffer): Tiff16 {
  const order = buf.toString('latin1', 0, 2)
  if (order !== 'II' && order !== 'MM') throw new Error('not a TIFF')
  const le = order === 'II'
  const u16 = (o: number): number => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o))
  const u32 = (o: number): number => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
  if (u16(2) !== 42) throw new Error('not a classic TIFF')
  const ifd = u32(4)
  const n = u16(ifd)
  const tags = new Map<number, { type: number; count: number; at: number }>()
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    const type = u16(e + 2)
    const count = u32(e + 4)
    const size = (TYPE_SIZE[type] ?? 1) * count
    tags.set(u16(e), { type, count, at: size <= 4 ? e + 8 : u32(e + 8) })
  }
  const values = (tag: number): number[] => {
    const t = tags.get(tag)
    if (!t) return []
    const out: number[] = []
    for (let i = 0; i < t.count; i++)
      out.push(t.type === 3 ? u16(t.at + i * 2) : t.type === 4 ? u32(t.at + i * 4) : buf[t.at + i])
    return out
  }
  const one = (tag: number, fallback?: number): number => {
    const v = values(tag)[0] ?? fallback
    if (v === undefined) throw new Error(`the TIFF has no tag ${tag}`)
    return v
  }
  const width = one(TAG.width)
  const height = one(TAG.height)
  const channels = one(TAG.samples, 1)
  if (channels !== 3 && channels !== 4) throw new Error('the TIFF is not RGB or RGBA')
  if (values(TAG.bits).some((b) => b !== 16)) throw new Error('the TIFF is not 16-bit')
  if (one(TAG.compression, 1) !== 1) throw new Error('the TIFF is compressed')
  if (one(TAG.planar, 1) !== 1) throw new Error('the TIFF is planar')
  if (channels === 4 && one(TAG.extraSamples, 2) === 1)
    throw new Error('the TIFF’s alpha is premultiplied')
  const offsets = values(TAG.stripOffsets)
  const counts = values(TAG.stripBytes)
  const samples = new Uint16Array(width * height * channels)
  let s = 0
  for (let k = 0; k < offsets.length && s < samples.length; k++) {
    const end = offsets[k] + counts[k]
    for (let o = offsets[k]; o + 1 < end && s < samples.length; o += 2) samples[s++] = u16(o)
  }
  if (s < samples.length) throw new Error('the TIFF is cut short')
  const icc = tags.get(TAG.icc)
  return {
    width,
    height,
    channels,
    samples,
    icc: icc ? Buffer.from(buf.subarray(icc.at, icc.at + icc.count)) : null
  }
}

/** An uncompressed 16-bit RGB or RGBA TIFF (little-endian, one strip, alpha straight). */
export function encodeTiff16(
  samples: Uint16Array,
  w: number,
  h: number,
  channels: 3 | 4,
  icc: Buffer | null = null
): Buffer {
  const entries: [number, number, number[] | Buffer][] = [
    [TAG.width, 4, [w]],
    [TAG.height, 4, [h]],
    [TAG.bits, 3, new Array(channels).fill(16)],
    [TAG.compression, 3, [1]],
    [TAG.photometric, 3, [2]],
    [TAG.stripOffsets, 4, [0]],
    [TAG.samples, 3, [channels]],
    [TAG.rowsPerStrip, 4, [h]],
    [TAG.stripBytes, 4, [samples.length * 2]],
    [TAG.planar, 3, [1]],
    ...(channels === 4 ? [[TAG.extraSamples, 3, [2]] as [number, number, number[]]] : []),
    ...(icc ? [[TAG.icc, 7, icc] as [number, number, Buffer]] : [])
  ]
  // Header, pixels, then the directory and the values too long for it.
  const data = 8
  const ifd = data + samples.length * 2
  const extra = ifd + 2 + entries.length * 12 + 4
  const long = entries.map(([, type, v]) =>
    Array.isArray(v) ? v.length * (type === 3 ? 2 : 4) : v.length
  )
  let size = extra
  for (const l of long) if (l > 4) size += l + (l % 2)
  const out = Buffer.alloc(size)
  out.write('II', 0, 'latin1')
  out.writeUInt16LE(42, 2)
  out.writeUInt32LE(ifd, 4)
  for (let i = 0; i < samples.length; i++) out.writeUInt16LE(samples[i], data + i * 2)
  out.writeUInt16LE(entries.length, ifd)
  let spill = extra
  entries.forEach(([tag, type, v], i) => {
    const e = ifd + 2 + i * 12
    const count = Array.isArray(v) ? v.length : v.length
    out.writeUInt16LE(tag, e)
    out.writeUInt16LE(type, e + 2)
    out.writeUInt32LE(count, e + 4)
    const at = long[i] > 4 ? spill : e + 8
    if (long[i] > 4) {
      out.writeUInt32LE(spill, e + 8)
      spill += long[i] + (long[i] % 2)
    }
    if (!Array.isArray(v)) v.copy(out, at)
    else
      v.forEach((x, j) => {
        const value = tag === TAG.stripOffsets ? data : x
        if (type === 3) out.writeUInt16LE(value, at + j * 2)
        else out.writeUInt32LE(value, at + j * 4)
      })
  })
  out.writeUInt32LE(0, ifd + 2 + entries.length * 12)
  return out
}

/** Whether a file is named as a TIFF. */
export const isTiffPath = (path: string): boolean => /\.tiff?$/i.test(path)
