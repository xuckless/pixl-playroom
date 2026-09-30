/**
 * Upright: perspective correction, as the engine's `Framing.transform`.
 *
 * The engine re-sees the picture with a virtual camera turned about its
 * optical centre, then stretched, scaled and moved — one homography, stated
 * in `pixl-engine/src/framing.rs` and reproduced exactly here, because the
 * develop view has to know where every point went: masks, pins and pickers
 * map through it, and the crop that is kept is the largest one the warped
 * frame still fills.
 *
 * The recipe keeps the suggestion (an Upright mode's or the guides') and the
 * manual sliders apart, and they add: the angles sum, the scales multiply,
 * the offsets sum.
 */
import type { CropRect, Transform } from './engine-types'

export type UprightMode = 'off' | 'auto' | 'level' | 'vertical' | 'full' | 'guided'

export interface GuideLine {
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface UprightSetting {
  mode: UprightMode
  /** What the mode (or the guides) suggested, measured on this photo; null for Off. */
  suggested: Transform | null
  /** Guided mode's lines, fractions of the frame before the transform. */
  guides: GuideLine[]
  /** The lens's focal length as a fraction of the frame's diagonal (35 mm-equivalent ÷ 43.27). */
  focal: number
  /** Manual sliders, −100…100 (scale 50…150). */
  vertical: number
  horizontal: number
  rotate: number
  aspect: number
  scale: number
  offsetX: number
  offsetY: number
}

/** A 35 mm lens: what an unknown focal length is taken to be. */
export const DEFAULT_FOCAL = 35 / 43.27

export function defaultUpright(): UprightSetting {
  return {
    mode: 'off',
    suggested: null,
    guides: [],
    focal: DEFAULT_FOCAL,
    vertical: 0,
    horizontal: 0,
    rotate: 0,
    aspect: 0,
    scale: 100,
    offsetX: 0,
    offsetY: 0
  }
}

/** The focal fraction for a shot: its 35 mm-equivalent focal length over the full frame's diagonal. */
export function focalOf(focal35: number | null | undefined): number {
  return focal35 && focal35 > 0 ? Math.min(20, Math.max(0.05, focal35 / 43.27)) : DEFAULT_FOCAL
}

// What the manual sliders' ends mean.
const MAX_TILT = 40
const MAX_ROTATE = 10
const MAX_OFFSET = 0.25

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round5 = (v: number): number => Math.round(v * 1e5) / 1e5

/**
 * The engine transform for the settings on a `w × h` frame, or null when it
 * is the identity. Re-aiming the camera slides the picture (its centre moves
 * by the focal length times the tangent of the turn), so the offset is set
 * to keep the photo's centre at the canvas's centre, as Lightroom does; the
 * X and Y offset sliders move it from there.
 */
export function uprightTransform(u: UprightSetting, w: number, h: number): Transform | null {
  const s = u.suggested
  const t: Transform = {
    vertical: round5(clamp((s?.vertical ?? 0) + (u.vertical / 100) * MAX_TILT, -80, 80)),
    horizontal: round5(clamp((s?.horizontal ?? 0) + (u.horizontal / 100) * MAX_TILT, -80, 80)),
    rotate: round5(clamp((s?.rotate ?? 0) + (u.rotate / 100) * MAX_ROTATE, -45, 45)),
    focal: round5(clamp(s?.focal ?? u.focal, 0.05, 20)),
    aspect: round5(clamp((s?.aspect ?? 0) + u.aspect / 100, -1, 1)),
    scale: round5(clamp((s?.scale ?? 1) * (clamp(u.scale, 50, 150) / 100), 0.1, 10)),
    offset: {
      x: round5(clamp((s?.offset.x ?? 0) + (u.offsetX / 100) * MAX_OFFSET, -1, 1)),
      y: round5(clamp((s?.offset.y ?? 0) + (u.offsetY / 100) * MAX_OFFSET, -1, 1))
    }
  }
  const identity =
    t.vertical === 0 &&
    t.horizontal === 0 &&
    t.rotate === 0 &&
    t.aspect === 0 &&
    t.scale === 1 &&
    t.offset.x === 0 &&
    t.offset.y === 0
  if (identity) return null
  if (w > 0 && h > 0) {
    const centre = apply(homography({ ...t, offset: { x: 0, y: 0 } }, w, h), w / 2, h / 2)
    if (centre) {
      t.offset = {
        x: round5(clamp(t.offset.x - (centre.x - w / 2) / w, -1, 1)),
        y: round5(clamp(t.offset.y - (centre.y - h / 2) / h, -1, 1))
      }
    }
  }
  return t
}

// ── The homography ───────────────────────────────────────────────────────────

export type Mat3 = [number, number, number, number, number, number, number, number, number]

function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array(9).fill(0) as Mat3
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return o
}

