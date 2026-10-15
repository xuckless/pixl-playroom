/**
 * Export, as one sheet: presets on the left (the previous export first,
 * Playroom's own, then the person's), the settings on the right as the
 * editor's own folding cards (Format & quality and Size open, the rest one
 * line each until opened), and what is about to happen always in view
 * below: the settings in a sentence, the photos' makeup, about how large
 * the files will be, and the guards (`shared/exportGuards.ts`, and the
 * disk's through `api.export.check`). A block stops Export, a warning does
 * not, and nothing is changed for the person. Export hands the photos as
 * they are now to the queue in main and closes; the top bar's pill follows
 * it. ⌘↵ exports from anywhere in the sheet, ⌘S keeps the settings as a
 * preset.
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
  type ExportCard,
  type Guard
} from '../../../shared/exportGuards'
import { BUILT_IN_PRESETS, copyName, sameSettings } from '../../../shared/exportPresets'
import {
  SAMPLED_PAST,
  estimateExport,
  exportMakeup,
  formatBytes
} from '../../../shared/exportSummary'
import type { ExportFacts, ExportPreset, ExportPreview } from '../../../shared/ipc'
import { BUY_URL } from '../../../shared/licence'
import { InfoTip, type Tip } from '../components/InfoTip'
import { LocationField } from '../components/LocationField'
import { Popover } from '../components/Popover'
import { useLocations } from '../lib/useLocations'
import { Card, Modal, Slider, StepSlider } from '../components/ui'
import { Spinner } from '../fx'
import { api, errorText } from '../lib/api'
import { IS_MAC } from '../lib/commands'
import { askConfirm, useConfirm } from '../state/confirm'
import { useExports } from '../state/exports'
import { useLibrary, useTargets } from '../state/library'
import { WatermarkSection } from './WatermarkSection'
import { PresetList, type Naming, type PresetRow } from './export/PresetList'
import { t, tk, tp } from '../lib/i18n'

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

const HDR_MODES: Record<ExportSettings['hdr']['mode'], string> = {
  sdr: 'SDR',
  keep: tk('Keep HDR'),
  expand: tk('Expand to HDR'),
  gainmap: tk('Gain map')
}

/** The cards, in the order the sheet shows them; Format & quality and Size open at first. */
const CARDS: ExportCard[] = [
  'format',
  'size',
  'colour',
  'sharpen',
  'hdr',
  'metadata',
  'location',
  'watermark'
]
const OPEN_FIRST: ExportCard[] = ['format', 'size']

