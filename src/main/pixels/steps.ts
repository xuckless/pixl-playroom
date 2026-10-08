/**
 * A pixel step onto its photo, from an AI job: the open develop session's
 * recipe when the photo is open (the renderer then records it in History),
 * else the photo's saved recipe.
 */
import { placeStep, replaceStep, type PixelStep } from '../../shared/pixels'
import type { Library } from '../library'
import type { DevelopSessions } from '../render'

/**
 * Add `step` (after the steps `basedOn` names, when it was computed on
 * them: see `placeStep`). An open photo's working pixels are made before
 * this resolves, so a preview cleared after it never shows the photo
 * without the step.
 */
export async function addPixelStep(
  library: Library,
  sessions: DevelopSessions | undefined,
  key: string,
  step: PixelStep,
  basedOn?: string[]
): Promise<void> {
  const live = sessions?.liveRecipe(key)
  if (live && sessions) {
    sessions.update(key, { ...live, pixels: placeStep(live.pixels, step, basedOn) }, false)
    await sessions.flush(key)
    await sessions.workingReady(key)
    return
  }
  const saved = await library.recipe(key)
  await library.saveRecipe(key, { ...saved, pixels: placeStep(saved.pixels, step, basedOn) })
}

/**
 * A step made again (the same id, mask and strength, new pixels) in its own
 * place, in the open session's recipe or the saved one.
 */
export async function replacePixelStep(
  library: Library,
  sessions: DevelopSessions | undefined,
  key: string,
  step: PixelStep
): Promise<void> {
  const live = sessions?.liveRecipe(key)
  if (live && sessions) {
    sessions.update(key, { ...live, pixels: replaceStep(live.pixels, step) }, false)
    await sessions.flush(key)
    await sessions.workingReady(key)
    return
  }
  const saved = await library.recipe(key)
  await library.saveRecipe(key, { ...saved, pixels: replaceStep(saved.pixels, step) })
}

/** Whether a photo's steps are stored losslessly: a RAW's always, else as the setting says. */
export async function storesLossless(
  isRaw: boolean,
  setting: () => Promise<unknown>
): Promise<boolean> {
  return isRaw || (await setting().catch(() => null)) === true
}
