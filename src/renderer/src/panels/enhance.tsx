/**
 * Super resolution (the dropdown's last panel, once Enhance): the photo made
 * ×2 or ×4 larger by a model, over its pixels as they are, kept in its
 * project as a pixel step (undone, redone and hidden in History like any
 * edit; no file is written beside the photo). PIXL Enhance's clean up,
 * noise reduction and sharpening are Detail's AI boxes (DetailAi.tsx). What
 * a run needs, the size and the time are `shared/enhance.ts`'s arithmetic.
 */
import { useEffect, useState } from 'react'
import type { AiJobEvent } from '../../../shared/ai'
import {
  ENHANCE_MODEL,
  enhanceRefusal,
  estimateMs,
  jpegRestoreRefusal,
  LARGE_OUTPUT_MP,
  neededModels,
  planSteps,
  scaleOf,
  type EnhanceRates,
  type EnhanceSettings,
  type UpscaleChoice,
  type UpscaleSource,
  withPixl
} from '../../../shared/enhance'
import { PIXL_ENHANCE } from '../../../shared/pixlenhance'
import { ModelGet } from '../components/ModelGet'
import { staleRawStep } from '../../../shared/pixels'
import { developMark } from '../../../shared/rawcolour'
import { allInstalled, useModels } from '../lib/models'
import { Section, Select, ToolPanel } from '../components/ui'
import { TIPS } from './tips'
import { HdrAiNote } from './HdrAiNote'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useAiJobs } from '../state/jobs'
import { useLibrary, useTargets } from '../state/library'
import { useScope } from '../state/scope'
import { useUi } from '../state/ui'
import { t, tk, tp } from '../lib/i18n'

const UPSCALE_OPTIONS: { value: UpscaleChoice; label: string }[] = [
  { value: 'off', label: tk('Off') },
  { value: 'x2', label: '×2' },
  { value: 'x4', label: '×4' }
]

/** What the photo is like: picks the model (engine 0.18: SPAN for clean, x4v3 for damaged). */
const SOURCE_OPTIONS: { value: UpscaleSource; label: string }[] = [
  { value: 'clean', label: tk('Clean · closest to the original') },
  { value: 'damaged', label: tk('Damaged · repairs compression and noise') },
  { value: 'texture', label: tk('Keep texture · leaves the grain') }
]

/** An options list with its labels in the language in force. */
const shown = <T extends string>(o: { value: T; label: string }[]): { value: T; label: string }[] =>
  o.map((x) => ({ ...x, label: t(x.label) }))

const duration = (ms: number): string =>
  ms < 60_000
    ? `${Math.max(1, Math.round(ms / 1000))} s`
    : ms < 3_600_000
      ? `${Math.round(ms / 60_000)} min`
      : `${(ms / 3_600_000).toFixed(1)} h`