/** What a field the keyboard can reach is, for a guard's card to put the focus in. */
const FIELDS = [
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[role="slider"]',
  'button:not(:disabled):not([tabindex="-1"])'
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

const byName = (a: ExportPreset, b: ExportPreset): number =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

export function ExportDialog(): React.JSX.Element {
  const targets = useTargets()
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const items = useLibrary((s) => s.items)
  // The previous export as it was when the sheet opened.
  const [last] = useState(() => useExports.getState().last)
  const queueBusy = useExports((s) => s.jobs.some((j) => !j.finished))
  const [s, setS] = useState<ExportSettings>(() =>
    last ? normaliseExportSettings(last.settings) : defaultExportSettings()
  )
  const [presets, setPresets] = useState<ExportPreset[]>([])
  const [selected, setSelected] = useState<string | null>(last ? 'previous' : 'default')
  const [naming, setNaming] = useState<Naming | null>(null)
  const [open, setOpen] = useState(
    () =>
      Object.fromEntries(CARDS.map((c) => [c, OPEN_FIRST.includes(c)])) as Record<
        ExportCard,
        boolean
      >
  )
  /** Why a lapsed licence refuses exporting (never while licensing isn't enforced). */
  const [locked, setLocked] = useState<string | null>(null)
  /** The disk's and the photos' checks, from main. */
  const [remote, setRemote] = useState<Guard[]>([])
  /** What main read of the photos, and for which selection. */
  const [read, setRead] = useState<{ of: string[]; facts: ExportFacts } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [shown, setShown] = useState<PreviewState>({ state: 'idle' })
  const cards = useRef<HTMLDivElement>(null)
  const previewButton = useRef<HTMLButtonElement>(null)
  const d = useMemo(() => defaultExportSettings(), [])

  useEffect(() => {
    void api.export.presets().then(setPresets)
    void api.licence.status().then((l) => setLocked(l.locked))
    const offLicence = api.licence.onChange((l) => setLocked(l.locked))
    return () => {
      offLicence()
      void api.export.cancelPreview()
    }
  }, [])

  // ── presets ──
  const rows: PresetRow[] = [
    last
      ? { id: 'previous', name: t('Previous'), group: 'previous', note: last.label ?? undefined }
      : { id: 'default', name: t('Defaults'), group: 'previous' },
    ...BUILT_IN_PRESETS.map((p): PresetRow => ({ id: p.id, name: t(p.name), group: 'builtin' })),
    ...[...presets].sort(byName).map((p): PresetRow => ({ id: p.id, name: p.name, group: 'yours' }))
  ]
  const settingsOf = (id: string | null): ExportSettings | null =>
    id === 'previous'
      ? (last?.settings ?? null)
      : id === 'default'
        ? d
        : (BUILT_IN_PRESETS.find((p) => p.id === id)?.settings ??
          presets.find((p) => p.id === id)?.settings ??
          null)
  const base = settingsOf(selected)
  const edited = base !== null && !sameSettings(s, base)
  const row = rows.find((r) => r.id === selected) ?? null
  /** The preset the export is made with, as the pill and Export with previous name it. */
  const label =
    !row || edited || row.id === 'default'
      ? null
      : row.id === 'previous'
        ? (last?.label ?? null)
        : row.name

  const choose = (id: string): void => {
    const next = settingsOf(id)
    if (!next) return
    setSelected(id)
    setNaming(null)
    setS(normaliseExportSettings(next))
  }
  const keep = async (p: Omit<ExportPreset, 'id'> & { id?: string }): Promise<void> => {
    try {
      const saved = await api.export.savePreset(p)
      setPresets(await api.export.presets())
      setSelected(saved.id)
    } catch (err) {
      say(errorText(err), 'error')
    }
  }
  const update = (): void => {
    const p = presets.find((x) => x.id === selected)
    if (p) void keep({ id: p.id, name: p.name, settings: s })
  }
  const named = (name: string): void => {
    const n = naming
    setNaming(null)
    if (n?.kind === 'rename') {
      const p = presets.find((x) => x.id === n.id)
      if (p) void keep({ ...p, name })
    } else void keep({ name, settings: s })
  }
  const duplicate = (id: string): void => {
    const from = settingsOf(id)
    const r = rows.find((x) => x.id === id)
    if (!from || !r) return
    const taken = presets.map((p) => p.name)
    void keep({ name: copyName(r.name, taken, t('copy|duplicate')), settings: from })
  }
  const remove = async (id: string): Promise<void> => {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    const yes = await askConfirm({
      title: t('Delete “{{name}}”?', { name: p.name }),
      body: t('The preset is deleted. Files exported with it stay as they are.'),
      confirm: t('Delete'),
      danger: true
    })
    if (!yes) return
    try {
      await api.export.removePreset(id)
      setPresets(await api.export.presets())
      if (selected === id) setSelected(null)
    } catch (err) {
      say(errorText(err), 'error')
    }
  }
  /** ⌘S: Update one's own preset changed, else Save as new. */
  const save = (): void => {
    if (edited && row?.group === 'yours') update()
    else setNaming({ kind: 'new' })
  }

  const up = <K extends keyof ExportSettings>(k: K, v: ExportSettings[K]): void =>
    setS((x) => ({ ...x, [k]: v }))
  const differs = (...keys: (keyof ExportSettings)[]): boolean =>
    keys.some((k) => JSON.stringify(s[k]) !== JSON.stringify(d[k]))
  const reset =
    (...keys: (keyof ExportSettings)[]) =>
    (): void =>
      setS((x) => ({ ...x, ...Object.fromEntries(keys.map((k) => [k, d[k]])) }))

  // ── the photos ──
  const byKey = useMemo(() => new Map(items.map((i) => [i.key, i])), [items])
  const targetItems = useMemo(
    () => targets.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])),
    [targets, byKey]
  )
  // What the photos are, read once for the selection (sizes and HDR, as probed).
  useEffect(() => {
    let live = true
    if (targets.length > 0)
      void api.export.facts(targets).then(
        (facts) => live && setRead({ of: targets, facts }),
        () => undefined
      )
    return () => {
      live = false
    }
  }, [targets])
  const facts = read?.of === targets ? read.facts : null
  const makeup = useMemo(() => exportMakeup(targetItems, facts?.sample), [targetItems, facts])
  const written = makeup.photos - makeup.offline
  const estimate = useMemo(
    () => (facts ? estimateExport(s, facts.sample, written) : null),
    [s, facts, written]
  )

  // Where exports are saved (one setting, Settings' too): the checks follow it.
  const locations = useLocations()
  const dest = locations.info?.exports.location ?? 'beside'
  const local = useMemo(
    () => exportGuards(s, makeup.sources, dest === 'beside', makeup.unread),
    [s, makeup, dest]
  )
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
  }, [s, targets, dest])
  const guards = useMemo(() => {
    const seen = new Set(local.map((g) => g.id))
    const rank = { block: 0, warn: 1, minor: 2 }
    return [...local, ...remote.filter((g) => !seen.has(g.id))].sort(
      (a, b) => rank[a.severity] - rank[b.severity]
    )
  }, [local, remote])
  const stop = blocked(guards)
  const blocks = guards.filter((g) => g.severity === 'block')
  const warns = guards.filter((g) => g.severity === 'warn')
  const canExport = targets.length > 0 && locked === null && !stop

  // Queued in main, from the photos as they are now: the sheet closes, and
  // the top bar's pill follows the export and keeps its receipt.
  const start = (): void => {
    if (!canExport) return
    setDialog(null)
    void useExports.getState().start(targets, s, label)
  }

  // ⌘↵ exports and ⌘S saves from anywhere in the sheet, a text field included.
  const keys = useRef({ start, save })
  useEffect(() => {
    keys.current = { start, save }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useConfirm.getState().open || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key === 'Enter') keys.current.start()
      else if (e.code === 'KeyS') keys.current.save()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

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

  // ── the cards ──
  const fold = (card: ExportCard): { open: boolean; onOpenChange: (o: boolean) => void } => ({
    open: open[card],
    onOpenChange: (o) => setOpen((x) => ({ ...x, [card]: o }))
  })
  /** A card's line when folded, and its mark when a guard is in it. */
  const right = (card: ExportCard, line: string): React.JSX.Element => {
    const mine = guards.filter((g) => g.card === card && g.severity !== 'minor')
    const bad = mine.some((g) => g.severity === 'block')
    const said = mine.map((g) => g.message)
    return (
      <>
        {!open[card] && <span className="es-line">{line}</span>}
        {mine.length > 0 && (
          <span
            className={`es-mark ${bad ? 'block' : 'warn'}`}
            title={said.join('\n')}
            aria-label={said.join(' ')}
          >
            {bad ? '!' : '▲'}
          </span>
        )}
      </>
    )
  }
  const notes = (card: ExportCard): React.JSX.Element | null => {
    const g = guards.filter((x) => x.card === card)
    return g.length === 0 ? null : <GuardList guards={g} />
  }
  /** The first guard's card, opened and brought into view, its first field focused. */
  const goToGuard = (): void => {
    const card = [...blocks, ...warns].find((x) => x.card)?.card
    if (!card) return
    setOpen((x) => ({ ...x, [card]: true }))
    requestAnimationFrame(() => {
      const el = cards.current?.querySelector<HTMLElement>(`[data-card="export.${card}"]`)
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      el?.querySelector<HTMLElement>(FIELDS.map((f) => `.card-body ${f}`).join(', '))?.focus()
    })
  }

  const depths = depthsFor(s.format)
  const hdrOut = s.hdr.mode !== 'sdr'
  const space = COLOUR_SPACES.find((c) => c.value === s.colorSpace)?.label ?? s.colorSpace
  const exportsPath = locations.info?.exports.path ?? null
  const where =
    dest === 'beside'
      ? t('Beside the original')
      : (exportsPath?.split(/[\\/]/).filter(Boolean).pop() ?? '')
  const makeupLine = [
    tp('{{count}} photo', '{{count}} photos', makeup.photos),
    makeup.hdr > 0 ? t('{{count}} HDR', { count: makeup.hdr }) : null,
    makeup.offline > 0 ? t('{{count}} offline', { count: makeup.offline }) : null,
    makeup.unread > 0 ? t('{{count}} not yet read', { count: makeup.unread }) : null
  ]
    .filter(Boolean)
    .join(' · ')
  const intentName = t(INTENT_INFO.find((i) => i.value === s.intent)?.name ?? '')

  return (
    <Modal
      title={tp('Export {{count}} photo', 'Export {{count}} photos', targets.length)}
      onClose={() => setDialog(null)}
      wide
      icon="export"
      className="export-sheet"
      footer={
        <>
          <div className="es-summary">
            <p className="es-sentence">{summary(s, written)}</p>
            <p className="es-facts">
              <span>{makeupLine}</span>
              {estimate && (
                <span
                  className="t-num"
                  title={t(
                    'An estimate from the size of the first {{count}} photos and what the format usually spends on a photograph’s pixel. Detail and noise move it either way; crops are not counted.',
                    { count: estimate.sampled }
                  )}
                >
                  {t('≈ {{each}} each · ≈ {{all}} in all', {
                    each: formatBytes(estimate.each),
                    all: formatBytes(estimate.all)
                  })}
                  {makeup.photos > SAMPLED_PAST &&
                    ` · ${t('from a sample of {{count}}', { count: estimate.sampled })}`}
                </span>
              )}
              {(blocks.length > 0 || warns.length > 0) && (
                <button
                  className={`ew-chip ${stop ? 'block' : 'warn'}`}
                  onClick={goToGuard}
                  title={[...blocks, ...warns].map((g) => g.message).join('\n')}
                >
                  <span aria-hidden>{stop ? '!' : '▲'}</span>
                  {stop
                    ? t('{{count}} to fix', { count: blocks.length })
                    : t('{{count}} to know', { count: warns.length })}
                </button>
              )}
            </p>
          </div>
          <button
            ref={previewButton}
            disabled={targets.length === 0 || stop}
            title={
              stop
                ? t('Fix what is marked first')
                : t('Render the first photo as it will be written')
            }
            aria-expanded={previewing}
            onClick={() => {
              if (previewing) return setPreviewing(false)
              setPreviewing(true)
              void makePreview()
            }}
          >
            {t('Preview')}
          </button>
          <button onClick={() => setDialog(null)}>{t('Cancel')}</button>
          <button
            className="primary"
            disabled={!canExport}
            title={
              targets.length === 0
                ? t('Select photos first')
                : stop
                  ? t('Fix what is marked first')
                  : undefined
            }
            onClick={start}
          >
            {t('Export')}
            <span className="kbd">{IS_MAC ? '⌘↵' : 'Ctrl+↵'}</span>
          </button>
          {previewing && (
            <Popover
              className="es-preview-pop"
              anchor={previewButton}
              align="right"
              side="top"
              onClose={() => setPreviewing(false)}
            >
              <ExportPreviewBody
                shown={shown}
                stale={shown.state === 'ready' && shown.of !== settingsKey}
                waits={queueBusy && shown.state === 'busy'}
                onAgain={() => void makePreview()}
              />
            </Popover>
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
      <div className="es-grid">
        <PresetList
          rows={rows}
          selected={selected}
          edited={edited}
          naming={naming}
          onSelect={choose}
          onExport={start}
          onUpdate={update}
          onNaming={setNaming}
          onName={named}
          onDuplicate={duplicate}
          onDelete={(id) => void remove(id)}
        />
        <div className="es-cards" ref={cards}>
          <Card
            id="export.format"
            title={t('Format & quality')}
            tip={formatTip()}
            {...fold('format')}
            right={right('format', formatLine(s))}
            changed={differs(...FORMAT_KEYS)}
            onReset={reset(...FORMAT_KEYS)}
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
            <Check on={s.dither} onChange={(v) => up('dither', v)}>
              {t('Dither 8-bit output')}
            </Check>
            {notes('format')}
          </Card>

          <Card
            id="export.size"
            title={t('Size')}
            tip={sizeTip()}
            {...fold('size')}
            right={right('size', sizeText(s))}
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
            {notes('size')}
          </Card>

          <Card
            id="export.colour"
            title={t('Colour')}
            tip={colourTip()}
            {...fold('colour')}
            right={right('colour', `${space} · ${intentName}`)}
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
            {notes('colour')}
          </Card>

          <Card
            id="export.sharpen"
            title={t('Output sharpening')}
            {...fold('sharpen')}
            right={right(
              'sharpen',
              s.outputSharpen.enabled && !hdrOut
                ? `${sharpenMedia(s.outputSharpen.media)} · ${sharpenAmount(s.outputSharpen.amount)}`
                : t('Off')
            )}
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
            {notes('sharpen')}
          </Card>

          <Card
            id="export.hdr"
            title="HDR"
            tip={hdrTip()}
            {...fold('hdr')}
            right={right(
              'hdr',
              s.hdr.mode !== 'sdr' && makeup.hdr > 0
                ? `${t(HDR_MODES[s.hdr.mode])} (${tp('{{count}} photo', '{{count}} photos', makeup.hdr)})`
                : t(HDR_MODES[s.hdr.mode])
            )}
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
            {notes('hdr')}
          </Card>

          <Card
            id="export.metadata"
            title={t('Metadata')}
            tip={{
              what: t('Which blocks of the original’s metadata the export keeps.'),
              expect: t(
                'Each block is copied whole or left out; the title, caption, keywords and copyright are then written into the ones kept.'
              )
            }}
            {...fold('metadata')}
            right={right(
              'metadata',
              s.metaMode === 'copyrightOnly'
                ? t('Copyright only')
                : s.removeLocation
                  ? t('All, no location')
                  : t('All')
            )}
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
            {notes('metadata')}
          </Card>

          <Card
            id="export.location"
            title={t('Location & name')}
            {...fold('location')}
            right={right(
              'location',
              s.subfolder.trim() ? `${where} / ${s.subfolder.trim()}` : where
            )}
            changed={differs('subfolder', 'template', 'collision', 'reveal')}
            onReset={reset('subfolder', 'template', 'collision', 'reveal')}
          >
            {/* Where exports are saved: Settings' own choice, changed here too. */}
            {locations.info && (
              <LocationField kind="exports" info={locations.info} save={locations.save} />
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
              {t('Show in folder when done, if Playroom is in the background')}
            </Check>
            {notes('location')}
          </Card>

          <WatermarkSection
            value={s.watermark}
            onChange={(v) => up('watermark', v)}
            thumbUrl={byKey.get(targets[0])?.thumbUrl ?? null}
            {...fold('watermark')}
            right={right('watermark', s.watermark.enabled && s.watermark.path ? t('On') : t('Off'))}
          />
        </div>
      </div>
    </Modal>
  )
}

/** What Format & quality's reset puts back. */
const FORMAT_KEYS: (keyof ExportSettings)[] = [
  'format',
  'bitDepth',
  'dither',
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
]

interface PreviewState {
  state: 'idle' | 'busy' | 'ready' | 'error'
  preview?: ExportPreview
  error?: string
  /** The settings it was made from: it is out of date when they change. */
  of?: string
}

/** The preview popover: the first photo rendered through the real export request. */
function ExportPreviewBody({
  shown,
  stale,
  waits,
  onAgain
}: {
  shown: PreviewState
  stale: boolean
  /** The background engine is writing an export: the preview takes its turn after. */
  waits: boolean
  onAgain: () => void
}): React.JSX.Element {
  return (
    <div className="es-preview">
      {shown.state === 'busy' && (
        <p className="es-preview-wait">
          <Spinner size={22} progress={null} />
          <span className="muted small">
            {waits ? t('Waits for the running export') : t('Rendering the first photo…')}
          </span>
        </p>
      )}
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
      {stale && (
        <p className="ew-preview-bar">
          <span className="muted small">{t('Settings changed since: preview again.')}</span>
          <button className="sm" onClick={onAgain}>
            {t('Preview again')}
          </button>
        </p>
      )}
    </div>
  )
}

/** A card's guards, each saying what is wrong or lost. */
function GuardList({ guards }: { guards: Guard[] }): React.JSX.Element {
  return (
    <ul className="ew-guards">
      {guards.map((g) => (
        <li key={g.id} className={g.severity}>
          <span className="ew-mark" aria-hidden>
            {g.severity === 'block' ? '!' : g.severity === 'warn' ? '▲' : '·'}
          </span>
          <span>{g.message}</span>
        </li>
      ))}
    </ul>
  )
}

const sharpenMedia = (m: ExportSettings['outputSharpen']['media']): string =>
  m === 'screen' ? t('Screen|medium') : m === 'matte' ? t('Matte paper') : t('Glossy paper')
const sharpenAmount = (a: ExportSettings['outputSharpen']['amount']): string =>
  a === 'low' ? t('Low') : a === 'standard' ? t('Standard') : t('High')

/** The format and its quality, as Format & quality's folded line says them. */
function formatLine(s: ExportSettings): string {
  const lossless =
    (s.format === 'avif' && s.lossless) ||
    (s.format === 'webp' && s.webpLossless) ||
    (s.format === 'jxl' && s.jxlLossless)
  const detail = lossless
    ? t('lossless')
    : s.format === 'jpeg' || s.format === 'webp' || s.format === 'avif'
      ? `q${s.quality}`
      : s.format === 'jxl'
        ? `d${s.jxlDistance}`
        : null
  const depth = depthsFor(s.format).length > 1 ? `${s.bitDepth}-bit` : null
  return [FORMAT_NAME[s.format], detail, depth].filter(Boolean).join(' · ')
}

/** The size the settings ask, in a few words. */
function sizeText(s: ExportSettings): string {
  const value = s.resize.value
  return s.resize.mode === 'none'
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
  const space = COLOUR_SPACES.find((c) => c.value === s.colorSpace)?.label ?? s.colorSpace
  const values = {
    format,
    depth: s.bitDepth,
    size: sizeText(s),
    space,
    hdr: t(HDR_MODES[s.hdr.mode])
  }
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
  expect: [
    t(
      'JPEG is the most widely read. PNG and TIFF keep every pixel. WebP, AVIF and JPEG XL are smaller for the same quality; AVIF and JPEG XL can also hold HDR.'
    ),
    t(
      'Higher is closer to the picture and larger. Chroma is how much of the colour detail is kept: 4:4:4 keeps all of it, 4:2:0 keeps a quarter.'
    )
  ].join('\n'),
  tip: t('JPEG XL is not shown by every program yet.')
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
