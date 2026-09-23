/**
 * The smallest PNG reader and writer Playroom needs: single-channel 8-bit
 * planes (painted masks, which the engine takes as grey PNGs), and 16-bit RGB
 * without filtering (the eyedropper's sample, which the engine writes).
 */
import { deflateSync, inflateSync } from 'zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/** An 8-bit greyscale PNG of `w × h` samples. */
export function encodeGreyPng(data: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 0 // greyscale
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0
    raw.set(data.subarray(y * w, (y + 1) * w), y * (w + 1) + 1)
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

interface Decoded {
  width: number
  height: number
  bitDepth: number
  colorType: number
  /** Unfiltered scanlines, filter bytes removed. */
  rows: Buffer
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/** Decode a non-interlaced PNG to raw scanlines (any filter). */
export function decodePng(png: Buffer): Decoded {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG')
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 8
  let colorType = 0
  const idat: Buffer[] = []
  while (off < png.length) {
    const len = png.readUInt32BE(off)
    const type = png.toString('ascii', off + 4, off + 8)
    const data = png.subarray(off + 8, off + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG not supported')
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType as 0 | 2 | 4 | 6]
  if (!channels) throw new Error(`PNG colour type ${colorType} not supported`)
  const bpp = (channels * bitDepth) / 8
  const stride = width * bpp
  const inflated = inflateSync(Buffer.concat(idat))
  const rows = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const f = inflated[y * (stride + 1)]
    const src = inflated.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = rows.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      const x = src[i]
      out[i] =
        f === 0
          ? x
          : f === 1
            ? (x + a) & 0xff
            : f === 2
              ? (x + b) & 0xff
              : f === 3
                ? (x + ((a + b) >> 1)) & 0xff
                : (x + paeth(a, b, c)) & 0xff
    }
  }
  return { width, height, bitDepth, colorType, rows }
}

/** A PNG's pixels as floats 0…1, `channels` per pixel. */
export function pngToFloats(png: Buffer): {
  width: number
  height: number
  channels: number
  data: Float32Array
} {
  const d = decodePng(png)
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[d.colorType as 0 | 2 | 4 | 6] as number
  const n = d.width * d.height * channels
  const data = new Float32Array(n)
  if (d.bitDepth === 16) for (let i = 0; i < n; i++) data[i] = d.rows.readUInt16BE(i * 2) / 65535
  else for (let i = 0; i < n; i++) data[i] = d.rows[i] / 255
  return { width: d.width, height: d.height, channels, data }
}
