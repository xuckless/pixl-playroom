/**
 * Painting a brush mask, the engine's way (0.21.0, E36): a stroke's strength
 * is its `flow` (the brush's Density) times the pen's pressure at each dab;
 * within a stroke the maximum is taken, so going back over it builds nothing
 * up; strokes combine by screen (`m + s·(1 − m)`), and an erase stroke takes
 * itself out (`m·(1 − s)`). Auto Mask weighs each pixel of a dab by how
 * close its colour is to the colour under the brush's centre.
 *
 * `paintStrokes` is the engine's rasteriser (`mask_stroke.rs`) in
 * TypeScript: capsules between consecutive dabs, the radius and pressure
 * running linearly along each, sampled at pixel centres. It draws what the
 * engine draws where Playroom needs a stroke's plane itself: the loupe's
 * own mask, a stroke kept to an object, a brush painted into one plane.
 *
 * Planes here are Float32Arrays of 0…1, row by row.
 */

const smooth = (e0: number, e1: number, x: number): number => {
  if (e1 <= e0) return x < e0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Stamp one dab into a stroke plane: the larger of what is there and the
 * dab, never more. `softness` 0…100 is how much of the radius fades;
 * `flow` 0…1 is the dab's strength (the stroke's flow times the pressure);
 * `weight(x, y)` (Auto Mask) scales it per pixel.
 */
export function stampDab(
  stroke: Float32Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
  softness: number,
  flow: number,
  weight?: (x: number, y: number) => number
): void {
  if (r <= 0 || flow <= 0) return
  const inner = r * (1 - Math.min(100, Math.max(0, softness)) / 100)
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(h - 1, Math.ceil(cy + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy)
      if (d > r) continue
      let a = flow * (1 - smooth(inner, r, d))
      if (weight) a *= weight(x, y)
      const i = y * w + x
      if (a > stroke[i]) stroke[i] = a
    }
  }
}

/** The mask after a stroke: painting screens it over what was there; erasing takes it away. */
export function composeStroke(
  plane: Float32Array,
  stroke: Float32Array,
  erase: boolean
): Float32Array {
  const out = new Float32Array(plane.length)
  for (let i = 0; i < plane.length; i++) {
    const s = Math.min(1, Math.max(0, stroke[i]))
    out[i] = erase ? plane[i] * (1 - s) : plane[i] + s * (1 - plane[i])
  }
  return out
}

/** A stroke as `paintStrokes` takes it: the recipe's (`BrushStrokeSetting`), turned or not. */
export interface StrokeLike {
  /** x, y, radius, pressure for each dab: fractions of the frame, the radius of its shorter side. */
  dabs: number[]
  /** 0…1 of a dab's radius that fades. */
  softness: number
  /** 0…1 */
  flow: number
  erase?: boolean
}

/**
 * Strokes painted onto `plane` (`w × h`) in order, as the engine paints
 * them: each the maximum over its capsules, screened over the plane, or an
 * erase stroke taken out of it.
 */
export function paintStrokes(
  plane: Float32Array,
  w: number,
  h: number,
  strokes: StrokeLike[]
): void {
  const short = Math.min(w, h)
  for (const s of strokes) {
    const n = Math.floor(s.dabs.length / 4)
    if (n === 0 || !(s.flow > 0)) continue
    const at = (k: number): [number, number, number, number] => [
      s.dabs[k * 4] * w,
      s.dabs[k * 4 + 1] * h,
      s.dabs[k * 4 + 2] * short,
      s.dabs[k * 4 + 3]
    ]
    // The stroke's own box, where its coverage is gathered before it joins.
    let bx0 = Infinity
    let by0 = Infinity
    let bx1 = -Infinity
    let by1 = -Infinity
    for (let k = 0; k < n; k++) {
      const [x, y, r] = at(k)
      bx0 = Math.min(bx0, x - r - 1)
      by0 = Math.min(by0, y - r - 1)
      bx1 = Math.max(bx1, x + r + 1)
      by1 = Math.max(by1, y + r + 1)
    }
    const x0 = Math.max(0, Math.floor(bx0))
    const y0 = Math.max(0, Math.floor(by0))
    const x1 = Math.min(w - 1, Math.ceil(bx1))
    const y1 = Math.min(h - 1, Math.ceil(by1))
    if (x1 < x0 || y1 < y0) continue
    const bw = x1 - x0 + 1
    const cover = new Float32Array(bw * (y1 - y0 + 1))
    const soft = Math.min(1, Math.max(0, s.softness))
    for (let k = 0; k < Math.max(1, n - 1); k++) {
      const [ax, ay, ra, pa] = at(k)
      const [bxx, byy, rb, pb] = n === 1 ? [ax, ay, ra, pa] : at(k + 1)
      const dx = bxx - ax
      const dy = byy - ay
      const dd = dx * dx + dy * dy
      const g = Math.max(ra, rb) + 1
      const sx0 = Math.max(x0, Math.floor(Math.min(ax, bxx) - g))
      const sy0 = Math.max(y0, Math.floor(Math.min(ay, byy) - g))
      const sx1 = Math.min(x1, Math.ceil(Math.max(ax, bxx) + g))
      const sy1 = Math.min(y1, Math.ceil(Math.max(ay, byy) + g))
      for (let y = sy0; y <= sy1; y++) {
        const py = y + 0.5
        for (let x = sx0; x <= sx1; x++) {
          const vx = x + 0.5 - ax
          const vy = py - ay
          const t = dd > 0 ? Math.min(1, Math.max(0, (vx * dx + vy * dy) / dd)) : 0
          const qx = vx - t * dx
          const qy = vy - t * dy
          const r = ra + t * (rb - ra)
          const d2 = qx * qx + qy * qy
          if (!(r > 0) || d2 > r * r) continue
          const rho = Math.sqrt(d2) / r
          let f = 1
          if (soft > 0) {
            const u = Math.min(1, Math.max(0, (1 - rho) / soft))
            f = u * u * (3 - 2 * u)
          }
          const v = (pa + t * (pb - pa)) * f
          const i = (y - y0) * bw + (x - x0)
          if (v > cover[i]) cover[i] = v
        }
      }
    }
    const flow = Math.min(1, s.flow)
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = flow * cover[(y - y0) * bw + (x - x0)]
        if (c <= 0) continue
        const i = y * w + x
        plane[i] = s.erase ? plane[i] * (1 - c) : plane[i] + c * (1 - plane[i])
      }
    }
  }
}

/** sRGB 0…255 to CIE L*a*b* (D65). */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number): number => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  const fx = f(X)
  const fy = f(Y)
  const fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function deltaE(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Auto Mask's weight for a colour `d` ΔE away from the brush's centre: full under 6, none past 18. */
export function autoMaskWeight(d: number): number {
  return 1 - smooth(6, 18, d)
}
