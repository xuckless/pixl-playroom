/** The crop tool's handle maths, kept free of the DOM so it can be tested. */
import { cropFits } from './compile'
import type { CropRect } from './engine-types'
import type { P, ViewGeometry } from './view'

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const CROP_HANDLES: CropHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN = 0.02

/** The crop a handle drag makes from `orig` moved by `d`, or null when it would leave the picture. */
export function dragCrop(
  handle: CropHandle,
  orig: CropRect,
  d: P,
  nAspect: number | null,
  g: ViewGeometry
): CropRect | null {
  let { x, y, width, height } = orig
  if (handle === 'move') {
    x = Math.min(1 - width, Math.max(0, x + d.x))
    y = Math.min(1 - height, Math.max(0, y + d.y))
  } else {
    if (handle.includes('w')) {
      x = Math.min(orig.x + orig.width - MIN, Math.max(0, orig.x + d.x))
      width = orig.x + orig.width - x
    }
    if (handle.includes('e')) width = Math.min(1 - x, Math.max(MIN, orig.width + d.x))
    if (handle.includes('n')) {
      y = Math.min(orig.y + orig.height - MIN, Math.max(0, orig.y + d.y))
      height = orig.y + orig.height - y
    }
    if (handle.includes('s')) height = Math.min(1 - y, Math.max(MIN, orig.height + d.y))
    if (nAspect) {
      if (handle === 'n' || handle === 's') width = height * nAspect
      else height = width / nAspect
      if (handle === 'n' || handle === 's') x = orig.x + (orig.width - width) / 2
      if (handle === 'e' || handle === 'w') y = orig.y + (orig.height - height) / 2
      if (handle.includes('n')) y = orig.y + orig.height - height
      if (handle.includes('w')) x = orig.x + orig.width - width
      if (x + width > 1 + 1e-9 || y + height > 1 + 1e-9 || x < -1e-9 || y < -1e-9) return null
    }
  }
  const next = { x, y, width, height }
  return cropFits(next, g.straighten, g.width, g.height) ? next : null
}
