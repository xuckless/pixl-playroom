/**
 * Export, as four steps (Format, Size & colour, Metadata & HDR, Review), each
 * made of the same folding cards as the editor's panels: a title, an (i), a
 * reset, sliders in the same glass. The guards (`shared/exportGuards.ts`, and
 * the disk's through `api.export.check`) are said where they arise and gather
 * on the last step; a block stops Export, a warning does not, and nothing is
 * changed for the person. Review can also render the first photo through the
 * real export request, at a reduced size, to see it as it will be written.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CEILING_MAX,
  CEILING_MIN,
  FORMAT_EXT,
  defaultExportSettings,
  depthsFor,
  normaliseExportSettings,
  supportsGainMap,
  supportsHdr,
  type ExportFormat,
  type ExportSettings,
  type ResizeMode
} from '../../../shared/export'
import {
  FORMAT_NAME,
  INTENT_INFO,
  blocked,
  exportGuards,
  type ExportSource,
  type ExportStep,
  type Guard
} from '../../../shared/exportGuards'
import type { ExportPreset, ExportPreview, ExportProgress } from '../../../shared/ipc'
import { BUY_URL } from '../../../shared/licence'
import { InfoTip, type Tip } from '../components/InfoTip'
import { Card, Modal, Slider, StepSlider } from '../components/ui'
import { Spinner } from '../fx'
import { api, errorText } from '../lib/api'
import { useLibrary, useTargets } from '../state/library'
import { WatermarkSection } from './WatermarkSection'
import { t, tk, tp } from '../lib/i18n'

const STEPS: { id: ExportStep; label: string }[] = [
  { id: 'format', label: tk('Format') },
  { id: 'size', label: tk('Size & colour') },
  { id: 'delivery', label: tk('Metadata & HDR') },
  { id: 'review', label: tk('Review') }
]

const FORMATS: { value: ExportFormat; label: string }[] = (
  ['jpeg', 'png', 'tiff', 'webp', 'avif', 'jxl'] as ExportFormat[]
).map((value) => ({ value, label: FORMAT_NAME[value] }))

const COLOUR_SPACES: { value: ExportSettings['colorSpace']; label: string }[] = [
  { value: 'Srgb', label: 'sRGB' },
  { value: 'DisplayP3', label: 'Display P3' },
  { value: 'AdobeRgb', label: 'Adobe RGB' },
  { value: 'Rec2020', label: 'Rec.2020' }
]

const JPEG_CHROMA: { value: ExportSettings['jpegSubsampling']; label: string }[] = [
  { value: 'Quarter', label: '4:2:0' },
  { value: 'Half', label: '4:2:2' },
  { value: 'None', label: '4:4:4' }
]
const AVIF_CHROMA: { value: ExportSettings['chroma']; label: string }[] = [
  { value: 'Half', label: '4:2:0' },
  { value: 'Wide', label: '4:2:2' },
  { value: 'Full', label: '4:4:4' }
]
const PNG_COMPRESSION: { value: ExportSettings['pngCompression']; label: string }[] = [
  { value: 'Fast', label: tk('Fast') },
  { value: 'Balanced', label: tk('Balanced') },
  { value: 'Best', label: tk('Best') }
]
const TIFF_COMPRESSION: { value: ExportSettings['tiffCompression']; label: string }[] = [
  { value: 'None', label: tk('None') },
  { value: 'Lzw', label: 'LZW' },
  { value: 'Deflate', label: 'Deflate' }
]

const RESIZE_MODES: { value: ResizeMode; label: string }[] = [
  { value: 'none', label: tk('Full size') },
  { value: 'long', label: tk('Long edge') },
  { value: 'short', label: tk('Short edge') },
  { value: 'width', label: tk('Width') },
  { value: 'height', label: tk('Height') },
  { value: 'box', label: tk('Fit inside width × height') },
  { value: 'megapixels', label: tk('Megapixels') },
  { value: 'percent', label: tk('Percent') }
]

/** A list of options, its labels translated. */
function translated<T>(options: { value: T; label: string }[]): { value: T; label: string }[] {
  return options.map((o) => ({ ...o, label: t(o.label) }))
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function Num({
  value,
  onChange,
  min,
  max,
  step = 1
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}): React.JSX.Element {
  return (
    <input
      type="number"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
      onKeyDown={(e) => e.stopPropagation()}
    />
  )
}

function Check({
  on,
  onChange,
  children,
  disabled
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={on}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />{' '}
      {children}
    </label>
  )
}

const intentTip = (): Tip => ({
  what: t('How colours that do not fit the new colour space are brought into it.'),
  expect: INTENT_INFO.map((i) => `${t(i.name)}: ${t(i.what)}`).join('\n'),
  tip: t('Relative colorimetric with black point compensation is the usual choice for photographs.')
})

export function ExportDialog(): React.JSX.Element {
  const targets = useTargets()
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const items = useLibrary((s) => s.items)
  const [s, setS] = useState<ExportSettings>(defaultExportSettings())
  const [presets, setPresets] = useState<ExportPreset[]>([])
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [presetName, setPresetName] = useState('')
  const [step, setStep] = useState<ExportStep>('format')
  /** Why a lapsed licence refuses exporting (never while licensing isn't enforced). */
  const [locked, setLocked] = useState<string | null>(null)
  /** The disk's and the photos' checks, from main. */
  const [remote, setRemote] = useState<Guard[]>([])
  const [shown, setShown] = useState<{
    state: 'idle' | 'busy' | 'ready' | 'error'
    preview?: ExportPreview
    error?: string
    /** The settings it was made from: it is out of date when they change. */
    of?: string
  }>({ state: 'idle' })
  const d = useMemo(() => defaultExportSettings(), [])

  useEffect(() => {
    void api.app
      .getSetting<ExportSettings>('export.last')
      .then((last) => last && setS(normaliseExportSettings(last)))
    void api.export.presets().then(setPresets)
    void api.licence.status().then((l) => setLocked(l.locked))
    const offLicence = api.licence.onChange((l) => setLocked(l.locked))
    const offProgress = api.export.onProgress(setProgress)
    return () => {
      offLicence()
      offProgress()
      void api.export.cancelPreview()
    }
  }, [])

  const up = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]): void =>
    setS((x) => ({ ...x, [k]: v }))
  const differs = (...keys: (keyof ExportSettings)[]): boolean =>
    keys.some((k) => JSON.stringify(s[k]) !== JSON.stringify(d[k]))
  const reset =
    (...keys: (keyof ExportSettings)[]) =>
    (): void =>
      setS((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, d[k]])) }))

  const sources: ExportSource[] = useMemo(
    () =>
      targets.flatMap((key) => {
        const it = items.find((i) => i.key === key)
        return it
          ? [
              {
                ext: it.ext,
                isRaw: it.isRaw,
                isHdr: it.hdr === 'pq' || it.hdr === 'hlg',
                hasGainMap: it.hdr === 'gainmap'
              }
            ]
          : []
      }),
    [targets, items]
  )
  const local = useMemo(() => exportGuards(s, sources), [s, sources])
  // The disk's checks follow the settings, a moment after the last change.
  const asked = useRef(0)
  useEffect(() => {
    const id = ++asked.current
    const timer = setTimeout(() => {
      void api.export
        .check(targets, s)
        .then((g) => id === asked.current && setRemote(g))
        .catch(() => id === asked.current && setRemote([]))
    }, 350)
    return () => clearTimeout(timer)
  }, [s, targets])
  const guards = useMemo(() => {
    const seen = new Set(local.map((g) => g.id))
    const rank = { block: 0, warn: 1, minor: 2 }
    return [...local, ...remote.filter((g) => !seen.has(g.id))].sort(
      (a, b) => rank[a.severity] - rank[b.severity]
    )
  }, [local, remote])
  const stop = blocked(guards)

  const start = async (): Promise<void> => {
    try {
      await api.export.start(targets, s)
    } catch (err) {
      say(errorText(err), 'error')
    }
  }
  const settingsKey = JSON.stringify(s)
  const makePreview = async (): Promise<void> => {
    if (targets.length === 0) return
    setShown({ state: 'busy' })
    try {
      const preview = await api.export.preview(targets[0], s)
      setShown({ state: 'ready', preview, of: settingsKey })
    } catch (err) {
      // A newer preview took over: it will say its own.
      const cancelled = /cancel/i.test(errorText(err))
      if (!cancelled) setShown({ state: 'error', error: errorText(err) })
    }
  }

  const running = progress !== null && !progress.finished
  const failed = progress?.errors.filter((e) => !e.warning) ?? []
  const warned = progress?.errors.filter((e) => e.warning) ?? []
  const depths = depthsFor(s.format)
  const hdrOut = s.hdr.mode !== 'sdr'
  const at = STEPS.findIndex((x) => x.id === step)
  const last = at === STEPS.length - 1
  const issues = (id: ExportStep): Guard[] => guards.filter((g) => g.step === id)
  const notes = (id: ExportStep): React.JSX.Element | null => {
    const g = issues(id)
    return g.length === 0 ? null : <GuardList guards={g} onGo={setStep} here={id} />
  }

  return (
    <Modal
      title={tp('Export {{count}} photo', 'Export {{count}} photos', targets.length)}
      onClose={() => setDialog(null)}
      wide
      icon="export"
      className="export-wizard"
      footer={
        <>
          {progress && (
            <span className="progress">
              <Spinner
                size={34}
                progress={progress.total > 0 ? progress.done / progress.total : null}
              />
              <span className="big">
                {progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%
              </span>
              <span>
                {progress.done}/{progress.total}{' '}
                {progress.current
                  ? `· ${progress.current}`
                  : progress.finished
                    ? `· ${t('done')}`
                    : ''}
                {failed.length > 0 && (
                  <span className="error">
                    {' '}
                    ·{' '}
                    {t('{{count}} failed: {{message}}', {
                      count: failed.length,
                      message: failed[0].message
                    })}
                  </span>
                )}
              </span>
            </span>
          )}
          {!progress && guards.some((g) => g.severity !== 'minor') && (
            <button
              className={`ew-chip ${stop ? 'block' : 'warn'}`}
              onClick={() => setStep('review')}
              title={t('Show on the last step')}
            >
              {stop
                ? t('{{count}} to fix', {
                    count: guards.filter((g) => g.severity === 'block').length
                  })
                : t('{{count}} to know', {
                    count: guards.filter((g) => g.severity === 'warn').length
                  })}
            </button>
          )}
          {!running && at > 0 && (
            <button onClick={() => setStep(STEPS[at - 1].id)}>{t('Back')}</button>
          )}
          {running ? (
            <button onClick={() => void api.export.cancel(progress.jobId)}>
              {t('Cancel after this file')}
            </button>
          ) : last ? (
            <button
              className="primary"
              disabled={targets.length === 0 || locked !== null || stop}
              title={stop ? t('Fix what is marked first') : undefined}
              onClick={() => void start()}
            >
              {t('Export')}
            </button>
          ) : (
            <button className="primary" onClick={() => setStep(STEPS[at + 1].id)}>
              {t('Next')}
            </button>
          )}
        </>
      }
    >
      {locked && (
        <div className="licence-lock" role="alert">
          <p>{locked}</p>
          <div className="prefs-row">
            <button onClick={() => setDialog('preferences')}>{t('Open Settings…')}</button>
            <a href={BUY_URL} target="_blank" rel="noreferrer">
              {t('Buy a licence')}
            </a>
          </div>
        </div>
      )}
      <nav className="ew-steps" aria-label={t('Export steps')}>
        {STEPS.map((x, i) => {
          const bad = issues(x.id).some((g) => g.severity === 'block')
          return (
            <button
              key={x.id}
              className={`ew-step${x.id === step ? ' on' : ''}${i < at ? ' done' : ''}${bad ? ' bad' : ''}`}
              aria-current={x.id === step ? 'step' : undefined}
              onClick={() => setStep(x.id)}
            >
              <span className="ew-n">{bad ? '!' : i + 1}</span>
              {t(x.label)}
            </button>
          )
        })}
      </nav>

      {step === 'format' && (
        <div className="ew-body">
          <Card
            id="export.format"
            title={t('Format')}
            tip={formatTip()}
            defaultOpen
            changed={differs('format', 'bitDepth', 'dither')}
            onReset={reset('format', 'bitDepth', 'dither')}
          >
            <StepSlider
              label={t('Format')}
              value={s.format}
              options={FORMATS}
              onChange={(f) =>
                setS((x) => ({
                  ...x,
                  format: f,
                  bitDepth: depthsFor(f).includes(x.bitDepth) ? x.bitDepth : depthsFor(f)[0]
                }))
              }
              title={t('Written as .{{ext}}', { ext: FORMAT_EXT[s.format] })}
            />
            {depths.length > 1 && (
              <StepSlider
                label={t('Bit depth')}
                value={s.bitDepth}
                options={depths.map((v) => ({ value: v, label: `${v}-bit` }))}
                onChange={(v) => up('bitDepth', v)}
              />
            )}
            <Check on={s.dither} onChange={(v) => up('dither', v)}>
              {t('Dither 8-bit output')}
            </Check>
          </Card>
          <Card
            id="export.quality"
            title={t('Quality & detail')}
            defaultOpen
            tip={qualityTip()}
            changed={differs(
              'quality',
              'jpegSubsampling',
              'chroma',
              'lossless',
              'avifSpeed',
              'jxlDistance',
              'jxlEffort',
              'jxlLossless',
              'webpMethod',
              'webpLossless',
              'pngCompression',
              'tiffCompression'
            )}
            onReset={reset(
              'quality',
              'jpegSubsampling',
              'chroma',
              'lossless',
              'avifSpeed',
              'jxlDistance',
              'jxlEffort',
              'jxlLossless',
              'webpMethod',
              'webpLossless',
              'pngCompression',
              'tiffCompression'
            )}
          >
            {['jpeg', 'webp', 'avif'].includes(s.format) &&
              !(s.format === 'avif' && s.lossless) &&
              !(s.format === 'webp' && s.webpLossless) && (
                <Slider
                  label={t('Quality')}
                  value={s.quality}
                  min={1}
                  max={100}
                  step={1}
                  def={d.quality}
                  onChange={(v) => up('quality', Math.round(v))}
                  onCommit={() => undefined}
                  adjusts={false}
                />
              )}
            {s.format === 'jpeg' && (
              <StepSlider
                label={t('Chroma')}
                value={s.jpegSubsampling}
                options={JPEG_CHROMA}
                onChange={(v) => up('jpegSubsampling', v)}
                tip={chromaTip()}
              />
            )}
            {s.format === 'avif' && (
              <>
                <Check on={s.lossless} onChange={(v) => up('lossless', v)}>
                  {t('Lossless')}
                </Check>
                {!s.lossless && (
                  <StepSlider
                    label={t('Chroma')}
                    value={s.chroma}
                    options={AVIF_CHROMA}
                    onChange={(v) => up('chroma', v)}
                    tip={chromaTip()}
                  />
                )}
                <Slider
                  label={t('Speed')}
                  value={s.avifSpeed}
                  min={0}
                  max={9}
                  step={1}
                  def={d.avifSpeed}
                  onChange={(v) => up('avifSpeed', Math.round(v))}
                  onCommit={() => undefined}
                  adjusts={false}
                  title={t('Slower is smaller for the same quality')}
                />
              </>
            )}
            {s.format === 'jxl' && (
              <>
                <Check on={s.jxlLossless} onChange={(v) => up('jxlLossless', v)}>
                  {t('Lossless')}
                </Check>
                {!s.jxlLossless && (
                  <Slider
                    label={t('Distance')}
                    value={s.jxlDistance}
                    min={0.1}
                    max={25}
                    step={0.1}
                    def={d.jxlDistance}
                    onChange={(v) => up('jxlDistance', Math.round(v * 10) / 10)}
                    onCommit={() => undefined}
                    adjusts={false}
                    format={(v) => v.toFixed(1)}
                    title={t(
                      'How far from the original: 1 is visually lossless, higher is smaller'
                    )}
                  />
                )}
                <Slider
                  label={t('Effort')}
                  value={s.jxlEffort}
                  min={1}
                  max={9}
                  step={1}
                  def={d.jxlEffort}
                  onChange={(v) => up('jxlEffort', Math.round(v))}
                  onCommit={() => undefined}
                  adjusts={false}
                />
              </>
            )}
            {s.format === 'webp' && (
              <>
                <Check on={s.webpLossless} onChange={(v) => up('webpLossless', v)}>
                  {t('Lossless')}
                </Check>
                <Slider
                  label={t('Method')}
                  value={s.webpMethod}
                  min={0}
                  max={6}
                  step={1}
                  def={d.webpMethod}
                  onChange={(v) => up('webpMethod', Math.round(v))}
                  onCommit={() => undefined}
                  adjusts={false}
                />
              </>
            )}
            {s.format === 'png' && (
              <StepSlider
                label={t('Compression')}
                value={s.pngCompression}
                options={translated(PNG_COMPRESSION)}
                onChange={(v) => up('pngCompression', v)}
              />
            )}
            {s.format === 'tiff' && (
              <StepSlider
                label={t('Compression')}
                value={s.tiffCompression}
                options={translated(TIFF_COMPRESSION)}
                onChange={(v) => up('tiffCompression', v)}
              />
            )}
            {s.format === 'png' || s.format === 'tiff' ? (
              <p className="muted small">{t('Lossless: the picture is kept exactly.')}</p>
            ) : null}
          </Card>
          {notes('format')}
        </div>
      )}

      {step === 'size' && (
        <div className="ew-body">
          <Card
            id="export.size"
            title={t('Size')}
            defaultOpen
            tip={sizeTip()}
            changed={differs('resize')}
            onReset={reset('resize')}
          >
            <Field label={t('Resize')}>
              <select
                value={s.resize.mode}
                onChange={(e) => up('resize', { ...s.resize, mode: e.target.value as ResizeMode })}
              >
                {RESIZE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {t(m.label)}
                  </option>
                ))}
              </select>
            </Field>
            {s.resize.mode === 'box' ? (
              <div className="ew-box">
                <Field label={t('Width')}>
                  <Num
                    value={s.resize.value}
                    min={1}
                    onChange={(v) => up('resize', { ...s.resize, value: v })}
                  />
                </Field>
                <span className="ew-x" aria-hidden>
                  ×
                </span>
                <Field label={t('Height')}>
                  <Num
                    value={s.resize.valueH}
                    min={1}
                    onChange={(v) => up('resize', { ...s.resize, valueH: v })}
                  />
                </Field>
              </div>
            ) : (
              s.resize.mode !== 'none' && (
                <Field
                  label={
                    s.resize.mode === 'megapixels'
                      ? 'MP'
                      : s.resize.mode === 'percent'
                        ? '%'
                        : t('Pixels')
                  }
                >
                  <Num
                    value={s.resize.value}
                    min={1}
                    onChange={(v) => up('resize', { ...s.resize, value: v })}
                  />
                </Field>
              )
            )}
            {s.resize.mode === 'box' && (
              <p className="muted small">
                {t('Each picture is made as large as fits inside the box, its shape kept.')}
              </p>
            )}
            {s.resize.mode !== 'none' && (
              <Check
                on={s.resize.enlarge}
                onChange={(v) => up('resize', { ...s.resize, enlarge: v })}
              >
                {t('Allow enlarging')}
              </Check>
            )}
          </Card>
          <Card
            id="export.colour"
            title={t('Colour')}
            defaultOpen
            tip={colourTip()}
            changed={differs('colorSpace', 'intent', 'blackPointCompensation')}
            onReset={reset('colorSpace', 'intent', 'blackPointCompensation')}
          >
            <StepSlider
              label={t('Colour space')}
              value={s.colorSpace}
              options={COLOUR_SPACES}
              onChange={(v) => up('colorSpace', v)}
            />
            <div className="ew-intent">
              <Field label={t('Intent')}>
                <select
                  value={s.intent}
                  onChange={(e) => up('intent', e.target.value as ExportSettings['intent'])}
                >
                  {INTENT_INFO.map((i) => (
                    <option key={i.value} value={i.value}>
                      {t(i.name)}
                    </option>
                  ))}
                </select>
              </Field>
              <InfoTip tip={intentTip()} label={t('Intent')} />
            </div>
            <p className="muted small">
              {t(INTENT_INFO.find((i) => i.value === s.intent)?.what ?? '')}
            </p>
            <Check on={s.blackPointCompensation} onChange={(v) => up('blackPointCompensation', v)}>
              {t('Black point compensation')}
            </Check>
            <p className="muted small">
              {t(
                'Keeps the darkest shadows from being lifted or crushed when the new space’s black differs.'
              )}
            </p>
          </Card>
          <Card
            id="export.sharpen"
            title={t('Output sharpening')}
            defaultOpen={false}
            changed={differs('outputSharpen')}
            onReset={reset('outputSharpen')}
          >
            <Check
              on={s.outputSharpen.enabled}
              disabled={hdrOut}
              onChange={(v) => up('outputSharpen', { ...s.outputSharpen, enabled: v })}
            >
              {t('Sharpen for output')}
            </Check>
            <Field label={t('Media')}>
              <select
                value={s.outputSharpen.media}
                disabled={hdrOut || !s.outputSharpen.enabled}
                onChange={(e) =>
                  up('outputSharpen', {
                    ...s.outputSharpen,
                    media: e.target.value as ExportSettings['outputSharpen']['media']
                  })
                }
              >
                <option value="screen">{t('Screen|medium')}</option>
                <option value="matte">{t('Matte paper')}</option>
                <option value="glossy">{t('Glossy paper')}</option>
              </select>
            </Field>
            <StepSlider
              label={t('Amount')}
              value={s.outputSharpen.amount}
              disabled={hdrOut || !s.outputSharpen.enabled}
              options={[
                { value: 'low', label: t('Low') },
                { value: 'standard', label: t('Standard') },
                { value: 'high', label: t('High') }
              ]}
              onChange={(v) => up('outputSharpen', { ...s.outputSharpen, amount: v })}
            />
            <p className="muted small">
              {hdrOut
                ? t('Not applied to HDR output.')
                : t('Applied after the resize, at the size the picture will be seen.')}
            </p>
          </Card>
          <WatermarkSection
            value={s.watermark}
            onChange={(v) => up('watermark', v)}
            thumbUrl={items.find((i) => i.key === targets[0])?.thumbUrl ?? null}
          />
          {notes('size')}
        </div>
      )}

      {step === 'delivery' && (
        <div className="ew-body">
          <Card
            id="export.metadata"
            title={t('Metadata')}
            defaultOpen
            tip={{
              what: t('Which blocks of the original’s metadata the export keeps.'),
              expect: t(
                'Each block is copied whole or left out; the title, caption, keywords and copyright are then written into the ones kept.'
              )
            }}
            changed={differs('metaMode', 'metadata', 'removeLocation', 'copyright')}
            onReset={reset('metaMode', 'metadata', 'removeLocation', 'copyright')}
          >
            <Field label={t('Include')}>
              <select
                value={s.metaMode}
                onChange={(e) => up('metaMode', e.target.value as ExportSettings['metaMode'])}
              >
                <option value="all">{t('All')}</option>
                <option value="copyrightOnly">{t('Copyright only')}</option>
              </select>
            </Field>
            <div className="ew-checks">
              {(['exif', 'icc', 'xmp', 'iptc'] as const).map((k) => (
                <Check
                  key={k}
                  on={s.metadata[k]}
                  // Copyright only keeps the profile and writes the copyright alone.
                  disabled={s.metaMode === 'copyrightOnly' && k !== 'icc'}
                  onChange={(v) => up('metadata', { ...s.metadata, [k]: v })}
                >
                  {k.toUpperCase()}
                </Check>
              ))}
            </div>
            <Check on={s.removeLocation} onChange={(v) => up('removeLocation', v)}>
              {t('Remove location')}
            </Check>
            <Field label={t('Copyright')}>
              <input
                value={s.copyright}
                placeholder={t('Used when a photo has none')}
                onChange={(e) => up('copyright', e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </Field>
          </Card>
          <Card
            id="export.hdr"
            title="HDR"
            defaultOpen
            tip={hdrTip()}
            changed={differs('hdr')}
            onReset={reset('hdr')}
          >
            <Field label={t('Mode')}>
              <select
                value={s.hdr.mode}
                onChange={(e) =>
                  up('hdr', { ...s.hdr, mode: e.target.value as ExportSettings['hdr']['mode'] })
                }
              >
                <option value="sdr">{t('SDR (tone map HDR sources)')}</option>
                <option value="keep" disabled={!supportsHdr(s.format)}>
                  {t('Keep HDR sources HDR')}
                </option>
                <option value="expand" disabled={!supportsHdr(s.format)}>
                  {t('Expand SDR to HDR')}
                </option>
                <option value="gainmap" disabled={!supportsGainMap(s.format)}>
                  {t('SDR + gain map (HDR sources)')}
                </option>
              </select>
            </Field>
            {s.hdr.mode === 'gainmap' && (
              <p className="muted small">
                {t(
                  'An HDR photo is written as its SDR picture with a gain map (UltraHDR in a JPEG): an HDR display lifts it back, any other shows the SDR picture. SDR photos are written as plain SDR.'
                )}
              </p>
            )}
            <Check on={s.hdr.pixl} onChange={(v) => up('hdr', { ...s.hdr, pixl: v })}>
              {t('PIXL’s own tone mapping and gamut compression')}
            </Check>
            <p className="muted small">
              {t(
                'The engine’s built-in path for an HDR photo’s HDR, gain-map and Display P3 files: it keeps highlight hues, eases colours into the output’s gamut and builds the gain map itself. Off: the operator below.'
              )}
            </p>
            {s.hdr.pixl && s.hdr.mode !== 'sdr' && (
              <Slider
                label={t('Ceiling')}
                value={s.hdr.ceiling ?? CEILING_MAX}
                min={CEILING_MIN}
                max={CEILING_MAX}
                step={1}
                def={CEILING_MAX}
                scale="log"
                format={(v) =>
                  s.hdr.ceiling === null && v >= CEILING_MAX
                    ? t('Photo’s peak')
                    : `${Math.round(v)} nits`
                }
                onChange={(v) =>
                  up('hdr', { ...s.hdr, ceiling: v >= CEILING_MAX ? null : Math.round(v) })
                }
                onCommit={() => undefined}
                adjusts={false}
                title={t(
                  'The brightest the HDR output goes; the far right holds it to the photo’s own peak'
                )}
              />
            )}
            {!s.hdr.pixl && (s.hdr.mode === 'sdr' || s.hdr.mode === 'gainmap') && (
              <>
                <Field label={t('Operator')}>
                  <select
                    value={s.hdr.operator}
                    onChange={(e) =>
                      up('hdr', {
                        ...s.hdr,
                        operator: e.target.value as ExportSettings['hdr']['operator']
                      })
                    }
                  >
                    <option value="Bt2390">BT.2390</option>
                    <option value="Hable">Hable</option>
                    <option value="Reinhard">Reinhard</option>
                    <option value="Clip">Clip</option>
                  </select>
                </Field>
                <Field label={t('Target white (nits)')}>
                  <Num
                    value={s.hdr.targetPeak}
                    min={50}
                    max={1000}
                    onChange={(v) => up('hdr', { ...s.hdr, targetPeak: v })}
                  />
                </Field>
              </>
            )}
            {s.hdr.mode === 'gainmap' && (
              <Slider
                label={t('Map quality')}
                value={s.hdr.gainMapQuality}
                min={1}
                max={100}
                step={1}
                def={d.hdr.gainMapQuality}
                onChange={(v) => up('hdr', { ...s.hdr, gainMapQuality: Math.round(v) })}
                onCommit={() => undefined}
                adjusts={false}
              />
            )}
            {s.hdr.mode !== 'sdr' && !s.hdr.pixl && (
              <>
                <Field label={t('Highlights')}>
                  <select
                    value={s.hdr.limit}
                    onChange={(e) =>
                      up('hdr', {
                        ...s.hdr,
                        limit: e.target.value as ExportSettings['hdr']['limit']
                      })
                    }
                    title={t('What happens to highlights an edit pushes above the peak')}
                  >
                    <option value="clip">{t('Clip at the peak')}</option>
                    <option value="rolloff">{t('Roll off (BT.2390)')}</option>
                  </select>
                </Field>
                {s.hdr.limit === 'rolloff' && (
                  <Slider
                    label={t('Knee')}
                    value={s.hdr.knee}
                    min={10}
                    max={100}
                    step={1}
                    def={d.hdr.knee}
                    format={(v) => `${Math.round(v)}%`}
                    onChange={(v) => up('hdr', { ...s.hdr, knee: Math.round(v) })}
                    onCommit={() => undefined}
                    adjusts={false}
                  />
                )}
              </>
            )}
            {s.hdr.mode === 'expand' && (
              <>
                <StepSlider
                  label={t('To')}
                  value={s.hdr.to}
                  options={[
                    { value: 'Rec2100Pq', label: 'PQ' },
                    { value: 'Rec2100Hlg', label: 'HLG' }
                  ]}
                  onChange={(v) => up('hdr', { ...s.hdr, to: v })}
                />
                <Field label={t('SDR white (nits)')}>
                  <Num
                    value={s.hdr.sdrWhite}
                    min={50}
                    max={1000}
                    onChange={(v) => up('hdr', { ...s.hdr, sdrWhite: v })}
                  />
                </Field>
                <Field label={t('Peak (nits)')}>
                  <Num
                    value={s.hdr.peak}
                    min={100}
                    max={10000}
                    onChange={(v) => up('hdr', { ...s.hdr, peak: v })}
                  />
                </Field>
              </>
            )}
          </Card>
          {notes('delivery')}
        </div>
      )}

      {step === 'review' && (
        <div className="ew-body">
          <Card
            id="export.location"
            title={t('Location & name')}
            defaultOpen
            changed={differs('folder', 'subfolder', 'template', 'collision', 'reveal')}
            onReset={reset('folder', 'subfolder', 'template', 'collision', 'reveal')}
          >
            <Check on={s.folder === null} onChange={(v) => up('folder', v ? null : '')}>
              {t('Beside each original')}
            </Check>
            {s.folder !== null && (
              <div className="row">
                <input value={s.folder} readOnly placeholder={t('Choose a folder')} />
                <button
                  onClick={() => void api.export.chooseFolder().then((f) => f && up('folder', f))}
                >
                  {t('Choose…')}
                </button>
              </div>
            )}
            <Field label={t('Subfolder')}>
              <input
                value={s.subfolder}
                onChange={(e) => up('subfolder', e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </Field>
            <Field label={t('File name')}>
              <input
                value={s.template}
                onChange={(e) => up('template', e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                title="{name} {seq} {date} {rating} {copy} {ext}"
              />
            </Field>
            <Field label={t('If it exists')}>
              <select
                value={s.collision}
                onChange={(e) => up('collision', e.target.value as ExportSettings['collision'])}
              >
                <option value="suffix">{t('Add a number')}</option>
                <option value="skip">{t('Skip')}</option>
                <option value="overwrite">{t('Overwrite')}</option>
              </select>
            </Field>
            <Check on={s.reveal} onChange={(v) => up('reveal', v)}>
              {t('Show in folder when done')}
            </Check>
          </Card>
          <Card id="export.presets" title={t('Presets')} defaultOpen={false}>
            <select
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value)
                if (p) setS(normaliseExportSettings(p.settings))
              }}
            >
              <option value="">{t('Load preset…')}</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="row">
              <input
                placeholder={t('Preset name')}
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
              <button
                disabled={!presetName.trim()}
                onClick={() =>
                  void api.export.savePreset({ name: presetName.trim(), settings: s }).then(() => {
                    setPresetName('')
                    void api.export.presets().then(setPresets)
                  })
                }
              >
                {t('Save')}
              </button>
            </div>
          </Card>
          <Card id="export.summary" title={t('Before you export')} defaultOpen>
            <p className="ew-summary">{summary(s, targets.length)}</p>
            {guards.length === 0 ? (
              <p className="muted small">{t('Nothing to flag.')}</p>
            ) : (
              <GuardList guards={guards} onGo={setStep} here="review" />
            )}
          </Card>
          <Card id="export.preview" title={t('Preview')} defaultOpen>
            <div className="ew-preview-bar">
              <button
                disabled={targets.length === 0 || shown.state === 'busy' || stop}
                title={
                  stop
                    ? t('Fix what is marked first')
                    : t('Render the first photo as it will be written')
                }
                onClick={() => void makePreview()}
              >
                {shown.state === 'ready' ? t('Preview again') : t('Preview the first photo')}
              </button>
              {shown.state === 'busy' && <Spinner size={22} progress={null} />}
              {shown.state === 'ready' && shown.of !== settingsKey && (
                <span className="muted small">{t('Settings changed since: preview again.')}</span>
              )}
            </div>
            {shown.state === 'error' && <p className="error small">{shown.error}</p>}
            {shown.state === 'ready' && shown.preview && (
              <figure className="ew-preview">
                <img src={shown.preview.url} alt={t('The first photo as it will be exported')} />
                <figcaption>
                  {shown.preview.width} × {shown.preview.height} px ·{' '}
                  {FORMAT_NAME[shown.preview.format as ExportFormat] ?? shown.preview.format} ·{' '}
                  {t('{{size}} KB at this size', {
                    size: Math.max(1, Math.round(shown.preview.bytes / 1024))
                  })}
                  {shown.preview.notes.map((n) => (
                    <span key={n} className="muted small">
                      {' '}
                      · {n}
                    </span>
                  ))}
                </figcaption>
              </figure>
            )}
          </Card>
          {progress?.finished && (
            <Card id="export.receipt" title={t('Receipt')} defaultOpen>
              <p className="ew-summary">
                {failed.length > 0
                  ? t('{{count}} written, {{failed}} failed.', {
                      count: progress.outputs.length,
                      failed: failed.length
                    })
                  : t('{{count}} written.', { count: progress.outputs.length })}
              </p>
              {failed.map((e, i) => (
                <p key={`f${i}`} className="error small">
                  {e.name}: {e.message}
                </p>
              ))}
              {warned.map((e, i) => (
                <p key={`w${i}`} className="muted small">
                  {e.name}: {e.message}
                </p>
              ))}
            </Card>
          )}
        </div>
      )}
    </Modal>
  )
}

/** The guards, each saying what and where; a click goes to the step that holds the setting. */
function GuardList({
  guards,
  onGo,
  here
}: {
  guards: Guard[]
  onGo: (s: ExportStep) => void
  here: ExportStep
}): React.JSX.Element {
  return (
    <ul className="ew-guards">
      {guards.map((g) => (
        <li key={g.id} className={g.severity}>
          <span className="ew-mark" aria-hidden>
            {g.severity === 'block' ? '!' : g.severity === 'warn' ? '▲' : '·'}
          </span>
          <span>
            {g.message}
            {g.step !== here && (
              <>
                {' '}
                <button type="button" className="link" onClick={() => onGo(g.step)}>
                  {t(STEPS.find((x) => x.id === g.step)?.label ?? '')}
                </button>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The settings in a sentence: what the person is about to do. */
function summary(s: ExportSettings, photos: number): string {
  const name = FORMAT_NAME[s.format]
  const format =
    s.format === 'jpeg' || s.format === 'webp' || s.format === 'avif'
      ? s.lossless || s.webpLossless
        ? t('{{format}} lossless', { format: name })
        : t('{{format}} quality {{quality}}', { format: name, quality: s.quality })
      : name
  const value = s.resize.value
  const size =
    s.resize.mode === 'none'
      ? t('full size')
      : s.resize.mode === 'box'
        ? t('inside {{width}} × {{height}} px', { width: value, height: s.resize.valueH })
        : s.resize.mode === 'megapixels'
          ? `${value} MP`
          : s.resize.mode === 'percent'
            ? `${value}%`
            : s.resize.mode === 'long'
              ? t('long edge {{value}} px', { value })
              : s.resize.mode === 'short'
                ? t('short {{value}} px', { value })
                : s.resize.mode === 'width'
                  ? t('width {{value}} px', { value })
                  : t('height {{value}} px', { value })
  const space = COLOUR_SPACES.find((c) => c.value === s.colorSpace)?.label ?? s.colorSpace
  const values = { format, depth: s.bitDepth, size, space, hdr: s.hdr.mode }
  return s.hdr.mode === 'sdr'
    ? tp(
        '{{count}} photo as {{format}}, {{depth}}-bit, {{size}}, in {{space}}.',
        '{{count}} photos as {{format}}, {{depth}}-bit, {{size}}, in {{space}}.',
        photos,
        values
      )
    : tp(
        '{{count}} photo as {{format}}, {{depth}}-bit, {{size}}, in {{space}}, HDR: {{hdr}}.',
        '{{count}} photos as {{format}}, {{depth}}-bit, {{size}}, in {{space}}, HDR: {{hdr}}.',
        photos,
        values
      )
}

const formatTip = (): Tip => ({
  what: t('The file type each photo is written as.'),
  expect: t(
    'JPEG is the most widely read. PNG and TIFF keep every pixel. WebP, AVIF and JPEG XL are smaller for the same quality; AVIF and JPEG XL can also hold HDR.'
  ),
  tip: t('JPEG XL is not shown by every program yet.')
})
const qualityTip = (): Tip => ({
  what: t('How much detail the encoder keeps against how big the file is.'),
  expect: t(
    'Higher is closer to the picture and larger. Chroma is how much of the colour detail is kept: 4:4:4 keeps all of it, 4:2:0 keeps a quarter.'
  )
})
const chromaTip = (): Tip => ({
  what: t('How finely colour is stored beside brightness.'),
  expect: t(
    '4:4:4 keeps all the colour detail. 4:2:2 halves it across, 4:2:0 quarters it: smaller files, with fine coloured edges (red text, thin lines) a little softer.'
  )
})
const sizeTip = (): Tip => ({
  what: t('How big the written picture is.'),
  expect: t(
    'Long or short edge, width or height set one side and the other follows. Fit inside width × height makes each picture as large as fits the box. Without Allow enlarging, a picture already smaller is left alone.'
  )
})
const colourTip = (): Tip => ({
  what: t(
    'The colour space the pixels are written in, and how colours that do not fit it are handled.'
  ),
  expect: t(
    'sRGB is read the same everywhere. Display P3 and Adobe RGB hold more saturated colour; Rec.2020 more still, for HDR and wide-gamut screens.'
  )
})
const hdrTip = (): Tip => ({
  what: t('What an HDR photo (or an SDR one) becomes.'),
  expect: t(
    'SDR tone maps HDR photos to an ordinary picture. Keep HDR writes PQ. A gain map writes an SDR picture that HDR displays lift back. Expand makes an SDR photo HDR.'
  )
})
