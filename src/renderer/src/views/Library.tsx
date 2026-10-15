import { rebuild, usePipeline } from '../lib/pipeline'
import { useFit } from '../lib/useFit'
import { olderDevelop } from '../../../shared/rebuild'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { DuplicateGroup, LibraryItem } from '../../../shared/ipc'
import { GlassSelect } from '../components/GlassSelect'
import { LiquidGlass } from '../components/glass/LiquidGlass'
import { Icon } from '../components/icons'
import { Slider, Stars } from '../components/ui'
import { Ambient, Spinner } from '../fx'
import { api, errorText } from '../lib/api'
import { autoWbBatch } from '../lib/autowb'
import { choosePhotos } from '../lib/openPhotos'
import { LABEL_COLOURS } from '../lib/helpers'
import { folderName, KEYS_MIME, sourceTrail } from '../lib/sources'
import { gridTakesFocus } from '../lib/roving'
import { useThumbFirst } from '../lib/thumbs'
import { IdentityBar } from '../shell/IdentityBar'
import { useDevelop } from '../state/develop'
import { suggestedReasons, useCull } from '../state/cull'
import {
  selectionSet,
  useHiddenByFilter,
  useLibrary,
  useShownCount,
  useTargets,
  useVisible,
  type SortKey
} from '../state/library'
import { useUi } from '../state/ui'
import { DuplicateControls, OrganiseMenu } from './library/ToolbarMenus'
import { SearchField } from './library/FilterBar'
import { goDevelop, goMode, toggleAutoAdvance, useCapsLock } from '../lib/librarymodes'
import type { LibraryMode } from '../../../shared/cullnav'
import { keyHint, useKeyHint, withKey } from '../lib/commands'
import { useEntering } from '../lib/hooks'
import { photoContextMenu } from '../lib/menus'
import { setGridLayout } from '../lib/librarycontext'
import { t, tk, tp } from '../lib/i18n'
import { editedCount } from '../lib/visiblepatch'

/** A colour label's name, to show (the label itself is the key). */
const LABEL_NAME: Record<string, string> = {
  red: tk('Red'),
  yellow: tk('Yellow'),
  green: tk('Green'),
  blue: tk('Blue'),
  purple: tk('Purple')
}

/**
 * Whether keyboard focus is in the grid: the focused photo then takes it as
 * the arrows move the focus (a tile scrolled out of the page drops it, and
 * the next one picks it up; never from a field or button elsewhere).
 */
let gridFocused = false

