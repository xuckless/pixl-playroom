/**
 * A mask from a model lands on the photo it was made for, whichever photo is
 * open by then: into the develop session's recipe when the photo is open
 * (the loupe re-reads it), else into its saved recipe.
 */
import type { AiJobEvent } from '../../shared/ai'
import { AI_MASK_EDGE } from '../../shared/maskcontrols'
import { nextMaskName } from '../../shared/masks'
import { newId, newLocalLayer, type BrushComponent, type Recipe } from '../../shared/recipe'
import { parseKey } from '../keys'
import type { Library } from '../library'
import type { PlaneStore } from '../planestore'
import type { DevelopSessions } from '../render'

export async function applyMaskResult(
  e: AiJobEvent,
  deps: { library: Library; sessions: DevelopSessions; planes: PlaneStore }
): Promise<void> {
  const r = e.result
  if (r?.kind !== 'mask') return
  const png = await deps.planes.get(r.ref)
  if (png === undefined) throw new Error('the mask went missing before it could be added')
  const live = deps.sessions.liveRecipe(e.key)
  const recipe: Recipe = structuredClone(live ?? (await deps.library.recipe(e.key)))
  const comp: BrushComponent = {
    id: newId(),
    name: r.label,
    kind: 'brush',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 0,
    width: r.width,
    height: r.height,
    png,
    // A model's plane is soft and low resolution, and blooms past the edge:
    // pulled in a little and firmed up.
    edge: { ...AI_MASK_EDGE },
    ...(r.source ? { source: r.source } : {})
  }
  const into = r.into && recipe.layers.find((l) => l.id === r.into!.layerId)
  if (into) into.components.push({ ...comp, mode: into.components.length ? r.into!.mode : 'Add' })
  else {
    const layer = newLocalLayer(nextMaskName(recipe.layers.map((l) => l.name)))
    layer.name = r.label
    layer.components = [comp]
    recipe.layers.push(layer)
    r.into = { layerId: layer.id, mode: 'Add' }
  }
  await keepRecipe(e.key, recipe, live !== undefined, deps)
}

/** The photo's recipe changed by main: into its open session, else its saved recipe. */
async function keepRecipe(
  key: string,
  recipe: Recipe,
  open: boolean,
  deps: { library: Library; sessions: DevelopSessions }
): Promise<void> {
  if (open) {
    deps.sessions.update(key, recipe, false)
    // Saved at once: the loupe reads the recipe back as soon as it hears.
    await deps.sessions.flush(key)
  } else {
    await deps.library.saveRecipe(key, recipe)
    const { photoId, copyId } = parseKey(key)
    deps.library.queueThumb(photoId, copyId, true)
  }
}

/**
 * Change a photo's recipe from main (a smart look's run shaping its masks),
 * whichever photo is open: as `applyMaskResult` lands a mask.
 */
export async function editPhotoRecipe(
  key: string,
  change: (r: Recipe) => void,
  deps: { library: Library; sessions: DevelopSessions }
): Promise<void> {
  const live = deps.sessions.liveRecipe(key)
  const recipe: Recipe = structuredClone(live ?? (await deps.library.recipe(key)))
  change(recipe)
  await keepRecipe(key, recipe, live !== undefined, deps)
}
