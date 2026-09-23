/**
 * Painted masks on disk. A brush component lives in the recipe as a base64
 * grey PNG in the base frame (the photo upright, before the user's turns); the
 * engine reads raster masks from a PNG path in the frame it grades, so each
 * plane is written once per (content, turn) into the photo's cache.
 */
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Orientation } from '../shared/engine-types'
import { orientPlane } from '../shared/orientation'
import { hash32, type Recipe } from '../shared/recipe'
import { paths } from './paths'
import { decodePng, encodeGreyPng } from './pngio'

export function brushPlanes(
  photoId: number,
  recipe: Recipe,
  user: Orientation
): Record<string, string> {
  const out: Record<string, string> = {}
  const dir = paths.photoCache(photoId)
  for (const layer of recipe.layers) {
    for (const c of layer.components) {
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
