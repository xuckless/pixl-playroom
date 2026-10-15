/**
 * Where a point on the screen is in the photo. The develop view shows the
 * framed picture (turned, straightened, cropped) — or, with the crop tool
 * open, the whole turned frame. Masks are stored in the *base* frame (the
 * file upright, before the user's own turns) so they stay on their subject
 * whatever the user does to the framing afterwards.
 *
 * Coordinate systems, all normalised 0…1 on each axis:
 *   display  — the rendered picture as shown;
 *   canvas   — the frame after an Upright warp, before the straighten;
 *   oriented — the user-turned frame, uncropped, unrotated and unwarped;
 *   base     — the file upright, before the user's turns.
 */
import type { CropRect, Orientation, Transform } from './engine-types'
import { effectiveCrop, orientedFrame } from './compile'
import { effective } from './edits'
import { lensCorrection } from './lens'
import { inverse, matrixOf, swapsAxes, transformPoint } from './orientation'
import { applyProjective, glMat3, type Projective } from './projective'
import { gridPoint, type LensGrid } from './lensframe'
import type { Recipe } from './recipe'
import {
  canvasToFrame,
  frameToCanvas,
  homography,
  invert3,
  uprightTransform,
  type Mat3
} from './upright'

export interface ViewGeometry {
  /** The oriented frame, full resolution, in pixels. */
  width: number
  height: number
  user: Orientation
  crop: CropRect | null
  straighten: number
  /** The Upright warp between the oriented frame and the canvas, if any. */
  transform: Transform | null
  /** The display is the whole canvas (crop tool open), or the whole unwarped frame (guides). */
  whole: boolean
  /**
   * The masks drawn under another lens than the one rendered (Optics
   * switched off, a lens slider moving): the map between the two, on the
   * base frame (shared/lensframe.ts). Absent or null: they are on it.
   * Points go through it; the matrices below leave it out.
   */
  lens?: LensGrid | null
}

export function viewGeometry(
  r: Pick<Recipe, 'geometry'>,
  frameWidth: number,
  frameHeight: number,
  cropMode: boolean,
  /** Upright's guides are being drawn: the display is the frame before the warp. */
  guides = false
): ViewGeometry {
  const o = orientedFrame(r, frameWidth, frameHeight)
  return {
    width: o.width,
    height: o.height,
    user: o.user,
    crop: effectiveCrop(r, o.width, o.height),
    straighten: r.geometry.straighten,
    transform: guides ? null : uprightTransform(r.geometry.upright, o.width, o.height),
    whole: cropMode || guides
  }
}

/**
 * The loupe's geometry: the picture as it is rendered, so from the recipe
 * `compile` reads (`edits.ts` `effective`). Crop & straighten switched off
 * are no crop and no straighten, Geometry switched off no Upright, and the
 * crop is then fitted as the engine's is (an Upright still auto-crops with
 * Crop off). One source of truth with the render: a view of its own once
 * drifted from it by hundreds of pixels.
 */
export function loupeGeometry(
  r: Recipe,
  isRaw: boolean,
  frameWidth: number,
  frameHeight: number,
  cropMode: boolean,
  guides = false
): ViewGeometry {
  return viewGeometry(effective(r, isRaw), frameWidth, frameHeight, cropMode, guides)
}

/**
 * What places every mask on the picture as rendered: the framing (turns,
 * straighten, crop, Upright, as switched on) and the lens's geometry, as
 * the engine is given them (rounded as `compile` rounds them). A change to
 * it leaves every mask plane on hand drawn for another picture; anything
 * else (a guide moved, an aspect lock on a drawn crop) leaves them as they are.
 *
 * Not the lens frame the masks are recorded on: moving that record (a lens
 * edit settling) leaves every mask where it was on the picture, and a plane
 * or thumbnail the engine has no reason to draw again would never show.
 */
export function maskPlacementKey(
  r: Recipe,
  isRaw: boolean,
  frameWidth: number,
  frameHeight: number
): string {
  const e = effective(r, isRaw)
  const g = viewGeometry(e, frameWidth, frameHeight, false)
  const round4 = (v: number): number => Math.round(v * 1e4) / 1e4
  return JSON.stringify([
    g.user,
    g.crop && [g.crop.x, g.crop.y, g.crop.width, g.crop.height].map(round4),
    round4(g.straighten),
    g.transform,
    lensCorrection(e.lens)?.distortion ?? null
  ])
}

