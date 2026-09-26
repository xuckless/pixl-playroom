import type { BrushComponent } from '../../../shared/recipe'
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

/** A brush component's PNG (base64), from the component, this cache, or the main process. */
export async function planePng(c: BrushComponent): Promise<string> {
  if (c.png) return c.png
  if (!c.ref) throw new Error('a painted mask has no plane')
  const hit = planes.get(c.ref)
  if (hit !== undefined) return hit
  const png = await api.develop.getPlane(c.ref)
  rememberPlane(c.ref, png)
  return png
}
