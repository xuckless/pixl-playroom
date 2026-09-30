/**
 * Retouching (the wheel's Heal tool): heal, clone and content-aware fill
 * spots, and red-eye and pet-eye corrections, as the engine's
 * `ConvertRequest.retouch` runs them — after the lens correction, before the
 * grade and framing, in the order they were made.
 *
 * Spots are stored like masks: positions as fractions of the *base* frame
 * (the file upright, before the user's turns), radii as fractions of its
 * shorter side, so they stay on their subject whatever the framing does;
 * `compileRetouch` turns them into the oriented frame the engine works in.
 * A heal or clone keeps its source as a point, not an offset, for the same
 * reason.
 */
import type { Ellipse, Feather, Orientation, Retouch, RetouchStep, SpotShape } from './engine-types'
import { transformPoint } from './orientation'

export type SpotKind = 'heal' | 'clone' | 'fill' | 'redeye' | 'peteye'

export interface P {
  x: number
  y: number
}

export interface RetouchSpot {
  id: string
  kind: SpotKind
  enabled: boolean
  /**
   * Where it is: one point (a round spot, or an eye's centre) or a stroke's
   * points, base-frame fractions.
   */
  points: P[]
  /** A spot's or stroke's radius; an eye's horizontal radius. Fraction of the shorter side. */
  radius: number
  /** An eye's vertical radius (fraction of the shorter side) and turn, degrees. */
  radiusY: number
  rotate: number
  /** Heal and clone: where the pixels come from (the spot's first point moved there). */
  source: P | null
  /** 0…100: the edge's softness, up to half the radius. */
  feather: number
  /** 0…100 */
  opacity: number
  /** Red eye: 0…100 each. */
  desaturate: number
  darken: number
  /** Pet eye: 0…100 each. */
  amount: number
  pupilLevel: number
}

export const SPOT_LABEL: Record<SpotKind, string> = {
  heal: 'Heal',
  clone: 'Clone',
  fill: 'Fill',
  redeye: 'Red eye',
  peteye: 'Pet eye'
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5

/** A feather's radius in shorter-side fractions: up to half the spot's radius. */
export function featherOf(s: Pick<RetouchSpot, 'feather' | 'radius'>): Feather {
  return { radius: round5((clamp(s.feather, 0, 100) / 100) * 0.5 * s.radius), edge: 'Zero' }
}

/** The engine's shape for a spot's points, in whatever frame the points are in. */
export function spotShape(points: P[], radius: number): SpotShape {
  const r = round5(clamp(radius, 1e-4, 0.5))
  if (points.length <= 1) {
    const c = points[0] ?? { x: 0.5, y: 0.5 }
    return { Circle: { centre: { x: round5(c.x), y: round5(c.y) }, radius: r } }
  }
  return {
    Stroke: {
      points: points.slice(0, 4096).map((p) => ({ x: round5(p.x), y: round5(p.y) })),
      radius: r
    }
  }
}

/**
 * The reach of a spot in frame fractions per axis — its points, its radius
 * and its feather's reach (three times its radius) — for a `w × h` frame.
 */
function reach(
  points: P[],
  radius: number,
  feather: number,
  w: number,
  h: number
): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  const short = Math.min(w, h)
  const rx = ((radius + 3 * feather) * short) / w
  const ry = ((radius + 3 * feather) * short) / h
  return {
    minX: Math.min(...points.map((p) => p.x)) - rx,
    maxX: Math.max(...points.map((p) => p.x)) + rx,
    minY: Math.min(...points.map((p) => p.y)) - ry,
    maxY: Math.max(...points.map((p) => p.y)) + ry
  }
}

/**
 * The offset to the source, pulled back so everything it reads (the spot's
 * reach, and a heal's one-pixel ring) lies inside the frame, as the engine
 * requires; null when even no offset would fit (a spot at the frame's edge).
 */
export function fitOffset(
  offset: P,
  points: P[],
  radius: number,
  feather: number,
  w: number,
  h: number
): P | null {
  const r = reach(points, radius, feather, w, h)
  const ring = { x: 1.5 / w, y: 1.5 / h }
  const lo = { x: -(r.minX - ring.x), y: -(r.minY - ring.y) }
  const hi = { x: 1 - (r.maxX + ring.x), y: 1 - (r.maxY + ring.y) }
  if (lo.x > hi.x || lo.y > hi.y) return null
  return { x: clamp(offset.x, lo.x, hi.x), y: clamp(offset.y, lo.y, hi.y) }
}

