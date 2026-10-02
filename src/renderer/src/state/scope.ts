/**
 * Where the panels' edits go. With a mask selected (and the masks window
 * up), Basic, Tone Curve, HSL, Colour Grading, Detail, Effects and
 * Calibration edit that mask's own settings, which apply where it selects;
 * otherwise they edit the whole photo. Lens and Crop always edit the photo.
 *
 * A panel reads `recipe` and writes through `edit` / `commit` / `replace`
 * exactly as it would the store's: in a mask the recipe it sees carries the
 * mask's settings in place of the photo's, and what it changes there lands
 * in the mask.
 */
import { useMemo } from 'react'
import { SETTINGS_KEYS, type LocalLayer, type Recipe } from '../../../shared/recipe'
import { useDevelop } from './develop'
import { useUi } from './ui'

/** The mask the panels edit, if any: the selected one, while the masks window is up. */
export function scopeLayer(
  recipe: Recipe | null,
  layerId: string | null,
  masksOpen: boolean
): LocalLayer | null {
  if (!recipe || !layerId || !masksOpen) return null
  return recipe.layers.find((l) => l.id === layerId) ?? null
}

/** The recipe as a panel in `layer`'s scope sees it: the mask's settings over the photo's. */
export function scopedView(recipe: Recipe, layer: LocalLayer | null): Recipe {
  return layer ? { ...recipe, ...layer.settings } : recipe
}

/**
 * Run a panel's change on `r` in the scope of layer `layerId`: on a view whose
 * settings are the mask's, then back into the mask (so a change that
 * replaces a whole group, `r.wb = …`, lands as surely as one that sets a field).
 */
export function changeIn(r: Recipe, layerId: string | null, change: (r: Recipe) => void): void {
  const layer = layerId ? r.layers.find((l) => l.id === layerId) : undefined
  if (!layer) return change(r)
  const view = scopedView(r, layer)
  change(view)
  const s = layer.settings as unknown as Record<string, unknown>
  for (const k of SETTINGS_KEYS) s[k] = view[k]
}

export interface Scope {
  /** The mask being edited, or null for the whole photo. */
  layer: LocalLayer | null
  /** The recipe as the panel sees it (the mask's settings in a mask). */
  recipe: Recipe | null
  edit(change: (r: Recipe) => void, interactive?: boolean): void
  /** Record a step; in a mask its name leads the label ("Mask 1: Exposure"). */
  commit(label: string): void
  /** Take `next` (a changed copy of `recipe`) as the scope's settings, and record a step. */
  replace(next: Recipe, label: string): void
}

function scopeNow(): { layerId: string | null } {
  const dev = useDevelop.getState()
  const layer = scopeLayer(dev.recipe, dev.layerId, useUi.getState().masksWin.open)
  return { layerId: layer?.id ?? null }
}

/** The scope's actions outside React (the loupe's tools): the same as `useScope`'s. */
export const scoped = {
  layer(): LocalLayer | null {
    const dev = useDevelop.getState()
    return scopeLayer(dev.recipe, dev.layerId, useUi.getState().masksWin.open)
  },
  recipe(): Recipe | null {
    const r = useDevelop.getState().recipe
    return r ? scopedView(r, scoped.layer()) : null
  },
  edit(change: (r: Recipe) => void, interactive = false): void {
    const { layerId } = scopeNow()
    useDevelop.getState().edit((r) => changeIn(r, layerId, change), interactive)
  },
  commit(label: string): void {
    const layer = scoped.layer()
    useDevelop.getState().commit(layer ? `${layer.name}: ${label}` : label)
  },
  replace(next: Recipe, label: string): void {
    const layer = scoped.layer()
    if (!layer) {
      void useDevelop.getState().replace(next, label)
      return
    }
    useDevelop.getState().edit((r) => {
      const l = r.layers.find((x) => x.id === layer.id)
      if (!l) return
      const s = l.settings as unknown as Record<string, unknown>
      for (const k of SETTINGS_KEYS) s[k] = structuredClone(next[k])
    })
    useDevelop.getState().commit(`${layer.name}: ${label}`)
  }
}

export function useScope(): Scope {
  const recipe = useDevelop((s) => s.recipe)
  const layerId = useDevelop((s) => s.layerId)
  const open = useUi((s) => s.masksWin.open)
  const layer = scopeLayer(recipe, layerId, open)
  const view = useMemo(() => (recipe ? scopedView(recipe, layer) : null), [recipe, layer])
  return {
    layer,
    recipe: view,
    edit: scoped.edit,
    commit: scoped.commit,
    replace: scoped.replace
  }
}
