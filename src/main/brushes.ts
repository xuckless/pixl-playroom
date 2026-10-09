/**
 * Raster masks on disk. A brush component lives in the recipe as a base64
 * grey PNG in the base frame (the photo upright, before the user's turns).
 * The engine reads raster masks from a PNG path in the frame it grades, so
 * each plane is written once per (content, turn) into the photo's cache, by
 * the pixels worker. Gradients reach the engine as its own shapes; only one
 * an older version gave an edge is drawn into a plane here
 * (`rasterGradient`).
 *
 * A painted stroke with Snap to edges is kept to the object it was painted
 * on: SAM (main/select) finds that object, and the plane written is the
 * stroke cut to it, so its edge is the object's (`snapsToObject`). Written
 * once per stroke, photo and lens correction, and found again by its name,
 * without SAM. Without SAM the stroke is written as it is, and only the
 * engine's refine snaps it.
 */
import { join } from 'path'
import type { Orientation } from '../shared/engine-types'
import { gradientKey, rasterGradient } from '../shared/gradients'
import { edgeKey } from '../shared/maskedge'
import type { LensCorrection } from '../shared/engine-types'
import { lensCorrection } from '../shared/lens'
import { planeEdge, snapsToObject } from '../shared/refine'
import type { Recipe } from '../shared/recipe'
import log from 'electron-log/main'
import { grey8 } from './pngio'
import { planeRef } from './planeref'
import { exists } from './exists'
import { paths } from './paths'
import { pruneGradientsSometimes, writeBrushPlane, writeGradientPlane } from './planes'
import { pixels, type PixelsJob } from './workers/pool'

/** Planes being written now, by file: two renders asking for one plane share the work. */
const writing = new Map<string, Promise<void>>()

/** A grey plane, 8 bits, row by row. */
export interface Grey {
  data: Uint8Array
  width: number
  height: number
}

/** What finds the object a stroke was painted on (main/select's SAM), once the app has one. */
export interface BrushSnapper {
  /** What a stroke's snap depends on besides the stroke (the photo, the lens): no model run. */
  key(photoKey: string, lens: LensCorrection | null): Promise<string>
  /** The object under a stroke at the frame's size, or null (no SAM, nothing found). */
  object(photoKey: string, lens: LensCorrection | null, stroke: Grey): Promise<Grey | null>
}
let snapper: BrushSnapper | null = null

/** Strokes are snapped to objects from now on (SAM can run). */
export function setBrushSnapper(s: BrushSnapper | null): void {
  snapper = s
}

/** Snapped planes being found now, by file: the path each lands at. */
const snapping = new Map<string, Promise<string>>()

/**
 * A stroke kept to its object: the snapped plane when there is one (made
 * now if need be), else the stroke's own.
 */
function snapped(
  snapFile: string,
  plainFile: string,
  photoKey: string,
  lens: LensCorrection | null,
  job: PixelsJob & { op: 'brush' }
): Promise<string> {
  const running = snapping.get(snapFile)
  if (running) return running
  const p = (async () => {
    if (await exists(snapFile)) return snapFile
    const object = await snapper
      ?.object(photoKey, lens, grey8(Buffer.from(job.png, 'base64')))
      .catch((err) => {
        log.warn('brush snap: no object', err)
        return null
      })
    if (!object) {
      await ensure(plainFile, job)
      return plainFile
    }
    await ensure(snapFile, { ...job, file: snapFile, object })
    return snapFile
  })().finally(() => snapping.delete(snapFile))
  snapping.set(snapFile, p)
  return p
}

function ensure(file: string, job: PixelsJob & { op: 'gradient' | 'brush' }): Promise<void> {
  const running = writing.get(file)
  if (running) return running
  const p = exists(file)
    .then((there) => (there ? undefined : pixels.run<null>(job).then(() => undefined)))
    .catch(() => {
      // The worker is gone: draw it here rather than fail the render.
      if (job.op === 'gradient') {
        writeGradientPlane(file, job.c, job.user)
        pruneGradientsSometimes(job.dir)
      } else writeBrushPlane(file, job.png, job.user, job.edge, job.object)
    })
    .finally(() => writing.delete(file))
  writing.set(file, p)
  return p
}

/** Each brush (or edged gradient) component's plane file, by component id. */
export async function brushPlanes(
  photoId: number,
  recipe: Recipe,
  user: Orientation
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const dir = paths.photoCache(photoId)
  const work: Promise<void>[] = []
  const photoKey = String(photoId)
  const lens = lensCorrection(recipe.lens)
  // Asked once, and only when a stroke is to be snapped.
  let snapKey: Promise<string | null> | null = null
  const snapKeyOf = (): Promise<string | null> =>
    (snapKey ??= snapper ? snapper.key(photoKey, lens).catch(() => null) : Promise.resolve(null))
  for (const layer of recipe.layers) {
    for (const c of layer.components) {
      if (c.kind === 'linear' || c.kind === 'radial' || c.kind === 'bidirectional') {
        if (!rasterGradient(c)) continue
        const file = join(dir, `grad-${gradientKey(c)}${edgeKey(c.edge)}-${user}.png`)
        work.push(ensure(file, { op: 'gradient', file, dir, c, user }))
        out[c.id] = file
        continue
      }
      if (c.kind === 'depth') {
        // A depth map: turned as a painted plane is; the band is keyed by the engine.
        if (!c.png) continue
        const file = join(dir, `depth-${c.ref ?? planeRef(c.png)}-${user}.png`)
        work.push(ensure(file, { op: 'brush', file, png: c.png, user }))
        out[c.id] = file
        continue
      }
      if (c.kind !== 'brush' || !c.png) continue
      // Named by its plane's reference (its content hash), reused when it has
      // one: hashing megabytes of PNG on every compile is what it saves. A
      // snapped plane's shift is the engine's (refine), not the plane's.
      const edge = planeEdge(c)
      const name = `brush-${c.ref ?? planeRef(c.png)}${edgeKey(edge)}`
      const file = join(dir, `${name}-${user}.png`)
      const job = { op: 'brush' as const, file, png: c.png, user, ...(edge ? { edge } : {}) }
      if (snapsToObject(c) && snapper) {
        const id = c.id
        work.push(
          snapKeyOf().then(async (k) => {
            out[id] = k
              ? await snapped(join(dir, `${name}-on${k}-${user}.png`), file, photoKey, lens, job)
              : file
            if (!k) await ensure(file, job)
          })
        )
        continue
      }
      work.push(ensure(file, job))
      out[c.id] = file
    }
  }
  await Promise.all(work)
  return out
}
