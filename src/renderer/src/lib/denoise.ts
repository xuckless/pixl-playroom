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
import { tk } from './i18n'
import { staleRawStep, type PixelStep } from '../../../shared/pixels'
import { developMark } from '../../../shared/rawcolour'
import { aiDenoiseModel, RETIRED_DENOISE } from '../../../shared/recipe'

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
        d.commit(tk('AI Denoise becomes a step'))
      })
      .catch((err) => useLibrary.getState().say(errorText(err), 'error'))
  })
}

/**
 * Denoise models quick enough to make a step again without asking. A step
 * SCUNet made (retired with engine 0.19) is made again on NAFNet SIDD, which
 * takes seconds where SCUNet took minutes.
 */
const QUICK_REDO: ReadonlySet<string> = new Set([
  'drunet-color',
  'nafnet-sidd-w32',
  RETIRED_DENOISE
])

/** Whether a stale step is made again on its own when its photo opens. */
export function redoesQuietly(step: PixelStep): boolean {
  return step.kind === 'denoise' && QUICK_REDO.has(String(step.params.model))
}

/** Make a denoise step again on today's RAW develop, in its place, at its mask and strength. */
export async function redoDenoise(key: string, step: PixelStep): Promise<void> {
  await api.ai.start({
    task: 'denoise',
    key,
    model: aiDenoiseModel(step.params.model),
    strength: step.opacity,
    redo: step.id
  })
}

/**
 * A RAW's denoise steps made from an older develop (`staleRawStep`) are made
 * again as the photo opens, when their model is quick; the others say so in
 * their row, with a button. Each step is tried once a run. Returns the unsubscribe.
 */
export function startStaleUpkeep(): () => void {
  const tried = new Set<string>()
  return useDevelop.subscribe((s, prev) => {
    if (!s.session || !s.recipe || s.session === prev.session || !s.session.isRaw) return
    const key = s.session.key
    const mark = developMark(s.session.rawColour ?? 'container')
    const stale = s.recipe.pixels.filter(
      (p) => staleRawStep(p, true, mark) && redoesQuietly(p) && !tried.has(`${key}/${p.id}`)
    )
    void (async () => {
      if (stale.length === 0) return
      // Made again quietly only with its model here and AI on: otherwise the
      // step stays as it is (its row offers the remake), and nothing blocks
      // or asks for a download as the photo opens (the owner, 2026-10-09).
      const [models, caps] = await Promise.all([
        api.models.list().catch(() => []),
        api.ai.capabilities().catch(() => null)
      ])
      if (caps && !caps.denoise) return
      const here = new Set(models.filter((m) => m.installed).map((m) => m.id))
      for (const p of stale) {
        tried.add(`${key}/${p.id}`)
        if (!here.has(aiDenoiseModel(p.params.model))) continue
        // One after the other: each is made on the steps before it.
        await redoDenoise(key, p).catch((err) => useLibrary.getState().say(errorText(err), 'error'))
      }
    })()
  })
}
