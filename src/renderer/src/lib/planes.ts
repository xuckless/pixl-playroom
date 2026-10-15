import { paintStrokes } from '../../../shared/brush'
import type { BrushComponent, PlaneComponent } from '../../../shared/recipe'
import { api } from './api'

/**
 * Painted planes the renderer has seen, by reference. Recipes here hold
 * brush planes by reference only (see the main process's plane store); the
 * brush reads a plane's pixels from here when it paints on it again.
 */
const KEEP = 16
const planes = new Map<string, string>()

export function rememberPlane(ref: string, png: string): void {
  planes.delete(ref)
  planes.set(ref, png)
  if (planes.size > KEEP) planes.delete(planes.keys().next().value as string)
}

/** A plane component's PNG (base64), from the component, this cache, or the main process. */
export async function planePng(c: PlaneComponent): Promise<string> {
  if (c.png) return c.png
  if (!c.ref) throw new Error('a painted mask has no plane')
  const hit = planes.get(c.ref)
  if (hit !== undefined) return hit
  const png = await api.develop.getPlane(c.ref)
  rememberPlane(c.ref, png)
  return png
}

/**
 * A brush's plane with its strokes painted over it as the engine paints
 * them (shared/brush.ts `paintStrokes`), at the brush's plane size: what the
 * loupe's own mask draws until the engine's plane arrives.
 */
export async function paintedBitmap(
  c: BrushComponent,
  opts: ImageBitmapOptions
): Promise<ImageBitmap> {
  const w = Math.max(1, Math.round(c.width))
  const h = Math.max(1, Math.round(c.height))
  const plane = new Float32Array(w * h)
  if (c.png || c.ref) {
    const bytes = Uint8Array.from(atob(await planePng(c)), (x) => x.charCodeAt(0))
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
      resizeWidth: w,
      resizeHeight: h,
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none'
    })
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    ctx.drawImage(bmp, 0, 0)
    bmp.close()
    const d = ctx.getImageData(0, 0, w, h).data
    for (let i = 0; i < plane.length; i++) plane[i] = d[i * 4] / 255
  }
  paintStrokes(plane, w, h, c.strokes ?? [])
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < plane.length; i++) {
    const v = Math.round(plane[i] * 255)
    rgba[i * 4] = v
    rgba[i * 4 + 1] = v
    rgba[i * 4 + 2] = v
    rgba[i * 4 + 3] = 255
  }
  return createImageBitmap(new ImageData(rgba, w, h), opts)
}
