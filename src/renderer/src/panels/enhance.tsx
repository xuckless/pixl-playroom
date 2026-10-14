/**
 * Enhance (the wheel's last tool): JPEG restore, deblur and super-resolution
 * over the photo's pixels as they are, kept in its project as a pixel step
 * (undone, redone and hidden in History like any edit; no file is written
 * beside the photo). With a mask selected, deblur and restore keep to it;
 * an upscale is always the whole photo. The steps run in the engine's
 * order; what they need, the size and the time are `shared/enhance.ts`'s
 * arithmetic. The settings are the panel's own (kept for the next photo).
 */
import { useEffect, useRef, useState } from 'react'
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
  type JpegRestore,
  type UpscaleChoice,
  type UpscaleSource,
  withPixl
} from '../../../shared/enhance'
import {
  LEVEL_HINT,
  LEVEL_LABEL,
  PIXL_ENHANCE,
  PIXL_LEVELS,
  type PixlLevel
} from '../../../shared/pixlenhance'
import { ModelGet } from '../components/ModelGet'
import { staleRawStep } from '../../../shared/pixels'
import { developMark } from '../../../shared/rawcolour'
import { allInstalled, useModels } from '../lib/models'
import { Section, Select, Slider, Toggle, ToolPanel } from '../components/ui'
import { TIPS } from './tips'
import { HdrAiNote } from './HdrAiNote'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useAiJobs } from '../state/jobs'
import { useLibrary, useTargets } from '../state/library'
import { useScope } from '../state/scope'
import { useUi } from '../state/ui'
import { t, tk, tp } from '../lib/i18n'
import { displayToBase, viewGeometry } from '../../../shared/view'
import { loupeZoom } from '../views/loupe/zoom'

const JPEG_OPTIONS: { value: JpegRestore; label: string }[] = [
  { value: 'off', label: tk('Off') },
  { value: 'reconstruct', label: tk('Rebuild (no model)') },
  { value: 'fbcnn', label: tk('AI · judges the damage') }
]

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

/** PIXL Enhance's level: off, or one of its three (each does what the one before does, and more). */
const PIXL_OPTIONS: { value: PixlLevel | 'off'; label: string }[] = [
  { value: 'off', label: tk('Off') },
  ...PIXL_LEVELS.map((l) => ({ value: l, label: LEVEL_LABEL[l] }))
]

/** Why JPEG restore is skipped, by the photo's format. */
const SKIPPED: Record<string, string> = {
  Raw: tk('Skipped: this photo is a RAW.'),
  Heif: tk('Skipped: this photo is a HEIC.'),
  Png: tk('Skipped: this photo is a PNG.'),
  Tiff: tk('Skipped: this photo is a TIFF.'),
  Avif: tk('Skipped: this photo is an AVIF.'),
  Webp: tk('Skipped: this photo is a WebP.'),
  Jxl: tk('Skipped: this photo is a JPEG XL.')
}

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

/**
 * Enhance is held until Playroom's own model, PIXL Enhance, is in the roster
 * (a development kit's is): until then the panel shows, greyed, and runs
 * nothing. With it, the panel is PIXL Enhance and the upscaler; JPEG restore
 * and Deblur are its job (`withPixl`).
 */
/** The jobs started from this panel, newest batch last (kept across the panel's remounts). */
let batch: string[] = []

/**
 * PIXL Enhance's preview: the model on a square at the centre of the view,
 * at full size, which the loupe then shows at 100% (graded and framed as
 * Apply's step will be). Let go when its settings, the photo or the panel
 * change, and when Apply starts.
 */
