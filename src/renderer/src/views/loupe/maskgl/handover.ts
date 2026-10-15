/**
 * When the loupe's own mask gives way to the engine's plane. The loupe draws
 * the selected mask from the recipe at once; the engine's plane takes over
 * once it is of the recipe the loupe drew (its `rev` at least `target`).
 * Pure, for tests.
 */

/** What the handover watches: the selected mask, its shape, and where masks are placed. */
export interface Watched {
  layerId: string | null
  /** The mask's components, by identity (its sliders moving leave them as they are). */
  components: unknown
  invert: boolean
  /** The develop store's `geometryRev`: the framing or the lens changed at this recipe number. */
  geometryRev: number
}

/**
 * The recipe number the engine's plane must be of before it shows, after a
 * change from `was` to `now`. A different mask shows the engine's plane as
 * soon as it has one for it (0); a change of shape waits for the edit, which
 * is sent as the next number; a framing or lens change waits for the render
 * of the picture as it is now placed, so a plane of the old framing never
 * shows stretched over the new one.
 */
export function nextTarget(was: Watched, now: Watched, target: number, lastSent: number): number {
  if (now.layerId !== was.layerId) return 0
  let t = target
  if (now.components !== was.components || now.invert !== was.invert) t = lastSent + 1
  if (now.geometryRev !== was.geometryRev) t = Math.max(t, now.geometryRev)
  return t
}
