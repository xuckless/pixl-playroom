import { useEffect, useRef } from 'react'
import type { ColorLabel, LibraryItem } from '../../../shared/ipc'
import { Stars } from '../components/ui'
import { LABEL_COLOURS } from '../lib/helpers'
import { useDevelop } from '../state/develop'
import { useLibrary, useVisible, type FlagFilter, type SortKey } from '../state/library'

function Thumb({
  item,
  size,
  onOpen
}: {
  item: LibraryItem
  size: number
  onOpen: () => void
}): React.JSX.Element {
  const selected = useLibrary((s) => s.selection.includes(item.key))
  const focus = useLibrary((s) => s.focus === item.key)
  const select = useLibrary((s) => s.select)
  const setMeta = useLibrary((s) => s.setMeta)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  return (
    <div
      ref={ref}
      className={`thumb ${selected ? 'selected' : ''} ${focus ? 'focus' : ''} ${item.flag === 'reject' ? 'rejected' : ''}`}
      style={{ width: size, height: size + 40 }}
      onClick={(e) =>
        select(item.key, e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'only')
      }
      onDoubleClick={onOpen}
    >
      <div className="thumb-img" style={{ height: size }}>
        {item.thumbUrl ? (
          <img src={item.thumbUrl} draggable={false} />
        ) : (
          <div className="thumb-wait">{item.ext.toUpperCase()}</div>
        )}
        {item.label && (
          <span className="label-dot" style={{ background: LABEL_COLOURS[item.label] }} />
        )}
        {item.flag === 'pick' && <span className="flag pick">⚑</span>}
        {item.flag === 'reject' && <span className="flag reject">✕</span>}
        {item.edited && (
          <span className="edited" title="Edited">
            ✎
          </span>
        )}
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
  const count = useVisible().length
  const total = useLibrary((s) => s.items.length)
  return (
    <div className="toolbar">
      <button onClick={() => void chooseFolder()}>📁 Open folder</button>
      <select
        value={folder ?? ''}
        onChange={(e) => e.target.value && void openFolder(e.target.value)}
        title="Recent folders"
      >
        <option value="">{folder ?? 'Recent…'}</option>
        {recent
          .filter((r) => r !== folder)
          .map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
      </select>
      <span className="spacer" />
      <input
        className="search"
        placeholder="Filter by name, camera, lens"
        value={filter.text}
        onChange={(e) => setFilter({ text: e.target.value })}
        onKeyDown={(e) => e.stopPropagation()}
      />
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
      >
        <option value="all">Any label</option>
        {Object.keys(LABEL_COLOURS).map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
      <select
        value={filter.edited}
        onChange={(e) => setFilter({ edited: e.target.value as 'all' | 'edited' | 'unedited' })}
      >
        <option value="all">Edited or not</option>
        <option value="edited">Edited</option>
        <option value="unedited">Unedited</option>
      </select>
      <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
        <option value="name">Name</option>
        <option value="captured">Capture time</option>
        <option value="rating">Rating</option>
        <option value="size">File size</option>
        <option value="edited">Edited first</option>
      </select>
      <input
        type="range"
        min={100}
        max={360}
        value={thumbSize}
        onChange={(e) => setThumbSize(Number(e.target.value))}
        title="Thumbnail size"
      />
      <span className="muted small">
        {count}/{total}
      </span>
      <button onClick={() => setDialog('export')} title="Export selected (Ctrl+Shift+E)">
        ⤓ Export
      </button>
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
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  if (!folder) {
    return (
      <div className="empty-state">
        <h1>Pixl Playroom</h1>
        <p>
          Open a folder of photos. Nothing is imported or moved; edits live in a sidecar beside each
          photo.
        </p>
        <button className="primary" onClick={() => void chooseFolder()}>
          📁 Open folder
        </button>
      </div>
    )
  }
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}
    >
      {items.map((it) => (
        <Thumb
          key={it.key}
          item={it}
          size={size}
          onOpen={() => {
            setFocus(it.key)
            setView('develop')
            void open(it.key)
          }}
        />
      ))}
      {items.length === 0 && <p className="muted">No photos match the filters.</p>}
    </div>
  )
}

export function Filmstrip(): React.JSX.Element {
  const items = useVisible()
  const focus = useLibrary((s) => s.focus)
  const selection = useLibrary((s) => s.selection)
  const select = useLibrary((s) => s.select)
  const open = useDevelop((s) => s.open)
  return (
    <div className="filmstrip">
      {items.map((it) => (
        <div
          key={it.key}
          className={`film ${it.key === focus ? 'focus' : ''} ${selection.includes(it.key) ? 'selected' : ''}`}
          onClick={(e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey) {
              select(it.key, e.shiftKey ? 'range' : 'toggle')
              return
            }
            select(it.key, 'only')
            void open(it.key)
          }}
          title={it.name}
        >
          {it.thumbUrl ? <img src={it.thumbUrl} draggable={false} /> : <span>{it.ext}</span>}
          {it.rating > 0 && <span className="film-rating">{'★'.repeat(it.rating)}</span>}
        </div>
      ))}
    </div>
  )
}