function PixlPreview({
  settings,
  ready,
  running
}: {
  settings: EnhanceSettings
  ready: boolean
  /** Apply under way: the whole photo is being made, the preview went (main let it go). */
  running: boolean
}): React.JSX.Element {
  const key = useDevelop((d) => d.session?.key ?? null)
  const say = useLibrary((l) => l.say)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<{ key: string; sig: string; shown: boolean } | null>(null)
  const sig = JSON.stringify([settings.pixl, settings.pixlStrength])
  // The preview stands for these settings on this photo, and until Apply starts.
  const live = made && made.key === key && made.sig === sig && !running ? made : null
  // What the unmount lets go of.
  const held = useRef(live)
  useEffect(() => {
    held.current = live
    // One for other settings, another photo or before Apply: main lets it go.
    if (made && !live) void api.enhance.previewClear(made.key).catch(() => undefined)
  }, [made, live])
  useEffect(
    () => () => {
      const m = held.current
      if (m) void api.enhance.previewClear(m.key).catch(() => undefined)
    },
    []
  )
  const preview = async (): Promise<void> => {
    const d = useDevelop.getState()
    if (!d.session || !d.recipe) return
    // The view's centre, in the photo's own frame (before its crop, straighten and turns).
    const g = viewGeometry(d.recipe, d.session.frameWidth, d.session.frameHeight, false)
    const at = displayToBase(g, { x: d.zoom.cx, y: d.zoom.cy })
    const asked = { key: d.session.key, sig }
    setBusy(true)
    try {
      await api.enhance.preview(asked.key, settings, at)
      setMade({ ...asked, shown: true })
      loupeZoom.actual()
    } catch (err) {
      say(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }
  const show = (on: boolean): void => {
    if (!live) return
    setMade({ ...live, shown: on })
    void api.enhance.previewShow(live.key, on).catch(() => undefined)
  }
  return (
    <div className="enhance-preview">
      <button className="sm" disabled={!ready || busy || running} onClick={() => void preview()}>
        {busy ? t('Previewing…') : t('Preview at 100%')}
      </button>
      {live && (
        <Toggle on={live.shown} onChange={show}>
          {t('Show the preview')}
        </Toggle>
      )}
      <p className="muted small">
        {t(
          'PIXL Enhance on a 1024 px square at the centre of the view, shown at 100%. Apply enhances the whole photo.'
        )}
      </p>
    </div>
  )
}

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
  // Without the model, a level saved on a development kit's run is not planned.
  const s = pixl ? withPixl(saved) : { ...saved, pixl: 'off' as const }
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
  const subsampled = info.jpeg?.subsampling === 'Half' || info.jpeg?.subsampling === 'Quarter'
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
            'Enhance is coming back in a future update, with models we’re training ourselves. Photos you’ve already enhanced keep their result.'
          )}
        </p>
      )}
      <HdrAiNote offer={false} />
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
        {pixl && (
          <Section id="enhance.pixl" title={t('PIXL Enhance')} tip={TIPS['enhance.pixl']}>
            <Select
              label={t('Enhance level')}
              value={s.pixl}
              options={shown(PIXL_OPTIONS)}
              onChange={(level) => set({ pixl: level })}
            />
            {s.pixl !== 'off' && (
              <>
                <p className="muted small">{t(LEVEL_HINT[s.pixl])}</p>
                <Slider
                  label={t('Strength')}
                  value={s.pixlStrength}
                  min={1}
                  max={100}
                  def={100}
                  onChange={(pixlStrength) => set({ pixlStrength })}
                  onCommit={() => undefined}
                />
                <ModelGet id={PIXL_ENHANCE} models={models} />
                <PixlPreview
                  settings={s}
                  ready={!session.isHdr && allInstalled(models, [PIXL_ENHANCE])}
                  running={running}
                />
              </>
            )}
          </Section>
        )}

        {!pixl && (
          <Section id="enhance.jpeg" title={t('JPEG restore')} tip={TIPS['enhance.jpeg']}>
            <Select
              label={t('Method')}
              value={s.jpeg}
              options={shown(JPEG_OPTIONS)}
              onChange={(jpeg) => set({ jpeg })}
            />
            {!isJpeg && s.jpeg !== 'off' && (
              <p className="muted small">
                {t(SKIPPED[info.input] ?? 'Skipped: this photo is not a JPEG.')}
              </p>
            )}
            {s.jpeg === 'reconstruct' && (
              <>
                <Slider
                  label={t('Smoothing')}
                  value={s.smoothing}
                  min={0}
                  max={100}
                  def={50}
                  onChange={(smoothing) => set({ smoothing })}
                  onCommit={() => undefined}
                  title={t(
                    "How far the blocks and banding are smoothed: only ever into what the file's own coefficients allow"
                  )}
                />
                {subsampled && (
                  <Toggle on={s.guidedChroma} onChange={(guidedChroma) => set({ guidedChroma })}>
                    {t('Colour follows edges')}
                  </Toggle>
                )}
              </>
            )}
            {s.jpeg === 'fbcnn' && (
              <>
                <Slider
                  label={t('Strength')}
                  value={s.jpegStrength}
                  min={1}
                  max={100}
                  def={100}
                  onChange={(jpegStrength) => set({ jpegStrength })}
                  onCommit={() => undefined}
                />
                <ModelGet id="fbcnn-color-blind" models={models} />
              </>
            )}
          </Section>
        )}

        {!pixl && (
          <Section id="enhance.deblur" title={t('Deblur')} tip={TIPS['enhance.deblur']}>
            <Toggle on={s.deblur} onChange={(deblur) => set({ deblur })}>
              {t('Remove motion blur')}
            </Toggle>
            {s.deblur && (
              <>
                <Slider
                  label={t('Strength')}
                  value={s.deblurStrength}
                  min={1}
                  max={100}
                  def={100}
                  onChange={(deblurStrength) => set({ deblurStrength })}
                  onCommit={() => undefined}
                />
                <ModelGet id="nafnet-gopro-w32" models={models} />
              </>
            )}
          </Section>
        )}

        <Section id="enhance.upscale" title={t('Super resolution')} tip={TIPS['enhance.upscale']}>
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
        </Section>

        <Section id="enhance.run" title={t('Apply')} tip={TIPS['enhance.apply']}>
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
                ? tp('Enhance {{count}} photo', 'Enhance {{count}} photos', targets.length)
                : layer && k === 1
                  ? t('Enhance inside {{layer}}', { layer: layer.name })
                  : t('Enhance')}
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
