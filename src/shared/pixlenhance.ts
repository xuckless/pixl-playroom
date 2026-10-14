/**
 * PIXL Enhance (`pixl-enhance-v1`, PIXL's own model; a development kit's
 * roster until it is released): one network for compression artefacts and
 * halos, noise and mild blur, told what to do by a level and never how much.
 * The levels nest, each doing what the one before does and more. Which two
 * planes and which tiling a level is, the roster entry says (`levels`): the
 * engine cannot tell a trained setting from an untrained one, so Playroom
 * states only those three, never its own numbers.
 */

import { tk } from './i18n'

/** The model's roster id. */
export const PIXL_ENHANCE = 'pixl-enhance-v1'

/** The three levels: 0 clean up (artefacts, halos), 1 also noise, 2 also mild blur. */
export type PixlLevel = 'clean' | 'denoise' | 'sharpen'

export const PIXL_LEVELS: readonly PixlLevel[] = ['clean', 'denoise', 'sharpen']

/** The level's number in the roster entry's `levels`. */
export const LEVEL_NUMBER: Record<PixlLevel, 0 | 1 | 2> = { clean: 0, denoise: 1, sharpen: 2 }

export const LEVEL_LABEL: Record<PixlLevel, string> = {
  clean: tk('Clean up'),
  denoise: tk('Clean up + denoise'),
  sharpen: tk('Clean up + denoise + sharpen')
}

export const LEVEL_HINT: Record<PixlLevel, string> = {
  clean: tk('Compression blocks, ringing and halos. Noise and softness are left as they are.'),
  denoise: tk('Also removes noise: for most phone photos.'),
  sharpen: tk('Also mild blur, and the softness a noise reduction leaves. Slower: larger tiles.')
}

/** A level as the roster entry states it: the model's two planes and its tiling. */
export interface PixlLevelValues {
  conditioning: unknown[]
  tiling: { Fixed: { width: number; height: number; overlap: number } }
}

/**
 * The roster entry's values for `level`, or an error naming what is missing:
 * an entry without them is not one this build knows how to run.
 */
export function levelValues(entry: unknown, level: PixlLevel): PixlLevelValues {
  const want = LEVEL_NUMBER[level]
  const levels = (entry as { levels?: unknown } | null)?.levels
  const found = Array.isArray(levels)
    ? (levels as { level?: unknown; conditioning?: unknown; tiling?: unknown }[]).find(
        (l) => l.level === want
      )
    : undefined
  const fixed = (found?.tiling as PixlLevelValues['tiling'] | undefined)?.Fixed
  if (!found || !Array.isArray(found.conditioning) || !fixed)
    throw new Error(`${PIXL_ENHANCE}: the roster states no level ${want}`)
  return { conditioning: found.conditioning, tiling: { Fixed: { ...fixed } } }
}
