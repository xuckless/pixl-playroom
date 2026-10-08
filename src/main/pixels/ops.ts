/**
 * The per-pixel work behind pixel steps, run in the pixels worker (it holds a
 * frame's worth of samples at a time). Pure: files in, files out.
 */
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { colourChunks, decodePng, encodeGreyPng, encodePng16, pngSamples16 } from '../pngio'

/** Write `data` to `file` whole or not at all (a reader never sees half of it). */
function writeWhole(file: string, data: Buffer): void {
  const tmp = `${file}.part-${process.pid}`
  writeFileSync(tmp, data)
  renameSync(tmp, file)
}

/**
 * A masked step's overlay: its image (16-bit RGB PNG) with the frozen mask
 * (8-bit grey PNG, the same size) as alpha, as one 16-bit RGBA PNG the
 * engine lays over the frame.
 */
export function composeMasked(image: string, mask: string, out: string): void {
  const imageBytes = readFileSync(image)
  const img = decodePng(imageBytes)
  if (img.bitDepth !== 16 || img.colorType !== 2)
    throw new Error('the step image is not 16-bit RGB')
  const m = decodePng(readFileSync(mask))
  if (m.width !== img.width || m.height !== img.height)
    throw new Error(`the mask is ${m.width}×${m.height}, the image ${img.width}×${img.height}`)
  const grey = m.bitDepth === 8 && m.colorType === 0
  if (!grey) throw new Error('the mask is not an 8-bit grey plane')
  const n = img.width * img.height
  const rgba = new Uint16Array(n * 4)
  const rows = img.rows
  for (let i = 0; i < n; i++) {
    const s = i * 6
    const d = i * 4
    rgba[d] = (rows[s] << 8) | rows[s + 1]
    rgba[d + 1] = (rows[s + 2] << 8) | rows[s + 3]
    rgba[d + 2] = (rows[s + 4] << 8) | rows[s + 5]
    rgba[d + 3] = m.rows[i] * 257
  }
  // The image's colour (a RAW's linear light) goes with its pixels.
  writeWhole(out, encodePng16(rgba, img.width, img.height, 4, 1, colourChunks(imageBytes)))
}

/** A coordinate ramp: R across, G down, both 0…65535 over the frame (see lensmap.ts). */
export function writeRamp(file: string, w: number, h: number): void {
  const ramp = new Uint16Array(w * h * 3)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      ramp[i] = Math.round((x / Math.max(1, w - 1)) * 65535)
      ramp[i + 1] = Math.round((y / Math.max(1, h - 1)) * 65535)
    }
  writeWhole(file, encodePng16(ramp, w, h, 3))
}

/**
 * A ramp value read back (`v`, 0…1, from a ramp `n` pixels across) as a
 * fraction of the frame, pixel centres at (i + 0.5) / n: the ramp holds
 * i / (n − 1) at pixel i.
 */
export function rampFraction(v: number, n: number): number {
  return (v * Math.max(1, n - 1) + 0.5) / n
}

/**
 * A mask drawn over the lens-corrected picture, put back on the photo's own
 * pixels (`w × h`, before the correction), through `map`: the ramp the same
 * correction was run over, so each corrected pixel holds where in the photo
 * it came from. Each mask value is spread onto the four photo pixels around
 * where it came from; the few photo pixels nothing landed on take a
 * neighbour's value; what lies outside the corrected picture (cropped away)
 * is outside the mask.
 */
