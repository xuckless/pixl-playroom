/**
 * A Depth range's map in the renderer: decoded once per plane, for its
 * preview in the mask's card and for the picker's click. The map is
 * disparity (255 the nearest thing in the photo); the sliders speak in
 * depth, 0 the nearest and 100 the farthest.
 */
import type { DepthComponent } from '../../../shared/recipe'
import { planePng } from './planes'
import { depthOf } from '../../../shared/depth'

export { coverage, depthOf } from '../../../shared/depth'

export interface DepthMap {
  /** One byte a pixel, the map's grey. */
  data: Uint8Array
  width: number
  height: number
}

const KEEP = 4
const maps = new Map<string, Promise<DepthMap>>()

/** The longest side a map is read at here: enough for a preview and a click. */
const READ_LONGEST = 512

async function decode(png: string): Promise<DepthMap> {
  const blob = await (await fetch(`data:image/png;base64,${png}`)).blob()
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, READ_LONGEST / Math.max(bmp.width, bmp.height))
  const width = Math.max(1, Math.round(bmp.width * k))
  const height = Math.max(1, Math.round(bmp.height * k))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, width, height)
  bmp.close()
  const rgba = ctx.getImageData(0, 0, width, height).data
  const data = new Uint8Array(width * height)
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4]
  return { data, width, height }
}

/** A depth component's map, decoded (cached by its plane). */
export function depthMap(c: DepthComponent): Promise<DepthMap> {
  const key = c.ref ?? `${c.png.length}:${c.png.slice(-32)}`
  let hit = maps.get(key)
  if (!hit) {
    hit = planePng(c).then(decode)
    hit.catch(() => maps.delete(key))
    maps.set(key, hit)
    if (maps.size > KEEP) maps.delete(maps.keys().next().value as string)
  }
  return hit
}

/** The depth at a base-frame point (fractions), 0…100. */
export async function depthAt(c: DepthComponent, x: number, y: number): Promise<number> {
  const m = await depthMap(c)
  const px = Math.min(m.width - 1, Math.max(0, Math.floor(x * m.width)))
  const py = Math.min(m.height - 1, Math.max(0, Math.floor(y * m.height)))
  return depthOf(m.data[py * m.width + px])
}