/** What a tile says to a screen reader: its name, rating, flag and label. */
function tileLabel(item: LibraryItem): string {
  const parts = [item.name]
  if (item.rating > 0) parts.push(tp('{{count}} star', '{{count}} stars', item.rating))
  if (item.flag === 'pick') parts.push(t('Picked'))
  if (item.flag === 'reject') parts.push(t('Rejected'))
  if (item.label && LABEL_NAME[item.label]) parts.push(t(LABEL_NAME[item.label]))
  if (item.edited) parts.push(t('Edited'))
  return parts.join(', ')
}

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
  // With no photo focused, the first takes the grid's stop.
  const stop = useLibrary((s) => (s.focus === null && index === 0) || s.focus === item.key)
  const select = useLibrary((s) => s.select)
  const setMeta = useLibrary((s) => s.setMeta)
  const toggleStack = useLibrary((s) => s.toggleStack)
  // A suggested reject (Pass 115): dimmed and grey, its colour and reason back on hover.
  const cull = useCull((s) => suggestedReasons(item, s.reasons))
  // The filter now hides it, but it has the focus: it stays, dimmed, until the focus moves on.
  const hidden = useHiddenByFilter(item)
  // Edited with an earlier develop, where today's pipeline has a newer one (shared/rebuild.ts).
  const older = usePipeline((p) => !!item.legacy && olderDevelop(item.legacy, item.isRaw, p))
  const ref = useRef<HTMLDivElement>(null)
  useThumbFirst(ref, item.key, !item.thumbUrl && !item.unreadable && !item.offline)
  useEffect(() => {
    const el = ref.current
    const at = document.activeElement
    if (
      focus &&
      el &&
      !el.contains(at) &&
      gridTakesFocus(gridFocused, !at || at === document.body, !!at?.closest('.grid'))
    )
      el.focus({ preventScroll: true })
  }, [focus])
  const cls = [
    'thumb',
    selected && 'selected',
    focus && 'focus',
    item.flag === 'reject' && 'rejected',
    item.offline && 'offline',
    cull && 'culled',
    hidden && 'filtered-out',
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
      role="gridcell"
      aria-selected={selected}
      aria-label={tileLabel(item)}
      // One stop for the grid: the focused photo; the arrows move it.
      tabIndex={stop ? 0 : -1}
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
      onContextMenu={(e) => photoContextMenu(e, item.key)}
    >
      <div className="thumb-img" style={{ height: size * 0.72 }}>
        {item.thumbUrl ? (
          <img src={item.thumbUrl} loading="lazy" decoding="async" draggable={false} alt="" />
        ) : item.unreadable ? (
          <div className="thumb-wait unreadable" title={t('This file cannot be read')}>
            {t('Can’t read')}
          </div>
        ) : item.offline ? (
          <div className="thumb-wait unreadable">{item.ext.toUpperCase()}</div>
        ) : (
          <div className="thumb-wait">{item.ext.toUpperCase()}</div>
        )}
        {item.label && (
          <span
            className="label-dot"
            title={t('Label: {{label}}', {
              label: LABEL_NAME[item.label] ? t(LABEL_NAME[item.label]) : item.label
            })}
            style={{ background: LABEL_COLOURS[item.label], color: LABEL_COLOURS[item.label] }}
          />
        )}
        {item.flag === 'pick' && <span className="flag pick">{t('PICK')}</span>}
        {item.flag === 'reject' && <span className="flag reject">✕</span>}
        {item.offline && (
          <span className="offline-badge" title={t('Not found at {{path}}', { path: item.path })}>
            {t('Offline')}
          </span>
        )}
        {hidden && (
          <span
            className="filtered-badge"
            title={t('The filters hide this photo; it goes when you move on')}
          >
            {t('Hidden by filter')}
          </span>
        )}
        {item.edited && <span className="edited" title={t('Edited')} />}
        {older && (
          <button
            type="button"
            className="older-badge"
            title={t(
              'Edited with an earlier develop: rebuild it with the PIXL demosaic and PIXL Enhance (a Version of it as it is is kept)'
            )}
            onClick={(e) => {
              e.stopPropagation()
              void rebuild([item.key]).catch((err) =>
                useLibrary.getState().say(errorText(err), 'error')
              )
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {t('Older develop')}
          </button>
        )}
        {cull && (
          <div className="cull-why" onDoubleClick={(e) => e.stopPropagation()}>
            <span className="cull-label micro">{t('Suggested reject')}</span>
            {cull.map((r) => (
              <span key={r.kind} className="cull-reason">
                {r.text}
              </span>
            ))}
            <span className="cull-acts">
              <button
                className="sm"
                title={t('Keep it: never suggested again')}
                onClick={(e) => {
                  e.stopPropagation()
                  void useCull.getState().keep([item.key])
                }}
              >
                {t('Keep')}
              </button>
              <button
                className="sm ghost"
                title={t('Reject it (X): nothing is deleted')}
                onClick={(e) => {
                  e.stopPropagation()
                  void setMeta({ flag: 'reject' }, [item.key])
                }}
              >
                {t('Reject')}
              </button>
            </span>
          </div>
        )}
        {item.project && (
          <button
            className="project-badge"
            title={t('Its edits and history are in {{project}} — click to show it', {
              project: item.project
            })}
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
                ? t('HDR: an SDR picture with a gain map (edit it as HDR in Develop)')
                : `HDR: ${item.hdr === 'pq' ? 'PQ' : 'HLG'}`
            }
          >
            HDR
          </span>
        )}
        {stackId && stackCover && (
          <button
            className={`stack-badge t-num${stackOpen ? ' open' : ''}`}
            title={
              stackOpen
                ? t('Collapse this stack of {{size}} (S)', { size: stackSize })
                : t('Expand this stack of {{size}} (S)', { size: stackSize })
            }
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
        <Stars
          compact
          value={item.rating}
          onChange={(v) => void setMeta({ rating: v }, [item.key])}
        />
      </div>
    </div>
  )
})

export function LibraryIdentity(): React.JSX.Element {
  const source = useLibrary((s) => s.source)
  const collections = useLibrary((s) => s.collections)
  const total = useLibrary((s) => s.items.length)
  // Counted once per list, not on every change to the library's state.
  const edited = useLibrary((s) => editedCount(s.items))
  const trail = source ? sourceTrail(source, collections) : []
  return (
    <IdentityBar
      facts={
        source ? (
          <>
            {tp('{{count}} photo', '{{count}} photos', total)} ·{' '}
            {t('{{count}} edited', { count: edited })}
          </>
        ) : undefined
      }
    >
      {source ? (
        <span
          className="t-body file-name trail"
          title={source.kind === 'folder' ? source.path : trail.join(' › ')}
        >
          {trail.map((part, i) => (
            <span key={i} className={i === trail.length - 1 ? 'here' : 'muted'}>
              {i > 0 && <span className="sep">›</span>}
              {part}
            </span>
          ))}
        </span>
      ) : (
        <span className="t-body muted">{t('Nothing open')}</span>
      )}
      {source?.kind === 'photos' && <ShowFolder />}
    </IdentityBar>
  )
}

/** Photos opened on their own: their folder, whole, a click away (the focused photo's). */
function ShowFolder(): React.JSX.Element | null {
  const shown = useLibrary((s) => s.items.find((i) => i.key === s.focus) ?? s.items[0] ?? null)
  const openFolder = useLibrary((s) => s.openFolder)
  const folder = shown?.folder ?? null
  if (!folder || !shown) return null
  return (
    <button
      className="sm ghost"
      title={folder}
      onClick={() => {
        // The photo it was opened for stays the one selected among its folder's.
        void openFolder(folder).then(() => {
          if (useLibrary.getState().items.some((i) => i.key === shown.key))
            useLibrary.setState({ selection: [shown.key], focus: shown.key })
        })
      }}
    >
      <Icon name="folder" />
      {t('Show folder')}
    </button>
  )
}

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'name', label: tk('Name') },
  { value: 'captured', label: tk('Capture time') },
  { value: 'added', label: tk('Date added') },
  { value: 'rating', label: tk('Rating') },
  { value: 'size', label: tk('File size') },
  { value: 'edited', label: tk('Edited first') }
]

