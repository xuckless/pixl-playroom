/**
 * Putting a look or a saved preset on a photo's recipe. A look (anything
 * with `fields`) moves only the sliders it sets; a saved preset replaces the
 * groups it was saved with. The rail, the browser's thumbnails and the hover
 * preview all go through here, so what they show is what applying does.
 */
import type { Preset } from '../ipc'
import type { ResolvedProfile } from '../lens'
import { applyFields, applyGroups, changedFields, type Recipe } from '../recipe'
import { wbFromSaved, type WbContext } from '../wbconvert'

export interface ApplyContext {
  /** The photo's white: a saved custom white is converted into its units. */
  wb: WbContext
  /**
   * The lens correction this photo resolved for the preset's profile, or
   * `'keep'` to leave the profile's resolution as the preset has it (a
   * thumbnail, a preview: nothing is looked up for those).
   */
  lensResolved: ResolvedProfile | null | 'keep'
}

/** Whether applying `p` needs the photo's own lens resolution (see `ApplyContext`). */
export function needsLens(p: Preset): boolean {
  return p.groups.includes('lens') && p.recipe.lens.profile.enabled
}

export function applyLook(to: Recipe, p: Preset, ctx: ApplyContext): Recipe {
  // A saved custom white balance is in the units of the photo it was made
  // on; on a photo of the other kind it goes through the engine's white.
  const from = p.wbOp ? { ...p.recipe, wb: wbFromSaved(p.recipe.wb, p.wbOp, ctx.wb) } : p.recipe
  const next = p.fields ? applyFields(to, from, p.fields) : applyGroups(to, from, p.groups)
  if (p.groups.includes('lens')) {
    // Chromatic aberration is measured per photo: this one keeps its own.
    next.lens.ca = to.lens.ca
    if (needsLens(p) && ctx.lensResolved !== 'keep') next.lens.profile.resolved = ctx.lensResolved
  }
  return next
}

/** The fields applying a look changed on a photo: what its Amount scales. */
export function lookFields(before: Recipe, after: Recipe): string[][] {
  return changedFields(after, before)
}
