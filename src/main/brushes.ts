/**
 * Raster masks on disk. A brush component lives in the recipe as a base64
 * grey PNG in the base frame (the photo upright, before the user's turns); a
 * linear or radial gradient lives there as its geometry and is drawn into a
 * plane here. The engine reads raster masks from a PNG path in the frame it
 * grades, so each plane is written once per (content, turn) into the
 * photo's cache, by the pixels worker.
 */
import { join } from 'path'
import type { Orientation } from '../shared/engine-types'
import { gradientKey } from '../shared/gradients'
import { hash32, type Recipe } from '../shared/recipe'
import { exists } from './exists'
import { paths } from './paths'
import { pruneGradients, writeBrushPlane, writeGradientPlane } from './planes'
import { pixels, type PixelsJob } from './workers/pool'

/** Planes being written now, by file: two renders asking for one plane share the work. */
const writing = new Map<string, Promise<void>>()

function ensure(file: string, job: PixelsJob & { op: 'gradient' | 'brush' }): Promise<void> {
  const running = writing.get(file)
  if (running) return running
  const p = exists(file)
    .then((there) => (there ? undefined : pixels.run<null>(job).then(() => undefined)))
    .catch(() => {
      // The worker is gone: draw it here rather than fail the render.
      if (job.op === 'gradient') {
        writeGradientPlane(file, job.c, job.user)
        pruneGradients(job.dir)
      } else writeBrushPlane(file, job.png, job.user)
    })
    .finally(() => writing.delete(file))
  writing.set(file, p)
  return p
}

/** Each brush or gradient component's plane file, by component id. */
export async function brushPlanes(
  photoId: number,
  recipe: Recipe,
  user: Orientation
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const dir = paths.photoCache(photoId)
  const work: Promise<void>[] = []
  for (const layer of recipe.layers) {
    for (const c of layer.components) {
      if (c.kind === 'linear' || c.kind === 'radial') {
        const file = join(dir, `grad-${gradientKey(c)}-${user}.png`)
        work.push(ensure(file, { op: 'gradient', file, dir, c, user }))
        out[c.id] = file
        continue
      }
      if (c.kind !== 'brush' || !c.png) continue
      const file = join(dir, `brush-${hash32(c.png).toString(16)}-${c.png.length}-${user}.png`)
      work.push(ensure(file, { op: 'brush', file, png: c.png, user }))
      out[c.id] = file
    }
  }
  await Promise.all(work)
  return out
}
