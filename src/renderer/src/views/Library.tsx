import { memo, useEffect, useRef } from 'react'
import type { ColorLabel, LibraryItem } from '../../../shared/ipc'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { Stars } from '../components/ui'
import { Ambient } from '../fx'
import { LABEL_COLOURS } from '../lib/helpers'
import { useThumbFirst } from '../lib/thumbs'
import { IdentityBar } from '../shell/IdentityBar'
import { useDevelop } from '../state/develop'
import { useLibrary, useVisible, type FlagFilter, type SortKey } from '../state/library'

const Thumb = memo(function Thumb({
  item,
  size,
  index,
  onOpen
}: {
  item: LibraryItem
  size: number
  index: number
  onOpen: () => void
}): React.JSX.Element {
  const selected = useLibrary((s) => s.selection.includes(item.key))
  const focus = useLibrary((s) => s.focus === item.key)
  const select = useLibrary((s) => s.select)
  const setMeta = useLibrary((s) => s.setMeta)
  const ref = useRef<HTMLDivElement>(null)
  useThumbFirst(ref, item.key, !item.thumbUrl && !item.unreadable)
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])
  return (
    <div
      ref={ref}
      className={`thumb${selected ? ' selected' : ''}${focus ? ' focus' : ''}${item.flag === 'reject' ? ' rejected' : ''}`}
      style={{
        width: size,
        animationDelay: `${Math.min(index, 24) * 18}ms`,
        // An off-screen tile skips layout at about its real height (picture and caption).
        containIntrinsicSize: `auto ${Math.round(size * 0.72 + 34)}px`
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
        {item.edited && <span className="edited" title="Edited" />}
        {item.copyId && <span className="copy-badge">{item.copyName}</span>}
      </div>
      <div className="thumb-meta">
        <span className="thumb-name" title={item.path}>
          {item.name}
        </span>
        <Stars value={item.rating} onChange={(v) => void setMeta({ rating: v }, [item.key])} />
      </div>
    </div>
  )
})

/** The folder a path names, for the identity bar and the recent list. */
function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function LibraryIdentity(): React.JSX.Element {
  const folder = useLibrary((s) => s.folder)
  const total = useLibrary((s) => s.items.length)
  const edited = useLibrary((s) => s.items.filter((i) => i.edited).length)
  return (
    <IdentityBar
      facts={
        folder ? (
          <>
            {total} photo{total === 1 ? '' : 's'} · {edited} edited
          </>
        ) : undefined
      }
    >
      {folder ? (
        <span className="t-body file-name" title={folder}>
          {folderName(folder)}
        </span>
      ) : (
        <span className="t-body muted">No folder open</span>
      )}
    </IdentityBar>
  )
}

export function Toolbar(): React.JSX.Element {
  const folder = useLibrary((s) => s.folder)
  const recent = useLibrary((s) => s.recent)
  const filter = useLibrary((s) => s.filter)
  const setFilter = useLibrary((s) => s.setFilter)
  const sort = useLibrary((s) => s.sort)
  const setSort = useLibrary((s) => s.setSort)
  const thumbSize = useLibrary((s) => s.thumbSize)
  const setThumbSize = useLibrary((s) => s.setThumbSize)
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  const openFolder = useLibrary((s) => s.openFolder)
  const setDialog = useLibrary((s) => s.setDialog)
  const focus = useLibrary((s) => s.focus)
  const setView = useLibrary((s) => s.setView)
  const open = useDevelop((s) => s.open)
  const count = useVisible().length
  const total = useLibrary((s) => s.items.length)
  const pct = ((thumbSize - 100) / 260) * 100
  return (
    <nav className="toolbar tool-bar library-bar">
      <button className="lg" onClick={() => void chooseFolder()}>
        <Icon name="folder" />
        Open folder
      </button>
      <select
        className="recent"
        value={folder ?? ''}
        onChange={(e) => e.target.value && void openFolder(e.target.value)}
        title="Recent folders"
      >
        <option value="">{folder ? folderName(folder) : 'Recent…'}</option>
        {recent
          .filter((r) => r !== folder)
          .map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
      </select>
      <span className="vsep" />
      <label className="search-field">
        <Icon name="search" />
        <input
          className="search"
          placeholder="Filter by name, camera, lens"
          value={filter.text}
          onChange={(e) => setFilter({ text: e.target.value })}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </label>
      <select
        value={filter.minRating}
        onChange={(e) => setFilter({ minRating: Number(e.target.value) })}
        title="Minimum rating"
      >
        {[0, 1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n === 0 ? 'Any rating' : `≥ ${'★'.repeat(n)}`}
          </option>
        ))}
      </select>
      <select
        value={filter.flag}
        onChange={(e) => setFilter({ flag: e.target.value as FlagFilter })}
        title="Flag"
      >
        <option value="notRejected">Hide rejected</option>
        <option value="all">All flags</option>
        <option value="pick">Picks</option>
        <option value="unflagged">Unflagged</option>
        <option value="reject">Rejected</option>
      </select>
      <select
        value={filter.label ?? 'all'}
        onChange={(e) => setFilter({ label: e.target.value as ColorLabel | 'all' })}
        title="Colour label"
      >
        <option value="all">Any label</option>
        {Object.keys(LABEL_COLOURS).map((l) => (
          <option key={l} value={l}>
            {l[0].toUpperCase() + l.slice(1)}
          </option>
        ))}
      </select>
      <select
        value={filter.edited}
        onChange={(e) => setFilter({ edited: e.target.value as 'all' | 'edited' | 'unedited' })}
        title="Edited"
      >
        <option value="all">Edited or not</option>
        <option value="edited">Edited</option>
        <option value="unedited">Unedited</option>
      </select>
      <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} title="Sort by">
        <option value="name">Name</option>
        <option value="captured">Capture time</option>
        <option value="rating">Rating</option>
        <option value="size">File size</option>
        <option value="edited">Edited first</option>
      </select>
      <span className="spacer" />
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
      <span className="count t-num">
        {count}
        <span className="muted">/{total}</span>
      </span>
      <span className="vsep" />
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

export function LibraryView(): React.JSX.Element {
  const items = useVisible()
  const folder = useLibrary((s) => s.folder)
  const size = useLibrary((s) => s.thumbSize)
  const setView = useLibrary((s) => s.setView)
  const setFocus = useLibrary((s) => s.setFocus)
  const open = useDevelop((s) => s.open)
  if (!folder) return <EmptyLibrary />
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
    >
      {items.map((it, i) => (
        <Thumb
          key={it.key}
          item={it}
          index={i}
          size={size}
          onOpen={() => {
            setFocus(it.key)
            setView('develop')
            void open(it.key)
          }}
        />
      ))}
      {items.length === 0 && <p className="grid-empty">No photos match the filters.</p>}
    </div>
  )
}

/** Counts and the keys that work here. */
export function LibraryStatus(): React.JSX.Element | null {
  const folder = useLibrary((s) => s.folder)
  const count = useVisible().length
  const total = useLibrary((s) => s.items.length)
  const selected = useLibrary((s) => s.selection.length)
  if (!folder) return null
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
        flag <span className="kbd">Enter</span> develop <span className="kbd">Ctrl+Shift+S</span>{' '}
        sync
      </span>
    </footer>
  )
}