export interface P {
  x: number
  y: number
}

/** A canvas point back through the warp to the frame (a point past the horizon stays put). */
function unwarp(g: ViewGeometry, p: P): P {
  return g.transform ? (canvasToFrame(g.transform, g.width, g.height, p) ?? p) : p
}

function warp(g: ViewGeometry, p: P): P {
  return g.transform ? (frameToCanvas(g.transform, g.width, g.height, p) ?? p) : p
}

export function displayToOriented(g: ViewGeometry, p: P): P {
  if (g.whole || !g.crop) return unwarp(g, p)
  const qx = (g.crop.x + p.x * g.crop.width) * g.width - g.width / 2
  const qy = (g.crop.y + p.y * g.crop.height) * g.height - g.height / 2
  const t = (g.straighten * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const px = c * qx + s * qy
  const py = -s * qx + c * qy
  return unwarp(g, { x: (px + g.width / 2) / g.width, y: (py + g.height / 2) / g.height })
}

export function orientedToDisplay(g: ViewGeometry, p: P): P {
  const w = warp(g, p)
  if (g.whole || !g.crop) return w
  const px = w.x * g.width - g.width / 2
  const py = w.y * g.height - g.height / 2
  const t = (g.straighten * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const qx = (c * px - s * py + g.width / 2) / g.width
  const qy = (s * px + c * py + g.height / 2) / g.height
  return { x: (qx - g.crop.x) / g.crop.width, y: (qy - g.crop.y) / g.crop.height }
}

export function orientedToBase(g: ViewGeometry, p: P): P {
  return transformPoint(inverse(g.user), p)
}

export function baseToOriented(g: ViewGeometry, p: P): P {
  return transformPoint(g.user, p)
}

export function displayToBase(g: ViewGeometry, p: P): P {
  const b = orientedToBase(g, displayToOriented(g, p))
  return g.lens ? gridPoint(g.lens.toMasks, g.lens.n, b) : b
}

export function baseToDisplay(g: ViewGeometry, p: P): P {
  const b = g.lens ? gridPoint(g.lens.toRendered, g.lens.n, p) : p
  return orientedToDisplay(g, baseToOriented(g, b))
}

// ── The map as a matrix ──────────────────────────────────────────────────────

/**
 * Display ↔ base as one projective matrix (`projective.ts`), normalised.
 * Exact: the crop and straighten, the turns and flips are affine and
 * Upright's warp is a homography, so their product is one (without an
 * Upright warp its last row is 0, 0, 1). What draws a mask on the GPU (the
 * loupe's preview, the brush's stroke) takes it, with the perspective
 * divide, so its shapes land where `displayToBase` puts them.
 */
export { applyProjective, glMat3, type Projective }

function mul3(a: Mat3, b: Mat3): Mat3 {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Mat3
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++) o[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j]
  return o
}

/** The same map scaled so its divisor is positive at `p` (the GPU's test for "in front"). */
function positiveAt(m: Projective, p: P): Projective {
  return m[6] * p.x + m[7] * p.y + m[8] < 0 ? (m.map((v) => -v) as Projective) : m
}

/**
 * Display → base, normalised (see `Projective`): the matrix of `displayToBase`
 * on the frame rendered (a lens grid, which is no projective map, left out).
 */
export function displayToBaseMatrix(g: ViewGeometry): Projective {
  const { width: W, height: H } = g
  // Display → canvas (normalised): the crop, then the straighten undone about the centre.
  let toCanvas: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  if (!g.whole && g.crop) {
    const t = (g.straighten * Math.PI) / 180
    const c = Math.cos(t)
    const s = Math.sin(t)
    // q = (crop.xy + d · crop.wh) · (W, H) − (W, H) / 2, in pixels about the centre.
    const crop: Mat3 = [
      g.crop.width * W,
      0,
      g.crop.x * W - W / 2,
      0,
      g.crop.height * H,
      g.crop.y * H - H / 2,
      0,
      0,
      1
    ]
    const turn: Mat3 = [c / W, s / W, 0.5, -s / H, c / H, 0.5, 0, 0, 1]
    toCanvas = mul3(turn, crop)
  }
  // Canvas → frame: the warp undone, in the frame's pixels.
  const unwarp: Mat3 = g.transform
    ? mul3(
        [1 / W, 0, 0, 0, 1 / H, 0, 0, 0, 1],
        mul3(invert3(homography(g.transform, W, H)), [W, 0, 0, 0, H, 0, 0, 0, 1])
      )
    : [1, 0, 0, 0, 1, 0, 0, 0, 1]
  // Oriented → base: the user's turn undone about the centre.
  const o = matrixOf(inverse(g.user))
  const toBase: Mat3 = [
    o[0][0],
    o[0][1],
    0.5 - 0.5 * (o[0][0] + o[0][1]),
    o[1][0],
    o[1][1],
    0.5 - 0.5 * (o[1][0] + o[1][1]),
    0,
    0,
    1
  ]
  return positiveAt(mul3(toBase, mul3(unwarp, toCanvas)), { x: 0.5, y: 0.5 })
}

/** Base → display, normalised: the inverse of `displayToBaseMatrix`. */
export function baseToDisplayMatrix(g: ViewGeometry): Projective {
  const m = displayToBaseMatrix(g)
  return positiveAt(invert3(m), applyProjective(m, { x: 0.5, y: 0.5 }))
}

/**
 * How much the display → base map magnifies about display point `p`: base
 * units per display unit, in the sizes given (a brush's plane pixels per
 * screen pixel, say), as √|det J|, the scale an area keeps. The same both
 * ways across under a turn or a straighten; under an Upright warp, a dab
 * keeps its area where a stretch along one axis only would have it grow.
 */
export function localScale(
  g: ViewGeometry,
  p: P,
  display: { w: number; h: number },
  base: { w: number; h: number }
): number {
  const m = displayToBaseMatrix(g)
  const w = m[6] * p.x + m[7] * p.y + m[8]
  const q = applyProjective(m, p)
  // ∂(X/w)/∂x = (m0 − X·m6) / w, and so on.
  const jxx = (m[0] - q.x * m[6]) / w
  const jxy = (m[1] - q.x * m[7]) / w
  const jyx = (m[3] - q.y * m[6]) / w
  const jyy = (m[4] - q.y * m[7]) / w
  const det = (jxx * jyy - jxy * jyx) * ((base.w * base.h) / (display.w * display.h))
  return Math.sqrt(Math.abs(det))
}

/**
 * A spot's outline as it shows: a circle of `radius` (a fraction of the
 * frame's shorter side) about `centre` on the base frame, where spots live,
 * carried through the turns, the Upright warp and the crop to the display.
 * Round without a warp; under one, the shape the engine heals.
 */
export function spotOutline(g: ViewGeometry, centre: P, radius: number, n = 48): P[] {
  const swap = swapsAxes(g.user)
  const bw = swap ? g.height : g.width
  const bh = swap ? g.width : g.height
  const r = radius * Math.min(bw, bh)
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * 2 * Math.PI
    return baseToDisplay(g, {
      x: centre.x + (r * Math.cos(t)) / bw,
      y: centre.y + (r * Math.sin(t)) / bh
    })
  })
}

