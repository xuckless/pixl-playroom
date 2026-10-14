/**
 * Detail's AI checkboxes: Sharpening, Noise reduction and Clean up artefacts
 * each have one beside their sliders, and ticking it runs PIXL Enhance on
 * the whole photo, quietly, at its level: Clean up artefacts at Clean up,
 * Noise reduction at Clean up + denoise, Sharpening at Clean up + denoise +
 * sharpen. The levels nest, so the photo holds one step, at the highest
 * level ticked (a lower box shows ticked inside it); another level makes
 * that step again in its place, and unticking the last takes it away
 * (History undoes both). Without PIXL Enhance in the roster, Noise
 * reduction's runs AI Denoise instead and the other two wait for it.
 *
 * An HDR photo's AI steps are made on its SDR picture: ticking one says so
 * and, agreed, edits the photo as SDR first (a RAW keeps its light above
 * white under AI steps: nothing to ask).
 */
import { useState } from 'react'
import {
  DEFAULT_ENHANCE,
  levelOfStep,
  nextLevel,
  pixlStepOf,
  withPixl,
  type EnhanceSettings
} from '../../../shared/enhance'
import { LEVEL_NUMBER, PIXL_ENHANCE, type PixlLevel } from '../../../shared/pixlenhance'
import type { PixelStep } from '../../../shared/pixels'
import { InfoTip, type Tip } from '../components/InfoTip'
import { api, errorText } from '../lib/api'
import { applyDenoise } from '../lib/denoise'
import { ensureModelId } from '../lib/ensureModel'
import { t, tk } from '../lib/i18n'
import { useModels } from '../lib/models'
import { askConfirm } from '../state/confirm'
import { useDevelop } from '../state/develop'
import { useAiJobs } from '../state/jobs'
import { useLibrary } from '../state/library'
import { useUi } from '../state/ui'

/**
 * An HDR photo before an AI step: says AI works in SDR and, agreed, edits
 * it as SDR and waits for it to open so. False when not agreed or it cannot.
 */
async function intoSdr(): Promise<boolean> {
  const d = useDevelop.getState()
  const session = d.session
  if (!session?.isHdr) return true
  if (!session.info.gain_map) return false
  const yes = await askConfirm({
    title: t('Edit this photo in SDR?'),
    body: t(
      'AI tools work on the SDR picture this photo stores, so using one moves the photo out of HDR: its highlights stop at white, and Full HDR and Headroom have nothing above white to show.\n\nYour adjustments stay. To edit in HDR again, remove the AI steps (untick the box, or in History), then choose Photo → Edit as HDR.'
    ),
    confirm: t('Edit in SDR and use AI')
  })
  if (!yes) return false
  d.edit((r) => (r.gainMap = 'base'))
  d.commit(tk('Edit as SDR'))
  const key = session.key
  return new Promise((resolve) => {
    const done = (ok: boolean): void => {
      clearTimeout(timer)
      stop()
      resolve(ok)
    }
    // Reopened on the SDR picture (the session is gone for a moment between).
    const stop = useDevelop.subscribe((s) => {
      if (!s.session) return
      if (s.session.key !== key) done(false)
      else if (!s.session.isHdr) done(true)
    })
    const timer = setTimeout(() => done(false), 30_000)
  })
}

/** The open photo's whole-photo AI Denoise steps (the fallback's). */
const denoiseSteps = (pixels: readonly PixelStep[]): PixelStep[] =>
  pixels.filter((p) => p.kind === 'denoise' && !p.alpha && !p.off)