/** A direction in pixels turned as the frame is turned (the orientation's own matrix). */
function turnVector(o: Orientation, dx: number, dy: number): { x: number; y: number } {
  const q = transformPoint(o, { x: 0.5 + dx, y: 0.5 + dy })
  return { x: q.x - 0.5, y: q.y - 0.5 }
}

/** An eye's ellipse, turned into the oriented frame. */
function eyeEllipse(s: RetouchSpot, o: Orientation): Ellipse {
  const c = transformPoint(o, s.points[0] ?? { x: 0.5, y: 0.5 })
  const th = (s.rotate * Math.PI) / 180
  const d = turnVector(o, Math.cos(th), Math.sin(th))
  const deg = (Math.atan2(d.y, d.x) * 180) / Math.PI
  return {
    centre: { x: round5(c.x), y: round5(c.y) },
    radius_x: round5(clamp(s.radius, 1e-4, 0.5)),
    radius_y: round5(clamp(s.radiusY || s.radius, 1e-4, 0.5)),
    rotate_degrees: round5(((deg + 540) % 360) - 180)
  }
}

/** The space spots blend and heal in: the look's own, where tone reads as the eye sees it. */
export const RETOUCH_SPACE = {
  Encoded: {
    space: 'DisplayP3' as const,
    intent: 'RelativeColorimetric' as const,
    black_point_compensation: false
  }
}

/**
 * The engine's retouch for the spots in the frame turned by `user` (the
 * user's quarter turns and flip; `Normal` for the base frame itself), on a
 * `w × h` frame (its shape decides which offsets fit). Spots that are off,
 * or whose source cannot fit inside the frame, are left out; null when none
 * is left.
 */
export function compileRetouch(
  spots: RetouchSpot[],
  user: Orientation,
  w: number,
  h: number
): Retouch | null {
  const swap = transformPoint(user, { x: 1, y: 0.5 }).y !== 0.5
  const fw = swap ? h : w
  const fh = swap ? w : h
  const steps: RetouchStep[] = []
  for (const s of spots) {
    if (!s.enabled || s.points.length === 0) continue
    const points = s.points.map((p) => transformPoint(user, p))
    const feather = featherOf(s)
    const opacity = clamp(s.opacity / 100, 0, 1)
    const shape = spotShape(points, s.radius)
    switch (s.kind) {
      case 'heal':
      case 'clone': {
        if (!s.source) continue
        const src = transformPoint(user, s.source)
        const want = { x: src.x - points[0].x, y: src.y - points[0].y }
        const off = fitOffset(want, points, s.radius, feather.radius, fw, fh)
        if (!off) continue
        const spot = {
          shape,
          source_offset: { x: round5(off.x), y: round5(off.y) },
          feather,
          opacity
        }
        steps.push(s.kind === 'heal' ? { Heal: spot } : { Clone: spot })
        break
      }
      case 'fill':
        steps.push({
          Fill: {
            shape,
            feather,
            opacity,
            patch: 7,
            iterations: 20,
            // Reproducible: the same spot fills the same way every render.
            seed: parseInt(s.id.replace(/[^0-9a-f]/gi, '').slice(0, 8) || '1', 16)
          }
        })
        break
      case 'redeye':
        steps.push({
          RedEye: {
            pupils: [eyeEllipse(s, user)],
            feather,
            desaturate: clamp(s.desaturate / 100, 0, 1),
            darken: clamp(s.darken / 100, 0, 1)
          }
        })
        break
      case 'peteye':
        steps.push({
          PetEye: {
            pupils: [eyeEllipse(s, user)],
            feather,
            amount: clamp(s.amount / 100, 0, 1),
            pupil_level: clamp(s.pupilLevel / 100, 0, 1)
          }
        })
        break
    }
  }
  return steps.length > 0 ? { space: RETOUCH_SPACE, steps } : null
}

/** A new spot of `kind` at `points` with the tool's current size, softness and strength. */
export function newSpot(
  id: string,
  kind: SpotKind,
  points: P[],
  radius: number,
  feather: number,
  opacity: number
): RetouchSpot {
  return {
    id,
    kind,
    enabled: true,
    points,
    radius,
    radiusY: radius,
    rotate: 0,
    source: null,
    feather,
    opacity,
    desaturate: 100,
    darken: 30,
    amount: 100,
    pupilLevel: 10
  }
}
