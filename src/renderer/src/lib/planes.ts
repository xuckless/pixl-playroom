import { paintStrokes } from '../../../shared/brush'
import {
  gridPoint,
  lensFrameKey,
  remapStrokes,
  sameLensFrame,
  type LensFrame,
  type LensGrid
} from '../../../shared/lensframe'
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
 * What the main process answered, by what was asked: a few kept, the newest
 * last, so a mask redrawn with each stroke painted (a live draft, a commit)
 * asks once for the plane re-warped and the grid, not every time. A failure
 * is not kept.
 */
function keptAsk<T>(
  store: Map<string, Promise<T>>,
  keep: number,
  key: string,
  ask: () => Promise<T>
): Promise<T> {
  const hit = store.get(key)
  if (hit) {
    store.delete(key)
    store.set(key, hit)
    return hit
  }
  const p = ask()
  store.set(key, p)
  p.catch(() => {
    if (store.get(key) === p) store.delete(key)
  })
  while (store.size > keep) store.delete(store.keys().next().value as string)
  return p
}
/** Planes re-warped onto another frame (a 2048 px PNG each). */
const rewarped = new Map<string, Promise<string>>()
/** Grids between two frames. */
const grids = new Map<string, Promise<LensGrid | null>>()
const framePair = (from: LensFrame, to: LensFrame): string =>
  `${lensFrameKey(from)}>${lensFrameKey(to)}`

/**
 * A plane component's PNG on lens frame `to`: as it is, or, when it is on
 * another (its own `lensFrame`, else the masks' frame `masks`), re-warped
 * onto it by the main process. The brush paints on the masks' frame; the
 * loupe shows a mask on the frame rendered.
 */
export async function planePngOn(
  key: string,
  c: PlaneComponent,
  to: LensFrame,
  masks: LensFrame = to
): Promise<string> {
  const from = c.lensFrame !== undefined ? c.lensFrame : masks
  if (sameLensFrame(from, to)) return planePng(c)
  // A plane held here (a selection being made) is not in the plane store yet.
  const ref = c.png || !c.ref ? await api.develop.putPlane(await planePng(c)) : c.ref
  return keptAsk(rewarped, 4, `${key}|${ref}|${framePair(from, to)}`, () =>
    api.develop.planeOnFrame(key, ref, from, to)
  )
}

/**
 * A brush with its strokes on lens frame `to`: as it is, or, when it is on
 * another (as `planePngOn` says), its dabs carried through the main
 * process's grid between the two frames. Its plane goes by `planePngOn`.
 */
export async function brushOn(
  key: string,
  c: BrushComponent,
  to: LensFrame,
  masks: LensFrame = to
): Promise<BrushComponent> {
  const from = c.lensFrame !== undefined ? c.lensFrame : masks
  if (!c.strokes?.length || sameLensFrame(from, to)) return c
  const grid = await keptAsk(grids, 8, `${key}|${framePair(from, to)}`, () =>
    api.develop.maskGrid(key, from, to)
  )
  if (!grid) return c
  return { ...c, strokes: remapStrokes(c.strokes, (p) => gridPoint(grid.toRendered, grid.n, p)) }
}

/**
 * A brush's plane with its strokes painted over it as the engine paints
 * them (shared/brush.ts `paintStrokes`), at the brush's plane size: what the
 * loupe's own mask draws until the engine's plane arrives. `png` gives the
 * plane (re-warped onto the frame shown, when the brush is on another).
 */
export async function paintedBitmap(
  c: BrushComponent,
  opts: ImageBitmapOptions,
  png: () => Promise<string> = () => planePng(c)
): Promise<ImageBitmap> {
  const w = Math.max(1, Math.round(c.width))
  const h = Math.max(1, Math.round(c.height))
  const plane = new Float32Array(w * h)
  if (c.png || c.ref) {
    const bytes = Uint8Array.from(atob(await png()), (x) => x.charCodeAt(0))
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
