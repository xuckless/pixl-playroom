/**
 * The 8-bit picture beside an SDR render sent as F16 (the settled picture
 * and the 1:1 tiles, on a window that draws float frames): what reads a
 * picture's pixels (the eyedropper, the scopes, a thumbnail) and the 2D
 * canvas a window without WebGPU falls back to take it, as they take a
 * Full HDR master's companion. The engine makes a companion only for a
 * Master, so the engine host makes this one from the frame: averaged as
 * light, then sRGB-encoded (Display P3's curve). Pure, for tests.
 */

let halves: Float32Array | null = null

/** Every half float's value, by its bits (made once: 256 KB). */
function halfTable(): Float32Array {
  if (halves) return halves
  const t = new Float32Array(65536)
  for (let x = 0; x < 65536; x++) {
    const e = (x >> 10) & 31
    const m = x & 1023
    const v =
      e === 0 ? m * 2 ** -24 : e === 31 ? (m ? NaN : Infinity) : (1 + m / 1024) * 2 ** (e - 15)
    t[x] = x & 0x8000 ? -v : v
  }
  halves = t
  return t
}

/** The sRGB curve to 8 bits, for linear values 0…1 in 1/4096 steps. */
const ENCODE = (() => {
  const t = new Uint8Array(4097)
  for (let i = 0; i <= 4096; i++) {
    const v = i / 4096
    const e = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
    t[i] = Math.round(e * 255)
  }
  return t
})()

/** Pixels read across each companion pixel, on each axis. */
const SAMPLES = 3

const encode = (v: number): number => ENCODE[Math.round(Math.min(1, Math.max(0, v)) * 4096)]

/**
 * `data`: RGBA half floats (little-endian), linear Display P3, 1.0 = white.
 * The companion: RGBA 8-bit Display P3 at most `edge` on its longer side,
 * each pixel the mean of up to 3 × 3 of the frame's pixels it covers.
 */
export function sdrCompanion(
  data: Uint8Array,
  width: number,
  height: number,
  edge: number
): { width: number; height: number; data: Uint8Array } {
  const h16 = new Uint16Array(data.buffer, data.byteOffset, width * height * 4)
  const lut = halfTable()
  const k = Math.min(1, edge / Math.max(width, height))
  const w = Math.max(1, Math.round(width * k))
  const h = Math.max(1, Math.round(height * k))
  const out = new Uint8Array(w * h * 4)
  // Where each companion row and column reads: at most SAMPLES of the
  // frame's rows (columns) it covers, evenly spread. A screen-sized frame's
  // companion then costs what a proxy's does (it is made before the frame is
  // sent, so it is on the picture's way to the screen).
  const spread = (n: number, size: number): { at: Int32Array; count: Uint8Array } => {
    const at = new Int32Array(n * SAMPLES)
    const count = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const from = Math.floor((i * size) / n)
      const to = Math.max(from + 1, Math.floor(((i + 1) * size) / n))
      const k = Math.min(SAMPLES, to - from)
      count[i] = k
      for (let j = 0; j < k; j++)
        at[i * SAMPLES + j] = from + Math.floor(((j + 0.5) * (to - from)) / k)
    }
    return { at, count }
  }
  const rows = spread(h, height)
  const cols = spread(w, width)
  for (let y = 0; y < h; y++) {
    const ny = rows.count[y]
    for (let x = 0; x < w; x++) {
      const nx = cols.count[x]
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let j = 0; j < ny; j++) {
        const line = rows.at[y * SAMPLES + j] * width
        for (let k = 0; k < nx; k++) {
          const i = (line + cols.at[x * SAMPLES + k]) * 4
          r += lut[h16[i]]
          g += lut[h16[i + 1]]
          b += lut[h16[i + 2]]
          a += lut[h16[i + 3]]
        }
      }
      const n = ny * nx
      const o = (y * w + x) * 4
      out[o] = encode(r / n)
      out[o + 1] = encode(g / n)
      out[o + 2] = encode(b / n)
      out[o + 3] = Math.round(Math.min(1, Math.max(0, a / n)) * 255)
    }
  }
  return { width: w, height: h, data: out }
}
