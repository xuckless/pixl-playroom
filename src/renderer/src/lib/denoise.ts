/**
 * AI denoise in the renderer: starting a denoise step for the open photo
 * (the whole photo, or inside the selected mask), and bringing photos from
 * before it was a step over: one whose recipe still has the old setting on
 * gets the step it described (its old full-resolution result reused when it
 * is still kept), and the setting goes off.
 */
import { api } from './api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { scoped } from '../state/scope'
import { useUi } from '../state/ui'
import { errorText } from './api'

/** Start a denoise step for the open photo: in the selected mask when the panels edit one. */
export async function applyDenoise(): Promise<void> {
  const { session } = useDevelop.getState()
  if (!session) return
  const { model, strength } = useUi.getState().denoise
  const layer = scoped.layer()
  await api.ai.start({
    task: 'denoise',
    key: session.key,
    model,
    strength,
    layerId: layer?.id ?? null
  })
}

/** Old AI denoise settings become steps, as photos open. Returns the unsubscribe. */
export function startDenoiseUpkeep(): () => void {
  return useDevelop.subscribe((s, prev) => {
    if (!s.session || !s.recipe || s.session === prev.session) return
    const ai = s.recipe.detail.ai
    if (!ai.enabled) return
    const key = s.session.key
    void api.ai
      .start({ task: 'denoise', key, model: ai.model, strength: ai.strength, legacy: true })
      .then(() => {
        const d = useDevelop.getState()
        if (d.session?.key !== key) return
        d.edit((r) => (r.detail.ai.enabled = false))
        d.commit('AI Denoise becomes a step')
      })
      .catch((err) => useLibrary.getState().say(errorText(err), 'error'))
  })
}
