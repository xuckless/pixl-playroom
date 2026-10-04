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
import { InfoTip } from '../components/InfoTip'
import { Card, Modal, Slider, StepSlider } from '../components/ui'
import { Spinner } from '../fx'
import { api, errorText } from '../lib/api'
import { useLibrary, useTargets } from '../state/library'
import { WatermarkSection } from './WatermarkSection'

const STEPS: { id: ExportStep; label: string }[] = [
  { id: 'format', label: 'Format' },
  { id: 'size', label: 'Size & colour' },
  { id: 'delivery', label: 'Metadata & HDR' },
  { id: 'review', label: 'Review' }
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
  { value: 'Fast', label: 'Fast' },
  { value: 'Balanced', label: 'Balanced' },
  { value: 'Best', label: 'Best' }
]
const TIFF_COMPRESSION: { value: ExportSettings['tiffCompression']; label: string }[] = [
  { value: 'None', label: 'None' },
  { value: 'Lzw', label: 'LZW' },
  { value: 'Deflate', label: 'Deflate' }
]

const RESIZE_MODES: { value: ResizeMode; label: string }[] = [
  { value: 'none', label: 'Full size' },
  { value: 'long', label: 'Long edge' },
  { value: 'short', label: 'Short edge' },
  { value: 'width', label: 'Width' },
  { value: 'height', label: 'Height' },
  { value: 'box', label: 'Fit inside width × height' },
  { value: 'megapixels', label: 'Megapixels' },
  { value: 'percent', label: 'Percent' }
]

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

