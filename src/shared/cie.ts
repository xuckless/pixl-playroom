/**
 * CIE 1976 u'v' chromaticity geometry for the expanded colour scope: the
 * spectral locus, the working space's primaries and the reference gamuts, all
 * as u'v' points. Pure, for the chart and the tests. The image's own
 * chromaticity (its cloud and hull) is not drawn here: it needs the engine to
 * measure it (TODO.md, ENGINE REQUEST: u'v' and gamut coverage metrics).
 */

export interface Uv {
  u: number
  v: number
}

/** CIE 1931 xy to CIE 1976 u'v'. */
export function xyToUv(x: number, y: number): Uv {
  const d = -2 * x + 12 * y + 3
  return { u: (4 * x) / d, v: (9 * y) / d }
}

/** The spectral locus, 380–700 nm at 10 nm, as CIE 1931 2° xy. */
const LOCUS_XY: [number, number][] = [
  [0.1741, 0.005],
  [0.1738, 0.0049],
  [0.1733, 0.0048],
  [0.1726, 0.0048],
  [0.1714, 0.0051],
  [0.1689, 0.0069],
  [0.1644, 0.0109],
  [0.1566, 0.0177],
  [0.144, 0.0297],
  [0.1241, 0.0578],
  [0.0913, 0.1327],
  [0.0454, 0.295],
  [0.0082, 0.5384],
  [0.0139, 0.7502],
  [0.0743, 0.8338],
  [0.1547, 0.8059],
  [0.2296, 0.7543],
  [0.3016, 0.6923],
  [0.3731, 0.6245],
  [0.4441, 0.5547],
  [0.5125, 0.4866],
  [0.5752, 0.4242],
  [0.627, 0.3725],
  [0.6658, 0.334],
  [0.6915, 0.3083],
  [0.7079, 0.292],
  [0.719, 0.2809],
  [0.726, 0.274],
  [0.73, 0.27],
  [0.732, 0.268],
  [0.7334, 0.2666],
  [0.7344, 0.2656],
  [0.7347, 0.2653]
]

export const SPECTRAL_LOCUS: Uv[] = LOCUS_XY.map(([x, y]) => xyToUv(x, y))

/** Where a colour space's red, green and blue are, and its white, in CIE 1931 xy. */
export interface Gamut {
  id: 'pixlrgb' | 'srgb' | 'p3' | 'adobe' | 'rec2020'
  name: string
  r: Uv
  g: Uv
  b: Uv
}

const D65_XY: [number, number] = [0.3127, 0.329]
/** Every space here is D65: the white point of the chart. */
export const WHITE_POINT: Uv = xyToUv(...D65_XY)

const gamut = (
  id: Gamut['id'],
  name: string,
  r: [number, number],
  g: [number, number],
  b: [number, number]
): Gamut => ({ id, name, r: xyToUv(...r), g: xyToUv(...g), b: xyToUv(...b) })

/**
 * PixlRGB, the engine's working space (0.17): its primaries enclose the whole
 * visible locus, so the chart is framed by it and it is always drawn.
 */
export const PIXLRGB: Gamut = gamut(
  'pixlrgb',
  'PixlRGB',
  [0.736, 0.2644],
  [-0.3256, 1.3204],
  [0.1414, -0.0105]
)

/** The spaces the Reference tab can lay over the chart. */
export const REFERENCE_GAMUTS: Gamut[] = [
  gamut('srgb', 'sRGB', [0.64, 0.33], [0.3, 0.6], [0.15, 0.06]),
  gamut('p3', 'Display P3', [0.68, 0.32], [0.265, 0.69], [0.15, 0.06]),
  gamut('adobe', 'Adobe RGB', [0.64, 0.33], [0.21, 0.71], [0.15, 0.06]),
  gamut('rec2020', 'Rec.2020', [0.708, 0.292], [0.17, 0.797], [0.131, 0.046])
]

export const gamutPoints = (g: Gamut): Uv[] => [g.r, g.g, g.b]

/** Whether `p` is inside the triangle `t` (edges count). */
export function inTriangle(p: Uv, t: Uv[]): boolean {
  const [a, b, c] = t
  const side = (p1: Uv, p2: Uv, p3: Uv): number =>
    (p1.u - p3.u) * (p2.v - p3.v) - (p2.u - p3.u) * (p1.v - p3.v)
  const d1 = side(p, a, b)
  const d2 = side(p, b, c)
  const d3 = side(p, c, a)
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/** The chart's frame in u'v': PixlRGB's triangle with a margin, so nothing sits on the edge. */
export function chartBounds(margin = 0.03): { u0: number; u1: number; v0: number; v1: number } {
  const pts = gamutPoints(PIXLRGB)
  return {
    u0: Math.min(...pts.map((p) => p.u)) - margin,
    u1: Math.max(...pts.map((p) => p.u)) + margin,
    v0: Math.min(...pts.map((p) => p.v)) - margin,
    v1: Math.max(...pts.map((p) => p.v)) + margin
  }
}

/**
 * The colour to paint at a chromaticity, for the chart's horseshoe: u'v' at
 * full brightness in sRGB, a colour outside sRGB shown at its nearest
 * (negative channels dropped), 0…255.
 */
export function uvToRgb(u: number, v: number): [number, number, number] {
  const d = 6 * u - 16 * v + 12
  if (!(d > 0)) return [0, 0, 0]
  const x = (9 * u) / d
  const y = (4 * v) / d
  if (!(y > 0)) return [0, 0, 0]
  const X = x / y
  const Z = (1 - x - y) / y
  const lin = [
    3.2404542 * X - 1.5371385 - 0.4985314 * Z,
    -0.969266 * X + 1.8760108 + 0.041556 * Z,
    0.0556434 * X - 0.2040259 + 1.0572252 * Z
  ].map((c) => Math.max(0, c))
  const top = Math.max(...lin, 1e-9)
  return lin.map((c) => {
    const e = c / top
    return Math.round(255 * (e <= 0.0031308 ? e * 12.92 : 1.055 * e ** (1 / 2.4) - 0.055))
  }) as [number, number, number]
}
