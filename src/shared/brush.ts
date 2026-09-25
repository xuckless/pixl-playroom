/**
 * Painting a brush mask, the way Lightroom's brush behaves: each dab lays
 * down `flow` of paint, building up where strokes cross; a stroke never
 * exceeds its `density`; and the stroke joins the mask as a union (or, when
 * erasing, takes itself out). Auto Mask weighs each pixel of a dab by how
 * close its colour is to the colour under the brush's centre.
 *
 * Planes here are Float32Arrays of 0…1, row by row.
 */

const smooth = (e0: number, e1: number, x: number): number => {
  if (e1 <= e0) return x < e0 ? 0 : 1
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * Stamp one dab into a stroke plane. `softness` 0…100 is how much of the
 * radius fades; `flow` 0…1 is what one dab adds; `weight(x, y)` (Auto Mask)
 * scales it per pixel.
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
      if (a <= 0) continue
      const i = y * w + x
      stroke[i] = stroke[i] + a * (1 - stroke[i])
    }
  }
}

/**
 * The mask after a stroke: painting unites the stroke (capped at
 * `density`) with what was there; erasing takes the capped stroke away.
 */
export function composeStroke(
  plane: Float32Array,
  stroke: Float32Array,
  density: number,
  erase: boolean
): Float32Array {
  const cap = Math.min(1, Math.max(0, density))
  const out = new Float32Array(plane.length)
  for (let i = 0; i < plane.length; i++) {
    const s = Math.min(stroke[i], cap)
    out[i] = erase ? plane[i] * (1 - s) : plane[i] + s * (1 - plane[i])
  }
  return out
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