/** The displayed picture's size in oriented-frame pixels (what one display unit spans). */
export function displaySize(g: ViewGeometry): { width: number; height: number } {
  if (g.whole || !g.crop) return { width: g.width, height: g.height }
  return { width: g.crop.width * g.width, height: g.crop.height * g.height }
}

/** A rectangle inside a box, in the box's pixels. */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A `width × height` picture fitted and centred in a `box`, never enlarged
 * past `maxScale` of the box-fitting size. Laying the loupe out from the
 * geometry rather than from whichever render arrived last keeps the frame
 * still while renders come and go.
 */
export function fitRect(
  box: { w: number; h: number },
  width: number,
  height: number,
  maxScale = Infinity
): Rect | null {
  if (!(box.w > 0 && box.h > 0 && width > 0 && height > 0)) return null
  const k = Math.min(box.w / width, box.h / height, maxScale)
  const w = width * k
  const h = height * k
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h }
}

/** A pointer's position over an element, normalised to the element's box. */
export function normalisedIn(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number }
): P {
  return {
    x: box.width > 0 ? (clientX - box.left) / box.width : 0,
    y: box.height > 0 ? (clientY - box.top) / box.height : 0
  }
}

// ── zoom ─────────────────────────────────────────────────────────────────────

/** The furthest the loupe zooms: four device pixels per photo pixel. */
export const MAX_ZOOM = 4

