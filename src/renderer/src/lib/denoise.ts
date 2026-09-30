/**
 * AI denoise's upkeep in the renderer: while the photo in Develop has it on,
 * what it asks for is made. Opening such a photo, switching to AI, picking
 * another model or letting go of Strength starts (or restarts) the photo's
 * denoise job when nothing is made for those settings; a job for settings
 * no longer wanted is cancelled. A model not downloaded yet is left to the
 * Detail panel, which offers it.
 */
import type { AiDenoiseSetting } from '../../../shared/recipe'
import { api } from './api'
import { useAiJobs } from '../state/jobs'
import { useDevelop } from '../state/develop'

/** Settle this long after the last change before asking (a Strength drag). */
const SETTLE_MS = 700

/** The job running for each photo, and the settings it was started for. */
const started = new Map<string, { jobId: string; params: string }>()

const paramsOf = (ai: AiDenoiseSetting): string => `${ai.model}:${Math.round(ai.strength)}`

const isLive = (jobId: string): boolean => {
  const j = useAiJobs.getState().jobs[jobId]
  return j !== undefined && (j.phase === 'queued' || j.phase === 'running')
}

/** Start (or restart) the open photo's denoise job when it needs one. */
export async function ensureDenoise(): Promise<void> {
  const { session, recipe } = useDevelop.getState()
  if (!session || !recipe) return
  const key = session.key
  const ai = recipe.detail.ai
  const mine = started.get(key)
  if (!ai.enabled || useAiJobs.getState().capabilities?.denoise === false) {
    if (mine && isLive(mine.jobId)) void api.ai.cancel(mine.jobId)
    return
  }
  const params = paramsOf(ai)
  if (mine && isLive(mine.jobId)) {
    if (mine.params === params) return
    await api.ai.cancel(mine.jobId)
  }
  const [state, models] = await Promise.all([api.develop.denoiseState(key), api.models.list()])
  if (state.refused || state.made === 'full') return
  if (!models.find((m) => m.id === ai.model)?.installed) return
  // Still the photo and the settings asked about?
  const now = useDevelop.getState()
  if (now.session?.key !== key || !now.recipe || paramsOf(now.recipe.detail.ai) !== params) return
  const again = started.get(key)
  if (again && again !== mine && isLive(again.jobId)) return
  const jobId = await api.ai.start({ task: 'denoise', key })
  started.set(key, { jobId, params })
}

let timer: ReturnType<typeof setTimeout> | undefined
function soon(): void {
  clearTimeout(timer)
  timer = setTimeout(() => void ensureDenoise().catch(() => undefined), SETTLE_MS)
}

/** Keep AI denoise made while the app runs; returns the unsubscribe. */
export function startDenoiseUpkeep(): () => void {
  const offDevelop = useDevelop.subscribe((s, prev) => {
    if (!s.session || !s.recipe) return
    const opened = s.session !== prev.session
    const changed =
      !prev.recipe || JSON.stringify(s.recipe.detail.ai) !== JSON.stringify(prev.recipe.detail.ai)
    if (opened || changed) soon()
  })
  // A model just downloaded may be the one waited for.
  const offModels = api.models.onEvent(() => soon())
  // A job that ended while the settings moved on: make what is asked now.
  const offJobs = api.ai.onEvent((e) => {
    if (e.task === 'denoise' && (e.phase === 'done' || e.phase === 'error')) {
      if (started.get(e.key)?.jobId === e.jobId) started.delete(e.key)
      if (e.phase === 'done') soon()
    }
  })
  return () => {
    clearTimeout(timer)
    offDevelop()
    offModels()
    offJobs()
  }
}
