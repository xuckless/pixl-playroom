/**
 * Applying a look or a saved preset to the open photo: one history step.
 * The rail and the Looks browser both come here.
 */
import type { Preset } from '../../../shared/ipc'
import { applyLook, needsLens } from '../../../shared/looks/apply'
import { useDevelop } from '../state/develop'
import { api } from './api'

export async function applyToPhoto(p: Preset): Promise<boolean> {
  const { session } = useDevelop.getState()
  if (!session) return false
  // A lens profile is this photo's lens's at its focal length and aperture,
  // not the numbers it had where the preset was saved.
  const resolved = needsLens(p)
    ? await api.lens.resolve(session.key, p.recipe.lens.profile.id).then(
        (m) => m.resolved,
        () => null
      )
    : null
  const now = useDevelop.getState()
  if (now.session?.key !== session.key || !now.recipe) return false
  const next = applyLook(now.recipe, p, { wb: session, lensResolved: resolved })
  now.replace(next, `${p.meta ? 'Look' : 'Preset'}: ${p.name}`)
  return true
}
