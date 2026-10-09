/**
 * A person's parts from Selfie Multiclass's planes (ai/segment.ts): where
 * the person is, the square the model reads around them, its planes laid
 * back, and each part kept where it beats the others. Pure, for
 * tests/namedmasks.test.ts.
 */

/** Where a part is told from the others, in 8-bit levels either side of a tie. */
const PART_MARGIN = 24

export type Plane8 = { name: string; data: Uint8Array; width: number; height: number }

/** The box around where any part is at least even odds, or null: no person. */
export function personBox(
  planes: Plane8[],
  w: number,
  h: number
): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (planes.some((p) => p.data[i] >= 128)) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** A square around the box, 15 % larger, within the frame (the model reads a square). */
export function squareAround(
  b: { x0: number; y0: number; x1: number; y1: number },
  w: number,
  h: number
): { x: number; y: number; side: number } {
  const side = Math.round(Math.min(w, h, Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1) * 1.15))
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  return {
    x: Math.round(Math.max(0, Math.min(w - side, cx - side / 2))),
    y: Math.round(Math.max(0, Math.min(h - side, cy - side / 2))),
    side
  }
}

/** A plane made on the square, laid into a frame-sized one where the square was. */
export function pasted(
  p: Plane8,
  sq: { x: number; y: number; side: number },
  w: number,
  h: number
): Uint8Array {
  const out = new Uint8Array(w * h)
  // The crop's plane can differ from the square by a pixel's rounding: scaled to it.
  const sx = p.width / sq.side
  const sy = p.height / sq.side
  for (let y = 0; y < sq.side && sq.y + y < h; y++) {
    const py = Math.min(p.height - 1, Math.floor(y * sy))
    for (let x = 0; x < sq.side && sq.x + x < w; x++)
      out[(sq.y + y) * w + sq.x + x] =
        p.data[py * p.width + Math.min(p.width - 1, Math.floor(x * sx))]
  }
  return out
}

/**
 * The part's planes summed, kept where they beat every other part: full a
 * margin above the strongest other, none a margin below, a ramp between.
 */
export function partPlane(planes: Plane8[], wanted: string[], n: number): Uint8Array {
  const mine = planes.filter((p) => wanted.includes(p.name))
  const others = planes.filter((p) => !wanted.includes(p.name))
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let v = 0
    for (const p of mine) v += p.data[i]
    v = Math.min(255, v)
    let o = 0
    for (const p of others) if (p.data[i] > o) o = p.data[i]
    const t = Math.min(1, Math.max(0, (v - o + PART_MARGIN) / (2 * PART_MARGIN)))
    out[i] = Math.round(v * t)
  }
  return out
}
