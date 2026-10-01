/**
 * A pixel step onto its photo, from an AI job: the open develop session's
 * recipe when the photo is open (the renderer then records it in History),
 * else the photo's saved recipe.
 */
import { placeStep, type PixelStep } from '../../shared/pixels'
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

/** Whether a photo's steps are stored losslessly: a RAW's always, else as the setting says. */
export async function storesLossless(
  isRaw: boolean,
  setting: () => Promise<unknown>
): Promise<boolean> {
  return isRaw || (await setting().catch(() => null)) === true
}
