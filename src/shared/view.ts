/**
 * Where a point on the screen is in the photo. The develop view shows the
 * framed picture (turned, straightened, cropped) — or, with the crop tool
 * open, the whole turned frame. Masks are stored in the *base* frame (the
 * file upright, before the user's own turns) so they stay on their subject
 * whatever the user does to the framing afterwards.
 *
 * Coordinate systems, all normalised 0…1 on each axis:
 *   display  — the rendered picture as shown;
 *   oriented — the user-turned frame, uncropped and unrotated;
 *   base     — the file upright, before the user's turns.
 */
import type { CropRect, Orientation } from './engine-types'
import { effectiveCrop, orientedFrame } from './compile'
import { inverse, transformPoint } from './orientation'
import type { Recipe } from './recipe'

export interface ViewGeometry {
  /** The oriented frame, full resolution, in pixels. */
  width: number
  height: number
  user: Orientation
  crop: CropRect | null
  straighten: number
  /** The display is the whole oriented frame (crop tool open). */
  whole: boolean
}

export function viewGeometry(
  r: Recipe,
  frameWidth: number,
  frameHeight: number,
  cropMode: boolean
): ViewGeometry {
  const o = orientedFrame(r, frameWidth, frameHeight)
  return {
    width: o.width,
    height: o.height,
    user: o.user,
    crop: effectiveCrop(r, o.width, o.height),
    straighten: r.geometry.straighten,
    whole: cropMode
  }
}

export interface P {
  x: number
  y: number
}

export function displayToOriented(g: ViewGeometry, p: P): P {
  if (g.whole || !g.crop) return p
  const qx = (g.crop.x + p.x * g.crop.width) * g.width - g.width / 2
  const qy = (g.crop.y + p.y * g.crop.height) * g.height - g.height / 2
  const t = (g.straighten * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const px = c * qx + s * qy
  const py = -s * qx + c * qy
  return { x: (px + g.width / 2) / g.width, y: (py + g.height / 2) / g.height }
}

export function orientedToDisplay(g: ViewGeometry, p: P): P {
  if (g.whole || !g.crop) return p
  const px = p.x * g.width - g.width / 2
  const py = p.y * g.height - g.height / 2
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
  return orientedToBase(g, displayToOriented(g, p))
}

export function baseToDisplay(g: ViewGeometry, p: P): P {
  return orientedToDisplay(g, baseToOriented(g, p))
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