export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det
  ]
}

/**
 * The transform as a homography on a `w × h` frame's pixels: a picture point
 * `p` lands at canvas point `H p` (see `framing.rs`: `d = (p − c, f)`, turned
 * by `R_z(rotate) · R_x(vertical) · R_y(horizontal)`, projected, then
 * stretched by `scale · 2^(±aspect/2)` about the centre and moved by
 * `offset × (w, h)`).
 */
export function homography(t: Transform, w: number, h: number): Mat3 {
  const cx = w / 2
  const cy = h / 2
  const f = t.focal * Math.hypot(w, h)
  const rad = Math.PI / 180
  const [a, b, g] = [t.vertical * rad, t.horizontal * rad, t.rotate * rad]
  const Rx: Mat3 = [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)]
  const Ry: Mat3 = [Math.cos(b), 0, Math.sin(b), 0, 1, 0, -Math.sin(b), 0, Math.cos(b)]
  const Rz: Mat3 = [Math.cos(g), -Math.sin(g), 0, Math.sin(g), Math.cos(g), 0, 0, 0, 1]
  const R = mul(Rz, mul(Rx, Ry))
  const toRay: Mat3 = [1, 0, -cx, 0, 1, -cy, 0, 0, f]
  const project: Mat3 = [f, 0, cx, 0, f, cy, 0, 0, 1]
  const sx = t.scale * Math.pow(2, t.aspect / 2)
  const sy = t.scale * Math.pow(2, -t.aspect / 2)
  const after: Mat3 = [
    sx,
    0,
    cx - sx * cx + t.offset.x * w,
    0,
    sy,
    cy - sy * cy + t.offset.y * h,
    0,
    0,
    1
  ]
  return mul(after, mul(project, mul(R, toRay)))
}

/** A point through a homography; null when it lands behind the camera. */
export function apply(m: Mat3, x: number, y: number): { x: number; y: number } | null {
  const X = m[0] * x + m[1] * y + m[2]
  const Y = m[3] * x + m[4] * y + m[5]
  const W = m[6] * x + m[7] * y + m[8]
  if (!(W > 1e-9)) return null
  return { x: X / W, y: Y / W }
}

/**
 * Where a normalised point of the transformed canvas shows from in the
 * frame (normalised), for a `w × h` frame; null past the horizon.
 */
export function canvasToFrame(
  t: Transform,
  w: number,
  h: number,
  p: { x: number; y: number }
): { x: number; y: number } | null {
  const q = apply(invert3(homography(t, w, h)), p.x * w, p.y * h)
  return q ? { x: q.x / w, y: q.y / h } : null
}

/** Where a normalised frame point lands on the transformed canvas; null past the horizon. */
export function frameToCanvas(
  t: Transform,
  w: number,
  h: number,
  p: { x: number; y: number }
): { x: number; y: number } | null {
  const q = apply(homography(t, w, h), p.x * w, p.y * h)
  return q ? { x: q.x / w, y: q.y / h } : null
}

// ── Crops under a warp ───────────────────────────────────────────────────────

/**
 * Whether every corner of `crop` (normalised canvas: after the transform,
 * before the straighten's rotation is undone) has picture behind it — the
 * engine's own test, with its half-pixel of grace.
 */
export function cropFitsWarp(
  crop: CropRect,
  degrees: number,
  t: Transform | null,
  w: number,
  h: number
): boolean {
  const th = (degrees * Math.PI) / 180
  const c = Math.cos(th)
  const s = Math.sin(th)
  const inv = t ? invert3(homography(t, w, h)) : null
  const corners = [
    [crop.x, crop.y],
    [crop.x + crop.width, crop.y],
    [crop.x, crop.y + crop.height],
    [crop.x + crop.width, crop.y + crop.height]
  ]
  return corners.every(([nx, ny]) => {
    const qx = nx * w - w / 2
    const qy = ny * h - h / 2
    // Undo the rotation, then the transform.
    let px = c * qx + s * qy + w / 2
    let py = -s * qx + c * qy + h / 2
    if (inv) {
      const q = apply(inv, px, py)
      if (!q) return false
      px = q.x
      py = q.y
    }
    return px >= -0.5 && px <= w + 0.5 && py >= -0.5 && py <= h + 0.5
  })
}
