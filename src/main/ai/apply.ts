/**
 * A mask from a model lands on the photo it was made for, whichever photo is
 * open by then: into the develop session's recipe when the photo is open
 * (the loupe re-reads it), else into its saved recipe.
 */
import type { AiJobEvent } from '../../shared/ai'
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
    png
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
  if (live) {
    deps.sessions.update(e.key, recipe, false)
    // Saved at once: the loupe reads the recipe back as soon as it hears.
    await deps.sessions.flush(e.key)
  } else {
    await deps.library.saveRecipe(e.key, recipe)
    const { photoId, copyId } = parseKey(e.key)
    deps.library.queueThumb(photoId, copyId, true)
  }
}
