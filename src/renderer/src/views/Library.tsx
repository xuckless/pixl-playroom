import { memo, useEffect, useRef } from 'react'
import type { DuplicateGroup, LibraryItem } from '../../../shared/ipc'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { Stars } from '../components/ui'
import { Ambient, Spinner } from '../fx'
import { autoWbBatch } from '../lib/autowb'
import { LABEL_COLOURS, MOD } from '../lib/helpers'
import { folderName, KEYS_MIME, sourceTrail } from '../lib/sources'
import { useThumbFirst } from '../lib/thumbs'
import { IdentityBar } from '../shell/IdentityBar'
import { useDevelop } from '../state/develop'
import { useLibrary, useTargets, useVisible, type SortKey } from '../state/library'
import { useUi } from '../state/ui'
import { DuplicateControls, FilterButton, OrganiseMenu } from './library/ToolbarMenus'

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
  onOpen: () => void
}): React.JSX.Element {
  const selected = useLibrary((s) => s.selection.includes(item.key))
  const focus = useLibrary((s) => s.focus === item.key)
  const select = useLibrary((s) => s.select)
  const setMeta = useLibrary((s) => s.setMeta)
  const toggleStack = useLibrary((s) => s.toggleStack)
  const ref = useRef<HTMLDivElement>(null)
  useThumbFirst(ref, item.key, !item.thumbUrl && !item.unreadable && !item.offline)
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])
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
      style={{
        width: size,
        animationDelay: `${Math.min(index, 24) * 18}ms`,
        // An off-screen tile skips layout at about its real height (picture and caption).
        containIntrinsicSize: `auto ${Math.round(size * 0.72 + (showFolder ? 48 : 34))}px`
      }}
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
      onDoubleClick={onOpen}
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
        {item.copyId && <span className="copy-badge">{item.copyName}</span>}
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
        title={`Sources (${MOD === '⌘' ? '⇧⌘L' : 'Ctrl+Shift+L'} or \\)`}
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
        <select
          className="sort-select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          title="Sort by"
          aria-label="Sort by"
        >
          <option value="name">Name</option>
          <option value="captured">Capture time</option>
          <option value="rating">Rating</option>
          <option value="size">File size</option>
          <option value="edited">Edited first</option>
        </select>
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
        title="Auto white balance on each selected photo (Ctrl+Shift+U)"
        onClick={() => void autoWbBatch(targets)}
      >
        <Icon name="picker" />
        <span className="lbl">Auto WB</span>
      </button>
      <button
        className="lg"
        disabled={!focus}
        title="Develop the focused photo (D)"
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
        title="Export selected (Ctrl+Shift+E)"
      >
        <Icon name="export" />
        Export
      </LiquidGlass>
      <button
        className={`icon lg${info ? ' on' : ''}`}
        title="Info and metadata (I)"
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
        <p>
          There is no import step. Files stay where they are; edits live in a sidecar beside each
          photo, and the engine renders thumbnails from a RAW&apos;s embedded preview until it is
          edited.
        </p>
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

export function LibraryView(): React.JSX.Element {
  const items = useVisible()
  const source = useLibrary((s) => s.source)
  const opening = useLibrary((s) => s.opening)
  const groups = useLibrary((s) => s.groups)
  const expanded = useLibrary((s) => s.expandedStacks)
  const total = useLibrary((s) => s.items.length)
  const size = useLibrary((s) => s.thumbSize)
  const setView = useLibrary((s) => s.setView)
  const setFocus = useLibrary((s) => s.setFocus)
  const open = useDevelop((s) => s.open)
  if (!source && !opening) return <EmptyLibrary />
  if (opening?.kind === 'duplicates' && source?.kind !== 'duplicates')
    return (
      <div className="grid-wait">
        <Spinner size={22} />
        <p>Looking for duplicates… the first look reads every picture, so it takes a while.</p>
      </div>
    )
  const showFolder = source?.kind !== 'folder'
  const roles = stackRoles(items, expanded)
  let index = 0
  const tile = (it: LibraryItem, group?: number): React.JSX.Element => {
    const role = groups ? undefined : roles.get(it.key)
    return (
      <Thumb
        key={group === undefined ? it.key : `${group}:${it.key}`}
        item={it}
        index={index++}
        size={size}
        showFolder={showFolder}
        stackId={role?.id ?? null}
        stackSize={role?.size ?? 0}
        stackCover={role?.cover ?? false}
        stackOpen={role?.open ?? false}
        onOpen={() => {
          setFocus(it.key)
          setView('develop')
          void open(it.key)
        }}
      />
    )
  }
  return (
    <div
      className={`grid${opening ? ' loading' : ''}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
    >
      {groups
        ? duplicateSections(groups, items).map(({ group, items: members }, g) => (
            <section key={group.keys.join(',')} className="dupe-group" role="group">
              <header className="dupe-head">
                <span className={`badge${group.kind === 'exact' ? '' : ' ghost'}`}>
                  {group.kind === 'exact' ? 'Exact' : 'Similar'}
                </span>
                <span className="t-num">
                  {members.length} photos
                  {group.kind === 'near' && group.distance !== undefined
                    ? ` · distance ≤ ${group.distance}`
                    : ' · same file contents'}
                </span>
                <span className="line" />
              </header>
              {members.map((it) => tile(it, g))}
            </section>
          ))
        : items.map((it) => tile(it))}
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
        <span className="kbd">P</span> <span className="kbd">X</span> <span className="kbd">U</span>{' '}
        flag <span className="kbd">{MOD}G</span> stack <span className="kbd">I</span> info{' '}
        <span className="kbd">Enter</span> develop <span className="kbd">Ctrl+Shift+S</span> sync
      </span>
    </footer>
  )
}
