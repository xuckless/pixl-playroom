import { useMemo, useRef, useState } from 'react'
import { extraFilterCount, type Filter } from '../../../../shared/filter'
import { keywordLabel, keywordPaths } from '../../../../shared/keywords'
import { cameraName } from '../../../../shared/smart'
import { Icon } from '../../components/icons'
import { Menu, Popover, type MenuItem } from '../../components/Popover'
import { MOD } from '../../lib/helpers'
import { useLibrary, useTargets } from '../../state/library'

const stop = (e: React.KeyboardEvent): void => e.stopPropagation()
const SHIFT_MOD = MOD === '⌘' ? '⇧⌘' : 'Ctrl+Shift+'

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
          aria-label={`${label} from`}
          placeholder="min"
          value={lo}
          onChange={(e) => commit(e.target.value, hi)}
          onKeyDown={stop}
        />
        <span className="muted">–</span>
        <input
          type="number"
          aria-label={`${label} to`}
          placeholder="max"
          value={hi}
          onChange={(e) => commit(lo, e.target.value)}
          onKeyDown={stop}
        />
        {unit && <span className="muted">{unit}</span>}
      </span>
    </div>
  )
}

const CLEARED: Partial<Filter> = {
  camera: '',
  lens: '',
  kind: 'all',
  iso: null,
  focal: null,
  from: '',
  to: '',
  keyword: ''
}

/**
 * The filters beyond the bar's own: camera, lens, file kind, ISO and focal
 * ranges, capture dates and a keyword. The button counts those narrowing
 * the view.
 */
export function FilterButton(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const filter = useLibrary((s) => s.filter)
  const n = extraFilterCount(filter)
  return (
    <span className="menu-anchor">
      <button
        className={`lg${n ? ' on' : ''}`}
        title="More filters: camera, lens, kind, ISO, focal length, date, keyword"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="filter" />
        Filters
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
  const withCurrent = (list: string[], v: string): string[] =>
    v && !list.includes(v) ? [v, ...list] : list
  return (
    <Popover onClose={onClose} className="filter-pop">
      <div className="field">
        <span>Camera</span>
        <select value={filter.camera} onChange={(e) => setFilter({ camera: e.target.value })}>
          <option value="">Any camera</option>
          {withCurrent(cameras, filter.camera).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>Lens</span>
        <select value={filter.lens} onChange={(e) => setFilter({ lens: e.target.value })}>
          <option value="">Any lens</option>
          {withCurrent(lenses, filter.lens).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <span>Kind</span>
        <div className="seg">
          {(
            [
              ['all', 'All'],
              ['raw', 'RAW'],
              ['nonraw', 'Not RAW']
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={filter.kind === v ? 'on' : ''}
              onClick={() => setFilter({ kind: v })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Range label="ISO" value={filter.iso} onChange={(iso) => setFilter({ iso })} />
      <Range
        label="Focal length"
        unit="mm"
        value={filter.focal}
        onChange={(focal) => setFilter({ focal })}
      />
      <div className="field">
        <span>Taken</span>
        <span className="range-pair">
          <input
            type="date"
            aria-label="Taken from"
            value={filter.from}
            onChange={(e) => setFilter({ from: e.target.value })}
            onKeyDown={stop}
          />
          <span className="muted">–</span>
          <input
            type="date"
            aria-label="Taken to"
            value={filter.to}
            onChange={(e) => setFilter({ to: e.target.value })}
            onKeyDown={stop}
          />
        </span>
      </div>
      <div className="field">
        <span>Keyword</span>
        <select value={filter.keyword} onChange={(e) => setFilter({ keyword: e.target.value })}>
          <option value="">Any keyword</option>
          {withCurrent(keywords, filter.keyword).map((k) => (
            <option key={k} value={k}>
              {keywordLabel(k)}
            </option>
          ))}
        </select>
      </div>
      <div className="row between pop-foot">
        <span className="muted small">Search also finds titles, captions and keywords.</span>
        <button className="sm" onClick={() => setFilter(CLEARED)}>
          Clear
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
      <span className="micro">Auto-stack by capture time</span>
      <p className="small muted">
        Photos in this folder taken no more than this far apart become one stack, the first on top.
        Photos already in a stack are left as they are.
      </p>
      <div className="row">
        <input
          type="number"
          min={0.5}
          max={600}
          step={0.5}
          aria-label="Seconds between shots"
          value={seconds}
          onChange={(e) => setSeconds(Math.max(0, Number(e.target.value)))}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') run()
          }}
        />
        <span className="muted">seconds</span>
        <span className="spacer" />
        <button className="primary sm" onClick={run}>
          Stack
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
      label: 'Stack selection',
      hint: `${MOD}G`,
      disabled: targets.length < 2,
      onSelect: () => void lib().stackTargets()
    },
    {
      label: 'Unstack',
      hint: `${SHIFT_MOD}G`,
      disabled: !inStack,
      onSelect: () => void lib().unstackTargets()
    },
    {
      label: stackId && expanded.has(stackId) ? 'Collapse stack' : 'Expand stack',
      hint: 'S',
      disabled: !stackId,
      onSelect: () => stackId && lib().toggleStack(stackId)
    },
    {
      label: 'Make cover',
      hint: 'Shift+S',
      disabled: !stackId || focusItem?.stack?.position === 0,
      onSelect: () => focusItem && void lib().makeCover(focusItem.key)
    },
    {
      label: 'Auto-stack by capture time…',
      disabled: !folder,
      onSelect: () => setOpen('autostack')
    },
    'sep',
    {
      label: 'Add selection to collection…',
      disabled: targets.length === 0 || manual.length === 0,
      onSelect: () => setOpen('collections')
    },
    ...(current?.kind === 'manual'
      ? [
          {
            label: `Remove from ${current.name}`,
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
        title="Stacks and collections"
        aria-expanded={open !== null}
        onClick={() => setOpen(open ? null : 'menu')}
      >
        <Icon name="stack" />
        <span className="lbl">Organise</span>
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
  const t = threshold ?? shown.threshold
  const reopen = (patch: { folder?: string | null; threshold?: number }): void =>
    void openSource({ ...shown, ...patch })
  return (
    <>
      <label
        className="bar-range dup-range"
        title="How different two pictures may be and still count as similar (0: only identical pictures)"
      >
        <span className="micro">Similar</span>
        <span className="bar-track">
          <span className="bar-fill" style={{ width: `${(t / 16) * 100}%` }} />
          <input
            type="range"
            min={0}
            max={16}
            value={t}
            aria-label="Similarity threshold"
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
        <span className="bar-value t-num">{t}</span>
      </label>
      <div className="seg" role="group" aria-label="Where to look">
        <button
          className={shown.folder !== null ? 'on' : ''}
          disabled={!lastFolder}
          title={lastFolder ?? 'Open a folder first'}
          onClick={() => reopen({ folder: lastFolder })}
        >
          This folder
        </button>
        <button
          className={shown.folder === null ? 'on' : ''}
          onClick={() => reopen({ folder: null })}
        >
          Whole library
        </button>
      </div>
    </>
  )
}
