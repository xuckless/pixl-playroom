/**
 * Detail → Noise reduction → AI: which model, how strong, and where the
 * photo's denoise stands (made, being made, a model to download first). The
 * making itself is `lib/denoise.ts`'s: it starts when these settings ask for
 * something not made yet.
 */
import { useEffect, useState } from 'react'
import type { DenoiseState } from '../../../shared/ipc'
import type { AiDenoiseModel } from '../../../shared/recipe'
import { ModelGet } from '../components/ModelGet'
import { useModels } from '../lib/models'
import { Select, Slider } from '../components/ui'
import { api, errorText } from '../lib/api'
import { ensureDenoise } from '../lib/denoise'
import { useDevelop } from '../state/develop'
import { useAiJobs } from '../state/jobs'
import { useLibrary } from '../state/library'

const MODELS: { value: AiDenoiseModel; label: string; hint: string }[] = [
  {
    value: 'scunet-color-real',
    label: 'SCUNet · real noise',
    hint: 'Trained on real camera noise; judges it by itself. Best on high-ISO shots.'
  },
  {
    value: 'drunet-color',
    label: 'DRUNet · measured',
    hint: 'Told the noise it measures on the photo; gentler, keeps fine texture.'
  }
]

export function AiDenoise(): React.JSX.Element | null {
  const key = useDevelop((s) => s.session?.key ?? null)
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const say = useLibrary((s) => s.say)
  const job = useAiJobs((s) =>
    Object.values(s.jobs).findLast((j) => j.key === key && j.task === 'denoise')
  )
  const models = useModels()
  const [state, setState] = useState<DenoiseState | null>(null)
  const ai = recipe?.detail.ai
  const params = ai ? `${ai.model}:${Math.round(ai.strength)}` : ''

  // Where it stands: asked again when the settings or the job move on.
  useEffect(() => {
    if (!key) return
    let live = true
    void api.develop.denoiseState(key).then(
      (s) => live && setState(s),
      () => undefined
    )
    return () => {
      live = false
    }
  }, [key, params, job?.phase, job?.stage])

  if (!recipe || !ai || !key) return null
  const model = models.find((m) => m.id === ai.model)
  const running = job?.phase === 'running' || job?.phase === 'queued'
  const pct = job?.progress == null ? null : Math.round(job.progress * 100)
  const setModel = (v: AiDenoiseModel): void => {
    edit((r) => (r.detail.ai.model = v))
    commit('AI denoise model')
  }

  let status: string
  if (state?.refused) status = state.refused
  else if (running)
    status =
      job.phase === 'queued'
        ? 'Waiting for another AI job…'
        : `${job.stage === 'full' ? 'Full resolution' : 'Preview'}${pct !== null ? ` · ${job.estimated ? '~' : ''}${pct}%` : ''}`
  else if (model && !model.installed) status = 'The model is not downloaded yet'
  else if (state?.made === 'full') status = 'Applied at full resolution'
  else if (state?.made === 'preview') status = 'Preview only: full resolution not made'
  else if (job?.phase === 'error') status = job.message ?? 'Failed'
  else status = 'Not applied yet'

  return (
    <div className="ai-denoise">
      <Select
        label="Model"
        value={ai.model}
        options={MODELS.map((m) => ({ value: m.value, label: m.label }))}
        onChange={setModel}
        title={MODELS.find((m) => m.value === ai.model)?.hint}
      />
      <Slider
        label="Strength"
        value={ai.strength}
        min={1}
        max={100}
        def={100}
        onChange={(v, live) => edit((r) => (r.detail.ai.strength = v), live)}
        onCommit={() => commit('AI denoise strength')}
      />
      <div className="ai-denoise-status">
        <span className={job?.phase === 'error' && !running ? 'error' : undefined}>{status}</span>
        {!state?.refused &&
          (running ? (
            <button className="sm ghost" onClick={() => void api.ai.cancel(job.jobId)}>
              Cancel
            </button>
          ) : model && !model.installed ? null : state?.made !== 'full' ? (
            <button
              className="sm"
              onClick={() => void ensureDenoise().catch((e) => say(errorText(e), 'error'))}
            >
              {state?.made === 'preview' ? 'Finish' : 'Apply'}
            </button>
          ) : null)}
      </div>
      {!state?.refused && <ModelGet id={ai.model} models={models} />}
      <p className="muted small">
        Made once per photo, model and strength, and kept: every view and export after uses it.
      </p>
    </div>
  )
}