/** The Library's views of its photos, as the toolbar's segment and the View menu offer them. */
const MODES: { mode: LibraryMode; label: string; command: string }[] = [
  { mode: 'grid', label: tk('Grid'), command: 'library.grid' },
  { mode: 'loupe', label: tk('Loupe'), command: 'library.loupe' },
  { mode: 'compare', label: tk('Compare'), command: 'library.compare' },
  { mode: 'survey', label: tk('Survey'), command: 'library.survey' }
]

/** Grid, Loupe, Compare and Survey: the toolbar's segment. */
function ModeSegment(): React.JSX.Element {
  const mode = useLibrary((s) => s.mode)
  const hint = useKeyHint()
  return (
    <div className="seg lg mode-seg" role="radiogroup" aria-label={t('View')}>
      {MODES.map((m) => (
        <button
          key={m.mode}
          role="radio"
          aria-checked={mode === m.mode}
          className={mode === m.mode ? 'on' : ''}
          title={`${t(m.label)} (${hint(m.command)})`}
          onClick={() => goMode(m.mode)}
        >
          {t(m.label)}
        </button>
      ))}
    </div>
  )
}

export function Toolbar(): React.JSX.Element {
  const bar = useFit(4)
  const mode = useLibrary((s) => s.mode)
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
  // A photo kept only while it has the focus (sticky hide) is not counted as shown.
  const count = useShownCount()
  const total = useLibrary((s) => s.items.length)
  return (
    <nav ref={bar} className={`toolbar tool-bar library-bar${dupes ? ' dupes' : ''}`}>
      <button
        className={`icon lg${sidebar ? ' on' : ''}`}
        title={withKey(t('Sources'), 'library.sidebar')}
        aria-label={t('Show the sources')}
        aria-pressed={sidebar}
        onClick={() => setSidebar(!sidebar)}
      >
        <Icon name="sidebar" />
      </button>
      <button
        className="icon lg"
        title={t('Open folder…')}
        aria-label={t('Open folder')}
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
              ? t('Showing the photos in its subfolders too: show this folder’s own')
              : t('Show the photos in its subfolders too')
          }
          onClick={() => {
            const deep = !source.deep
            // How folders open from now on, too.
            setSubfolders(deep)
            void openSource({ kind: 'folder', path: source.path, ...(deep ? { deep } : {}) })
          }}
        >
          <Icon name="stack" />
          <span className="lbl">{t('Subfolders')}</span>
        </button>
      )}
      <span className="vsep" />
      <SearchField />
      {!dupes && (
        <GlassSelect<SortKey>
          className="lg sort-select"
          label={t('Sort by')}
          prefix={t('Sort')}
          value={sort}
          options={SORTS.map((o) => ({ ...o, label: t(o.label) }))}
          onChange={setSort}
        />
      )}
      <span className="spacer" />
      <ModeSegment />
      {dupes ? (
        <DuplicateControls />
      ) : (
        mode === 'grid' && (
          <span className="bar-range size-range">
            <Slider
              label={t('Size')}
              title={t('Thumbnail size')}
              value={thumbSize}
              min={100}
              max={360}
              def={180}
              format={(v) => String(Math.round(v))}
              onChange={(v) => setThumbSize(Math.round(v))}
              onCommit={() => undefined}
              adjusts={false}
            />
          </span>
        )
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
        title={withKey(t('Auto white balance on each selected photo'), 'autoWbBatch')}
        onClick={() => void autoWbBatch(targets)}
      >
        <Icon name="picker" />
        <span className="lbl">{t('Auto WB')}</span>
      </button>
      <button
        className="lg"
        disabled={!focus}
        title={withKey(t('Develop the photo shown'), 'library.develop')}
        onClick={goDevelop}
      >
        <Icon name="presets" />
        <span className="lbl">{t('Develop')}</span>{' '}
        <span className="kbd">{keyHint('library.develop')}</span>
      </button>
      <LiquidGlass
        as="button"
        className="primary lg"
        flat
        onClick={() => setDialog('export')}
        title={withKey(t('Export selected'), 'export')}
      >
        <Icon name="export" />
        <span className="lbl-last">{t('Export…')}</span>
      </LiquidGlass>
      <button
        className={`icon lg${info ? ' on' : ''}`}
        title={withKey(t('Info and metadata'), 'library.info')}
        aria-label={t('Show info')}
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
        <span className="micro accent">{t('Library')}</span>
        <h1>{t('Open a folder of photographs.')}</h1>
        <p>{t('There is no import step: your photos stay where they are.')}</p>
        <div className="row">
          <button className="primary lg" onClick={() => void chooseFolder()}>
            <Icon name="folder" />
            {t('Choose folder…')}
          </button>
          <button className="lg" onClick={() => void choosePhotos()}>
            <Icon name="photo" />
            {t('Open a photo…')}
          </button>
        </div>
        {recent.length > 0 && (
          <>
            <div className="rule" />
            <span className="micro">{t('Recent')}</span>
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
  const [height, setHeight] = useState(0)
  const waiting = !source && !opening
  const dupesLoading = opening?.kind === 'duplicates' && source?.kind !== 'duplicates'
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setHeight(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [waiting, dupesLoading])
  const cols = Math.max(1, Math.floor((width - 2 * GRID_PAD_X + GRID_GAP) / (size + GRID_GAP)))
  const rows = useMemo(() => gridRows(items, groups, cols), [items, groups, cols])
  // Photos from more than one folder say which: a collection's, or a folder's with its subfolders.
  const showFolder = source?.kind !== 'folder' || !!source.deep
  const tileHeight = Math.round(size * 0.72 + (showFolder ? 48 : 34)) + 2
  // The rows as the keyboard walks them (↑/↓, PgUp/PgDn: lib/librarycontext.ts).
  useEffect(() => {
    setGridLayout(
      rows.flatMap((r) => (r.kind === 'tiles' ? [r.items.map((i) => i.key)] : [])),
      Math.floor(height / (tileHeight + GRID_GAP))
    )
  }, [rows, height, tileHeight])
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
        <p>
          {t('Looking for duplicates… the first look reads every picture, so it takes a while.')}
        </p>
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
      role="grid"
      aria-label={t('Photos')}
      aria-multiselectable
      aria-rowcount={rows.length}
      onFocus={() => (gridFocused = true)}
      onBlur={(e) => {
        // Focus leaving for somewhere else (not a tile scrolled away, which has none).
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node))
          gridFocused = false
      }}
    >
      <div className="grid-space" role="presentation" style={{ height: virtual.getTotalSize() }}>
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
                role="row"
                aria-rowindex={v.index + 1}
              >
                <span className={`badge${row.group.kind === 'exact' ? '' : ' ghost'}`}>
                  {row.group.kind === 'exact' ? t('Exact') : t('Similar')}
                </span>
                <span className="t-num" role="rowheader">
                  {tp('{{count}} photo', '{{count}} photos', row.count)}
                  {' · '}
                  {row.group.kind === 'near' && row.group.distance !== undefined
                    ? t('distance ≤ {{distance}}', { distance: row.group.distance })
                    : t('same file contents')}
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
              role="row"
              aria-rowindex={v.index + 1}
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
              ? t('No duplicates here. Raise “Similar” to find looser matches.')
              : t('No duplicates match the filters.')
            : source?.kind === 'collection' && total === 0
              ? t('This collection is empty. Drag photos onto it in the sidebar to add them.')
              : total === 0
                ? t('No photos here')
                : t('No photos match the filters.')}
          {!groups && source?.kind !== 'collection' && total === 0 && (
            <button className="sm" onClick={() => void useLibrary.getState().chooseFolder()}>
              {t('Choose folder…')}
            </button>
          )}
          {!groups && total > 0 && (
            <button className="sm" onClick={() => useLibrary.getState().resetFilter()}>
              {t('Reset filters')}
            </button>
          )}
        </p>
      )}
    </div>
  )
}

