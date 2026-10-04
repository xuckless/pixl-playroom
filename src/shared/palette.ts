/**
 * Colour maths for the scopes' metrics: sRGB ↔ linear, CIELAB, ΔE, hex, and a
 * dominant-colours palette by median cut. Pure, so the expanded scope and the
 * tests share it. Values are sRGB 0…255 unless a name says linear.
 */

export type Rgb8 = [number, number, number]
export type Lab = [number, number, number]

/** sRGB's decoding: 0…1 encoded to 0…1 linear. */
export const srgbToLinear = (v: number): number =>
  v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4

/** The inverse: linear 0…1 to encoded 0…1. */
export const linearToSrgb = (v: number): number =>
  v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055

const D65: [number, number, number] = [0.95047, 1, 1.08883]

/** sRGB 0…255 to CIELAB (D65). */
export function rgbToLab([r, g, b]: Rgb8): Lab {
  const lr = srgbToLinear(r / 255)
  const lg = srgbToLinear(g / 255)
  const lb = srgbToLinear(b / 255)
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / D65[0]
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / D65[1]
  const z = (0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / D65[2]
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const fx = f(x)
  const fy = f(y)
  const fz = f(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** The colour difference of two Lab colours (CIE76: the distance). */
export const deltaE = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** The difference in the a*b* plane only: how far apart two colours are in hue and chroma, lightness aside. */
export const chromaDiff = (a: Lab, b: Lab): number => Math.hypot(a[1] - b[1], a[2] - b[2])

export function hexOf([r, g, b]: Rgb8): string {
  const h = (v: number): string =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** An HSL colour (degrees, 0…1, 0…1) as sRGB 0…255. */
export function hslToRgb(h: number, s: number, l: number): Rgb8 {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x]
  const m = l - c / 2
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255]
}

/**
 * Where to cut sorted values in two so that the two halves are as tight as
 * they can be (the cut with the least summed squared deviation): at a gap
 * between two colours rather than at the middle of the count.
 */
function splitAt(sorted: number[]): number {
  const n = sorted.length
  const pre = new Float64Array(n + 1)
  const pre2 = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    pre[i + 1] = pre[i] + sorted[i]
    pre2[i + 1] = pre2[i] + sorted[i] * sorted[i]
  }
  const sse = (a: number, b: number): number => {
    const m = b - a
    const s = pre[b] - pre[a]
    return pre2[b] - pre2[a] - (s * s) / m
  }
  let best = Math.floor(n / 2)
  let bestCost = Infinity
  for (let i = 1; i < n; i++) {
    // A cut between equal values splits nothing.
    if (sorted[i - 1] === sorted[i]) continue
    const cost = sse(0, i) + sse(i, n)
    if (cost < bestCost) {
      bestCost = cost
      best = i
    }
  }
  return best
}

export interface Swatch {
  rgb: Rgb8
  /** The fraction of the picture's pixels it stands for. */
  share: number
  hex: string
  lab: Lab
}

/**
 * The picture's dominant colours by median cut: the pixels are split along
 * their widest channel at the median until there are `k` boxes, each box one
 * swatch (its mean). `rgba` is interleaved RGBA 8-bit; transparent pixels are
 * left out. Most of the picture first.
 */
export function dominantColours(
  rgba: ArrayLike<number>,
  k = 6,
  /** Pixels read at most: a long picture is strided. */
  limit = 20000
): Swatch[] {
  const n = Math.floor(rgba.length / 4)
  const stride = Math.max(1, Math.floor(n / limit))
  const px: Rgb8[] = []
  for (let i = 0; i < n; i += stride) {
    if (rgba[i * 4 + 3] < 128) continue
    px.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]])
  }
  if (px.length === 0) return []
  let boxes: Rgb8[][] = [px]
  while (boxes.length < k) {
    // Split the box with the widest spread (and more than one colour).
    let best = -1
    let bestRange = 0
    let bestChannel = 0
    boxes.forEach((box, bi) => {
      if (box.length < 2) return
      for (let c = 0; c < 3; c++) {
        let lo = 255
        let hi = 0
        for (const p of box) {
          if (p[c] < lo) lo = p[c]
          if (p[c] > hi) hi = p[c]
        }
        if (hi - lo > bestRange) {
          bestRange = hi - lo
          best = bi
          bestChannel = c
        }
      }
    })
    if (best < 0 || bestRange === 0) break
    const box = boxes[best].slice().sort((a, b) => a[bestChannel] - b[bestChannel])
    const at = splitAt(box.map((p) => p[bestChannel]))
    boxes = [...boxes.slice(0, best), box.slice(0, at), box.slice(at), ...boxes.slice(best + 1)]
  }
  return boxes
    .filter((b) => b.length > 0)
    .map((box) => {
      const sum = box.reduce<Rgb8>((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0])
      const rgb: Rgb8 = [
        Math.round(sum[0] / box.length),
        Math.round(sum[1] / box.length),
        Math.round(sum[2] / box.length)
      ]
      return { rgb, share: box.length / px.length, hex: hexOf(rgb), lab: rgbToLab(rgb) }
    })
    .sort((a, b) => b.share - a.share)
}
