/**
 * Where each pixel of the lens-corrected picture comes from in the photo:
 * the engine's own correction run over a coordinate ramp (an "ST map", as
 * compositors call it). A mask is drawn over the corrected picture; a pixel
 * step lives on the photo's own pixels, before the correction; this is how
 * one is put on the other exactly, whatever the lens model, and including the
 * crop the correction makes.
 *
 * Only the geometry: lateral CA would move the ramp's red and blue apart (and
 * the map is read from red and green), vignetting would dim it.
 */
import { mkdir } from 'fs/promises'
import { join } from 'path'
import type { LensCorrection } from '../../shared/engine-types'
import { hash32 } from '../../shared/recipe'
import { exists } from '../exists'
import { blankRequest } from '../source'
import { makeOnce, type PixelDeps } from './working'

/** The map's long edge: the correction is smooth, and the map is read bilinearly. */
const MAP_EDGE = 1024

/** Whether a correction moves pixels at all (else a mask is already on the photo's pixels). */
export function moves(lens: LensCorrection | null): boolean {
  return !!lens?.distortion
}

/**
 * The map for `lens` over a `width × height` photo: a 16-bit PNG whose red and
 * green at each corrected pixel are where in the photo (0…65535 across and
 * down) it comes from. Made once per correction and photo size.
 */
export async function lensMap(
  deps: PixelDeps,
  lens: LensCorrection,
  width: number,
  height: number
): Promise<string> {
  const geometry: LensCorrection = {
    distortion: lens.distortion,
    lateral_ca: null,
    vignetting: null,
    outside: lens.outside ?? 'Crop',
    resampler: 'Bilinear'
  }
  const dir = join(deps.cacheDir, 'lensmaps')
  const key = hash32(JSON.stringify([geometry, width, height])).toString(16)
  const out = join(dir, `map-${key}.png`)
  if (await exists(out)) return out
  await mkdir(dir, { recursive: true })
  const k = Math.min(1, MAP_EDGE / Math.max(width, height))
  const w = Math.max(2, Math.round(width * k))
  const h = Math.max(2, Math.round(height * k))
  const ramp = join(dir, `ramp-${w}x${h}.png`)
  // Each written whole, once: a map read half made would misplace the mask.
  await makeOnce(ramp, (tmp) => deps.work({ op: 'ramp', file: tmp, w, h }))
  await makeOnce(
    out,
    (tmp) =>
      deps.engine.convert({
        ...blankRequest(ramp, tmp, 'Png'),
        pixel: { depth: 'Sixteen', channels: 3 },
        encode: { Png: { compression: 'Fast', filter: 'Sub' } },
        // Numbers, not colours: nothing may touch them.
        metadata: { exif: false, icc: false, xmp: false, iptc: false },
        color: 'Preserve',
        lens: geometry
      }),
    true
  )
  return out
}