export function AiCheck({
  want,
  label = tk('AI'),
  tip
}: {
  /** The level ticking it asks for. */
  want: PixlLevel
  label?: string
  tip?: Tip
}): React.JSX.Element | null {
  const key = useDevelop((s) => s.session?.key ?? null)
  const isHdr = useDevelop((s) => s.session?.isHdr === true)
  const switchable = useDevelop((s) => !!s.session?.info.gain_map)
  const pixels = useDevelop((s) => s.recipe?.pixels)
  const models = useModels()
  const pixl = models.some((m) => m.id === PIXL_ENHANCE)
  const denoise = useUi((s) => s.denoise)
  const say = useLibrary((s) => s.say)
  const task = pixl ? 'enhance' : 'denoise'
  const job = useAiJobs((s) =>
    Object.values(s.jobs).findLast(
      (j) => j.key === key && j.task === task && (j.phase === 'running' || j.phase === 'queued')
    )
  )
  // The level asked for while its step is being made.
  // The level this box asked for, and the job making it.
  const [asked, setAsked] = useState<{ level: PixlLevel; job: string } | null>(null)
  const running = !!job
  if (!key || !pixels) return null

  const step = pixl ? pixlStepOf(pixels) : null
  const level = levelOfStep(step)
  const fallback = !pixl && want === 'denoise'
  const waiting = !pixl && !fallback
  const blocked = isHdr && !switchable
  // This box started the run: it says how it goes (the others only wait).
  const mine = running && asked?.job === job.jobId
  const shownLevel = mine ? asked.level : level
  const checked = fallback
    ? denoiseSteps(pixels).length > 0 || mine
    : shownLevel !== null && LEVEL_NUMBER[shownLevel] >= LEVEL_NUMBER[want]
  // Ticked inside a higher level: that one's box takes it away.
  const inside = !fallback && shownLevel !== null && LEVEL_NUMBER[shownLevel] > LEVEL_NUMBER[want]

  const change = async (on: boolean): Promise<void> => {
    const d = useDevelop.getState()
    if (fallback) {
      if (!on) {
        const gone = new Set(denoiseSteps(d.recipe?.pixels ?? []).map((p) => p.id))
        d.edit((r) => (r.pixels = r.pixels.filter((p) => !gone.has(p.id))))
        d.commit(tk('AI noise reduction off'))
        return
      }
      const model = models.find((m) => m.id === denoise.model)
      if (!(await ensureModelId(denoise.model, model?.installed === true, t('AI denoise')))) return
      if (!(await intoSdr())) return
      const id = await applyDenoise({ whole: true })
      if (id) setAsked({ level: want, job: id })
      return
    }
    const next = nextLevel(level, want, on)
    if (next === level) return
    if (next === null) {
      if (!step) return
      d.edit((r) => (r.pixels = r.pixels.filter((p) => p.id !== step.id)))
      d.commit(tk('AI enhance off'))
      return
    }
    const own = models.find((m) => m.id === PIXL_ENHANCE)
    if (!(await ensureModelId(PIXL_ENHANCE, own?.installed === true, t('PIXL Enhance')))) return
    if (!(await intoSdr())) return
    const settings: EnhanceSettings = withPixl({
      ...DEFAULT_ENHANCE,
      upscale: 'off',
      pixl: next,
      pixlStrength: 100
    })
    const now = useDevelop.getState().session?.key ?? key
    const id = await api.ai.start({
      task: 'enhance',
      key: now,
      settings,
      layerId: null,
      ...(step ? { redo: step.id } : {})
    })
    setAsked({ level: next, job: id })
  }

  const pct = job?.progress == null ? null : Math.round(job.progress * 100)
  return (
    <div className={`row ai-check${waiting || blocked ? ' waiting' : ''}`}>
      <label className="check">
        <input
          type="checkbox"
          checked={checked}
          disabled={waiting || blocked || running || inside}
          onChange={(e) =>
            void change(e.target.checked).catch((err) => {
              setAsked(null)
              say(errorText(err), 'error')
            })
          }
        />
        {t(label)}
      </label>
      <span className="ai-check-state muted small">
        {mine
          ? job.phase === 'queued'
            ? t('Waiting…')
            : `${t('Working…')}${pct !== null ? ` ${job.estimated ? '~' : ''}${pct}%` : ''}`
          : waiting
            ? t('Coming in an update')
            : blocked
              ? t('SDR photos only for now')
              : inside
                ? t('Included in a higher level')
                : null}
      </span>
      {mine && (
        <button className="sm ghost" onClick={() => void api.ai.cancel(job.jobId)}>
          {t('Cancel')}
        </button>
      )}
      {tip && <InfoTip tip={tip} label={t(label)} />}
    </div>
  )
}
