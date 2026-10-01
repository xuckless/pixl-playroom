/**
 * The per-pixel work behind pixel steps, run in the pixels worker (it holds a
 * frame's worth of samples at a time). Pure: files in, files out.
 */
import { readFileSync, renameSync, writeFileSync } from 'fs'
import { decodePng, encodeGreyPng, encodePng16, pngSamples16 } from '../pngio'

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
  const img = decodePng(readFileSync(image))
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
  writeWhole(out, encodePng16(rgba, img.width, img.height, 4))
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
      const px = bil(0) * (w - 1)
      const py = bil(1) * (h - 1)
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
