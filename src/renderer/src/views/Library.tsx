import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DuplicateGroup, LibraryItem } from '../../../shared/ipc'
import { GlassSelect } from '../components/GlassSelect'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { Stars } from '../components/ui'
import { Ambient, Spinner } from '../fx'
import { api } from '../lib/api'
import { autoWbBatch } from '../lib/autowb'
import { LABEL_COLOURS } from '../lib/helpers'
import { folderName, KEYS_MIME, sourceTrail } from '../lib/sources'
import { useThumbFirst } from '../lib/thumbs'
import { IdentityBar } from '../shell/IdentityBar'
import { useDevelop } from '../state/develop'
import { selectionSet, useLibrary, useTargets, useVisible, type SortKey } from '../state/library'
import { useUi } from '../state/ui'
import { DuplicateControls, FilterButton, OrganiseMenu } from './library/ToolbarMenus'
import { keyHint, withKey } from '../lib/commands'
import { useEntering } from '../lib/hooks'

/** A tile's part in a stack: the cover (collapsed or open), or a member of an open one. */
interface StackRole {
  id: string
  size: number
  cover: boolean
  open: boolean
}

const Thumb = memo(function Thumb({
  item,
  size,
  index,
  showFolder,
  stackId,
  stackSize,
  stackCover,
  stackOpen,
  onOpen
}: {
  item: LibraryItem
  size: number
  index: number
  /** The source spans folders: name the folder under the file. */
  showFolder: boolean
  stackId: string | null
  stackSize: number
  stackCover: boolean
  stackOpen: boolean
  onOpen: (key: string) => void
}): React.JSX.Element {
  const selected = useLibrary((s) => selectionSet(s.selection).has(item.key))
  const focus = useLibrary((s) => s.focus === item.key)
  const select = useLibrary((s) => s.select)
  const setMeta = useLibrary((s) => s.setMeta)
  const toggleStack = useLibrary((s) => s.toggleStack)
  const ref = useRef<HTMLDivElement>(null)
  useThumbFirst(ref, item.key, !item.thumbUrl && !item.unreadable && !item.offline)
  const cls = [
    'thumb',
    selected && 'selected',
    focus && 'focus',
    item.flag === 'reject' && 'rejected',
    item.offline && 'offline',
    stackId && !stackOpen && 'stack-closed',
    stackId && stackOpen && 'in-stack',
    stackId && stackOpen && stackCover && 'stack-cover'
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div
      ref={ref}
      className={cls}
      style={{ width: size, animationDelay: `${Math.min(index, 24) * 18}ms` }}
      draggable
      onDragStart={(e) => {
        // Dragging a selected photo drags the selection; any other, just itself.
        const sel = useLibrary.getState().selection
        const keys = sel.includes(item.key) ? sel : [item.key]
        e.dataTransfer.setData(KEYS_MIME, JSON.stringify(keys))
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={(e) =>
        select(item.key, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'only')
      }
      onDoubleClick={() => onOpen(item.key)}
    >
      <div className="thumb-img" style={{ height: size * 0.72 }}>
        {item.thumbUrl ? (
          <img src={item.thumbUrl} loading="lazy" decoding="async" draggable={false} alt="" />
        ) : item.unreadable ? (
          <div className="thumb-wait unreadable" title="This file cannot be read">
            Can’t read
          </div>
        ) : item.offline ? (
          <div className="thumb-wait unreadable">{item.ext.toUpperCase()}</div>
        ) : (
          <div className="thumb-wait">{item.ext.toUpperCase()}</div>
        )}
        {item.label && (
          <span
            className="label-dot"
            title={`Label: ${item.label}`}
            style={{ background: LABEL_COLOURS[item.label], color: LABEL_COLOURS[item.label] }}
          />
        )}
        {item.flag === 'pick' && <span className="flag pick">PICK</span>}
        {item.flag === 'reject' && <span className="flag reject">✕</span>}
        {item.offline && (
          <span className="offline-badge" title={`Not found at ${item.path}`}>
            Offline
          </span>
        )}
        {item.edited && <span className="edited" title="Edited" />}
        {item.project && (
          <button
            className="project-badge"
            title={`Its edits and history are in ${item.project} — click to show it`}
            onClick={(e) => {
              e.stopPropagation()
              void api.app.reveal(item.project!).catch(() => undefined)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            .pixl
          </button>
        )}
        {item.copyId && <span className="copy-badge">{item.copyName}</span>}
        {item.hdr && (
          <span
            className="hdr-badge"
            title={
              item.hdr === 'gainmap'
                ? 'HDR: an SDR picture with a gain map (edit it as HDR in Develop)'
                : `HDR: ${item.hdr === 'pq' ? 'PQ' : 'HLG'}`
            }
          >
            HDR
          </span>
        )}
        {stackId && stackCover && (
          <button
            className={`stack-badge t-num${stackOpen ? ' open' : ''}`}
            title={`${stackOpen ? 'Collapse' : 'Expand'} this stack of ${stackSize} (S)`}
            aria-expanded={stackOpen}
            onClick={(e) => {
              e.stopPropagation()
              toggleStack(stackId)
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Icon name="stack" />
            {stackSize}
          </button>
        )}
      </div>
      <div className="thumb-meta">
        <span className="thumb-names">
          <span className="thumb-name" title={item.path}>
            {item.name}
          </span>
          {showFolder && (
            <span className="thumb-folder" title={item.folder}>
              {folderName(item.folder)}
            </span>
          )}
        </span>
        <Stars value={item.rating} onChange={(v) => void setMeta({ rating: v }, [item.key])} />
      </div>
    </div>
  )
})

export function LibraryIdentity(): React.JSX.Element {
  const source = useLibrary((s) => s.source)
  const collections = useLibrary((s) => s.collections)
  const total = useLibrary((s) => s.items.length)
  const edited = useLibrary((s) => s.items.filter((i) => i.edited).length)
  const trail = source ? sourceTrail(source, collections) : []
  return (
    <IdentityBar
      facts={
        source ? (
          <>
            {total} photo{total === 1 ? '' : 's'} · {edited} edited
          </>
        ) : undefined
      }
    >
      {source ? (
        <span
          className="t-body file-name trail"
          title={source.kind === 'folder' ? source.path : trail.join(' › ')}
        >
          {trail.map((t, i) => (
            <span key={i} className={i === trail.length - 1 ? 'here' : 'muted'}>
              {i > 0 && <span className="sep">›</span>}
              {t}
            </span>
          ))}
        </span>
      ) : (
        <span className="t-body muted">Nothing open</span>
      )}
    </IdentityBar>
  )
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'captured', label: 'Capture time' },
  { value: 'added', label: 'Date added' },
  { value: 'rating', label: 'Rating' },
  { value: 'size', label: 'File size' },
  { value: 'edited', label: 'Edited first' }
]

export function Toolbar(): React.JSX.Element {
  const filter = useLibrary((s) => s.filter)
  const setFilter = useLibrary((s) => s.setFilter)
  const sort = useLibrary((s) => s.sort)
  const setSort = useLibrary((s) => s.setSort)
  const thumbSize = useLibrary((s) => s.thumbSize)
  const setThumbSize = useLibrary((s) => s.setThumbSize)
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  const setDialog = useLibrary((s) => s.setDialog)
  const focus = useLibrary((s) => s.focus)
  const dupes = useLibrary((s) => (s.opening ?? s.source)?.kind === 'duplicates')
  const source = useLibrary((s) => s.source)
  const openSource = useLibrary((s) => s.openSource)
  const setSubfolders = useUi((s) => s.setSubfolders)
  const sidebar = useUi((s) => s.librarySidebar)
  const setSidebar = useUi((s) => s.setLibrarySidebar)
  const info = useUi((s) => s.libraryInfo)
  const setInfo = useUi((s) => s.setLibraryInfo)
  const targets = useTargets()
  const setView = useLibrary((s) => s.setView)
  const open = useDevelop((s) => s.open)
  const count = useVisible().length
  const total = useLibrary((s) => s.items.length)
  const pct = ((thumbSize - 100) / 260) * 100
  return (
    <nav className={`toolbar tool-bar library-bar${dupes ? ' dupes' : ''}`}>
      <button
        className={`icon lg${sidebar ? ' on' : ''}`}
        title={withKey('Sources', 'library.sidebar')}
        aria-label="Show the sources"
        aria-pressed={sidebar}
        onClick={() => setSidebar(!sidebar)}
      >
        <Icon name="sidebar" />
      </button>
      <button
        className="icon lg"
        title="Open folder…"
        aria-label="Open folder"
        onClick={() => void chooseFolder()}
      >
        <Icon name="folder" />
      </button>
      {source?.kind === 'folder' && (
        <button
          className={`lg subfolders${source.deep ? ' on' : ''}`}
          aria-pressed={!!source.deep}
          title={
            source.deep
              ? 'Showing the photos in its subfolders too: show this folder’s own'
              : 'Show the photos in its subfolders too'
          }
          onClick={() => {
            const deep = !source.deep
            // How folders open from now on, too.
            setSubfolders(deep)
            void openSource({ kind: 'folder', path: source.path, ...(deep ? { deep } : {}) })
          }}
        >
          <Icon name="stack" />
          Subfolders
        </button>
      )}
      <span className="vsep" />
      <label className="search-field">
        <Icon name="search" />
        <input
          className="search"
          placeholder="Search names, titles, keywords, camera"
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>
      <FilterButton />
      {!dupes && (
        <GlassSelect<SortKey>
          className="lg sort-select"
          label="Sort by"
          prefix="Sort"
          value={sort}
          options={SORTS}
          onChange={setSort}
        />
      )}
      <span className="spacer" />
      {dupes ? (
        <DuplicateControls />
      ) : (
        <label className="bar-range size-range" title="Thumbnail size">
          <Icon name="library" />
          <span className="bar-track">
            <span className="bar-fill" style={{ width: `${pct}%` }} />
            <input
              type="range"
              min={100}
              max={360}
              value={thumbSize}
              onChange={(e) => setThumbSize(Number(e.target.value))}
              onKeyDown={(e) => e.stopPropagation()}
            />
          </span>
        </label>
      )}
      <span className="count t-num">
        {count}
        <span className="muted">/{total}</span>
      </span>
      <span className="vsep" />
      <OrganiseMenu />
      <button
        className="lg"
        disabled={targets.length === 0}
        title={withKey('Auto white balance on each selected photo', 'autoWbBatch')}
        onClick={() => void autoWbBatch(targets)}
      >
        <Icon name="picker" />
        <span className="lbl">Auto WB</span>
      </button>
      <button
        className="lg"
        disabled={!focus}
        title={withKey('Develop the focused photo', 'library.develop')}
        onClick={() => {
          if (!focus) return
          setView('develop')
          void open(focus)
        }}
      >
        Develop <span className="kbd">D</span>
      </button>
      <LiquidGlass
        as="button"
        className="primary lg"
        flat
        onClick={() => setDialog('export')}
        title={withKey('Export selected', 'export')}
      >
        <Icon name="export" />
        Export
      </LiquidGlass>
      <button
        className={`icon lg${info ? ' on' : ''}`}
        title={withKey('Info and metadata', 'library.info')}
        aria-label="Show info"
        aria-pressed={info}
        onClick={() => setInfo(!info)}
      >
        <Icon name="info" />
      </button>
    </nav>
  )
}

function EmptyLibrary(): React.JSX.Element {
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  const openFolder = useLibrary((s) => s.openFolder)
  const recent = useLibrary((s) => s.recent)
  return (
    <div className="empty-library">
      <Ambient />
      <LiquidGlass className="empty-card" radius={2} bezel={14} strength={0.8}>
        <span className="micro accent">Library</span>
        <h1>Open a folder of photographs.</h1>
        <p>There is no import step: your photos stay where they are.</p>
        <div className="row">
          <button className="primary lg" onClick={() => void chooseFolder()}>
            <Icon name="folder" />
            Choose folder…
          </button>
        </div>
        {recent.length > 0 && (
          <>
            <div className="rule" />
            <span className="micro">Recent</span>
            <div className="stagger recent-list">
              {recent.slice(0, 6).map((r) => (
                <div
                  key={r}
                  role="button"
                  tabIndex={0}
                  className="rail-item"
                  title={r}
                  onClick={() => void openFolder(r)}
                  onKeyDown={(e) => e.key === 'Enter' && void openFolder(r)}
                >
                  <span className="rail-label">
                    <i className="dot" />
                    {folderName(r)}
                  </span>
                  <span className="t">{r.replace(folderName(r), '').slice(-38)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </LiquidGlass>
    </div>
  )
}

/** Each visible stack's part for its tiles: the first tile of a stack is its cover. */
function stackRoles(items: LibraryItem[], expanded: Set<string>): Map<string, StackRole> {
  const roles = new Map<string, StackRole>()
  const seen = new Set<string>()
  for (const it of items) {
    if (!it.stack) continue
    const id = it.stack.id
    roles.set(it.key, { id, size: it.stack.size, cover: !seen.has(id), open: expanded.has(id) })
    seen.add(id)
  }
  return roles
}

/**
 * The duplicates' groups over what the filters let through. A photo can be
 * in two groups (an exact copy that is also near a third): it shows in both,
 * and a group the filters leave one photo of is no group.
 */
function duplicateSections(
  groups: DuplicateGroup[],
  items: LibraryItem[]
): { group: DuplicateGroup; items: LibraryItem[] }[] {
  const byKey = new Map(items.map((i) => [i.key, i]))
  return groups
    .map((group) => ({
      group,
      items: group.keys.filter((k) => byKey.has(k)).map((k) => byKey.get(k) as LibraryItem)
    }))
    .filter((s) => s.items.length > 1)
}

/** The grid's spacing (as `.grid` and `.grid-row` lay it out). */
const GRID_GAP = 16
const GRID_PAD_X = 22

/** A row of the grid: a duplicate group's heading, or a row of tiles. */
type GridRow =
  | { kind: 'head'; key: string; group: DuplicateGroup; count: number; first: boolean }
  | { kind: 'tiles'; key: string; items: LibraryItem[]; group?: number; start: number }

/** The grid as rows of `cols` tiles (each duplicate group starting a row under its heading). */
function gridRows(items: LibraryItem[], groups: DuplicateGroup[] | null, cols: number): GridRow[] {
  const rows: GridRow[] = []
  let start = 0
  const tiles = (list: LibraryItem[], group?: number): void => {
    for (let i = 0; i < list.length; i += cols) {
      const part = list.slice(i, i + cols)
      rows.push({
        kind: 'tiles',
        key: `${group ?? ''}:${part[0].key}`,
        items: part,
        group,
        start
      })
      start += part.length
    }
  }
  if (!groups) tiles(items)
  else
    duplicateSections(groups, items).forEach(({ group, items: members }, g) => {
      rows.push({
        kind: 'head',
        key: `head:${group.keys.join(',')}`,
        group,
        count: members.length,
        first: g === 0
      })
      tiles(members, g)
    })
  return rows
}

/**
 * The library grid, virtualised: only the rows in view (and a few either
 * side) are in the page, whatever the folder holds. Columns are worked out
 * as `auto-fill` did: as many tiles of at least the chosen size as fit.
 */
export function LibraryView(): React.JSX.Element {
  const items = useVisible()
  const source = useLibrary((s) => s.source)
  const opening = useLibrary((s) => s.opening)
  const groups = useLibrary((s) => s.groups)
  const expanded = useLibrary((s) => s.expandedStacks)
  const total = useLibrary((s) => s.items.length)
  const size = useLibrary((s) => s.thumbSize)
  const focus = useLibrary((s) => s.focus)
  const sort = useLibrary((s) => s.sort)
  const setView = useLibrary((s) => s.setView)
  const setFocus = useLibrary((s) => s.setFocus)
  const open = useDevelop((s) => s.open)
  // One callback for every tile (a new one per tile per render undid their memo).
  const openTile = useCallback(
    (key: string): void => {
      setFocus(key)
      setView('develop')
      void open(key)
    },
    [setFocus, setView, open]
  )
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const waiting = !source && !opening
  const dupesLoading = opening?.kind === 'duplicates' && source?.kind !== 'duplicates'
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [waiting, dupesLoading])
  const cols = Math.max(1, Math.floor((width - 2 * GRID_PAD_X + GRID_GAP) / (size + GRID_GAP)))
  const rows = useMemo(() => gridRows(items, groups, cols), [items, groups, cols])
  // Photos from more than one folder say which: a collection's, or a folder's with its subfolders.
  const showFolder = source?.kind !== 'folder' || !!source.deep
  const tileHeight = Math.round(size * 0.72 + (showFolder ? 48 : 34)) + 2
  // The virtualiser is mutable by design (it re-renders this on scroll): the
  // compiler lint's warning about it does not apply to a build without it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => (rows[i]?.kind === 'head' ? 44 : tileHeight + GRID_GAP),
    getItemKey: (i) => rows[i]?.key ?? i,
    overscan: 3,
    paddingStart: 20,
    paddingEnd: 12
  })
  // The focused photo kept in view (it may be rows away, not in the page at
  // all) when the focus moves, and once the grid knows its columns (coming
  // back from Develop, its first layout has none: placed then, the photo's
  // row is reckoned one photo per row, far down); not when the rows change
  // under it (a thumbnail arriving), which would pull the grid back from a
  // scroll. The first time it is centred, after that only brought into view.
  const rowsNow = useRef(rows)
  useEffect(() => {
    rowsNow.current = rows
  }, [rows])
  const placed = useRef(false)
  const laidOut = width > 0
  useEffect(() => {
    if (!focus || !laidOut) return
    const i = rowsNow.current.findIndex(
      (r) => r.kind === 'tiles' && r.items.some((it) => it.key === focus)
    )
    if (i < 0) return
    virtual.scrollToIndex(i, { align: placed.current ? 'auto' : 'center' })
    placed.current = true
  }, [focus, virtual, laidOut, cols])
  // A new order starts at its top: where the sort puts its first photos.
  const sortNow = useRef(sort)
  useEffect(() => {
    if (sortNow.current === sort) return
    sortNow.current = sort
    virtual.scrollToOffset(0)
  }, [sort, virtual])
  const entering = useEntering(source)
  if (waiting) return <EmptyLibrary />
  if (dupesLoading)
    return (
      <div className="grid-wait">
        <Spinner size={22} />
        <p>Looking for duplicates… the first look reads every picture, so it takes a while.</p>
      </div>
    )
  const roles = stackRoles(items, expanded)
  const tile = (it: LibraryItem, index: number, group?: number): React.JSX.Element => {
    const role = groups ? undefined : roles.get(it.key)
    return (
      <Thumb
        key={group === undefined ? it.key : `${group}:${it.key}`}
        item={it}
        index={index}
        size={size}
        showFolder={showFolder}
        stackId={role?.id ?? null}
        stackSize={role?.size ?? 0}
        stackCover={role?.cover ?? false}
        stackOpen={role?.open ?? false}
        onOpen={openTile}
      />
    )
  }
  return (
    <div
      ref={scroller}
      className={`grid${opening ? ' loading' : ''}${entering ? ' entering' : ''}`}
    >
      <div className="grid-space" style={{ height: virtual.getTotalSize() }}>
        {virtual.getVirtualItems().map((v) => {
          const row = rows[v.index]
          if (row.kind === 'head')
            return (
              <header
                key={v.key}
                data-index={v.index}
                ref={virtual.measureElement}
                className={`dupe-head${row.first ? ' first' : ''}`}
                style={{ transform: `translateY(${v.start}px)` }}
              >
                <span className={`badge${row.group.kind === 'exact' ? '' : ' ghost'}`}>
                  {row.group.kind === 'exact' ? 'Exact' : 'Similar'}
                </span>
                <span className="t-num">
                  {row.count} photos
                  {row.group.kind === 'near' && row.group.distance !== undefined
                    ? ` · distance ≤ ${row.group.distance}`
                    : ' · same file contents'}
                </span>
                <span className="line" />
              </header>
            )
          return (
            <div
              key={v.key}
              data-index={v.index}
              ref={virtual.measureElement}
              className="grid-row"
              style={{
                transform: `translateY(${v.start}px)`,
                gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`
              }}
            >
              {row.items.map((it, i) => tile(it, row.start + i, row.group))}
            </div>
          )
        })}
      </div>
      {items.length === 0 && (
        <p className="grid-empty">
          {groups
            ? groups.length === 0
              ? 'No duplicates here. Raise “Similar” to find looser matches.'
              : 'No duplicates match the filters.'
            : source?.kind === 'collection' && total === 0
              ? 'This collection is empty. Drag photos onto it in the sidebar to add them.'
              : 'No photos match the filters.'}
        </p>
      )}
    </div>
  )
}

/** Counts and the keys that work here. */
export function LibraryStatus(): React.JSX.Element | null {
  const source = useLibrary((s) => s.source)
  const count = useVisible().length
  const total = useLibrary((s) => s.items.length)
  const selected = useLibrary((s) => s.selection.length)
  if (!source) return null
  return (
    <footer className="status-bar">
      <span className="t-num">
        {count} of {total} shown
        {selected > 1 ? ` · ${selected} selected` : ''}
      </span>
      <span className="spacer" />
      <span className="keys">
        <span className="kbd">0–5</span> rate <span className="kbd">6–9</span> label{' '}
        <span className="kbd">{keyHint('flag.pick')}</span>{' '}
        <span className="kbd">{keyHint('flag.reject')}</span>{' '}
        <span className="kbd">{keyHint('flag.clear')}</span> flag{' '}
        <span className="kbd">{keyHint('library.stack')}</span> stack{' '}
        <span className="kbd">{keyHint('library.info')}</span> info{' '}
        <span className="kbd">{keyHint('library.develop')}</span> develop{' '}
        <span className="kbd">{keyHint('sync')}</span> sync
      </span>
    </footer>
  )
}
