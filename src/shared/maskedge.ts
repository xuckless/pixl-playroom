/**
 * A mask component's edge, moved and sharpened (`MaskEdge` on a component).
 * An AI plane is soft (the model's probabilities) and low resolution, and a
 * feather is symmetric about its edge: both reach past what was meant.
 *
 * - `shift` −100…100 contracts or expands the edge, 100 being EDGE_SHIFT_SPAN
 *   of the frame's shorter side. A raster plane (painted, AI, gradient) is
 *   eroded or dilated by a square min/max filter of that many of its pixels;
 *   a lasso's polygon is offset.
 * - `harden` 0…100 steepens a soft edge about its middle (a levels curve
 *   through 50%): 0 leaves it, 100 makes it ten times as steep. Rasters only.
 * - `inside` (a lasso) moves the line in by the feather's radius too, so the
 *   feather falls inside what was drawn rather than half outside it.
 *
 * Pure: the pixels worker writes planes with it, the compiler offsets
 * lassos, and the loupe's live preview follows the same numbers.
 */

export interface MaskEdge {
  /** −100…100: contract (−) or expand (+). */
  shift: number
  /** 0…100. */
  harden: number
  /** A lasso's feather kept inside its line. */
  inside?: boolean
}

/** What a `shift` of 100 moves the edge by, as a fraction of the frame's shorter side. */
export const EDGE_SHIFT_SPAN = 0.03

/** How steep `harden` 100 makes the edge. */
const HARDEST = 10

/** An edge that changes nothing (absent counts as this). */
export function isPlainEdge(e: MaskEdge | undefined): boolean {
  return !e || (Math.round(e.shift) === 0 && Math.round(e.harden) === 0 && !e.inside)
}

/** A component's edge as stored: in range, whole numbers, absent when it changes nothing. */
export function normaliseEdge(value: unknown): MaskEdge | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const n = (x: unknown, lo: number, hi: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? Math.round(Math.min(hi, Math.max(lo, x))) : 0
  const e: MaskEdge = {
    shift: n(v.shift, -100, 100),
    harden: n(v.harden, 0, 100),
    ...(v.inside === true ? { inside: true } : {})
  }
  return isPlainEdge(e) ? undefined : e
}

/** The part of a plane file's name that says how its edge was made ('' for none). */
export function edgeKey(e: MaskEdge | undefined): string {
  if (!e || (Math.round(e.shift) === 0 && Math.round(e.harden) === 0)) return ''
  return `-e${Math.round(e.shift)}h${Math.round(e.harden)}`
}

/** How many of a `w × h` plane's pixels a `shift` moves the edge by. */
export function shiftPixels(shift: number, w: number, h: number): number {
  return Math.round((Math.abs(shift) / 100) * EDGE_SHIFT_SPAN * Math.min(w, h))
}

/**
 * One row or column of a min (erode) or max (dilate) filter over a window
 * of `2r + 1`, written to `out` (van Herk / Gil-Werman: three passes,
 * whatever `r`). The line is padded with its end pixels, so every window
 * is whole and a mask touching the frame's edge stays touching it.
 */
function filterLine(
  src: Uint8Array,
  out: Uint8Array,
  start: number,
  stride: number,
  n: number,
  r: number,
  grow: boolean,
  pad: Uint8Array,
  g: Uint8Array,
  hb: Uint8Array
): void {
  const pick = grow ? Math.max : Math.min
  const size = 2 * r + 1
  const m = n + 2 * r
  for (let j = 0; j < m; j++) pad[j] = src[start + Math.min(n - 1, Math.max(0, j - r)) * stride]
  // Running from each block's start (g) and back from its end (hb).
  for (let j = 0; j < m; j++) g[j] = j % size === 0 ? pad[j] : pick(g[j - 1], pad[j])
  for (let j = m - 1; j >= 0; j--)
    hb[j] = j === m - 1 || (j + 1) % size === 0 ? pad[j] : pick(hb[j + 1], pad[j])
  // The window of pixel i is padded [i, i + 2r]: exactly one block long.
  for (let i = 0; i < n; i++) out[start + i * stride] = pick(hb[i], g[i + 2 * r])
}

/**
 * A plane eroded (`grow` false) or dilated by `r` pixels, through an
 * octagon of that radius (round enough that a circle stays a circle): a
 * square of r·(√2 − 1), rows then columns, then a diamond of the rest, as
 * the two diagonals. Each pass is linear in the pixels, whatever `r`.
 */
