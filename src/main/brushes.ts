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
import type { Orientation } from '../shared/engine-types'
import { gradientKey, rasterGradient } from '../shared/gradients'
import { edgeKey } from '../shared/maskedge'
import type { LensCorrection } from '../shared/engine-types'
import { renderedLens } from '../shared/edits'
import { frameMap, frameOf, remapComponent, warpPlane, type MaskFrames } from '../shared/lensframe'
import { planeWarpFor } from './maskframe'
import { planeEdge, snapsToObject } from '../shared/refine'
import type { Recipe } from '../shared/recipe'
import log from 'electron-log/main'
import { grey8 } from './pngio'
import { isPlaneHash } from '../shared/ids'
import { cacheFile } from './contain'
import { planeRef } from './planeref'
import { exists } from './exists'
import { KnownFiles } from './knownfiles'
import { paths } from './paths'
import { pruneGradientsSometimes, writeBrushPlane, writeGradientPlane } from './planes'
import { pixels, type PixelsJob } from './workers/pool'

/** Planes being written now, by file: two renders asking for one plane share the work. */
const writing = new Map<string, Promise<void>>()
/**
 * Planes known to be written: a drag's drafts (each compiles every mask's
 * plane) find them here rather than by a stat each, per plane, per frame.
 */
const present = new KnownFiles()

/** A photo's cache folder was swept: its planes are looked for on disk again. */
export function forgetPlanes(dir: string): void {
  present.forget(dir)
}

/** Whether `file` is on disk: known, or found (and known from then on). */
async function onDisk(file: string): Promise<boolean> {
  if (present.has(file)) return true
  const there = await exists(file)
  if (there) present.add(file)
  return there
}

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
    if (await onDisk(snapFile)) return snapFile
    // The object is found on the picture as rendered: a stroke drawn under
    // another lens asks for it where it now lies (once: the file is kept).
    const drawn = grey8(Buffer.from(job.png, 'base64'))
    const stroke = job.warp
      ? { ...drawn, data: warpPlane(drawn.data, drawn.width, drawn.height, job.warp) }
      : drawn
    const object = await snapper?.object(photoKey, lens, stroke).catch((err) => {
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
  if (present.has(file)) return Promise.resolve()
  const running = writing.get(file)
  if (running) return running
  const p = onDisk(file)
    .then((there) => (there ? undefined : pixels.run<null>(job).then(() => undefined)))
    .catch(() => {
      // The worker is gone: draw it here rather than fail the render.
      if (job.op === 'gradient') {
        writeGradientPlane(file, job.c, job.user)
        pruneGradientsSometimes(job.dir)
      } else writeBrushPlane(file, job.png, job.user, job.edge, job.object, job.warp)
    })
    .then(() => {
      // Writing a gradient's plane may have pruned the folder's older ones.
      if (job.op === 'gradient') present.forget(job.dir, 'grad-')
      present.add(file)
    })
    .finally(() => writing.delete(file))
  writing.set(file, p)
  return p
}

/**
 * A plane's name in the cache: its reference when that is a SHA-256 (what
 * Playroom names planes by), else the hash of its PNG. A recipe from a file
 * someone else wrote never names a cache file.
 */
const planeName = (c: { ref?: string; png: string }): string =>
  isPlaneHash(c.ref) ? c.ref : planeRef(c.png)

/** What the planes are written for, besides the recipe and the turn. */
export interface PlaneOptions {
  /** The photo is a RAW: what its recipe's switched-off sections render as (`edits.ts` `effective`). */
  isRaw?: boolean
  /**
   * The masks drawn under another lens than the one rendered
   * (main/maskframe.ts `maskFramesFor`): such a plane is re-warped onto the
   * frame rendered, once, into a file of its own (`<plane>-<lens>-<turn>.png`).
   */
  frames?: MaskFrames | null
}

/** Each brush (or edged gradient) component's plane file, by component id. */
export async function brushPlanes(
  photoId: number,
  recipe: Recipe,
  user: Orientation,
  opts: PlaneOptions = {}
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const dir = paths.photoCache(photoId)
  const work: Promise<void>[] = []
  const photoKey = String(photoId)
  // The object a stroke snaps to is found on the picture as rendered.
  const lens = renderedLens(recipe, opts.isRaw === true)
  // Asked once, and only when a stroke is to be snapped.
  let snapKey: Promise<string | null> | null = null
  const snapKeyOf = (): Promise<string | null> =>
    (snapKey ??= snapper ? snapper.key(photoKey, lens).catch(() => null) : Promise.resolve(null))
  const frames = opts.frames ?? null
  const masks = recipe.masks?.lensFrame ?? null
  for (const layer of recipe.layers) {
    for (const drawn of layer.components) {
      // A plane drawn under another lens: re-warped onto the one rendered.
      const warped = frames ? planeWarpFor(frames, frameOf(drawn, masks)) : null
      const lensKey = warped ? `-${warped.key}` : ''
      const warp = warped ? { warp: warped.warp } : {}
      if (drawn.kind === 'linear' || drawn.kind === 'radial' || drawn.kind === 'bidirectional') {
        if (!rasterGradient(drawn)) continue
        // Drawn from its points: they move to the frame rendered, as compile moves them.
        const c =
          frames && warped
            ? remapComponent(drawn, frameMap(frames.maps, frameOf(drawn, masks), frames.to))
            : drawn
        const file = cacheFile(dir, `grad-${gradientKey(c)}${edgeKey(c.edge)}-${user}.png`)
        work.push(ensure(file, { op: 'gradient', file, dir, c, user }))
        out[c.id] = file
        continue
      }
      const c = drawn
      if (c.kind === 'depth') {
        // A depth map: turned as a painted plane is; the band is keyed by the engine.
        if (!c.png) continue
        const file = cacheFile(dir, `depth-${planeName(c)}${lensKey}-${user}.png`)
        work.push(ensure(file, { op: 'brush', file, png: c.png, user, ...warp }))
        out[c.id] = file
        continue
      }
      if (c.kind !== 'brush' || !c.png) continue
      // Named by its plane's reference (its content hash), reused when it has
      // one: hashing megabytes of PNG on every compile is what it saves. A
      // snapped plane's shift is the engine's (refine), not the plane's.
      const edge = planeEdge(c)
      const name = `brush-${planeName(c)}${edgeKey(edge)}${lensKey}`
      const file = cacheFile(dir, `${name}-${user}.png`)
      const job = {
        op: 'brush' as const,
        file,
        png: c.png,
        user,
        ...(edge ? { edge } : {}),
        ...warp
      }
      if (snapsToObject(c) && snapper) {
        const id = c.id
        work.push(
          snapKeyOf().then(async (k) => {
            out[id] = k
              ? await snapped(
                  cacheFile(dir, `${name}-on${k}-${user}.png`),
                  file,
                  photoKey,
                  lens,
                  job
                )
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