/**
 * How the loupe looks at the picture: fitted, or at `scale` device pixels
 * per photo pixel (1 is 100%) with display point (`cx`, `cy`) at the centre.
 */
export interface ZoomView {
  scale: number | 'fit'
  cx: number
  cy: number
}

export const FIT: ZoomView = { scale: 'fit', cx: 0.5, cy: 0.5 }

/** The loupe box, the displayed picture's size in photo pixels, and the screen's pixel ratio. */
export interface Viewport {
  box: { w: number; h: number }
  width: number
  height: number
  dpr: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The fitted picture's scale, in device pixels per photo pixel. */
export function fitScale(v: Viewport): number {
  const r = fitRect(v.box, v.width, v.height, 4)
  return r ? (r.w * v.dpr) / v.width : 1
}

/** A view's scale as a number (the fitted scale for Fit). */
export function scaleOf(v: Viewport, view: ZoomView): number {
  return view.scale === 'fit' ? fitScale(v) : Math.max(view.scale, fitScale(v))
}

/**
 * Where the picture lies in the loupe box for a view: the fitted rect for
 * Fit, else the picture at its scale around the view's centre, kept over the
 * box (and centred on an axis where it is smaller than the box).
 */
export function zoomedRect(v: Viewport, view: ZoomView): Rect | null {
  const fit = fitRect(v.box, v.width, v.height, 4)
  if (!fit || view.scale === 'fit' || view.scale <= fitScale(v)) return fit
  const k = view.scale / v.dpr
  const w = v.width * k
  const h = v.height * k
  const x = w > v.box.w ? clamp(v.box.w / 2 - view.cx * w, v.box.w - w, 0) : (v.box.w - w) / 2
  const y = h > v.box.h ? clamp(v.box.h / 2 - view.cy * h, v.box.h - h, 0) : (v.box.h - h) / 2
  return { x, y, w, h }
}

/** The view that puts the picture at `r` (its centre read back from the rect, so it stays in bounds). */
function viewOf(v: Viewport, scale: number, r: Rect): ZoomView {
  if (scale <= fitScale(v) * 1.0001) return FIT
  return { scale, cx: (v.box.w / 2 - r.x) / r.w, cy: (v.box.h / 2 - r.y) / r.h }
}

/** Zoom by `factor` about a point of the loupe box, which stays under the pointer. */
export function zoomAt(v: Viewport, view: ZoomView, factor: number, at: P): ZoomView {
  const r = zoomedRect(v, view)
  if (!r) return view
  const fit = fitScale(v)
  const next = clamp(scaleOf(v, view) * factor, fit, Math.max(fit, MAX_ZOOM))
  if (next <= fit * 1.0001) return FIT
  const u = (at.x - r.x) / r.w
  const w = (v.width * next) / v.dpr
  const h = (v.height * next) / v.dpr
  const raw = { scale: next, cx: (v.box.w / 2 - (at.x - u * w)) / w, cy: 0 }
  raw.cy = (v.box.h / 2 - (at.y - ((at.y - r.y) / r.h) * h)) / h
  const placed = zoomedRect(v, raw)
  return placed ? viewOf(v, next, placed) : raw
}

/** A view at `scale` with display point `p` under box point `at` (Z and double-click to 100%). */
export function zoomTo(v: Viewport, view: ZoomView, scale: number, at: P): ZoomView {
  return zoomAt(v, view, scale / scaleOf(v, view), at)
}

/** Move a zoomed view by (`dx`, `dy`) box pixels, as a drag or a two-finger scroll would. */
export function panBy(v: Viewport, view: ZoomView, dx: number, dy: number): ZoomView {
  const r = zoomedRect(v, view)
  if (!r || view.scale === 'fit') return view
  const moved = zoomedRect(v, {
    scale: view.scale,
    cx: (v.box.w / 2 - (r.x + dx)) / r.w,
    cy: (v.box.h / 2 - (r.y + dy)) / r.h
  })
  return moved ? viewOf(v, view.scale, moved) : view
}

/** The part of a picture rect that shows in the box, in the rect's own pixels. */
export function visiblePart(box: { w: number; h: number }, r: Rect): Rect {
  const x = Math.max(0, -r.x)
  const y = Math.max(0, -r.y)
  return {
    x,
    y,
    w: Math.max(0, Math.min(r.w, box.w - r.x) - x),
    h: Math.max(0, Math.min(r.h, box.h - r.y) - y)
  }
}