const INTENT_TIP = {
  what: 'How colours that do not fit the new colour space are brought into it.',
  expect: INTENT_INFO.map((i) => `${i.name}: ${i.what}`).join('\n'),
  tip: 'Relative colorimetric with black point compensation is the usual choice for photographs.'
}

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
    const t = setTimeout(() => {
      void api.export
        .check(targets, s)
        .then((g) => id === asked.current && setRemote(g))
        .catch(() => id === asked.current && setRemote([]))
    }, 350)
    return () => clearTimeout(t)
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
      title={`Export ${targets.length} photo${targets.length === 1 ? '' : 's'}`}
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
                {progress.current ? `· ${progress.current}` : progress.finished ? '· done' : ''}
                {failed.length > 0 && (
                  <span className="error">
                    {' '}
                    · {failed.length} failed: {failed[0].message}
                  </span>
                )}
              </span>
            </span>
          )}
          {!progress && guards.some((g) => g.severity !== 'minor') && (
            <button
              className={`ew-chip ${stop ? 'block' : 'warn'}`}
              onClick={() => setStep('review')}
              title="Show on the last step"
            >
              {stop
                ? `${guards.filter((g) => g.severity === 'block').length} to fix`
                : `${guards.filter((g) => g.severity === 'warn').length} to know`}
            </button>
          )}
          {!running && at > 0 && <button onClick={() => setStep(STEPS[at - 1].id)}>Back</button>}
          {running ? (
            <button onClick={() => void api.export.cancel(progress.jobId)}>
              Cancel after this file
            </button>
          ) : last ? (
            <button
              className="primary"
              disabled={targets.length === 0 || locked !== null || stop}
              title={stop ? 'Fix what is marked first' : undefined}
              onClick={() => void start()}
            >
              Export
            </button>
          ) : (
            <button className="primary" onClick={() => setStep(STEPS[at + 1].id)}>
              Next
            </button>
          )}
        </>
      }
    >
      {locked && (
        <div className="licence-lock" role="alert">
          <p>{locked}</p>
          <div className="prefs-row">
            <button onClick={() => setDialog('preferences')}>Open Settings…</button>
            <a href={BUY_URL} target="_blank" rel="noreferrer">
              Buy a licence
            </a>
          </div>
        </div>
      )}
      <nav className="ew-steps" aria-label="Export steps">
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
              {x.label}
            </button>
          )
        })}
      </nav>

      {step === 'format' && (
        <div className="ew-body">
          <Card
            id="export.format"
            title="Format"
            tip={FORMAT_TIP}
            defaultOpen
            changed={differs('format', 'bitDepth', 'dither')}
            onReset={reset('format', 'bitDepth', 'dither')}
          >
            <StepSlider
              label="Format"
              value={s.format}
              options={FORMATS}
              onChange={(f) =>
                setS((x) => ({
                  ...x,
                  format: f,
                  bitDepth: depthsFor(f).includes(x.bitDepth) ? x.bitDepth : depthsFor(f)[0]
                }))
              }
              title={`Written as .${FORMAT_EXT[s.format]}`}
            />
            {depths.length > 1 && (
              <StepSlider
                label="Bit depth"
                value={s.bitDepth}
                options={depths.map((v) => ({ value: v, label: `${v}-bit` }))}
                onChange={(v) => up('bitDepth', v)}
              />
            )}
            <Check on={s.dither} onChange={(v) => up('dither', v)}>
              Dither 8-bit output
            </Check>
          </Card>
          <Card
            id="export.quality"
            title="Quality & detail"
            defaultOpen
            tip={QUALITY_TIP}
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
                  label="Quality"
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
                label="Chroma"
                value={s.jpegSubsampling}
                options={JPEG_CHROMA}
                onChange={(v) => up('jpegSubsampling', v)}
                tip={CHROMA_TIP}
              />
            )}
            {s.format === 'avif' && (
              <>
                <Check on={s.lossless} onChange={(v) => up('lossless', v)}>
                  Lossless
                </Check>
                {!s.lossless && (
                  <StepSlider
                    label="Chroma"
                    value={s.chroma}
                    options={AVIF_CHROMA}
                    onChange={(v) => up('chroma', v)}
                    tip={CHROMA_TIP}
                  />
                )}
                <Slider
                  label="Speed"
                  value={s.avifSpeed}
                  min={0}
                  max={9}
                  step={1}
                  def={d.avifSpeed}
                  onChange={(v) => up('avifSpeed', Math.round(v))}
                  onCommit={() => undefined}
                  adjusts={false}
                  title="Slower is smaller for the same quality"
                />
              </>
            )}
            {s.format === 'jxl' && (
              <>
                <Check on={s.jxlLossless} onChange={(v) => up('jxlLossless', v)}>
                  Lossless
                </Check>
                {!s.jxlLossless && (
                  <Slider
                    label="Distance"
                    value={s.jxlDistance}
                    min={0.1}
                    max={25}
                    step={0.1}
                    def={d.jxlDistance}
                    onChange={(v) => up('jxlDistance', Math.round(v * 10) / 10)}
                    onCommit={() => undefined}
                    adjusts={false}
                    format={(v) => v.toFixed(1)}
                    title="How far from the original: 1 is visually lossless, higher is smaller"
                  />
                )}
                <Slider
                  label="Effort"
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
                  Lossless
                </Check>
                <Slider
                  label="Method"
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
                label="Compression"
                value={s.pngCompression}
                options={PNG_COMPRESSION}
                onChange={(v) => up('pngCompression', v)}
              />
            )}
            {s.format === 'tiff' && (
              <StepSlider
                label="Compression"
                value={s.tiffCompression}
                options={TIFF_COMPRESSION}
                onChange={(v) => up('tiffCompression', v)}
              />
            )}
            {s.format === 'png' || s.format === 'tiff' ? (
              <p className="muted small">Lossless: the picture is kept exactly.</p>
            ) : null}
          </Card>
          {notes('format')}
        </div>
      )}

      {step === 'size' && (
        <div className="ew-body">
          <Card
            id="export.size"
            title="Size"
            defaultOpen
            tip={SIZE_TIP}
            changed={differs('resize')}
            onReset={reset('resize')}
          >
            <Field label="Resize">
              <select
                value={s.resize.mode}
                onChange={(e) => up('resize', { ...s.resize, mode: e.target.value as ResizeMode })}
              >
                {RESIZE_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            {s.resize.mode === 'box' ? (
              <div className="ew-box">
                <Field label="Width">
                  <Num
                    value={s.resize.value}
                    min={1}
                    onChange={(v) => up('resize', { ...s.resize, value: v })}
                  />
                </Field>
                <span className="ew-x" aria-hidden>
                  ×
                </span>
                <Field label="Height">
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
                        : 'Pixels'
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
                Each picture is made as large as fits inside the box, its shape kept.
              </p>
            )}
            {s.resize.mode !== 'none' && (
              <Check
                on={s.resize.enlarge}
                onChange={(v) => up('resize', { ...s.resize, enlarge: v })}
              >
                Allow enlarging
              </Check>
            )}
          </Card>
          <Card
            id="export.colour"
            title="Colour"
            defaultOpen
            tip={COLOUR_TIP}
            changed={differs('colorSpace', 'intent', 'blackPointCompensation')}
            onReset={reset('colorSpace', 'intent', 'blackPointCompensation')}
          >
            <StepSlider
              label="Colour space"
              value={s.colorSpace}
              options={COLOUR_SPACES}
              onChange={(v) => up('colorSpace', v)}
            />
            <div className="ew-intent">
              <Field label="Intent">
                <select
                  value={s.intent}
                  onChange={(e) => up('intent', e.target.value as ExportSettings['intent'])}
                >
                  {INTENT_INFO.map((i) => (
                    <option key={i.value} value={i.value}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </Field>
              <InfoTip tip={INTENT_TIP} label="Intent" />
            </div>
            <p className="muted small">{INTENT_INFO.find((i) => i.value === s.intent)?.what}</p>
            <Check on={s.blackPointCompensation} onChange={(v) => up('blackPointCompensation', v)}>
              Black point compensation
            </Check>
            <p className="muted small">
              Keeps the darkest shadows from being lifted or crushed when the new space’s black
              differs.
            </p>
          </Card>
          <Card
            id="export.sharpen"
            title="Output sharpening"
            defaultOpen={false}
            changed={differs('outputSharpen')}
            onReset={reset('outputSharpen')}
          >
            <Check
              on={s.outputSharpen.enabled}
              disabled={hdrOut}
              onChange={(v) => up('outputSharpen', { ...s.outputSharpen, enabled: v })}
            >
              Sharpen for output
            </Check>
            <Field label="Media">
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
                <option value="screen">Screen</option>
                <option value="matte">Matte paper</option>
                <option value="glossy">Glossy paper</option>
              </select>
            </Field>
            <StepSlider
              label="Amount"
              value={s.outputSharpen.amount}
              disabled={hdrOut || !s.outputSharpen.enabled}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'standard', label: 'Standard' },
                { value: 'high', label: 'High' }
              ]}
              onChange={(v) => up('outputSharpen', { ...s.outputSharpen, amount: v })}
            />
            <p className="muted small">
              {hdrOut
                ? 'Not applied to HDR output.'
                : 'Applied after the resize, at the size the picture will be seen.'}
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
            title="Metadata"
            defaultOpen
            tip={{
              what: 'Which blocks of the original’s metadata the export keeps.',
              expect:
                'Each block is copied whole or left out; the title, caption, keywords and copyright are then written into the ones kept.'
            }}
            changed={differs('metaMode', 'metadata', 'removeLocation', 'copyright')}
            onReset={reset('metaMode', 'metadata', 'removeLocation', 'copyright')}
          >
            <Field label="Include">
              <select
                value={s.metaMode}
                onChange={(e) => up('metaMode', e.target.value as ExportSettings['metaMode'])}
              >
                <option value="all">All</option>
                <option value="copyrightOnly">Copyright only</option>
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
              Remove location
            </Check>
            <Field label="Copyright">
              <input
                value={s.copyright}
                placeholder="Used when a photo has none"
                onChange={(e) => up('copyright', e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </Field>
          </Card>
          <Card
            id="export.hdr"
            title="HDR"
            defaultOpen
            tip={HDR_TIP}
            changed={differs('hdr')}
            onReset={reset('hdr')}
          >
            <Field label="Mode">
              <select
                value={s.hdr.mode}
                onChange={(e) =>
                  up('hdr', { ...s.hdr, mode: e.target.value as ExportSettings['hdr']['mode'] })
                }
              >
                <option value="sdr">SDR (tone map HDR sources)</option>
                <option value="keep" disabled={!supportsHdr(s.format)}>
                  Keep HDR sources HDR
                </option>
                <option value="expand" disabled={!supportsHdr(s.format)}>
                  Expand SDR to HDR
                </option>
                <option value="gainmap" disabled={!supportsGainMap(s.format)}>
                  SDR + gain map (HDR sources)
                </option>
              </select>
            </Field>
            {s.hdr.mode === 'gainmap' && (
              <p className="muted small">
                An HDR photo is written as its SDR picture with a gain map (UltraHDR in a JPEG): an
                HDR display lifts it back, any other shows the SDR picture. SDR photos are written
                as plain SDR.
              </p>
            )}
            <Check on={s.hdr.pixl} onChange={(v) => up('hdr', { ...s.hdr, pixl: v })}>
              PIXL’s own tone mapping and gamut compression
            </Check>
            <p className="muted small">
              The engine’s built-in path for an HDR photo’s HDR, gain-map and Display P3 files: it
              keeps highlight hues, eases colours into the output’s gamut and builds the gain map
              itself. Off: the operator below.
            </p>
            {s.hdr.pixl && s.hdr.mode !== 'sdr' && (
              <Slider
                label="Ceiling"
                value={s.hdr.ceiling ?? CEILING_MAX}
                min={CEILING_MIN}
                max={CEILING_MAX}
                step={1}
                def={CEILING_MAX}
                scale="log"
                format={(v) =>
                  s.hdr.ceiling === null && v >= CEILING_MAX
                    ? 'Photo’s peak'
                    : `${Math.round(v)} nits`
                }
                onChange={(v) =>
                  up('hdr', { ...s.hdr, ceiling: v >= CEILING_MAX ? null : Math.round(v) })
                }
                onCommit={() => undefined}
                adjusts={false}
                title="The brightest the HDR output goes; the far right holds it to the photo’s own peak"
              />
            )}
            {!s.hdr.pixl && (s.hdr.mode === 'sdr' || s.hdr.mode === 'gainmap') && (
              <>
                <Field label="Operator">
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
                <Field label="Target white (nits)">
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
                label="Map quality"
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
                <Field label="Highlights">
                  <select
                    value={s.hdr.limit}
                    onChange={(e) =>
                      up('hdr', {
                        ...s.hdr,
                        limit: e.target.value as ExportSettings['hdr']['limit']
                      })
                    }
                    title="What happens to highlights an edit pushes above the peak"
                  >
                    <option value="clip">Clip at the peak</option>
                    <option value="rolloff">Roll off (BT.2390)</option>
                  </select>
                </Field>
                {s.hdr.limit === 'rolloff' && (
                  <Slider
                    label="Knee"
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
                  label="To"
                  value={s.hdr.to}
                  options={[
                    { value: 'Rec2100Pq', label: 'PQ' },
                    { value: 'Rec2100Hlg', label: 'HLG' }
                  ]}
                  onChange={(v) => up('hdr', { ...s.hdr, to: v })}
                />
                <Field label="SDR white (nits)">
                  <Num
                    value={s.hdr.sdrWhite}
                    min={50}
                    max={1000}
                    onChange={(v) => up('hdr', { ...s.hdr, sdrWhite: v })}
                  />
                </Field>
                <Field label="Peak (nits)">
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
            title="Location & name"
            defaultOpen
            changed={differs('folder', 'subfolder', 'template', 'collision', 'reveal')}
            onReset={reset('folder', 'subfolder', 'template', 'collision', 'reveal')}
          >
            <Check on={s.folder === null} onChange={(v) => up('folder', v ? null : '')}>
              Beside each original
            </Check>
            {s.folder !== null && (
              <div className="row">
                <input value={s.folder} readOnly placeholder="Choose a folder" />
                <button
                  onClick={() => void api.export.chooseFolder().then((f) => f && up('folder', f))}
                >
                  Choose…
                </button>
              </div>
            )}
            <Field label="Subfolder">
              <input
                value={s.subfolder}
                onChange={(e) => up('subfolder', e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </Field>
            <Field label="File name">
              <input
                value={s.template}
                onChange={(e) => up('template', e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                title="{name} {seq} {date} {rating} {copy} {ext}"
              />
            </Field>
            <Field label="If it exists">
              <select
                value={s.collision}
                onChange={(e) => up('collision', e.target.value as ExportSettings['collision'])}
              >
                <option value="suffix">Add a number</option>
                <option value="skip">Skip</option>
                <option value="overwrite">Overwrite</option>
              </select>
            </Field>
            <Check on={s.reveal} onChange={(v) => up('reveal', v)}>
              Show in folder when done
            </Check>
          </Card>
          <Card id="export.presets" title="Presets" defaultOpen={false}>
            <select
              value=""
              onChange={(e) => {
                const p = presets.find((x) => x.id === e.target.value)
                if (p) setS(normaliseExportSettings(p.settings))
              }}
            >
              <option value="">Load preset…</option>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <div className="row">
              <input
                placeholder="Preset name"
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
                Save
              </button>
            </div>
          </Card>
          <Card id="export.summary" title="Before you export" defaultOpen>
            <p className="ew-summary">{summary(s, targets.length)}</p>
            {guards.length === 0 ? (
              <p className="muted small">Nothing to flag.</p>
            ) : (
              <GuardList guards={guards} onGo={setStep} here="review" />
            )}
          </Card>
          <Card id="export.preview" title="Preview" defaultOpen>
            <div className="ew-preview-bar">
              <button
                disabled={targets.length === 0 || shown.state === 'busy' || stop}
                title={
                  stop ? 'Fix what is marked first' : 'Render the first photo as it will be written'
                }
                onClick={() => void makePreview()}
              >
                {shown.state === 'ready' ? 'Preview again' : 'Preview the first photo'}
              </button>
              {shown.state === 'busy' && <Spinner size={22} progress={null} />}
              {shown.state === 'ready' && shown.of !== settingsKey && (
                <span className="muted small">Settings changed since: preview again.</span>
              )}
            </div>
            {shown.state === 'error' && <p className="error small">{shown.error}</p>}
            {shown.state === 'ready' && shown.preview && (
              <figure className="ew-preview">
                <img src={shown.preview.url} alt="The first photo as it will be exported" />
                <figcaption>
                  {shown.preview.width} × {shown.preview.height} px ·{' '}
                  {FORMAT_NAME[shown.preview.format as ExportFormat] ?? shown.preview.format} ·{' '}
                  {Math.max(1, Math.round(shown.preview.bytes / 1024))} KB at this size
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
            <Card id="export.receipt" title="Receipt" defaultOpen>
              <p className="ew-summary">
                {progress.outputs.length} written
                {failed.length > 0 ? `, ${failed.length} failed` : ''}.
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
                  {STEPS.find((x) => x.id === g.step)?.label}
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
  const q =
    s.format === 'jpeg' || s.format === 'webp' || s.format === 'avif'
      ? s.lossless || s.webpLossless
        ? ' lossless'
        : ` quality ${s.quality}`
      : ''
  const size =
    s.resize.mode === 'none'
      ? 'full size'
      : s.resize.mode === 'box'
        ? `inside ${s.resize.value} × ${s.resize.valueH} px`
        : s.resize.mode === 'megapixels'
          ? `${s.resize.value} MP`
          : s.resize.mode === 'percent'
            ? `${s.resize.value}%`
            : `${s.resize.mode === 'long' ? 'long edge' : s.resize.mode} ${s.resize.value} px`
  const space = COLOUR_SPACES.find((c) => c.value === s.colorSpace)?.label ?? s.colorSpace
  return `${photos} photo${photos === 1 ? '' : 's'} as ${FORMAT_NAME[s.format]}${q}, ${s.bitDepth}-bit, ${size}, in ${space}${
    s.hdr.mode === 'sdr' ? '' : `, HDR: ${s.hdr.mode}`
  }.`
}

const FORMAT_TIP = {
  what: 'The file type each photo is written as.',
  expect:
    'JPEG is the most widely read. PNG and TIFF keep every pixel. WebP, AVIF and JPEG XL are smaller for the same quality; AVIF and JPEG XL can also hold HDR.',
  tip: 'JPEG XL is not shown by every program yet.'
}
const QUALITY_TIP = {
  what: 'How much detail the encoder keeps against how big the file is.',
  expect:
    'Higher is closer to the picture and larger. Chroma is how much of the colour detail is kept: 4:4:4 keeps all of it, 4:2:0 keeps a quarter.'
}
const CHROMA_TIP = {
  what: 'How finely colour is stored beside brightness.',
  expect:
    '4:4:4 keeps all the colour detail. 4:2:2 halves it across, 4:2:0 quarters it: smaller files, with fine coloured edges (red text, thin lines) a little softer.'
}
const SIZE_TIP = {
  what: 'How big the written picture is.',
  expect:
    'Long or short edge, width or height set one side and the other follows. Fit inside width × height makes each picture as large as fits the box. Without Allow enlarging, a picture already smaller is left alone.'
}
const COLOUR_TIP = {
  what: 'The colour space the pixels are written in, and how colours that do not fit it are handled.',
  expect:
    'sRGB is read the same everywhere. Display P3 and Adobe RGB hold more saturated colour; Rec.2020 more still, for HDR and wide-gamut screens.'
}
const HDR_TIP = {
  what: 'What an HDR photo (or an SDR one) becomes.',
  expect:
    'SDR tone maps HDR photos to an ordinary picture. Keep HDR writes PQ. A gain map writes an SDR picture that HDR displays lift back. Expand makes an SDR photo HDR.'
}
