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
  MetaTextPatch
} from '../../../shared/ipc'
import type { Recipe, RecipeGroup } from '../../../shared/recipe'
import type { SmartGroup } from '../../../shared/smart'
import { collapseStacks } from '../../../shared/stacks'
import { api, errorText } from '../lib/api'
import { folderName, isUnder } from '../lib/sources'
import { useBusy } from './busy'
import { useUi } from './ui'

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
  view: 'library' | 'develop'
  filter: Filter
  sort: SortKey
  thumbSize: number
  recent: string[]
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
    | 'engine'
    | 'whats-new'
    | 'scopes'
  /** The collection the 'collection' dialog edits. */
  editing: CollectionDraft | null
  clipboard: { recipe: Recipe; groups: RecipeGroup[]; source: string | null } | null

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
  patchItems(items: (LibraryItem | undefined)[]): void
  select(key: string, mode: 'only' | 'toggle' | 'range'): void
  selectAll(): void
  setFocus(key: string | null): void
  setView(view: 'library' | 'develop'): void
  setFilter(f: Partial<Filter>): void
  resetFilter(): void
  setSort(s: SortKey): void
  setThumbSize(n: number): void
  setMeta(
    patch: { rating?: number; flag?: Flag; label?: ColorLabel },
    keys?: string[]
  ): Promise<void>
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

const photos = (n: number): string => `${n} photo${n === 1 ? '' : 's'}`

/** Bumped by every open: a listing that lands after a newer open is dropped. */
let openSeq = 0

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
  view: 'library',
  filter: DEFAULT_FILTER,
  sort: 'name',
  thumbSize: 180,
  recent: [],
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
        title: 'Finding duplicates',
        detail: src.folder ? folderName(src.folder) : 'Whole library',
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
        view: 'library'
      }))
      const first = get().visible()[0]?.key ?? null
      set({ selection: first ? [first] : [], focus: first })
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
      get().say(`Removed ${folderName(folder)} from the list`)
    } catch (err) {
      get().say(errorText(err), 'error')
    }
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
    const { selection, focus } = get()
    if (mode === 'only') set({ selection: [key], focus: key })
    else if (mode === 'toggle') {
      set({
        selection: selection.includes(key)
          ? selection.filter((k) => k !== key)
          : [...selection, key],
        focus: key
      })
    } else {
      const vis = get()
        .visible()
        .map((i) => i.key)
      const a = vis.indexOf(focus ?? key)
      const b = vis.indexOf(key)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      set({ selection: vis.slice(Math.max(lo, 0), hi + 1), focus: key })
    }
  },

  selectAll() {
    set({
      selection: get()
        .visible()
        .map((i) => i.key)
    })
  },

  setFocus(key) {
    set({ focus: key, selection: key ? [key] : [] })
  },

  setView(view) {
    set({ view })
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
    try {
      get().patchItems(await api.library.setMeta(targets, patch))
      // A smart collection may no longer hold (or may now hold) what changed:
      // its count in the sidebar, and its listing when it is the one shown.
      if (get().collections.some((c) => c.kind === 'smart')) void get().loadSources()
      if (get().source?.kind === 'collection') void get().refresh()
    } catch (err) {
      get().say(errorText(err), 'error')
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
    if (!cover || photoIds.size < 2) return get().say('Select two or more photos to stack')
    const folder = byKey.get(cover)?.folder
    const elsewhere = keys.filter((k) => byKey.get(k)?.folder !== folder).length
    try {
      const changed = await api.library.stack(keys, cover)
      get().patchItems(changed)
      const id = changed.find((i) => i?.key === cover)?.stack?.id
      if (id) get().toggleStack(id, false)
      set({ selection: [cover], focus: cover })
      const made = changed.filter((i) => i && i.copyId === null && i.stack?.id === id).length
      get().say(
        `Stacked ${photos(made)}` +
          (elsewhere ? ` (${photos(elsewhere)} from other folders left out)` : '')
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
        n === 0 ? 'No bursts to stack' : `Made ${n} stack${n === 1 ? '' : 's'} by capture time`
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
      get().say(`Added ${photos(keys.length)} to ${c.name}`)
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async removeFromCollection(id, keys) {
    const c = get().collections.find((x) => x.id === id)
    if (!c || keys.length === 0) return
    try {
      await api.library.collectionItems(id, keys, 'remove')
      get().say(`Removed ${photos(keys.length)} from ${c.name}`)
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
    const { items, filter, sort, groups, expandedStacks } = get()
    return visibleFor(items, filter, sort, groups, expandedStacks)
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
  expanded: Set<string>
): LibraryItem[] {
  const m = visibleMemo
  if (
    m &&
    m.items === items &&
    m.filter === filter &&
    m.sort === sort &&
    m.groups === groups &&
    m.expanded === expanded
  )
    return m.out
  const out = computeVisible(items, filter, sort, groups, expanded)
  visibleMemo = { items, filter, sort, groups, expanded, out }
  return out
}

/** Names compared as `localeCompare` does, without building a collator per comparison. */
const collator = new Intl.Collator()

function computeVisible(
  items: LibraryItem[],
  filter: Filter,
  sort: SortKey,
  groups: LibraryState['groups'],
  expandedStacks: Set<string>
): LibraryItem[] {
  const shown = [...applyFilter(items, filter)]
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
  return useMemo(
    () => visibleFor(items, filter, sort, groups, expanded),
    [items, filter, sort, groups, expanded]
  )
}

/** The keys an action applies to: the selection, or the focused item. */
export function useTargets(): string[] {
  return useLibrary(
    useShallow((s) => (s.selection.length > 0 ? s.selection : s.focus ? [s.focus] : []))
  )
}
