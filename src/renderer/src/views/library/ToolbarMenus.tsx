import { useMemo, useRef, useState } from 'react'
import { clearedFilters, extraFilterCount, type FlagFilter } from '../../../../shared/filter'
import type { ColorLabel } from '../../../../shared/ipc'
import { keywordLabel, keywordPaths } from '../../../../shared/keywords'
import { cameraName } from '../../../../shared/smart'
import { Icon } from '../../components/icons'
import { Menu, Popover, type MenuItem } from '../../components/Popover'
import { useCull } from '../../state/cull'
import { useUi } from '../../state/ui'
import { LABEL_COLOURS } from '../../lib/helpers'
import { useLibrary, useTargets } from '../../state/library'
import { keyHint } from '../../lib/commands'
import { t, tk, tp } from '../../lib/i18n'

const stop = (e: React.KeyboardEvent): void => e.stopPropagation()

/** Distinct non-empty values, sorted. */
const distinct = (values: (string | null)[]): string[] =>
  [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))

/** A min–max pair of number fields; both empty is no range. */
function Range({
  label,
  value,
  unit,
  onChange
}: {
  label: string
  value: [number, number] | null
  unit?: string
  onChange: (v: [number, number] | null) => void
}): React.JSX.Element {
  const show = (n: number | undefined): string =>
    n === undefined || !Number.isFinite(n) ? '' : String(n)
  const [lo, setLo] = useState(show(value?.[0]))
  const [hi, setHi] = useState(show(value?.[1]))
  const commit = (a: string, b: string): void => {
    setLo(a)
    setHi(b)
    if (a.trim() === '' && b.trim() === '') return onChange(null)
    const x = a.trim() === '' ? -Infinity : Number(a)
    const y = b.trim() === '' ? Infinity : Number(b)
    if (Number.isNaN(x) || Number.isNaN(y)) return
    onChange([x, y])
  }
  return (
    <div className="field">
      <span>{label}</span>
      <span className="range-pair">
        <input
          type="number"
          aria-label={t('{{label}} from', { label })}
          placeholder={t('min')}
          value={lo}
          onChange={(e) => commit(e.target.value, hi)}
          onKeyDown={stop}
        />
        <span className="muted">–</span>
        <input
          type="number"
          aria-label={t('{{label}} to', { label })}
          placeholder={t('max')}
          value={hi}
          onChange={(e) => commit(lo, e.target.value)}
          onKeyDown={stop}
        />
        {unit && <span className="muted">{unit}</span>}
      </span>
    </div>
  )
}

const FLAGS: [FlagFilter, string][] = [
  ['notRejected', tk('Hide rejected')],
  ['all', tk('All photos')],
  ['pick', tk('Picks')],
  ['unflagged', tk('Unflagged')],
  ['reject', tk('Rejected only')]
]

const LABEL_NAME: Record<string, string> = {
  red: tk('Red'),
  yellow: tk('Yellow'),
  green: tk('Green'),
  blue: tk('Blue'),
  purple: tk('Purple')
}

const cap = (s: string): string => s[0].toUpperCase() + s.slice(1)
const labelName = (l: string): string => (LABEL_NAME[l] ? t(LABEL_NAME[l]) : cap(l))

/**
 * Every filter but the search: rating, flag, colour label and edits first
 * (the quick ones), then camera, lens, file kind, ISO and focal ranges,
 * capture dates and a keyword. The button counts those narrowing the view.
 */
export function FilterButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const filter = useLibrary((s) => s.filter)
  const n = extraFilterCount(filter)
  return (
    <span className="menu-anchor">
      <button
        className={`lg${n ? ' on' : ''}`}
        title={t(
          'Filter by rating, flag, label, edits, camera, lens, kind, ISO, focal length, date or keyword'
        )}
        aria-label={n ? tp('Filters, {{count}} on', 'Filters, {{count}} on', n) : t('Filters')}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="filter" />
        {t('Filters')}
        {n > 0 && <span className="filter-count t-num">{n}</span>}
      </button>
      {open && <FilterForm onClose={() => setOpen(false)} />}
    </span>
  )
}

function FilterForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const filter = useLibrary((s) => s.filter)
  const setFilter = useLibrary((s) => s.setFilter)
  const items = useLibrary((s) => s.items)
  const tree = useLibrary((s) => s.keywords)
  const cameras = useMemo(() => distinct(items.map((i) => cameraName(i))), [items])
  const lenses = useMemo(() => distinct(items.map((i) => i.camera.lens)), [items])
  const keywords = useMemo(() => keywordPaths(tree), [tree])
  const cullSuggest = useUi((s) => s.cullSuggest)
  const withCurrent = (list: string[], v: string): string[] =>
    v && !list.includes(v) ? [v, ...list] : list
  return (
    <Popover onClose={onClose} className="filter-pop">
      <div className="field">
        <span>{t('Rating')}</span>
        <div className="seg rating-seg" role="group" aria-label={t('Minimum rating')}>
          {[0, 1, 2, 3, 4, 5].map((r) => (
            <button
              key={r}
              className={filter.minRating === r ? 'on' : ''}
              aria-pressed={filter.minRating === r}
              title={
                r === 0
                  ? t('Any rating')
                  : tp('{{count}} star or more', '{{count}} stars or more', r)
              }
              onClick={() => setFilter({ minRating: r })}
            >
              {r === 0 ? (
                t('Any')
              ) : (
                <>
                  {r}
                  <span className="seg-star">★</span>
                </>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{t('Flag')}</span>
        <select
          value={filter.flag}
          onChange={(e) => setFilter({ flag: e.target.value as FlagFilter })}
          aria-label={t('Flag')}
        >
          {FLAGS.map(([v, label]) => (
            <option key={v} value={v}>
              {t(label)}
            </option>
          ))}
        </select>
      </div>
      {cullSuggest && (
        <label
          className="check field"
          title={t('Photos that look like rejects, with why: nothing is deleted')}
        >
          <input
            type="checkbox"
            checked={filter.suggested === true}
            onChange={(e) => {
              setFilter({ suggested: e.target.checked })
              // Photos not measured yet are measured now.
              if (e.target.checked) void useCull.getState().measure()
            }}
          />
          {t('Suggested rejects only')}
        </label>
      )}
      <div className="field">
        <span>{t('Label')}</span>
        <div className="label-pick" role="group" aria-label={t('Colour label')}>
          <button
            className={`sm${filter.label === 'all' ? ' on' : ''}`}
            aria-pressed={filter.label === 'all'}
            onClick={() => setFilter({ label: 'all' })}
          >
            {t('Any')}
          </button>
          {Object.keys(LABEL_COLOURS).map((l) => (
            <button
              key={l}
              className={`swatch${filter.label === l ? ' on' : ''}`}
              aria-pressed={filter.label === l}
              aria-label={labelName(l)}
              title={labelName(l)}
              style={{ color: LABEL_COLOURS[l] }}
              onClick={() => setFilter({ label: filter.label === l ? 'all' : (l as ColorLabel) })}
            >
              <i />
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>{t('Edits')}</span>
        <div className="seg" role="group" aria-label={t('Edited')}>
          {(
            [
              ['all', tk('Any')],
              ['edited', tk('Edited')],
              ['unedited', tk('Unedited')]
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={filter.edited === v ? 'on' : ''}
              aria-pressed={filter.edited === v}
              onClick={() => setFilter({ edited: v })}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <div className="pop-rule" />
      <div className="field">
        <span>{t('Camera')}</span>
        <select value={filter.camera} onChange={(e) => setFilter({ camera: e.target.value })}>
          <option value="">{t('Any camera')}</option>
          {withCurrent(cameras, filter.camera).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>{t('Lens')}</span>
        <select value={filter.lens} onChange={(e) => setFilter({ lens: e.target.value })}>
          <option value="">{t('Any lens')}</option>
          {withCurrent(lenses, filter.lens).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>{t('Kind')}</span>
        <div className="seg">
          {(
            [
              ['all', tk('All')],
              ['raw', 'RAW'],
              ['nonraw', tk('Not RAW')]
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={filter.kind === v ? 'on' : ''}
              onClick={() => setFilter({ kind: v })}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      <Range label="ISO" value={filter.iso} onChange={(iso) => setFilter({ iso })} />
      <Range
        label={t('Focal length')}
        unit="mm"
        value={filter.focal}
        onChange={(focal) => setFilter({ focal })}
      />
      <div className="field">
        <span>{t('Taken')}</span>
        <span className="range-pair">
          <input
            type="date"
            aria-label={t('Taken from')}
            value={filter.from}
            onChange={(e) => setFilter({ from: e.target.value })}
            onKeyDown={stop}
          />
          <span className="muted">–</span>
          <input
            type="date"
            aria-label={t('Taken to')}
            value={filter.to}
            onChange={(e) => setFilter({ to: e.target.value })}
            onKeyDown={stop}
          />
        </span>
      </div>
      <div className="field">
        <span>{t('Keyword')}</span>
        <select value={filter.keyword} onChange={(e) => setFilter({ keyword: e.target.value })}>
          <option value="">{t('Any keyword')}</option>
          {withCurrent(keywords, filter.keyword).map((k) => (
            <option key={k} value={k}>
              {keywordLabel(k)}
            </option>
          ))}
        </select>
      </div>
      <div className="row between pop-foot">
        <span className="muted small">{t('Search also finds titles, captions and keywords.')}</span>
        <button className="sm" onClick={() => setFilter(clearedFilters())}>
          {t('Clear')}
        </button>
      </div>
    </Popover>
  )
}

/** The auto-stack form: the longest gap inside a burst. */
function AutoStackForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const autoStack = useLibrary((s) => s.autoStack)
  const [seconds, setSeconds] = useState(3)
  const run = (): void => {
    onClose()
    void autoStack(seconds)
  }
  return (
    <Popover onClose={onClose} className="autostack-pop" align="right">
      <span className="micro">{t('Auto-stack by capture time')}</span>
      <p className="small muted">
        {t(
          'Photos in this folder taken no more than this far apart become one stack, the first on top. Photos already in a stack are left as they are.'
        )}
      </p>
      <div className="row">
        <input
          type="number"
          min={0.5}
          max={600}
          step={0.5}
          aria-label={t('Seconds between shots')}
          value={seconds}
          onChange={(e) => setSeconds(Math.max(0, Number(e.target.value)))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') run()
          }}
        />
        <span className="muted">{t('seconds')}</span>
        <span className="spacer" />
        <button className="primary sm" onClick={run}>
          {t('Stack')}
        </button>
      </div>
    </Popover>
  )
}

/**
 * Stacks and collections for the selection, from the toolbar (and so from
 * the keyboard): stack, unstack, cover, auto-stack; add to a collection.
 */
export function OrganiseMenu(): React.JSX.Element {
  const [open, setOpen] = useState<null | 'menu' | 'collections' | 'autostack'>(null)
  const targets = useTargets()
  const lib = useLibrary.getState
  const folder = useLibrary((s) => s.folder)
  const source = useLibrary((s) => s.source)
  const collections = useLibrary((s) => s.collections)
  const expanded = useLibrary((s) => s.expandedStacks)
  const focusItem = useLibrary((s) => s.items.find((i) => i.key === s.focus))
  const inStack = useLibrary((s) =>
    s.items.some((i) => i.stack && (s.selection.includes(i.key) || i.key === s.focus))
  )
  const manual = collections.filter((c) => c.kind === 'manual')
  const current =
    source?.kind === 'collection' ? collections.find((c) => c.id === source.id) : undefined
  const stackId = focusItem?.stack?.id
  const items: (MenuItem | 'sep')[] = [
    {
      label: t('Stack selection'),
      hint: keyHint('library.stack'),
      disabled: targets.length < 2,
      onSelect: () => void lib().stackTargets()
    },
    {
      label: t('Unstack'),
      hint: keyHint('library.unstack'),
      disabled: !inStack,
      onSelect: () => void lib().unstackTargets()
    },
    {
      label: stackId && expanded.has(stackId) ? t('Collapse stack') : t('Expand stack'),
      hint: 'S',
      disabled: !stackId,
      onSelect: () => stackId && lib().toggleStack(stackId)
    },
    {
      label: t('Make cover'),
      hint: keyHint('library.makeCover'),
      disabled: !stackId || focusItem?.stack?.position === 0,
      onSelect: () => focusItem && void lib().makeCover(focusItem.key)
    },
    {
      label: t('Auto-stack by capture time…'),
      disabled: !folder,
      onSelect: () => setOpen('autostack')
    },
    'sep',
    {
      label: t('Add selection to collection…'),
      disabled: targets.length === 0 || manual.length === 0,
      onSelect: () => setOpen('collections')
    },
    ...(current?.kind === 'manual'
      ? [
          {
            label: t('Remove from {{name}}', { name: current.name }),
            disabled: targets.length === 0,
            danger: true,
            onSelect: () => void lib().removeFromCollection(current.id, targets)
          }
        ]
      : [])
  ]
  return (
    <span className="menu-anchor">
      <button
        className="lg"
        title={t('Stacks and collections')}
        aria-expanded={open !== null}
        onClick={() => setOpen(open ? null : 'menu')}
      >
        <Icon name="stack" />
        <span className="lbl">{t('Organise')}</span>
      </button>
      {open === 'menu' && <Menu items={items} onClose={() => setOpen(null)} align="right" />}
      {open === 'collections' && (
        <Menu
          align="right"
          onClose={() => setOpen(null)}
          items={manual.map((c) => ({
            label: c.name,
            hint: c.count !== undefined ? String(c.count) : undefined,
            onSelect: () => void lib().addToCollection(c.id, targets)
          }))}
        />
      )}
      {open === 'autostack' && <AutoStackForm onClose={() => setOpen(null)} />}
    </span>
  )
}

/** The duplicates' own controls: how similar counts, and where to look. */
export function DuplicateControls(): React.JSX.Element | null {
  const source = useLibrary((s) => s.source)
  const opening = useLibrary((s) => s.opening)
  const lastFolder = useLibrary((s) => s.lastFolder)
  const openSource = useLibrary((s) => s.openSource)
  const shown = opening?.kind === 'duplicates' ? opening : source
  const [threshold, setThreshold] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (shown?.kind !== 'duplicates') return null
  const level = threshold ?? shown.threshold
  const reopen = (patch: { folder?: string | null; threshold?: number }): void =>
    void openSource({ ...shown, ...patch })
  return (
    <>
      <label
        className="bar-range dup-range"
        title={t(
          'How different two pictures may be and still count as similar (0: only identical pictures)'
        )}
      >
        <span className="micro">{t('Similar')}</span>
        <span className="bar-track">
          <span className="bar-fill" style={{ width: `${(level / 16) * 100}%` }} />
          <input
            type="range"
            min={0}
            max={16}
            value={level}
            aria-label={t('Similarity threshold')}
            onChange={(e) => {
              const v = Number(e.target.value)
              setThreshold(v)
              if (timer.current) clearTimeout(timer.current)
              timer.current = setTimeout(() => {
                setThreshold(null)
                reopen({ threshold: v })
              }, 350)
            }}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </span>
        <span className="bar-value t-num">{level}</span>
      </label>
      <div className="seg" role="group" aria-label={t('Where to look')}>
        <button
          className={shown.folder !== null ? 'on' : ''}
          disabled={!lastFolder}
          title={lastFolder ?? t('Open a folder first')}
          onClick={() => reopen({ folder: lastFolder })}
        >
          {t('This folder')}
        </button>
        <button
          className={shown.folder === null ? 'on' : ''}
          onClick={() => reopen({ folder: null })}
        >
          {t('Whole library')}
        </button>
      </div>
    </>
  )
}