/** The keys a view answers, as the status bar names them: [command ids, what they do]. */
const MODE_KEYS: Record<LibraryMode, [string[], string][]> = {
  grid: [
    [['flag.pick', 'flag.reject', 'flag.clear'], tk('flag')],
    [['library.loupe'], tk('loupe')],
    [['library.compare'], tk('compare')],
    [['library.survey'], tk('survey')],
    [['library.stack'], tk('stack')],
    [['library.quickDevelop'], tk('quick develop')],
    [['library.undo'], tk('undo')],
    [['library.develop'], tk('develop')]
  ],
  loupe: [
    [['flag.pick', 'flag.reject', 'flag.clear'], tk('flag')],
    [['loupe.zoom'], tk('1:1')],
    [['library.toggleLoupe'], tk('grid')],
    [['library.develop'], tk('develop')]
  ],
  compare: [
    [['nav.prev', 'nav.next'], tk('candidate')],
    [['compare.swap'], tk('swap')],
    [['compare.promote'], tk('make select')],
    [['loupe.zoom'], tk('1:1')],
    [['compare.link'], tk('link')]
  ],
  survey: [
    [['nav.prev', 'nav.next'], tk('move')],
    [['flag.reject'], tk('reject')],
    [['survey.drop'], tk('drop')],
    [['library.back'], tk('grid')]
  ]
}

