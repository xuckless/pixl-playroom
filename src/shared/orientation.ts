/**
 * The eight EXIF orientations as a group, so a file's own orientation and the
 * user's quarter turns and flips compose into the one `Framing.orientation`
 * the engine takes.
 *
 * Each orientation is a 2×2 integer matrix acting on centred coordinates of a
 * point (x right, y down): `shown = M · stored`. The matrices match the
 * engine's `framing::Orientation::source_of` exactly (see the test).
 */
import type { Orientation } from './engine-types'

type M2 = [[number, number], [number, number]]

const MATRICES: Record<Orientation, M2> = {
  Normal: [
    [1, 0],
    [0, 1]
  ],
  FlipHorizontal: [
    [-1, 0],
    [0, 1]
  ],
  Rotate180: [
    [-1, 0],
    [0, -1]
  ],
  FlipVertical: [
    [1, 0],
    [0, -1]
  ],
  Transpose: [
    [0, 1],
    [1, 0]
  ],
  Rotate90: [
    [0, -1],
    [1, 0]
  ],
  Transverse: [
    [0, -1],
    [-1, 0]
  ],
  Rotate270: [
    [0, 1],
    [-1, 0]
  ]
}

const EXIF_ORDER: Orientation[] = [
  'Normal',
  'FlipHorizontal',
  'Rotate180',
  'FlipVertical',
  'Transpose',
  'Rotate90',
  'Transverse',
  'Rotate270'
]

/** The orientation an EXIF value names; anything outside 1–8 is `Normal`. */
export function fromExif(value: number): Orientation {
  return EXIF_ORDER[value - 1] ?? 'Normal'
}

export function toExif(o: Orientation): number {
  return EXIF_ORDER.indexOf(o) + 1
}

export function matrixOf(o: Orientation): M2 {
  return MATRICES[o]
}

function mul(a: M2, b: M2): M2 {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]]
  ]
}

function fromMatrix(m: M2): Orientation {
  for (const o of EXIF_ORDER) {
    const n = MATRICES[o]
    if (n[0][0] === m[0][0] && n[0][1] === m[0][1] && n[1][0] === m[1][0] && n[1][1] === m[1][1])
      return o
  }
  return 'Normal'
}

/** `after` applied to what `first` produced. */
export function compose(first: Orientation, after: Orientation): Orientation {
  return fromMatrix(mul(MATRICES[after], MATRICES[first]))
}

/** The user's own turn: `quarterTurns` clockwise, then an optional mirror. */
export function userOrientation(quarterTurns: number, flipHorizontal: boolean): Orientation {
  const turns = ((quarterTurns % 4) + 4) % 4
  let o: Orientation = (['Normal', 'Rotate90', 'Rotate180', 'Rotate270'] as const)[turns]
  if (flipHorizontal) o = compose(o, 'FlipHorizontal')
  return o
}

export function swapsAxes(o: Orientation): boolean {
  return MATRICES[o][0][0] === 0
}

/**
 * A normalised point (0…1 on each axis) of a frame, moved to where it lands
 * after the frame is turned by `o`. Normalised coordinates survive the swap of
 * axes because each axis stays a fraction of its own side.
 */
export function transformPoint(
  o: Orientation,
  p: { x: number; y: number }
): { x: number; y: number } {
  const m = MATRICES[o]
  const cx = p.x - 0.5
  const cy = p.y - 0.5
  return { x: m[0][0] * cx + m[0][1] * cy + 0.5, y: m[1][0] * cx + m[1][1] * cy + 0.5 }
}

/** The inverse orientation. */
export function inverse(o: Orientation): Orientation {
  const m = MATRICES[o]
  // Orthogonal integer matrices: the inverse is the transpose.
  return fromMatrix([
    [m[0][0], m[1][0]],
    [m[0][1], m[1][1]]
  ])
}

/**
 * Where output pixel `(dx, dy)` of a `w × h` image turned by `o` reads from —
 * the engine's `source_of`, for turning a painted mask the same way.
 */
export function sourceOf(
  o: Orientation,
  dx: number,
  dy: number,
  w: number,
  h: number
): [number, number] {
  switch (o) {
    case 'Normal':
      return [dx, dy]
    case 'FlipHorizontal':
      return [w - 1 - dx, dy]
    case 'Rotate180':
      return [w - 1 - dx, h - 1 - dy]
    case 'FlipVertical':
      return [dx, h - 1 - dy]
    case 'Transpose':
      return [dy, dx]
    case 'Rotate90':
      return [dy, h - 1 - dx]
    case 'Transverse':
      return [w - 1 - dy, h - 1 - dx]
    case 'Rotate270':
      return [w - 1 - dy, dx]
  }
}

/** Turn a single-channel 8-bit plane by `o`. */
export function orientPlane(
  o: Orientation,
  data: Uint8Array,
  w: number,
  h: number
): { data: Uint8Array; width: number; height: number } {
  if (o === 'Normal') return { data, width: w, height: h }
  const [ow, oh] = swapsAxes(o) ? [h, w] : [w, h]
  const out = new Uint8Array(ow * oh)
  for (let dy = 0; dy < oh; dy++) {
    for (let dx = 0; dx < ow; dx++) {
      const [sx, sy] = sourceOf(o, dx, dy, w, h)
      out[dy * ow + dx] = data[sy * w + sx]
    }
  }
  return { data: out, width: ow, height: oh }
}
