/**
 * Detail → Noise reduction → AI: denoise steps. Pick a model and how strong,
 * then apply: a step is made (a model runs once, a few seconds a megapixel)
 * and kept in the photo's project; from then on it undoes, redoes and hides
 * in History, and its Strength changes, without the model running again.
 * With a mask selected the step is made inside it (the mask frozen as it is).
 */
import { useEffect, useState } from 'react'
import type { AiDenoiseModel } from '../../../shared/recipe'
import type { PixelStep } from '../../../shared/pixels'
import { ModelGet } from '../components/ModelGet'
import { useModels } from '../lib/models'
import { Icon } from '../components/icons'
import { InfoTip } from '../components/InfoTip'
import { TIPS } from './tips'
import { Select, Slider } from '../components/ui'
import { api, errorText } from '../lib/api'
import { applyDenoise } from '../lib/denoise'
import { useDevelop } from '../state/develop'
import { useAiJobs } from '../state/jobs'
import { useLibrary } from '../state/library'
import { askConfirm } from '../state/confirm'
import { useScope } from '../state/scope'
import { useUi } from '../state/ui'

const MODELS: { value: AiDenoiseModel; label: string; hint: string }[] = [
  {
    value: 'drunet-color',
    label: 'DRUNet · measured',
    hint: 'Told the noise it measures on the photo; gentler, keeps fine texture.'
  },
  {
    value: 'scunet-color-real',
    label: 'SCUNet · real noise',
    hint: 'Trained on real camera noise; judges it by itself. Best on high-ISO shots.'
  }
]

const LOSSLESS_KEY = 'pixels.lossless'

/** One step's row: its Strength (changed on release: the step's pixels are laid again, no model) and remove. */
function StepRow({ step }: { step: PixelStep }): React.JSX.Element {
  // While a drag is on: what the slider shows until it is let go.
  const [dragging, setDragging] = useState<number | null>(null)
  const opacity = dragging ?? step.opacity
  const change = (fn: (s: PixelStep) => void, label: string): void => {
    const d = useDevelop.getState()
    d.edit((r) => {
      const s = r.pixels.find((x) => x.id === step.id)
      if (s) fn(s)
    })
    d.commit(label)
  }
  return (
    <div className="pixel-step">
      <div className="pixel-step-head">
        <span className="pixel-step-label" title={step.label}>
          {step.label}
        </span>
        <button
          className="icon sm ghost"
          title="Remove this step (undo brings it back)"
          aria-label={`Remove ${step.label}`}
          onClick={() => {
            const d = useDevelop.getState()
            d.edit((r) => (r.pixels = r.pixels.filter((x) => x.id !== step.id)))
            d.commit(`Remove ${step.label}`)
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
      <Slider
        label="Strength"
        value={opacity}
        min={0}
        max={100}
        def={100}
        format={(v) => `${Math.round(v)}%`}
        onChange={(v) => setDragging(v)}
        onCommit={() => {
          const v = Math.round(opacity)
          setDragging(null)
          change((s) => (s.opacity = v), `${step.label}: strength`)
        }}
      />
    </div>
  )
}

export function AiDenoise(): React.JSX.Element | null {
  const key = useDevelop((s) => s.session?.key ?? null)
  const isHdr = useDevelop((s) => s.session?.isHdr === true)
  const isRaw = useDevelop((s) => s.session?.isRaw === true)
  const pixels = useDevelop((s) => s.recipe?.pixels)
  const frame = useDevelop((s) =>
    s.session ? (s.session.frameWidth * s.session.frameHeight) / 1e6 : 0
  )
  const { layer } = useScope()
  const prefs = useUi((s) => s.denoise)
  const setPrefs = useUi((s) => s.setDenoise)
  const say = useLibrary((s) => s.say)
  const job = useAiJobs((s) =>
    Object.values(s.jobs).findLast((j) => j.key === key && j.task === 'denoise')
  )
  const models = useModels()
  const [lossless, setLossless] = useState(false)
  useEffect(() => {
    void api.app.getSetting<boolean>(LOSSLESS_KEY).then((v) => setLossless(v === true))
  }, [])

  if (!key) return null
  const steps = (pixels ?? []).filter((p) => p.kind === 'denoise')
  const model = models.find((m) => m.id === prefs.model)
  const running = job?.phase === 'running' || job?.phase === 'queued'
  const pct = job?.progress == null ? null : Math.round(job.progress * 100)

  let status: string | null = null
  if (isHdr) status = 'HDR photos cannot take AI pixel steps yet'
  else if (running)
    status =
      job.phase === 'queued'
        ? 'Waiting for another AI job…'
        : `${job.stage === 'full' ? 'Full resolution' : job.stage === 'save' ? 'Keeping it' : job.stage === 'preview' ? 'Preview' : 'Starting'}${pct !== null ? ` · ${job.estimated ? '~' : ''}${pct}%` : ''}`
  else if (model && !model.installed) status = 'The model is not downloaded yet'
  else if (job?.phase === 'error') status = job.message ?? 'Failed'

  const setStorage = async (on: boolean): Promise<void> => {
    if (on) {
      const mb = (x: number): string => `${Math.max(1, Math.round(x))} MB`
      const yes = await askConfirm({
        title: 'Store AI results losslessly?',
        body: `Each denoise step of a photo this size would take about ${mb(frame * 2.3)} in its project, instead of about ${mb(frame * 0.4)} near-losslessly.\n\nLossless keeps the most room for editing afterwards: pushing exposure or shadows far shows nothing of compression. Steps already made keep how they were stored. RAW photos are always stored losslessly.`,
        confirm: 'Store losslessly'
      })
      if (!yes) return
    }
    setLossless(on)
    void api.app.setSetting(LOSSLESS_KEY, on).catch((e) => say(errorText(e), 'error'))
  }

  return (
    <div className="ai-denoise">
      <Select
        label="Model"
        value={prefs.model}
        options={MODELS.map((m) => ({ value: m.value, label: m.label }))}
        onChange={(v) => setPrefs({ model: v })}
        title={MODELS.find((m) => m.value === prefs.model)?.hint}
      />
      <Slider
        label="Strength"
        value={prefs.strength}
        min={1}
        max={100}
        def={100}
        format={(v) => `${Math.round(v)}%`}
        tip={isRaw ? TIPS['detail.ai.raw'] : TIPS['detail.ai']}
        onChange={(v) => setPrefs({ strength: v })}
        onCommit={() => undefined}
      />
      <div className="ai-denoise-status">
        {status && (
          <span className={job?.phase === 'error' && !running ? 'error' : undefined}>{status}</span>
        )}
        {!isHdr &&
          (running ? (
            <button className="sm ghost" onClick={() => void api.ai.cancel(job.jobId)}>
              Cancel
            </button>
          ) : model && !model.installed ? null : (
            <button
              className="sm primary"
              onClick={() => void applyDenoise().catch((e) => say(errorText(e), 'error'))}
            >
              {layer ? `Denoise inside ${layer.name}` : 'Denoise the photo'}
            </button>
          ))}
      </div>
      {!isHdr && <ModelGet id={prefs.model} models={models} />}
      {steps.length > 0 && (
        <div className="pixel-steps">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      )}
      {/* A RAW's results are always lossless: nothing to choose. */}
      {!isRaw && (
        <div className="row ai-lossless">
          <label className="check">
            <input
              type="checkbox"
              checked={lossless}
              onChange={(e) => void setStorage(e.target.checked)}
            />
            Store results losslessly
          </label>
          <InfoTip tip={TIPS['detail.ai.lossless']} label="Store results losslessly" />
        </div>
      )}
    </div>
  )
}
