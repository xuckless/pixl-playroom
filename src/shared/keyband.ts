/**
 * A range mask's band (`KeyBand`: centre, width, softness) as a strip the
 * panel drags: a plateau `width` wide about `centre` at full strength, and
 * shoulders `softness` long either side (the engine's and the loupe's
 * `band`). Hue wraps at 360; saturation and luminance run 0…1.
 */
import type { KeyBand } from './engine-types'

/** Which part of the band a press takes hold of. */
export type BandPart = 'centre' | 'width-left' | 'width-right' | 'soft-left' | 'soft-right'

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** `v` folded into 0…max (hue), or clamped to it. */
export function bandValue(v: number, max: number, periodic: boolean): number {
  return periodic ? ((v % max) + max) % max : clamp(v, 0, max)
}

/** The distance from `a` to `b` along the strip (the short way round, for hue). */
function gap(a: number, b: number, max: number, periodic: boolean): number {
  const d = Math.abs(a - b)
  return periodic ? Math.min(d, max - d) : d
}

/** Whether `v` falls on the band's plateau. */
export function inPlateau(b: KeyBand, v: number, max: number, periodic: boolean): boolean {
  return gap(b.centre, v, max, periodic) <= b.width / 2
}

/** Where the band's handles sit: its plateau's edges and its shoulders' ends. */
export function bandHandles(b: KeyBand): Record<Exclude<BandPart, 'centre'>, number> {
  const half = b.width / 2
  return {
    'width-left': b.centre - half,
    'width-right': b.centre + half,
    'soft-left': b.centre - half - b.softness,
    'soft-right': b.centre + half + b.softness
  }
}

/**
 * The part a press at `v` takes: the nearest handle within `reach` (in the
 * band's units), else the centre (moved to `v` first when outside the plateau).
 */
export function bandPart(
  b: KeyBand,
  v: number,
  max: number,
  periodic: boolean,
  reach: number
): BandPart {
  let best: BandPart = 'centre'
  let near = reach
  for (const [part, at] of Object.entries(bandHandles(b)) as [BandPart, number][]) {
    const d = gap(bandValue(at, max, periodic), v, max, periodic)
    if (d <= near) {
      near = d
      best = part
    }
  }
  return best
}

/** The band after `part` moves by `dv` (in the band's units) from `from`. */
export function dragBand(
  from: KeyBand,
  part: BandPart,
  dv: number,
  max: number,
  periodic: boolean
): KeyBand {
  switch (part) {
    case 'centre':
      return { ...from, centre: bandValue(from.centre + dv, max, periodic) }
    case 'width-left':
      return { ...from, width: clamp(from.width - 2 * dv, 0, max) }
    case 'width-right':
      return { ...from, width: clamp(from.width + 2 * dv, 0, max) }
    case 'soft-left':
      return { ...from, softness: clamp(from.softness - dv, 0, max) }
    case 'soft-right':
      return { ...from, softness: clamp(from.softness + dv, 0, max) }
  }
}

/**
 * The band's outline over a strip `w` wide and `h` tall, as SVG polygon
 * points: one trapezoid, or for hue the copies either side that wrap into view.
 */
export function bandOutline(
  b: KeyBand,
  max: number,
  periodic: boolean,
  w: number,
  h: number
): string[] {
  const x = (v: number): number => (v / max) * w
  const half = b.width / 2
  const shape = (c: number): string =>
    [
      [x(c - half - b.softness), h],
      [x(c - half), 0],
      [x(c + half), 0],
      [x(c + half + b.softness), h]
    ]
      .map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`)
      .join(' ')
  if (!periodic) return [shape(b.centre)]
  return [b.centre - max, b.centre, b.centre + max].map(shape)
}