/** Auto-advance as it is in force (Caps Lock flips it), a click toggles it. */
function AdvanceChip(): React.JSX.Element | null {
  const on = useUi((s) => s.autoAdvance)
  const caps = useCapsLock((s) => s.on)
  const mode = useLibrary((s) => s.mode)
  const hint = useKeyHint()
  // Survey never moves on.
  if (mode === 'survey') return null
  const live = on !== caps
  return (
    <button
      className={`sm ghost advance-chip${live ? ' on' : ''}`}
      aria-pressed={on}
      title={
        caps
          ? t('Auto advance, flipped while Caps Lock is on ({{key}} to change)', {
              key: hint('library.autoAdvance')
            })
          : t('A rating, flag or label moves on to the next photo ({{key}}; Caps Lock flips it)', {
              key: hint('library.autoAdvance')
            })
      }
      onClick={toggleAutoAdvance}
    >
      {live ? t('Advance on') : t('Advance off')}
    </button>
  )
}

export function LibraryStatus(): React.JSX.Element | null {
  const source = useLibrary((s) => s.source)
  const mode = useLibrary((s) => s.mode)
  // A photo kept only while it has the focus (sticky hide) is not counted as shown.
  const count = useShownCount()
  const total = useLibrary((s) => s.items.length)
  const selected = useLibrary((s) => s.selection.length)
  const hint = useKeyHint()
  if (!source) return null
  const name = MODES.find((m) => m.mode === mode)?.label ?? ''
  return (
    <footer className="status-bar">
      <span className="t-num">
        {mode !== 'grid' && `${t(name)} · `}
        {t('{{count}} of {{total}} shown', { count, total })}
        {selected > 1 ? ` · ${t('{{count}} selected', { count: selected })}` : ''}
      </span>
      <span className="spacer" />
      <span className="keys">
        {mode === 'grid' && (
          <>
            <span className="kbd">0–5</span> {t('rate')} <span className="kbd">6–9</span>{' '}
            {t('label')}{' '}
          </>
        )}
        {MODE_KEYS[mode].map(([ids, what]) => (
          <span key={ids.join()} className="key-pair">
            {ids.map((id) => (
              <span key={id} className="kbd">
                {hint(id)}
              </span>
            ))}{' '}
            {t(what)}
          </span>
        ))}
      </span>
      <AdvanceChip />
    </footer>
  )
}
