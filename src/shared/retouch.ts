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
import type {
  Ellipse,
  Feather,
  Orientation,
  Refine,
  Retouch,
  RetouchStep,
  SpotShape
} from './engine-types'
import { refineFor } from './refine'
import { transformPoint } from './orientation'
import { tk } from './i18n'

/** `remove`: an inpainting model fills it (MI-GAN, engine 0.18); baked at once, never live. */
export type SpotKind = 'heal' | 'clone' | 'fill' | 'remove' | 'redeye' | 'peteye'

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
  /**
   * Heal and clone: how the spot's edge meets the photo (engine 0.19.2,
   * Phase A §4.2). Absent is plain, as before; `edgeSnap` keeps the strong
   * edges a spot crosses; `matting` blends softer and wider. The owner's
   * three choices (2026-10-11).
   */
  refine?: SpotRefine
}

/** A heal's edge: the heal brush's setting, kept for every new spot until changed. */
export type SpotRefine = 'edgeSnap' | 'matting'
export type SpotRefineChoice = 'plain' | SpotRefine
export const SPOT_REFINES: SpotRefineChoice[] = ['plain', 'edgeSnap', 'matting']

/** The long edge of the smallest frame spots are rendered on (the develop view's draft). */
const SMALLEST_RENDER = 1280

/** The shorter side, in pixels, of the smallest render of a `w × h` frame. */
function smallestShort(w: number, h: number): number {
  return Math.min(w, h) * Math.min(1, SMALLEST_RENDER / Math.max(w, h))
}

/**
 * The engine's refine for a heal or clone spot on a `w × h` frame, or null
 * for plain. Matting runs at its defaults. Edge snap's distance is kept
 * inside the spot: a snap reaching as far as the spot's radius less its
 * feather can never select anything (engine 0.21.0, E60: the step then
 * changes nothing; 0.19.2 refused it), and the engine counts in whole
 * pixels of each render. So the distance is at most half the radius, and at
 * most what the draft (the smallest render, where a pixel is the largest
 * share) has room for; a spot with no room for even a pixel is healed plain.
 */
export function spotRefine(
  r: SpotRefine | undefined,
  spot: Pick<RetouchSpot, 'radius' | 'feather'>,
  w: number,
  h: number
): Refine | null {
  if (r === 'matting') return refineFor({ on: true, radius: 0.5, method: r }, false, 0.005)
  if (r !== 'edgeSnap') return null
  const snap = refineFor({ on: true, radius: 0.5, method: r }, false, 0.005)
  if (!('EdgeSnap' in snap)) return snap
  const short = smallestShort(w, h)
  const room = Math.floor(spot.radius * short - Math.round(featherOf(spot).radius * short) - 1)
  if (room < 1) return null
  const distance = Math.min(snap.EdgeSnap.distance, spot.radius / 2, room / short)
  if (distance < SNAP_LEAST) return null
  return { EdgeSnap: { distance: Math.round(distance * 1e6) / 1e6 } }
}

/** The least distance the engine's Edge snap takes (a shorter-side fraction). */
const SNAP_LEAST = 0.0005

export const SPOT_LABEL: Record<SpotKind, string> = {
  heal: tk('Heal'),
  clone: tk('Clone'),
  fill: tk('Fill'),
  remove: tk('Remove'),
  redeye: tk('Red eye'),
  peteye: tk('Pet eye')
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
 * The reach of a spot in frame fractions per axis — its points, its radius,
 * its feather's reach (three times its radius) and what a refine adds to
 * that (`bound`, a shorter-side fraction) — for a `w × h` frame.
 */
function reach(
  points: P[],
  radius: number,
  feather: number,
  w: number,
  h: number,
  bound = 0
): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  const short = Math.min(w, h)
  const rx = ((radius + 3 * feather + bound) * short) / w
  const ry = ((radius + 3 * feather + bound) * short) / h
  return {
    minX: Math.min(...points.map((p) => p.x)) - rx,
    maxX: Math.max(...points.map((p) => p.x)) + rx,
    minY: Math.min(...points.map((p) => p.y)) - ry,
    maxY: Math.max(...points.map((p) => p.y)) + ry
  }
}

