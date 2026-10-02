import { useEffect, useState, type ReactNode } from 'react'
import type { Collection, KeywordNode, LibrarySource } from '../../../../shared/ipc'
import { Icon, type IconName } from '../../components/icons'
import { Menu, type MenuItem } from '../../components/Popover'
import { Section } from '../../components/ui'
import { api, errorText } from '../../lib/api'
import { askConfirm } from '../../state/confirm'
import {
  collectionTree,
  folderName,
  KEYS_MIME,
  sameSource,
  type CollectionNode
} from '../../lib/sources'
import { useLibrary, useTargets } from '../../state/library'
import { useUi } from '../../state/ui'

const carriesKeys = (e: React.DragEvent): boolean => e.dataTransfer.types.includes(KEYS_MIME)

function droppedKeys(e: React.DragEvent): string[] {
  try {
    const keys = JSON.parse(e.dataTransfer.getData(KEYS_MIME)) as unknown
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

const KIND_ICON: Record<Collection['kind'], IconName> = {
  manual: 'collection',
  smart: 'smart',
  set: 'set'
}

/**
 * One line of the sidebar: a source to show. It opens on a click or Enter,
 * offers its menu on a right-click, and takes dropped photos when `onDrop`
 * is given.
 */
function SourceRow({
  icon,
  label,
  title,
  count,
  depth = 0,
  active,
  expanded,
  onToggle,
  onOpen,
  menu,
  actions,
  onDrop
}: {
  icon: IconName
  label: string
  title?: string
  count?: number
  depth?: number
  active: boolean
  /** Rows with children: whether they show. */
  expanded?: boolean
  onToggle?: () => void
  onOpen: () => void
  menu?: () => (MenuItem | 'sep')[]
  actions?: ReactNode
  onDrop?: (keys: string[]) => void
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [over, setOver] = useState(false)
  return (
    <div
      role="button"
      tabIndex={0}
      className={`src-row${active ? ' on' : ''}${over ? ' drop' : ''}${menuOpen ? ' menu-open' : ''}`}
      style={{ '--depth': depth } as React.CSSProperties}
      title={title ?? label}
      aria-current={active || undefined}
      aria-expanded={expanded}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') onOpen()
        if (onToggle && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
          if (expanded !== (e.key === 'ArrowRight')) onToggle()
          e.stopPropagation()
          e.preventDefault()
        }
        if (menu && (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))) {
          setMenuOpen(true)
          e.preventDefault()
        }
      }}
      onContextMenu={
        menu
          ? (e) => {
              e.preventDefault()
              setMenuOpen(true)
            }
          : undefined
      }
      onDragOver={
        onDrop
          ? (e) => {
              if (!carriesKeys(e)) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              if (!over) setOver(true)
            }
          : undefined
      }
      onDragLeave={onDrop ? () => setOver(false) : undefined}
      onDrop={
        onDrop
          ? (e) => {
              setOver(false)
              if (!carriesKeys(e)) return
              e.preventDefault()
              onDrop(droppedKeys(e))
            }
          : undefined
      }
    >
      {onToggle ? (
        <span
          className={`src-caret${expanded ? ' open' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          <svg viewBox="0 0 10 10" aria-hidden>
            <path d="M3.5 2 6.5 5 3.5 8" />
          </svg>
        </span>
      ) : (
        <span className="src-caret" />
      )}
      <Icon name={icon} className="src-icon" />
      <span className="src-label">{label}</span>
      {actions}
      {menu && (
        <span className="src-menu">
          <button
            className="icon src-more"
            title="More"
            aria-label={`${label}: more`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
          >
            <Icon name="more" />
          </button>
          {menuOpen && (
            <Menu items={menu()} onClose={() => setMenuOpen(false)} align="right" solid />
          )}
        </span>
      )}
      {count !== undefined && <span className="src-count t-num">{count}</span>}
    </div>
  )
}

/** A "+" in a section's header that opens a menu. */
function AddMenu({
  title,
  items
}: {
  title: string
  items: () => (MenuItem | 'sep')[]
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <span className="src-add">
      <button className="icon sm" title={title} aria-label={title} onClick={() => setOpen(!open)}>
        <Icon name="plus" />
      </button>
      {open && <Menu items={items()} onClose={() => setOpen(false)} align="right" solid />}
    </span>
  )
}

/**
 * A folder and, opened out, its subfolders (read when first opened, one
 * level at a time), each a source of its own. The open ones are remembered
 * for the session.
 */
function FolderTree({
  path,
  depth,
  actions,
  menu
}: {
  path: string
  depth: number
  actions?: ReactNode
  menu?: MenuItem[]
}): React.JSX.Element {
  const source = useLibrary((s) => s.source)
  const openFolder = useLibrary((s) => s.openFolder)
  const [open, setOpen] = useState(() => openTrees.has(path))
  const [children, setChildren] = useState<{ path: string; name: string }[] | null>(null)
  useEffect(() => {
    if (!open || children) return
    let live = true
    void api.library.subfolders(path).then(
      (list) => live && setChildren(list),
      () => live && setChildren([])
    )
    return () => {
      live = false
    }
  }, [open, children, path])
  const toggle = (): void => {
    if (open) openTrees.delete(path)
    else openTrees.add(path)
    setOpen(!open)
  }
  return (
    <>
      <SourceRow
        icon="folder"
        label={folderName(path)}
        title={path}
        depth={depth}
        active={source?.kind === 'folder' && source.path === path}
        expanded={children?.length === 0 ? undefined : open}
        onToggle={children?.length === 0 ? undefined : toggle}
        onOpen={() => void openFolder(path)}
        actions={actions}
        menu={() => [
          ...(menu ?? []),
          {
            label: 'Show in folder',
            onSelect: () =>
              void api.app
                .reveal(path)
                .catch((e) => useLibrary.getState().say(errorText(e), 'error'))
          }
        ]}
      />
      {open && children?.map((c) => <FolderTree key={c.path} path={c.path} depth={depth + 1} />)}
    </>
  )
}

/** The folder trees opened out, kept while the app runs. */
const openTrees = new Set<string>()

function Folders(): React.JSX.Element {
  const recent = useLibrary((s) => s.recent)
  const pinned = useLibrary((s) => s.pinned)
  const chooseFolder = useLibrary((s) => s.chooseFolder)
  const togglePin = useLibrary((s) => s.togglePin)
  const forget = useLibrary((s) => s.forgetFolder)
  const rest = recent.filter((r) => !pinned.includes(r)).slice(0, 8)
  const row = (path: string, isPinned: boolean): React.JSX.Element => (
    <FolderTree
      key={path}
      path={path}
      depth={0}
      actions={
        <>
          <button
            className="icon src-forget"
            title="Remove from the list (the folder and its photos stay on disk)"
            aria-label={`Remove ${folderName(path)} from the list`}
            onClick={(e) => {
              e.stopPropagation()
              void forget(path)
            }}
          >
            <Icon name="close" />
          </button>
          <button
            className={`icon src-pin${isPinned ? ' pinned' : ''}`}
            title={isPinned ? 'Unpin' : 'Pin to the top'}
            aria-label={isPinned ? `Unpin ${folderName(path)}` : `Pin ${folderName(path)}`}
            aria-pressed={isPinned}
            onClick={(e) => {
              e.stopPropagation()
              togglePin(path)
            }}
          >
            <Icon name="pin" />
          </button>
        </>
      }
      menu={[
        { label: isPinned ? 'Unpin' : 'Pin to the top', onSelect: () => togglePin(path) },
        { label: 'Remove from the list', onSelect: () => void forget(path) }
      ]}
    />
  )
  return (
    <Section
      id="lib-folders"
      title="Folders"
      right={
        <button
          className="icon sm"
          title="Open folder…"
          aria-label="Open folder"
          onClick={() => void chooseFolder()}
        >
          <Icon name="plus" />
        </button>
      }
    >
      <div className="src-list">
        {pinned.map((p) => row(p, true))}
        {pinned.length > 0 && rest.length > 0 && <div className="src-sep" />}
        {rest.map((p) => row(p, false))}
        {pinned.length === 0 && rest.length === 0 && (
          <button className="sm ghost src-empty" onClick={() => void chooseFolder()}>
            <Icon name="folder" />
            Open folder…
          </button>
        )}
      </div>
    </Section>
  )
}

/** New collections, and the file round trip. */
function collectionsMenu(): (MenuItem | 'sep')[] {
  const lib = useLibrary.getState()
  const draft = (kind: Collection['kind'], name: string): void =>
    lib.editCollection({
      name,
      kind,
      parent: null,
      rules: kind === 'smart' ? { match: 'all', rules: [] } : null,
      sort: 0
    })
  return [
    { label: 'New collection…', onSelect: () => draft('manual', 'New collection') },
    { label: 'New smart collection…', onSelect: () => draft('smart', 'New smart collection') },
    { label: 'New set…', onSelect: () => draft('set', 'New set') },
    'sep',
    {
      label: 'Import…',
      onSelect: () =>
        void api.library
          .importCollections()
          .then((added) => {
            if (added.length === 0) return
            void lib.loadSources()
            lib.say(`Imported ${added.length} collection${added.length === 1 ? '' : 's'}`)
          })
          .catch((e) => lib.say(errorText(e), 'error'))
    },
    {
      label: 'Export all…',
      disabled: lib.collections.length === 0,
      onSelect: () => void exportCollections(lib.collections.map((c) => c.id))
    }
  ]
}

async function exportCollections(ids: string[]): Promise<void> {
  const lib = useLibrary.getState()
  try {
    const path = await api.library.exportCollections(ids)
    if (path)
      lib.say(`Exported to ${folderName(path)}`, 'info', {
        label: 'Show',
        run: () => void api.app.reveal(path)
      })
  } catch (e) {
    lib.say(errorText(e), 'error')
  }
}

function CollectionRows({
  nodes,
  depth,
  open,
  toggle
}: {
  nodes: CollectionNode[]
  depth: number
  open: Set<string>
  toggle: (id: string) => void
}): React.JSX.Element {
  const source = useLibrary((s) => s.source)
  const openSource = useLibrary((s) => s.openSource)
  const targets = useTargets()
  return (
    <>
      {nodes.map(({ collection: c, children }) => {
        const src: LibrarySource = { kind: 'collection', id: c.id }
        const lib = useLibrary.getState
        const isSet = c.kind === 'set'
        const showing = sameSource(source, src)
        const menu = (): (MenuItem | 'sep')[] => [
          ...(c.kind === 'manual'
            ? [
                {
                  label: `Add ${targets.length > 1 ? `${targets.length} selected` : 'selection'}`,
                  disabled: targets.length === 0,
                  onSelect: () => void lib().addToCollection(c.id, targets)
                },
                ...(showing
                  ? [
                      {
                        label: 'Remove selection from it',
                        disabled: targets.length === 0,
                        onSelect: () => void lib().removeFromCollection(c.id, targets)
                      }
                    ]
                  : []),
                'sep' as const
              ]
            : []),
          {
            label: c.kind === 'smart' ? 'Edit rules…' : 'Rename…',
            onSelect: () =>
              lib().editCollection({
                id: c.id,
                name: c.name,
                kind: c.kind,
                parent: c.parent,
                rules: c.rules,
                sort: c.sort
              })
          },
          { label: 'Export…', onSelect: () => void exportCollections([c.id]) },
          'sep',
          {
            label: isSet ? 'Delete set' : 'Delete',
            danger: true,
            onSelect: () =>
              void askConfirm({
                title: isSet ? 'Delete set' : 'Delete collection',
                body: isSet
                  ? `Delete the set “${c.name}”? The collections in it move to the top level.`
                  : `Delete “${c.name}”? The photos stay where they are.`,
                confirm: 'Delete',
                danger: true
              }).then((yes) => {
                if (yes)
                  void api.library
                    .removeCollection(c.id)
                    .catch((e) => lib().say(errorText(e), 'error'))
              })
          }
        ]
        return (
          <div key={c.id} role="group">
            <SourceRow
              icon={KIND_ICON[c.kind]}
              label={c.name}
              count={c.count}
              depth={depth}
              active={showing}
              expanded={isSet ? open.has(c.id) : undefined}
              onToggle={isSet ? () => toggle(c.id) : undefined}
              onOpen={() => void openSource(src)}
              menu={menu}
              onDrop={
                c.kind === 'manual' ? (keys) => void lib().addToCollection(c.id, keys) : undefined
              }
            />
            {isSet && open.has(c.id) && (
              <CollectionRows nodes={children} depth={depth + 1} open={open} toggle={toggle} />
            )}
          </div>
        )
      })}
    </>
  )
}

/** Remembered open rows (sets, keywords) for the session. */
function useOpenSet(): [Set<string>, (id: string) => void] {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (id: string): void =>
    setOpen((o) => {
      const next = new Set(o)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  return [open, toggle]
}

function Collections(): React.JSX.Element {
  const collections = useLibrary((s) => s.collections)
  const [open, toggle] = useOpenSet()
  const tree = collectionTree(collections)
  return (
    <Section
      id="lib-collections"
      title="Collections"
      right={<AddMenu title="New collection" items={collectionsMenu} />}
    >
      <div className="src-list">
        <CollectionRows nodes={tree} depth={0} open={open} toggle={toggle} />
        {tree.length === 0 && (
          <p className="src-hint">
            Gather photos from any folder: make a collection with +, then drag photos onto it.
          </p>
        )}
      </div>
    </Section>
  )
}

function KeywordRows({
  nodes,
  depth,
  open,
  toggle
}: {
  nodes: KeywordNode[]
  depth: number
  open: Set<string>
  toggle: (path: string) => void
}): React.JSX.Element {
  const source = useLibrary((s) => s.source)
  const openSource = useLibrary((s) => s.openSource)
  return (
    <>
      {nodes.map((k) => {
        const src: LibrarySource = { kind: 'keyword', path: k.path }
        const kids = k.children.length > 0
        return (
          <div key={k.path} role="group">
            <SourceRow
              icon="tag"
              label={k.name}
              title={k.path.split('|').join(' › ')}
              count={k.count}
              depth={depth}
              active={sameSource(source, src)}
              expanded={kids ? open.has(k.path) : undefined}
              onToggle={kids ? () => toggle(k.path) : undefined}
              onOpen={() => void openSource(src)}
              onDrop={(keys) =>
                void useLibrary.getState().setMetadata(keys, { addKeywords: [k.path] })
              }
            />
            {kids && open.has(k.path) && (
              <KeywordRows nodes={k.children} depth={depth + 1} open={open} toggle={toggle} />
            )}
          </div>
        )
      })}
    </>
  )
}

function Keywords(): React.JSX.Element {
  const keywords = useLibrary((s) => s.keywords)
  const [open, toggle] = useOpenSet()
  return (
    <Section id="lib-keywords" title="Keywords">
      <div className="src-list">
        <KeywordRows nodes={keywords} depth={0} open={open} toggle={toggle} />
        {keywords.length === 0 && (
          <p className="src-hint">Keywords added in the Info panel (I) gather here.</p>
        )}
      </div>
    </Section>
  )
}

function Duplicates(): React.JSX.Element {
  const source = useLibrary((s) => s.source)
  const lastFolder = useLibrary((s) => s.lastFolder)
  const openSource = useLibrary((s) => s.openSource)
  return (
    <Section id="lib-duplicates" title="Duplicates">
      <div className="src-list">
        <SourceRow
          icon="duplicate"
          label="Exact and similar photos"
          title="Find copies of the same picture, in this folder or the whole library"
          active={source?.kind === 'duplicates'}
          onOpen={() =>
            void openSource({
              kind: 'duplicates',
              folder: source?.kind === 'duplicates' ? source.folder : lastFolder,
              threshold: source?.kind === 'duplicates' ? source.threshold : 6
            })
          }
        />
      </div>
    </Section>
  )
}

/**
 * The library's left column: the folders it has seen, the collections, the
 * keyword tree and the duplicates finder. Folds away (Cmd/Ctrl+Shift+L or
 * backslash) and remembers.
 */
export function Sidebar(): React.JSX.Element {
  const open = useUi((s) => s.librarySidebar)
  return (
    <aside className={`lib-sidebar${open ? ' open' : ''}`} aria-label="Sources" inert={!open}>
      <div className="lib-sidebar-inner">
        <Folders />
        <Collections />
        <Keywords />
        <Duplicates />
      </div>
    </aside>
  )
}
