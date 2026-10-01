/**
 * A pixel step onto its photo, from an AI job: the open develop session's
 * recipe when the photo is open (the renderer then records it in History),
 * else the photo's saved recipe.
 */
import type { PixelStep } from '../../shared/pixels'
import type { Library } from '../library'
import type { DevelopSessions } from '../render'

export async function addPixelStep(
  library: Library,
  sessions: DevelopSessions | undefined,
  key: string,
  step: PixelStep
): Promise<void> {
  const live = sessions?.liveRecipe(key)
  if (live && sessions) {
    sessions.update(key, { ...live, pixels: [...live.pixels, step] }, false)
    await sessions.flush(key)
    return
  }
  const saved = await library.recipe(key)
  await library.saveRecipe(key, { ...saved, pixels: [...saved.pixels, step] })
}

/** Whether a photo's steps are stored losslessly: a RAW's always, else as the setting says. */
export async function storesLossless(
  isRaw: boolean,
  setting: () => Promise<unknown>
): Promise<boolean> {
  return isRaw || (await setting().catch(() => null)) === true
}