export function unwarpMask(mask: string, map: string, w: number, h: number, out: string): void {
  const m = decodePng(readFileSync(mask))
  if (m.bitDepth !== 8 || m.colorType !== 0) throw new Error('the mask is not an 8-bit grey plane')
  const mp = pngSamples16(readFileSync(map))
  const mw = mp.width
  const mh = mp.height
  const cw = m.width
  const ch = m.height
  const acc = new Float32Array(w * h)
  const wsum = new Float32Array(w * h)
  const sx = mw / cw
  const sy = mh / ch
  const at = (x: number, y: number, c: number): number => mp.data[(y * mw + x) * 3 + c] / 65535
  for (let cy = 0; cy < ch; cy++) {
    // Where in the map this corrected row falls (pixel centres).
    const my = Math.min(mh - 1, Math.max(0, (cy + 0.5) * sy - 0.5))
    const y0 = Math.floor(my)
    const y1 = Math.min(mh - 1, y0 + 1)
    const fy = my - y0
    for (let cx = 0; cx < cw; cx++) {
      const mx = Math.min(mw - 1, Math.max(0, (cx + 0.5) * sx - 0.5))
      const x0 = Math.floor(mx)
      const x1 = Math.min(mw - 1, x0 + 1)
      const fx = mx - x0
      const bil = (c: number): number =>
        (at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx) * (1 - fy) +
        (at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx) * fy
      // Where in the photo, in its pixels (centres at whole numbers).
      const px = rampFraction(bil(0), mw) * w - 0.5
      const py = rampFraction(bil(1), mh) * h - 0.5
      const v = m.rows[cy * cw + cx] / 255
      const ix = Math.floor(px)
      const iy = Math.floor(py)
      const ax = px - ix
      const ay = py - iy
      for (const [dx, dy, k] of [
        [0, 0, (1 - ax) * (1 - ay)],
        [1, 0, ax * (1 - ay)],
        [0, 1, (1 - ax) * ay],
        [1, 1, ax * ay]
      ] as const) {
        const X = ix + dx
        const Y = iy + dy
        if (X < 0 || Y < 0 || X >= w || Y >= h || k <= 0) continue
        acc[Y * w + X] += v * k
        wsum[Y * w + X] += k
      }
    }
  }
  const plane = new Uint8Array(w * h)
  const known = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (wsum[i] > 1e-4) {
      plane[i] = Math.round(Math.min(1, acc[i] / wsum[i]) * 255)
      known[i] = 1
    }
  }
  // Holes between landed values: a few passes of their neighbours' mean.
  for (let pass = 0; pass < 4; pass++) {
    let filled = 0
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (known[i]) continue
        let s = 0
        let n = 0
        for (const j of [
          x > 0 ? i - 1 : -1,
          x < w - 1 ? i + 1 : -1,
          y > 0 ? i - w : -1,
          y < h - 1 ? i + w : -1
        ]) {
          if (j < 0 || known[j] !== 1) continue
          s += plane[j]
          n++
        }
        if (n > 0) {
          plane[i] = Math.round(s / n)
          known[i] = 2
          filled++
        }
      }
    for (let i = 0; i < w * h; i++) if (known[i] === 2) known[i] = 1
    if (filled === 0) break
  }
  writeWhole(out, encodeGreyPng(plane, w, h, 3))
}

/**
 * A baked heal's patch: two renders of the same region of the frame, with the
 * stroke (`withStroke`) and without it (`without`), both 16-bit RGB PNGs. The
 * patch is the first's pixels where they differ from the second's (alpha 1;
 * 0 elsewhere), times a frozen mask when one clips the stroke (`mask`, an
 * 8-bit grey plane of the whole frame, the region at `at` on it), cropped to
 * what changed. Returns where in the region it lies, or null when nothing did.
 */
