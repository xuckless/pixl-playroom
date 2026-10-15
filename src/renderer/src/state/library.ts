import { useDeferredValue, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { create } from 'zustand'
import { applyFilter, DEFAULT_FILTER, type Filter } from '../../../shared/filter'
import type {
  ColorLabel,
  Collection,
  DuplicateGroup,
  EngineStatus,
  Flag,
  KeywordNode,
  LibraryItem,
  LibrarySource,
  MetaPatch,
  MetaTextPatch
} from '../../../shared/ipc'
import type { SettingsClipboard } from '../../../shared/clipboard'
import { keepPinned, pinnedOnly, rangeKeys, type LibraryMode } from '../../../shared/cullnav'
import {
  CONFIRM_ABOVE,
  patched,
  type MetaEntry,
  type MetaValues
} from '../../../shared/libraryundo'
import type { SmartGroup } from '../../../shared/smart'
import { collapseStacks } from '../../../shared/stacks'
import { api, errorText } from '../lib/api'
import { t, tp } from '../lib/i18n'
import { folderName, isUnder } from '../lib/sources'
import { useBusy } from './busy'
import { askConfirm } from './confirm'
import { pushUndo, undoAction } from './libraryUndo'
import { useUi } from './ui'
import { suggestedReasons, useCull } from './cull'
import type { CullReason } from '../../../shared/cullsuggest'

export type { Filter, FlagFilter } from '../../../shared/filter'
export type SortKey = 'name' | 'captured' | 'added' | 'rating' | 'size' | 'edited'

export interface ToastAction {
  label: string
  run: () => void
}

/** A collection being made or changed in its dialog. */
export interface CollectionDraft {
  id?: string
  name: string
  kind: Collection['kind']
  parent: string | null
  rules: SmartGroup | null
  sort: number
}

interface LibraryState {
  /** What the grid shows; null before anything is opened. */
  source: LibrarySource | null
  /** The source's folder when it is a folder (null for a collection, a keyword, the duplicates). */
  folder: string | null
  /** The folder most recently shown, for "this folder" when the source is not one. */
  lastFolder: string | null
  items: LibraryItem[]
  /** The duplicates source: its groups, in order; null for every other source. */
  groups: DuplicateGroup[] | null
  /** A source on its way (the duplicates can take a while the first time). */
  opening: LibrarySource | null
  /** Stacks shown whole; the rest show only their cover. */
  expandedStacks: Set<string>
  collections: Collection[]
  keywords: KeywordNode[]
  /** Folders kept at the top of the sidebar. */
  pinned: string[]
  selection: string[]
  focus: string | null
  /** Where a ⇧-click or ⇧-arrow extends the selection from. */
  anchor: string | null
  /**
   * A photo kept in the grid while it has the focus though the filter now
   * hides it (rejected while rejects are hidden): it shows dimmed and tagged,
   * and goes once the focus leaves it (shared/cullnav.ts).
   */
  sticky: string | null
  view: 'library' | 'develop'
  /** The Library's view of its photos: Grid, Loupe, Compare or Survey (lib/librarymodes.ts). */
  mode: LibraryMode
  /** Compare's Candidate (its Select is the focus). */
  candidate: string | null
  /** Compare's pane the keys act on. */
  active: 'select' | 'candidate'
  /**
   * What Survey shows: the selection (at most SURVEY_MAX of `total`), or a
   * photo's burst, near shots or stack (`group`).
   */
  survey: { keys: string[]; total: number; group?: 'burst' | 'near' | 'stack' } | null
  filter: Filter
  sort: SortKey
  thumbSize: number
  recent: string[]
  /** Photos opened on their own (File → Open Photo…), the latest first. */
  recentPhotos: string[]
  engine: EngineStatus | null
  toast: { text: string; tone: 'info' | 'error'; action?: ToastAction } | null
  dialog:
    | null
    | 'export'
    | 'sync'
    | 'preset'
    | 'looks'
    | 'collection'
    | 'preferences'
    | 'crash-consent'
    /** Where projects go, asked once at the first Develop. */
    | 'projects-location'
    | 'engine'
    | 'whats-new'
    | 'scopes'
    /** An update is available: what it brings, and Restart to update. */
    | 'update'
    /** Photo → Edit as SDR: the open gain-map photo's editing space. */
    | 'editing-space'
    /** ⇧⌘V: choose which of the clipboard's settings to paste. */
    | 'paste'
  /** The collection the 'collection' dialog edits. */
  editing: CollectionDraft | null
  /** The settings ⌘C copied, named after their photo (lib/clipboard.ts). */
  clipboard: SettingsClipboard | null

  /** Show a source; false when it could not be opened (the error is said). */
  openSource(src: LibrarySource): Promise<boolean>
  openFolder(folder: string): Promise<boolean>
  chooseFolder(): Promise<void>
  refresh(): Promise<void>
  /** A folder's files changed (main says which). */
  onChanged(folder: string): void
  /** Collections, keywords or metadata changed: the sidebar reloads, a derived source re-lists. */
  onSourcesChanged(): Promise<void>
  loadSources(): Promise<void>
  togglePin(folder: string): void
  /** Take a folder off the sidebar's list (unpinned too); nothing on disk changes. */
  forgetFolder(folder: string): Promise<void>
  /** Photos just opened on their own go to the top of Recent Photos. */
  rememberPhotos(paths: string[]): void
  /** Take a photo off Recent Photos; nothing on disk changes. */
  forgetPhoto(path: string): void
  patchItems(items: (LibraryItem | undefined)[]): void
  select(key: string, mode: 'only' | 'toggle' | 'range'): void
  /** Move the focus to `key`; with `extend`, the selection runs from the anchor to it. */
  moveTo(key: string, extend: boolean): void
  selectAll(): void
  setFocus(key: string | null): void
  setView(view: 'library' | 'develop'): void
  /** Show the Library's photos this way (Compare's and Survey's photos are set by lib/librarymodes.ts). */
  setMode(mode: LibraryMode): void
  setFilter(f: Partial<Filter>): void
  resetFilter(): void
  setSort(s: SortKey): void
  setThumbSize(n: number): void
  /**
   * Rate, flag or label `keys` (the targets when not given): shown at once,
   * written behind, one entry on the Library's undo stack, a toast with Undo
   * when it changed more than one photo, and a question first above
   * CONFIRM_ABOVE photos.
   */
  setMeta(
    patch: { rating?: number; flag?: Flag; label?: ColorLabel },
    keys?: string[]
  ): Promise<void>
  /** Write metadata without an undo entry (the undo stack's own writes). */
  writeMeta(patch: MetaPatch, keys: string[]): Promise<boolean>
  setMetadata(keys: string[], patch: MetaTextPatch): Promise<void>
  toggleStack(id: string, open?: boolean): void
  /** Stack the targets, the focused one on top. */
  stackTargets(): Promise<void>
  unstackTargets(): Promise<void>
  makeCover(key: string): Promise<void>
  autoStack(seconds: number): Promise<void>
  addToCollection(id: string, keys: string[]): Promise<void>
  removeFromCollection(id: string, keys: string[]): Promise<void>
  editCollection(draft: CollectionDraft | null): void
  /** A toast; one with an action stays until it is used or replaced. */
  say(text: string, tone?: 'info' | 'error', action?: ToastAction): void
  setDialog(d: LibraryState['dialog']): void
  setClipboard(c: LibraryState['clipboard']): void
  visible(): LibraryItem[]
  targets(): string[]
}

/** How many photos Recent Photos keeps. */
const RECENT_PHOTOS = 10

/** Bumped by every open: a listing that lands after a newer open is dropped. */
let openSeq = 0

/** Bumped by every metadata write: only the newest one's answer is shown. */
let metaSeq = 0

let ids = 0
/** An id for an undo entry or a batch (it goes into history labels: letters, digits, dashes). */
export function nextId(): string {
  return `${Date.now().toString(36)}-${(++ids).toString(36)}`
}

/** How long the sidebar's counts and a collection's listing wait after a rating, flag or label. */
const SOURCES_WAIT_MS = 300
let sourcesTimer: ReturnType<typeof setTimeout> | null = null

/**
 * A smart collection may no longer hold (or may now hold) what changed: its
 * count in the sidebar, and its listing when it is the one shown. Once,
 * a moment after the last of a run of keys, not per key.
 */
function sourcesSoon(): void {
  if (sourcesTimer) clearTimeout(sourcesTimer)
  sourcesTimer = setTimeout(() => {
    sourcesTimer = null
    const l = useLibrary.getState()
    if (l.collections.some((c) => c.kind === 'smart')) void l.loadSources()
    if (l.source?.kind === 'collection') void l.refresh()
  }, SOURCES_WAIT_MS)
}

/** Above CONFIRM_ABOVE photos, a change asks first. */
export function confirmMany(count: number): Promise<boolean> {
  return askConfirm({
    title: tp('Change {{count}} photo?', 'Change all {{count}} photos?', count),
    body: t('Every one of them changes. Undo takes it back.'),
    confirm: t('Change all')
  })
}

/** What a metadata change is, for the Edit menu's Undo. */
function metaTitle(p: MetaPatch): string {
  if (p.rating !== undefined) return t('Rating')
  if (p.flag !== undefined) return t('Flag')
  return t('Colour label')
}

/** What a metadata change did, for its toast. */
function metaSaid(p: MetaPatch, n: number): string {
  if (p.rating !== undefined)
    return p.rating > 0
      ? tp('Rated {{count}} photo', 'Rated {{count}} photos', n)
      : tp('Cleared the rating of {{count}} photo', 'Cleared the ratings of {{count}} photos', n)
  if (p.flag !== undefined)
    return p.flag === 'pick'
      ? tp('Flagged {{count}} photo as a pick', 'Flagged {{count}} photos as picks', n)
      : p.flag === 'reject'
        ? tp('Flagged {{count}} photo as a reject', 'Flagged {{count}} photos as rejects', n)
        : tp('Removed the flag from {{count}} photo', 'Removed the flags from {{count}} photos', n)
  return p.label
    ? tp('Labelled {{count}} photo', 'Labelled {{count}} photos', n)
    : tp(
        'Removed the colour label from {{count}} photo',
        'Removed the colour labels from {{count}} photos',
        n
      )
}

export const useLibrary = create<LibraryState>((set, get) => ({
  source: null,
  folder: null,
  lastFolder: null,
  items: [],
  groups: null,
  opening: null,
  expandedStacks: new Set(),
  collections: [],
  keywords: [],
  pinned: [],
  selection: [],
  focus: null,
  anchor: null,
  sticky: null,
  view: 'library',
  // The Grid or the Loupe, as the last session left it.
  mode: useUi.getState().libraryMode,
  candidate: null,
  active: 'select',
  survey: null,
  filter: DEFAULT_FILTER,
  sort: 'name',
  thumbSize: 180,
  recent: [],
  recentPhotos: [],
  engine: null,
  toast: null,
  dialog: null,
  editing: null,
  clipboard: null,

  async openSource(src) {
    const seq = ++openSeq
    set({ opening: src })
    const job = `open-source-${seq}`
    // The first look for duplicates hashes every picture; say so while it runs.
    if (src.kind === 'duplicates')
      useBusy.getState().begin({
        id: job,
        title: t('Finding duplicates'),
        detail: src.folder ? folderName(src.folder) : t('Whole library'),
        scope: 'global'
      })
    try {
      const listing = await api.library.openSource(src)
      if (seq !== openSeq) return false
      const folder = src.kind === 'folder' ? src.path : null
      set((s) => ({
        source: src,
        folder,
        lastFolder: folder ?? s.lastFolder,
        items: listing.items,
        groups: listing.groups ?? null,
        opening: null,
        view: 'library',
        // Compare's and Survey's photos were the last source's: the Loupe stays.
        ...(s.mode === 'compare' || s.mode === 'survey'
          ? { mode: 'grid' as const, candidate: null, active: 'select' as const, survey: null }
          : {})
      }))
      const first = get().visible()[0]?.key ?? null
      set({ selection: first ? [first] : [], focus: first, anchor: first })
      // The duplicates are slow to find again: a relaunch goes back to the folder.
      if (src.kind !== 'duplicates') void api.app.setSetting('library.lastSource', src)
      if (folder) {
        void api.app.setSetting('library.lastFolder', folder)
        set({ recent: await api.library.recentFolders() })
      }
      return true
    } catch (err) {
      if (seq === openSeq) set({ opening: null })
      get().say(errorText(err), 'error')
      return false
    } finally {
      useBusy.getState().end(job)
    }
  },

  openFolder(path) {
    // With its subfolders' photos too, when that is how folders open.
    const deep = useUi.getState().subfolders
    return get().openSource({ kind: 'folder', path, ...(deep ? { deep } : {}) })
  },

  async chooseFolder() {
    const f = await api.library.chooseFolder()
    if (f) await get().openFolder(f)
  },

  async refresh() {
    const src = get().source
    if (!src) return
    const seq = openSeq
    let listing
    try {
      listing = await api.library.openSource(src)
    } catch (err) {
      if (seq === openSeq && get().source === src) get().say(errorText(err), 'error')
      return
    }
    // Another source opened meanwhile: this listing is no longer the one shown.
    if (seq !== openSeq || get().source !== src) return
    const keep = new Set(listing.items.map((i) => i.key))
    set((s) => ({
      items: listing.items,
      groups: listing.groups ?? null,
      selection: s.selection.filter((k) => keep.has(k)),
      focus: s.focus && keep.has(s.focus) ? s.focus : (listing.items[0]?.key ?? null)
    }))
  },

  onChanged(folder) {
    const src = get().source
    if (!src) return
    const mine =
      src.kind === 'folder'
        ? src.path === folder || (src.deep === true && isUnder(folder, src.path))
        : src.kind === 'duplicates'
          ? src.folder === null || src.folder === folder
          : true
    if (mine) void get().refresh()
  },

  async onSourcesChanged() {
    await get().loadSources()
    const src = get().source
    if (!src || src.kind === 'folder') return
    // The collection shown was deleted: back to the last folder.
    if (src.kind === 'collection' && !get().collections.some((c) => c.id === src.id)) {
      const back = get().lastFolder
      if (back) await get().openFolder(back)
      else set({ source: null, items: [], groups: null, selection: [], focus: null })
      return
    }
    await get().refresh()
  },

  async loadSources() {
    try {
      const [collections, keywords] = await Promise.all([
        api.library.collections(),
        api.library.keywordTree()
      ])
      set({ collections, keywords })
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async forgetFolder(folder) {
    try {
      await api.library.forgetFolder(folder)
      if (get().pinned.includes(folder)) get().togglePin(folder)
      set({ recent: await api.library.recentFolders() })
      get().say(t('Removed {{name}} from the list', { name: folderName(folder) }))
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  rememberPhotos(paths) {
    const recentPhotos = [...paths, ...get().recentPhotos.filter((p) => !paths.includes(p))].slice(
      0,
      RECENT_PHOTOS
    )
    set({ recentPhotos })
    // Not kept (the index is busy or gone): the list is still right for now.
    void api.app.setSetting('library.recentPhotos', recentPhotos).catch(() => undefined)
  },

  forgetPhoto(path) {
    const recentPhotos = get().recentPhotos.filter((p) => p !== path)
    set({ recentPhotos })
    void api.app.setSetting('library.recentPhotos', recentPhotos).catch(() => undefined)
  },

  togglePin(folder) {
    const pinned = get().pinned.includes(folder)
      ? get().pinned.filter((p) => p !== folder)
      : [...get().pinned, folder]
    set({ pinned })
    void api.app.setSetting('library.pinned', pinned)
  },

  patchItems(items) {
    const byKey = new Map(items.filter((i): i is LibraryItem => !!i).map((i) => [i.key, i]))
    if (byKey.size === 0) return
    set((s) => {
      const known = new Set(s.items.map((i) => i.key))
      const merged = s.items.map((i) => byKey.get(i.key) ?? i)
      // Something new in the folder shown (a copy) joins it; a collection lists only its own.
      const src = s.source
      for (const [k, v] of byKey)
        if (!known.has(k) && src?.kind === 'folder' && v.folder === src.path) merged.push(v)
      return { items: merged }
    })
  },

  select(key, mode) {
    const { selection, focus, anchor } = get()
    if (mode === 'only') set({ selection: [key], focus: key, anchor: key })
    else if (mode === 'toggle') {
      set({
        selection: selection.includes(key)
          ? selection.filter((k) => k !== key)
          : [...selection, key],
        focus: key,
        anchor: key
      })
    } else {
      const vis = get()
        .visible()
        .map((i) => i.key)
      // From where the last plain or ⌘-click started, as Finder extends.
      set({ selection: rangeKeys(vis, anchor ?? focus ?? key, key), focus: key })
    }
  },

  moveTo(key, extend) {
    if (extend) get().select(key, 'range')
    else get().setFocus(key)
  },

  selectAll() {
    set({
      selection: get()
        .visible()
        .map((i) => i.key)
    })
  },

  setFocus(key) {
    set({ focus: key, selection: key ? [key] : [], anchor: key })
  },

  setView(view) {
    set({ view })
  },

  setMode(mode) {
    set((s) => ({
      mode,
      // Leaving Compare or Survey: what they showed goes with them.
      ...(mode !== 'compare' ? { candidate: null, active: 'select' as const } : {}),
      ...(mode !== 'survey' ? { survey: null } : {}),
      ...(s.view !== 'library' ? { view: 'library' as const } : {})
    }))
    useUi.getState().setLibraryMode(mode)
  },

  setFilter(f) {
    set((s) => ({ filter: { ...s.filter, ...f } }))
  },

  resetFilter() {
    set((s) => ({ filter: { ...DEFAULT_FILTER, text: s.filter.text } }))
  },

  setSort(sort) {
    set({ sort })
  },

  setThumbSize(thumbSize) {
    set({ thumbSize })
  },

  async setMeta(patch, keys) {
    const targets = keys ?? get().targets()
    if (targets.length === 0) return
    if (targets.length > CONFIRM_ABOVE && !(await confirmMany(targets.length))) return
    const byKey = new Map(get().items.map((i) => [i.key, i]))
    const before: Record<string, MetaValues> = {}
    for (const k of targets) {
      const it = byKey.get(k)
      if (it) before[k] = { rating: it.rating, flag: it.flag, label: it.label }
    }
    // The photo shown stays where it is though the filter may now hide it
    // (the focus, or Compare's Candidate).
    const { focus, candidate } = get()
    if (focus && targets.includes(focus)) set({ sticky: focus })
    else if (candidate && targets.length === 1 && targets[0] === candidate)
      set({ sticky: candidate })
    if (!(await get().writeMeta(patch, targets))) return
    const entry: MetaEntry = { kind: 'meta', id: nextId(), title: metaTitle(patch), patch, before }
    pushUndo(entry)
    if (targets.length > 1) get().say(metaSaid(patch, targets.length), 'info', undoAction(entry))
  },

  async writeMeta(patch, keys) {
    if (keys.length === 0) return true
    // Shown at once: a fast cull (a few keys a second) never waits on a write.
    const want = new Set(keys)
    get().patchItems(
      get()
        .items.filter((i) => want.has(i.key))
        .map((i) => ({ ...i, ...patched(i, patch) }))
    )
    const mine = ++metaSeq
    try {
      const items = await api.library.setMeta(keys, patch)
      // A later key's write is on its way: its answer is the one to show.
      if (mine === metaSeq) get().patchItems(items)
      sourcesSoon()
      return true
    } catch (err) {
      get().say(errorText(err), 'error')
      void get().refresh()
      return false
    }
  },

  async setMetadata(keys, patch) {
    if (keys.length === 0) return
    try {
      get().patchItems(await api.library.setMetadata(keys, patch))
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  toggleStack(id, open) {
    set((s) => {
      const next = new Set(s.expandedStacks)
      if (open ?? !next.has(id)) next.add(id)
      else next.delete(id)
      return { expandedStacks: next }
    })
  },

  async stackTargets() {
    const keys = get().targets()
    const byKey = new Map(get().items.map((i) => [i.key, i]))
    const focus = get().focus
    const cover = focus && keys.includes(focus) ? focus : keys[0]
    const photoIds = new Set(keys.map((k) => byKey.get(k)?.photoId))
    if (!cover || photoIds.size < 2) return get().say(t('Select two or more photos to stack'))
    const folder = byKey.get(cover)?.folder
    const elsewhere = keys.filter((k) => byKey.get(k)?.folder !== folder).length
    try {
      const changed = await api.library.stack(keys, cover)
      get().patchItems(changed)
      const id = changed.find((i) => i?.key === cover)?.stack?.id
      if (id) get().toggleStack(id, false)
      set({ selection: [cover], focus: cover })
      const made = changed.filter((i) => i && i.copyId === null && i.stack?.id === id).length
      const stacked = tp('Stacked {{count}} photo', 'Stacked {{count}} photos', made)
      get().say(
        elsewhere
          ? t('{{stacked}} ({{photos}} from other folders left out)', {
              stacked,
              photos: tp('{{count}} photo', '{{count}} photos', elsewhere)
            })
          : stacked
      )
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async unstackTargets() {
    const keys = get().targets()
    if (!keys.some((k) => get().items.find((i) => i.key === k)?.stack)) return
    try {
      get().patchItems(await api.library.unstack(keys))
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async makeCover(key) {
    if (!get().items.find((i) => i.key === key)?.stack) return
    try {
      get().patchItems(await api.library.stackTop(key))
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async autoStack(seconds) {
    const folder = get().folder
    if (!folder) return
    try {
      const n = await api.library.autoStack(folder, seconds)
      get().say(
        n === 0
          ? t('No bursts to stack')
          : tp('Made {{count}} stack by capture time', 'Made {{count}} stacks by capture time', n)
      )
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async addToCollection(id, keys) {
    const c = get().collections.find((x) => x.id === id)
    if (!c || keys.length === 0) return
    try {
      await api.library.collectionItems(id, keys, 'add')
      get().say(
        tp('Added {{count}} photo to {{name}}', 'Added {{count}} photos to {{name}}', keys.length, {
          name: c.name
        })
      )
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async removeFromCollection(id, keys) {
    const c = get().collections.find((x) => x.id === id)
    if (!c || keys.length === 0) return
    try {
      await api.library.collectionItems(id, keys, 'remove')
      get().say(
        tp(
          'Removed {{count}} photo from {{name}}',
          'Removed {{count}} photos from {{name}}',
          keys.length,
          {
            name: c.name
          }
        )
      )
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  editCollection(editing) {
    set({ editing, dialog: editing ? 'collection' : null })
  },

  say(text, tone = 'info', action) {
    set({ toast: { text, tone, action } })
    if (action) return
    setTimeout(
      () => {
        if (get().toast?.text === text) set({ toast: null })
      },
      tone === 'error' ? 8000 : 3500
    )
  },

  setDialog(dialog) {
    set({ dialog })
  },

  setClipboard(clipboard) {
    set({ clipboard })
  },

  visible() {
    const { items, filter, sort, groups, expandedStacks, sticky } = get()
    return visibleFor(
      items,
      filter,
      sort,
      groups,
      expandedStacks,
      useCull.getState().reasons,
      sticky
    )
  },

  targets() {
    const { selection, focus } = get()
    return selection.length > 0 ? selection : focus ? [focus] : []
  }
}))

/** The selection as a set, made once per selection (tiles ask "am I selected?" per change). */
let selected: { of: string[]; set: Set<string> } | null = null
export function selectionSet(selection: string[]): Set<string> {
  if (selected?.of !== selection) selected = { of: selection, set: new Set(selection) }
  return selected.set
}

let visibleMemo: {
  items: LibraryItem[]
  filter: Filter
  sort: SortKey
  groups: LibraryState['groups']
  expanded: Set<string>
  cull: Record<string, CullReason[]>
  pinned: string | null
  out: LibraryItem[]
} | null = null

/**
 * The visible items, once per change of what they depend on, however many
 * ask (the grid, the filmstrip, the counts): filtering and sorting a big
 * folder is not free.
 */
function visibleFor(
  items: LibraryItem[],
  filter: Filter,
  sort: SortKey,
  groups: LibraryState['groups'],
  expanded: Set<string>,
  cull: Record<string, CullReason[]>,
  pinned: string | null
): LibraryItem[] {
  const m = visibleMemo
  // The suggestions only change what is shown while Suggested rejects is on.
  const cullKey = filter.suggested ? cull : null
  if (
    m &&
    m.items === items &&
    m.filter === filter &&
    m.sort === sort &&
    m.groups === groups &&
    m.expanded === expanded &&
    m.pinned === pinned &&
    (filter.suggested ? m.cull === cull : true)
  )
    return m.out
  const shown = filter.suggested
    ? items.filter((i) => suggestedReasons(i, cullKey ?? {}) !== null)
    : items
  // The focused photo the filter now hides stays where it was (sticky hide).
  const passed = keepPinned(items, applyFilter(shown, filter), pinned)
  const out = arrange(passed, sort, groups, expanded)
  visibleMemo = { items, filter, sort, groups, expanded, cull, pinned, out }
  return out
}

/** Names compared as `localeCompare` does, without building a collator per comparison. */
const collator = new Intl.Collator()

/** What the filters let through, sorted, the duplicates in their groups and stacks collapsed. */
function arrange(
  passed: LibraryItem[],
  sort: SortKey,
  groups: LibraryState['groups'],
  expandedStacks: Set<string>
): LibraryItem[] {
  const shown = [...passed]
  // The duplicates keep their groups' order, every member showing.
  if (groups) {
    const at = new Map<string, number>()
    for (const g of groups) for (const k of g.keys) if (!at.has(k)) at.set(k, at.size)
    return shown
      .filter((i) => at.has(i.key))
      .sort((a, b) => (at.get(a.key) as number) - (at.get(b.key) as number))
  }
  const by: Record<SortKey, (a: LibraryItem, b: LibraryItem) => number> = {
    name: (a, b) =>
      collator.compare(a.name, b.name) || collator.compare(a.copyId ?? '', b.copyId ?? ''),
    captured: (a, b) => (a.camera.capturedAt ?? '').localeCompare(b.camera.capturedAt ?? ''),
    // Newest first, as Finder's Date Added.
    added: (a, b) =>
      (b.added ?? b.mtime) - (a.added ?? a.mtime) || collator.compare(a.name, b.name),
    rating: (a, b) => b.rating - a.rating,
    size: (a, b) => b.size - a.size,
    edited: (a, b) => Number(b.edited) - Number(a.edited) || collator.compare(a.name, b.name)
  }
  return collapseStacks(shown.sort(by[sort]), expandedStacks)
}

/**
 * The visible items, memoised on what they depend on. (A selector that builds
 * a new array every call would re-render forever.)
 */
export function useVisible(): LibraryItem[] {
  const items = useLibrary((s) => s.items)
  // Typing a search: the grid follows a moment behind the keys, not per key.
  const filter = useDeferredValue(useLibrary((s) => s.filter))
  const sort = useLibrary((s) => s.sort)
  const groups = useLibrary((s) => s.groups)
  const expanded = useLibrary((s) => s.expandedStacks)
  const cull = useCull((s) => s.reasons)
  const sticky = useLibrary((s) => s.sticky)
  return useMemo(
    () => visibleFor(items, filter, sort, groups, expanded, cull, sticky),
    [items, filter, sort, groups, expanded, cull, sticky]
  )
}

/**
 * Whether a photo shows only because it is pinned: the filter hides it, and
 * it stays (dimmed, tagged "Hidden by filter") until the focus leaves it.
 */
export function useHiddenByFilter(item: LibraryItem): boolean {
  return useLibrary((s) => s.sticky === item.key && filteredOut(item, s.filter))
}

/** The filter (Suggested rejects with it) would not show this photo. */
function filteredOut(item: LibraryItem, filter: Filter): boolean {
  return (
    applyFilter([item], filter).length === 0 ||
    (filter.suggested === true && suggestedReasons(item, useCull.getState().reasons) === null)
  )
}

/** How many photos the filter shows: the visible ones, less one kept only by sticky hide. */
export function useShownCount(): number {
  const visible = useVisible().length
  const pinned = useLibrary((s) =>
    pinnedOnly(s.items, s.sticky, (it) => !filteredOut(it, s.filter))
  )
  return visible - (pinned ? 1 : 0)
}

// The focus (or Compare's Candidate) left the pinned photo: the filter has its say again.
useLibrary.subscribe((s) => {
  if (s.sticky !== null && s.sticky !== s.focus && s.sticky !== s.candidate)
    useLibrary.setState({ sticky: null })
})

/** The keys an action applies to: the selection, or the focused item. */
export function useTargets(): string[] {
  return useLibrary(
    useShallow((s) => (s.selection.length > 0 ? s.selection : s.focus ? [s.focus] : []))
  )
}
