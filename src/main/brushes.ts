/**
 * Raster masks on disk. A brush component lives in the recipe as a base64
 * grey PNG in the base frame (the photo upright, before the user's turns); a
 * linear or radial gradient lives there as its geometry and is drawn into a
 * plane here. The engine reads raster masks from a PNG path in the frame it
 * grades, so each plane is written once per (content, turn) into the
 * photo's cache.
 */
import { existsSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Orientation } from '../shared/engine-types'
import { gradientKey, rasteriseGradient } from '../shared/gradients'
import { orientPlane } from '../shared/orientation'
import { hash32, type LinearComponent, type RadialComponent, type Recipe } from '../shared/recipe'
import { paths } from './paths'
import { decodePng, encodeGreyPng } from './pngio'

/** Gradient planes kept per photo: dragging a gradient writes a new one per settled position. */
const KEEP_GRADIENTS = 64

function gradientPlane(
  dir: string,
  c: LinearComponent | RadialComponent,
  user: Orientation
): string {
  const file = join(dir, `grad-${gradientKey(c)}-${user}.png`)
  if (existsSync(file)) return file
  const w = Math.max(1, Math.round(c.width))
  const h = Math.max(1, Math.round(c.height))
  const turned = orientPlane(user, rasteriseGradient(c), w, h)
  writeFileSync(file, encodeGreyPng(turned.data, turned.width, turned.height))
  pruneGradients(dir)
  return file
}

/** Keep the newest gradient planes, drop the rest. */
function pruneGradients(dir: string): void {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('grad-'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    if (files.length <= KEEP_GRADIENTS) return
    files.sort((a, b) => b.t - a.t)
    for (const { f } of files.slice(KEEP_GRADIENTS)) unlinkSync(join(dir, f))
  } catch {
    // another process may hold one open (Windows); it goes next time
  }
}

export function brushPlanes(
  photoId: number,
  recipe: Recipe,
  user: Orientation
): Record<string, string> {
  const out: Record<string, string> = {}
  const dir = paths.photoCache(photoId)
  for (const layer of recipe.layers) {
    for (const c of layer.components) {
      if (c.kind === 'linear' || c.kind === 'radial') {
        out[c.id] = gradientPlane(dir, c, user)
        continue
      }
      if (c.kind !== 'brush' || !c.png) continue
      const file = join(dir, `brush-${hash32(c.png).toString(16)}-${c.png.length}-${user}.png`)
      if (!existsSync(file)) {
        const png = Buffer.from(c.png, 'base64')
        if (user === 'Normal') writeFileSync(file, png)
        else {
          const d = decodePng(png)
          const turned = orientPlane(user, new Uint8Array(d.rows), d.width, d.height)
          writeFileSync(file, encodeGreyPng(turned.data, turned.width, turned.height))
        }
      }
      out[c.id] = file
    }
  }
  return out
}
