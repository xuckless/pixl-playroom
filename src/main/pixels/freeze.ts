/**
 * A mask frozen for a pixel step: the mask as it is now, on the photo's own
 * pixels (the source frame: upright, before lens correction, full size), as
 * an 8-bit grey PNG. A step made inside a mask keeps this shape whatever the
 * mask does afterwards, as a filter run on a selection does.
 *
 * The engine draws the mask as the develop view does (its brush planes, its
 * gradients, a colour range keyed on the graded picture), over the working
 * pixels at full size, without the user's turns, crop or perspective. When
 * the lens correction moves pixels, the plane is put back through the lens
 * map (lensmap.ts).
 */
import { join } from 'path'
import { compile, orientedFrame } from '../../shared/compile'
import { STRIP_ALL } from '../../shared/engine-types'
import { defaultUpright } from '../../shared/upright'
import { newId, type Recipe } from '../../shared/recipe'
import { brushPlanes } from '../brushes'
import type { ProxyFile } from '../proxy'
import { BACKGROUND_THREADS, blankRequest } from '../source'
import { lensMap, moves } from './lensmap'
import type { PixelDeps } from './working'

export interface FreezeContext {
  photoId: number
  isRaw: boolean
  asShot: Parameters<typeof compile>[1]['asShot']
  seed: number
  /** The working pixels at full size (the frame the step is made on). */
  master: ProxyFile
}

/** The recipe drawn on the photo's own frame: no turn, flip, straighten, crop or perspective. */
function onSourceFrame(recipe: Recipe): Recipe {
  return {
    ...recipe,
    geometry: {
      ...recipe.geometry,
      quarterTurns: 0,
      flipHorizontal: false,
      straighten: 0,
      crop: null,
      aspect: null,
      upright: defaultUpright()
    }
  }
}

/** Freeze `layerId`'s mask; the plane's path (in the cache), or null when the mask selects nothing. */
export async function freezeMask(
  deps: PixelDeps,
  ctx: FreezeContext,
  recipe: Recipe,
  layerId: string
): Promise<string | null> {
  const r = onSourceFrame(recipe)
  const { master } = ctx
  const { user } = orientedFrame(r, master.width, master.height)
  const compiled = compile(r, {
    isRaw: ctx.isRaw,
    asShot: ctx.asShot,
    sourceOrientation: 'Normal',
    frameWidth: master.width,
    frameHeight: master.height,
    scale: 1,
    seed: ctx.seed,
    brushPaths: await brushPlanes(ctx.photoId, r, user),
    applyCrop: false
  })
  const index = compiled.layerIndex[layerId]
  if (index === undefined || !compiled.grade) return null
  // Two masks frozen in one millisecond (two jobs) never share a file.
  const stamp = newId()
  const drawn = join(deps.cacheDir, `freeze-${stamp}.png`)
  await deps.engine.convert({
    ...blankRequest(master.path, drawn, master.input),
    pixel: { depth: 'Eight', channels: 1 },
    encode: { Png: { compression: 'Fast', filter: 'Sub' } },
    metadata: STRIP_ALL,
    color: 'Preserve',
    grade: compiled.grade,
    framing: null,
    lens: compiled.lens,
    // Spots move pixels too, but not where they are: the mask is unaffected.
    retouch: null,
    inspect: { LayerMask: { layer: index } },
    threads: BACKGROUND_THREADS
  })
  if (!moves(compiled.lens)) return drawn
  const map = await lensMap(deps, compiled.lens!, master.width, master.height)
  const out = join(deps.cacheDir, `freeze-${stamp}-source.png`)
  await deps.work({ op: 'unwarp', mask: drawn, map, w: master.width, h: master.height, out })
  return out
}
