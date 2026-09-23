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