/**
 * How much further a refined spot reads than a plain one, as a shorter-side
 * fraction of a `w × h` frame: the engine grows its support by the method's
 * own bound (0.19.2: Edge snap's distance and a pixel, Matting's band and
 * two, each rounded to whole pixels), and refuses a source that reaches
 * past the frame for it (`source_offset`). The pixels are the smallest
 * render's, where they are the largest share of the frame.
 */
export function refineBound(refine: Refine | null, w: number, h: number): number {
  if (!refine) return 0
  const short = smallestShort(w, h)
  if ('EdgeSnap' in refine) return refine.EdgeSnap.distance + 1.5 / short
  if ('Matting' in refine) return refine.Matting.band + 2.5 / short
  return 0
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
  h: number,
  /** A refined spot's further reach (`refineBound`). */
  bound = 0
): P | null {
  const r = reach(points, radius, feather, w, h, bound)
  // The spot is rendered at every size from the 1280 px draft up, and the
  // engine counts whole pixels at each (the shape's bounds outwards, three
  // times the feather's rounded radius, the offset rounded): the margin is
  // four of the smallest's, not a fraction of the largest's.
  const k = Math.min(1, SMALLEST_RENDER / Math.max(w, h))
  const ring = { x: 4 / (w * k), y: 4 / (h * k) }
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
  h: number,
  /** An inpainter's filled ref, for a Remove (only a bake has one: a live Remove is left out). */
  inpainter: Record<string, unknown> | null = null
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
        const refine = spotRefine(s.refine, s, fw, fh)
        const bound = refineBound(refine, fw, fh)
        const off = fitOffset(want, points, s.radius, feather.radius, fw, fh, bound)
        if (!off) continue
        const spot = {
          shape,
          source_offset: { x: round5(off.x), y: round5(off.y) },
          feather,
          opacity,
          // Only when one is set, so a plain spot's request is 0.19's.
          ...(refine ? { refine } : {})
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
      case 'remove':
        if (!inpainter) continue
        steps.push({
          Remove: { shape, feather, opacity, context: REMOVE_CONTEXT, model: inpainter }
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
            pupil_level: clamp(s.pupilLevel / 100, 0, 1),
            catchlights: []
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

/** How much around a Remove's hole the model sees: the box grown by this times its longer side. */
export const REMOVE_CONTEXT = 0.75

/**
 * A mask (grey, 8 bits, a frame's size) as a brush stroke that covers it, for
 * a Remove: the engine fills circles or strokes, not planes. Rows across the
 * object a stroke's width apart, each from the mask's left to its right
 * there, joined end to end (a serpentine); the stroke's radius grows it a
 * little past the edge, which a removal wants. Fractions of the frame and of
 * its shorter side; null when the mask selects nothing.
 */
export function strokeOver(mask: {
  data: Uint8Array
  width: number
  height: number
}): { points: P[]; radius: number } | null {
  const { data, width: w, height: h } = mask
  let x0 = w
  let x1 = -1
  let y0 = h
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x] >= 128) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  // About two dozen rows over the object's longer side, never under 2 px.
  const r = Math.max(2, Math.max(x1 - x0 + 1, y1 - y0 + 1) / 24)
  let step = r * 1.2
  // 4096 points at most: two a row.
  step = Math.max(step, (y1 - y0 + 1) / 2000)
  const points: P[] = []
  let flip = false
  for (let yc = y0; yc <= y1 + step / 2; yc += step) {
    const lo = Math.max(0, Math.floor(yc - step / 2))
    const hi = Math.min(h - 1, Math.ceil(yc + step / 2))
    let a = w
    let b = -1
    for (let y = lo; y <= hi; y++)
      for (let x = x0; x <= x1; x++)
        if (data[y * w + x] >= 128) {
          if (x < a) a = x
          if (x > b) b = x
        }
    if (b < 0) continue
    const y = Math.min(h - 1, yc)
    const row = [
      { x: (a + 0.5) / w, y: (y + 0.5) / h },
      { x: (b + 0.5) / w, y: (y + 0.5) / h }
    ]
    points.push(...(flip ? row.reverse() : row))
    flip = !flip
  }
  if (points.length === 1) points.push({ ...points[0] })
  return { points, radius: r / Math.min(w, h) }
}

/** A Remove spot over `points` (a stroke, or one point for a disc), as the Heal tool makes one. */
export function removeSpot(points: P[], radius: number, feather: number): RetouchSpot {
  const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
  return newSpot(id, 'remove', points, radius, feather, 100)
}
