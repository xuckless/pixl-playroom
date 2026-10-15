import { sameLensFrame, type LensFrame } from '../../../shared/lensframe'
import type { PlaneComponent } from '../../../shared/recipe'
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
  return api.develop.planeOnFrame(key, ref, from, to)
}