export function shiftPlane(
  data: Uint8Array,
  w: number,
  h: number,
  r: number,
  grow: boolean
): Uint8Array {
  if (r <= 0) return data
  // Along an axis the square reaches a and the diamond 2t: together exactly r.
  const t = Math.floor((r - Math.round(r * (Math.SQRT2 - 1))) / 2)
  const a = r - 2 * t
  const m = Math.max(w, h) + 2 * Math.max(a, t)
  const bufs = { pad: new Uint8Array(m), g: new Uint8Array(m), hb: new Uint8Array(m) }
  let cur = data
  const pass = (
    lines: (fn: (start: number, stride: number, n: number) => void) => void,
    rad: number
  ): void => {
    if (rad <= 0) return
    const out = new Uint8Array(cur.length)
    const src = cur
    lines((start, stride, n) =>
      filterLine(src, out, start, stride, n, rad, grow, bufs.pad, bufs.g, bufs.hb)
    )
    cur = out
  }
  // The square: rows, then columns.
  pass((f) => {
    for (let y = 0; y < h; y++) f(y * w, 1, w)
  }, a)
  pass((f) => {
    for (let x = 0; x < w; x++) f(x, w, h)
  }, a)
  // The diamond: down-right diagonals, then down-left ones.
  pass((f) => {
    for (let x = 0; x < w; x++) f(x, w + 1, Math.min(w - x, h))
    for (let y = 1; y < h; y++) f(y * w, w + 1, Math.min(w, h - y))
  }, t)
  pass((f) => {
    for (let x = 0; x < w; x++) f(x, w - 1, Math.min(x + 1, h))
    for (let y = 1; y < h; y++) f(y * w + w - 1, w - 1, Math.min(w, h - y))
  }, t)
  return cur
}

/** The levels curve `harden` makes: 256 entries, steeper about 128. */
export function hardenLut(harden: number): Uint8Array {
  const k = 1 + (Math.min(100, Math.max(0, harden)) / 100) * (HARDEST - 1)
  const lut = new Uint8Array(256)
  for (let v = 0; v < 256; v++)
    lut[v] = Math.round(Math.min(255, Math.max(0, (v - 127.5) * k + 127.5)))
  return lut
}

/** A plane with its edge moved and hardened (the same array when the edge changes nothing). */
export function applyEdge(
  data: Uint8Array,
  w: number,
  h: number,
  e: MaskEdge | undefined
): Uint8Array {
  if (!e) return data
  let out = shiftPlane(data, w, h, shiftPixels(e.shift, w, h), e.shift > 0)
  if (Math.round(e.harden) > 0) {
    const lut = hardenLut(e.harden)
    if (out === data) out = new Uint8Array(data)
    for (let i = 0; i < out.length; i++) out[i] = lut[out[i]]
  }
  return out
}

/**
 * A closed polygon (normalised points on a `width × height` frame) moved
 * out (`by` > 0) or in by `by`, a fraction of the frame's shorter side.
 * Each corner moves along the bisector of its edges' normals, at most twice
 * `by` away (a miter limit, so a sharp corner does not shoot out).
 */
export function offsetPolygon(
  points: { x: number; y: number }[],
  by: number,
  width: number,
  height: number
): { x: number; y: number }[] {
  const n = points.length
  if (n < 3 || by === 0) return points
  const short = Math.min(width, height)
  // In pixels, where a distance means the same along both axes.
  const p = points.map((q) => ({ x: q.x * width, y: q.y * height }))
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = p[i]
    const b = p[(i + 1) % n]
    area += a.x * b.y - b.x * a.y
  }
  // The outward normal of an edge a→b is (dy, −dx) when the shoelace sum is
  // positive (clockwise on screen, where y runs down), the opposite otherwise.
  const side = area < 0 ? -1 : 1
  const d = by * short
  const normal = (a: { x: number; y: number }, b: { x: number; y: number }): [number, number] => {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    return [(side * dy) / len, (-side * dx) / len]
  }
  return p.map((q, i) => {
    const prev = p[(i - 1 + n) % n]
    const next = p[(i + 1) % n]
    const [ax, ay] = normal(prev, q)
    const [bx, by2] = normal(q, next)
    let mx = ax + bx
    let my = ay + by2
    const ml = Math.hypot(mx, my)
    if (ml < 1e-9) {
      mx = ax
      my = ay
    } else {
      mx /= ml
      my /= ml
    }
    // How far along the bisector keeps the edges `d` away; capped at 2d.
    const cos = mx * ax + my * ay
    const reach = Math.min(2, 1 / Math.max(cos, 0.5)) * d
    return { x: (q.x + mx * reach) / width, y: (q.y + my * reach) / height }
  })
}
