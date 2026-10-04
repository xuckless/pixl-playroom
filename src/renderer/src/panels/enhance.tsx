/**
 * Enhance (the wheel's last tool): JPEG restore, deblur and super-resolution
 * over the photo's pixels as they are, kept in its project as a pixel step
 * (undone, redone and hidden in History like any edit; no file is written
 * beside the photo). With a mask selected, deblur and restore keep to it;
 * an upscale is always the whole photo. The steps run in the engine's
 * order; what they need, the size and the time are `shared/enhance.ts`'s
 * arithmetic. The settings are the panel's own (kept for the next photo).
 */
import { useEffect, useState } from 'react'
import type { AiJobEvent } from '../../../shared/ai'
import {
  enhanceRefusal,
  estimateMs,
  jpegRestoreRefusal,
  LARGE_OUTPUT_MP,
  neededModels,
  planSteps,
  scaleOf,
  type EnhanceRates,
  type JpegRestore,
  type UpscaleChoice
} from '../../../shared/enhance'
import { ModelGet } from '../components/ModelGet'
import { allInstalled, useModels } from '../lib/models'
import { Section, Select, Slider, Toggle, ToolPanel } from '../components/ui'
import { TIPS } from './tips'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useAiJobs } from '../state/jobs'
import { useLibrary, useTargets } from '../state/library'
import { useScope } from '../state/scope'
import { useUi } from '../state/ui'

const JPEG_OPTIONS: { value: JpegRestore; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'reconstruct', label: 'Rebuild (no model)' },
  { value: 'fbcnn', label: 'AI · judges the damage' }
]

const UPSCALE_OPTIONS: { value: UpscaleChoice; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'x2', label: '×2 · photographic' },
  { value: 'x4', label: '×4 · general' },
  { value: 'x4-wdn', label: '×4 · keep texture' }
]

const FORMAT_NAME: Record<string, string> = {
  Raw: 'a RAW',
  Heif: 'a HEIC',
  Png: 'a PNG',
  Tiff: 'a TIFF',
  Avif: 'an AVIF',
  Webp: 'a WebP',
  Jxl: 'a JPEG XL'
}

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

export function EnhancePanel(): React.JSX.Element | null {
  const session = useDevelop((s) => s.session)
  const stepsBefore = useDevelop((s) => s.recipe?.pixels.length ?? 0)
  const { layer } = useScope()
  const s = useUi((u) => u.enhance)
  const set = useUi((u) => u.setEnhance)
  const targets = useTargets()
  const models = useModels()
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
      ? (capable.why.enhance ?? 'Enhance is not available')
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
      batch = started
      setIds(started)
    } catch (err) {
      say(errorText(err), 'error')
    }
  }

  return (
    <ToolPanel>
      <Section id="enhance.jpeg" title="JPEG restore" tip={TIPS['enhance.jpeg']}>
        <Select
          label="Method"
          value={s.jpeg}
          options={JPEG_OPTIONS}
          onChange={(jpeg) => set({ jpeg })}
        />
        {!isJpeg && s.jpeg !== 'off' && (
          <p className="muted small">
            Skipped: this photo is {FORMAT_NAME[info.input] ?? 'not a JPEG'}.
          </p>
        )}
        {s.jpeg === 'reconstruct' && (
          <>
            <Slider
              label="Smoothing"
              value={s.smoothing}
              min={0}
              max={100}
              def={50}
              onChange={(smoothing) => set({ smoothing })}
              onCommit={() => undefined}
              title="How far the blocks and banding are smoothed: only ever into what the file's own coefficients allow"
            />
            {subsampled && (
              <Toggle on={s.guidedChroma} onChange={(guidedChroma) => set({ guidedChroma })}>
                Colour follows edges
              </Toggle>
            )}
          </>
        )}
        {s.jpeg === 'fbcnn' && (
          <>
            <Slider
              label="Strength"
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

      <Section id="enhance.deblur" title="Deblur" tip={TIPS['enhance.deblur']}>
        <Toggle on={s.deblur} onChange={(deblur) => set({ deblur })}>
          Remove motion blur
        </Toggle>
        {s.deblur && (
          <>
            <Slider
              label="Strength"
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

      <Section id="enhance.upscale" title="Super resolution" tip={TIPS['enhance.upscale']}>
        <Select
          label="Scale"
          value={s.upscale}
          options={UPSCALE_OPTIONS}
          onChange={(upscale) => set({ upscale })}
        />
        {s.upscale !== 'off' && (
          <ModelGet
            id={
              s.upscale === 'x2'
                ? 'real-esrgan-x2plus'
                : s.upscale === 'x4'
                  ? 'realesr-general-x4v3'
                  : 'realesr-general-wdn-x4v3'
            }
            models={models}
          />
        )}
      </Section>

      <Section id="enhance.run" title="Apply" tip={TIPS['enhance.apply']}>
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
            {outMp.toFixed(0)} MP · ~{bytes(outW * outH * (session.isRaw ? 2.3 : 0.4))} in the
            project
          </span>
          {steps.length > 0 && (
            <span className="muted" title="From how fast earlier runs went here">
              {steps.map((p) => p.label).join(' → ')} · ~{duration(eta)}
            </span>
          )}
        </div>
        {outMp > LARGE_OUTPUT_MP && (
          <p className="note small">A {outMp.toFixed(0)} MP file is large to edit; consider ×2.</p>
        )}
        {refusal && <p className="muted small">{refusal}</p>}
        <div className="enhance-run">
          <button className="primary" disabled={!ready} onClick={() => void run()}>
            {many
              ? `Enhance ${targets.length} photos`
              : layer && k === 1
                ? `Enhance inside ${layer.name}`
                : 'Enhance'}
          </button>
          {running && (
            <button
              className="ghost"
              onClick={() => ids.forEach((id) => void api.ai.cancel(id))}
              title="Stop this batch"
            >
              Cancel
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
                      : 'Working…'
                    : j.phase === 'queued'
                      ? 'Waiting'
                      : j.phase === 'done'
                        ? 'Added'
                        : j.phase === 'cancelled'
                          ? 'Cancelled'
                          : (j.message ?? 'Failed')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {layer && k > 1 && <p className="muted small">An upscale is always the whole photo.</p>}
      </Section>
    </ToolPanel>
  )
}