const bytes = (b: number): string =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`

/** The jobs started from this panel, newest batch last (kept across the panel's remounts). */
let batch: string[] = []

/** The batch just started, kept for the panel's next mount. */
function keepBatch(ids: string[]): void {
  batch = ids
}

export function EnhancePanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const stepsBefore = useDevelop((s) => s.recipe?.pixels.length ?? 0)
  // Enhance steps made from an older RAW develop (`staleRawStep`).
  const stale = useDevelop((d) => {
    if (!d.session?.isRaw || !d.recipe) return 0
    const mark = d.session.developMark ?? developMark(d.session.rawColour ?? 'container')
    return d.recipe.pixels.filter((p) => p.kind === 'enhance' && staleRawStep(p, true, mark)).length
  })
  const { layer } = useScope()
  const saved = useUi((u) => u.enhance)
  const set = useUi((u) => u.setEnhance)
  const targets = useTargets()
  const models = useModels()
  const pixl = models.some((m) => m.id === PIXL_ENHANCE)
  const held = !pixl
  // The upscale alone: clean up, noise and sharpening are Detail's.
  const s: EnhanceSettings = withPixl({ ...saved, pixl: 'off' })
  const say = useLibrary((l) => l.say)
  const capable = useAiJobs((j) => j.capabilities)
  const jobs = useAiJobs((j) => j.jobs)
  const ended = useAiJobs((j) => j.ended)
  const [rates, setRates] = useState<EnhanceRates>({})
  const [ids, setIds] = useState<string[]>(batch)
  const running = ids.some((id) => {
    const p = jobs[id]?.phase
    return p === 'running' || p === 'queued'
  })
  useEffect(() => {
    void api.enhance.rates().then(setRates, () => undefined)
  }, [running])
  if (!session) return null

  const info = session.info
  const isJpeg = info.input === 'Jpeg'
  const steps = planSteps(s, isJpeg)
  const need = neededModels(s, isJpeg)
  const refusal =
    capable && !capable.enhance
      ? (capable.why.enhance ?? t('Enhance is not available'))
      : s.upscale === 'off'
        ? t('Choose ×2 or ×4.')
        : (enhanceRefusal(s, { isJpeg, isHdr: session.isHdr }) ??
          jpegRestoreRefusal(s, isJpeg, stepsBefore))
  const ready = !refusal && allInstalled(models, need)
  // The frame as it will be written: upright, before the user's turns.
  const k = scaleOf(s)
  const outW = session.frameWidth * k
  const outH = session.frameHeight * k
  const outMp = (outW * outH) / 1e6
  const eta = estimateMs(steps, session.frameWidth, session.frameHeight, rates)
  const many = targets.length > 1 && targets.includes(session.key)
  const list = ids.map((id) => jobs[id] ?? ended[id]).filter((j): j is AiJobEvent => !!j)

  const run = async (): Promise<void> => {
    const keys = many ? targets : [session.key]
    // The whole photo now: a preview of a square goes.
    void api.enhance.previewClear(session.key).catch(() => undefined)
    try {
      const started = await Promise.all(
        keys.map((key) =>
          api.ai.start({
            task: 'enhance',
            key,
            settings: s,
            // The selected mask belongs to this photo only.
            layerId: key === session.key ? (layer?.id ?? null) : null
          })
        )
      )
      keepBatch(started)
      setIds(started)
    } catch (err) {
      say(errorText(err), 'error')
    }
  }

  return (
    <ToolPanel>
      {/* Held until Playroom's own model (the owner, 0.4.x): greyed, not
          gone, and the steps already made keep rendering. */}
      {held && (
        <p className="note small enhance-held">
          {t(
            'Super resolution is coming back in a future update, with models we’re training ourselves. Photos you’ve already enhanced keep their result.'
          )}
        </p>
      )}
      {/* A gain-map photo can be edited as SDR and upscaled there (0.20.0 guide §4). */}
      <HdrAiNote offer={!held} />
      <div className={held ? 'enhance-held-body' : undefined} inert={held} aria-disabled={held}>
        {stale > 0 && (
          <p className="pixel-step-stale">
            {tp(
              'One Enhance step was made from the previous RAW develop. Undo it in History and run Enhance again to match this one.',
              '{{count}} Enhance steps were made from the previous RAW develop. Undo it in History and run Enhance again to match this one.',
              stale
            )}
          </p>
        )}
        <Section id="enhance.run" title={t('Scale')} tip={TIPS['enhance.upscale']}>
          <Select
            label={t('Scale')}
            value={s.upscale}
            options={shown(UPSCALE_OPTIONS)}
            onChange={(upscale) => set({ upscale })}
          />
          {s.upscale !== 'off' && (
            <>
              <Select
                label={t('Source')}
                value={s.upscaleSource}
                options={shown(SOURCE_OPTIONS)}
                onChange={(upscaleSource) => set({ upscaleSource })}
              />
              <ModelGet id={ENHANCE_MODEL[s.upscaleSource]} models={models} />
            </>
          )}
          <div className="enhance-sum">
            <span>
              {session.frameWidth} × {session.frameHeight}
              {k > 1 && (
                <>
                  {' → '}
                  <b>
                    {outW} × {outH}
                  </b>
                </>
              )}
            </span>
            <span className="muted">
              {t('{{mp}} MP · ~{{size}} in the project', {
                mp: outMp.toFixed(0),
                size: bytes(outW * outH * (session.isRaw ? 2.3 : 0.4))
              })}
            </span>
            {steps.length > 0 && (
              <span className="muted" title={t('From how fast earlier runs went here')}>
                {steps.map((p) => p.label).join(' → ')} · ~{duration(eta)}
              </span>
            )}
          </div>
          {outMp > LARGE_OUTPUT_MP && (
            <p className="note small">
              {t('A {{mp}} MP file is large to edit; consider ×2.', { mp: outMp.toFixed(0) })}
            </p>
          )}
          {refusal && <p className="muted small">{refusal}</p>}
          <div className="enhance-run">
            <button className="primary" disabled={!ready || held} onClick={() => void run()}>
              {many
                ? tp('Upscale {{count}} photo', 'Upscale {{count}} photos', targets.length)
                : t('Upscale')}
            </button>
            {running && (
              <button
                className="ghost"
                onClick={() => ids.forEach((id) => void api.ai.cancel(id))}
                title={t('Stop this batch')}
              >
                {t('Cancel')}
              </button>
            )}
          </div>
          {list.length > 0 && (
            <ul className="enhance-jobs">
              {list.map((j) => (
                <li key={j.jobId} className={j.phase}>
                  <span className="name">{j.name}</span>
                  <span className="muted">
                    {j.phase === 'running'
                      ? j.progress !== null
                        ? `${j.estimated ? '~' : ''}${Math.round(j.progress * 100)}%`
                        : t('Working…')
                      : j.phase === 'queued'
                        ? t('Waiting')
                        : j.phase === 'done'
                          ? t('Added')
                          : j.phase === 'cancelled'
                            ? t('Cancelled')
                            : (j.message ?? t('Failed'))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {layer && k > 1 && (
            <p className="muted small">{t('An upscale is always the whole photo.')}</p>
          )}
        </Section>
      </div>
    </ToolPanel>
  )
}