export function buildPatch(
  withStroke: string,
  without: string,
  out: string,
  mask?: { path: string; at: { x: number; y: number } }
): { x: number; y: number; w: number; h: number } | null {
  const withBytes = readFileSync(withStroke)
  const a = decodePng(withBytes)
  const b = decodePng(readFileSync(without))
  if (a.width !== b.width || a.height !== b.height)
    throw new Error('the two renders differ in size')
  if (a.bitDepth !== 16 || a.colorType !== 2 || b.bitDepth !== 16 || b.colorType !== 2)
    throw new Error('the renders are not 16-bit RGB')
  const w = a.width
  const h = a.height
  const m = mask ? decodePng(readFileSync(mask.path)) : null
  if (m && (m.bitDepth !== 8 || m.colorType !== 0))
    throw new Error('the mask is not an 8-bit grey plane')
  const alpha = new Uint16Array(w * h)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const o = i * 6
      let differs = false
      for (let c = 0; c < 6; c++)
        if (a.rows[o + c] !== b.rows[o + c]) {
          differs = true
          break
        }
      if (!differs) continue
      let v = 65535
      if (m && mask) {
        const mx = mask.at.x + x
        const my = mask.at.y + y
        v = mx < m.width && my < m.height ? m.rows[my * m.width + mx] * 257 : 0
        if (v === 0) continue
      }
      alpha[i] = v
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  if (x1 < 0) return null
  const pw = x1 - x0 + 1
  const ph = y1 - y0 + 1
  const rgba = new Uint16Array(pw * ph * 4)
  for (let y = 0; y < ph; y++)
    for (let x = 0; x < pw; x++) {
      const i = (y0 + y) * w + (x0 + x)
      const o = i * 6
      const d = (y * pw + x) * 4
      rgba[d] = (a.rows[o] << 8) | a.rows[o + 1]
      rgba[d + 1] = (a.rows[o + 2] << 8) | a.rows[o + 3]
      rgba[d + 2] = (a.rows[o + 4] << 8) | a.rows[o + 5]
      rgba[d + 3] = alpha[i]
    }
  // The renders' colour (a RAW's linear light) goes with the patch.
  writeWhole(out, encodePng16(rgba, pw, ph, 4, 6, colourChunks(withBytes)))
  return { x: x0, y: y0, w: pw, h: ph }
}

/**
 * Where a float frame is not clipped, as an 8-bit grey plane (255 kept, 0
 * clipped): its brightest channel at or under GUARD_LOW is the step's to
 * change, at or over 1.0 the frame's own (an AI model clipped its input
 * there), with a linear ramp between. `rgb` is the frame's F32 samples.
 */
export const GUARD_LOW = 0.95

export function headroomGuard(rgb: Float32Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) {
    const m = Math.max(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])
    const k = (1 - m) / (1 - GUARD_LOW)
    out[i] = Math.round(255 * Math.min(1, Math.max(0, k)))
  }
  return out
}

/**
 * A step's overlay (16-bit RGB or RGBA PNG) with its alpha multiplied by the
 * frame's headroom guard (8-bit grey, the frame's size), the overlay's top
 * left at `at` on the frame: under it the float frame keeps what the step's
 * model clipped (engine 0.18: a RAW's master is Scene in float).
 */
export function guardOverlay(
  src: string,
  guard: string,
  out: string,
  at: { x: number; y: number }
): void {
  const bytes = readFileSync(src)
  const img = decodePng(bytes)
  if (img.bitDepth !== 16 || (img.colorType !== 2 && img.colorType !== 6))
    throw new Error('the step overlay is not 16-bit RGB or RGBA')
  const g = decodePng(readFileSync(guard))
  if (g.bitDepth !== 8 || g.colorType !== 0) throw new Error('the guard is not an 8-bit grey plane')
  const ch = img.colorType === 6 ? 4 : 3
  const n = img.width * img.height
  const rgba = new Uint16Array(n * 4)
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = y * img.width + x
      const s = i * ch * 2
      const d = i * 4
      for (let c = 0; c < 3; c++) rgba[d + c] = (img.rows[s + c * 2] << 8) | img.rows[s + c * 2 + 1]
      const a = ch === 4 ? (img.rows[s + 6] << 8) | img.rows[s + 7] : 65535
      const gx = Math.min(g.width - 1, x + at.x)
      const gy = Math.min(g.height - 1, y + at.y)
      rgba[d + 3] = Math.round((a * g.rows[gy * g.width + gx]) / 255)
    }
  writeWhole(out, encodePng16(rgba, img.width, img.height, 4, 1, colourChunks(bytes)))
}
