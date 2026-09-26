import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { create } from 'zustand'
import type { ColorLabel, EngineStatus, Flag, LibraryItem } from '../../../shared/ipc'
import type { Recipe, RecipeGroup } from '../../../shared/recipe'
import { api, errorText } from '../lib/api'

export type FlagFilter = 'all' | 'pick' | 'unflagged' | 'reject' | 'notRejected'
export type SortKey = 'name' | 'captured' | 'rating' | 'size' | 'edited'

export interface Filter {
  minRating: number
  flag: FlagFilter
  label: ColorLabel | 'all'
  edited: 'all' | 'edited' | 'unedited'
  text: string
}

export interface ToastAction {
  label: string
  run: () => void
}

interface LibraryState {
  folder: string | null
  items: LibraryItem[]
  selection: string[]
  focus: string | null
  view: 'library' | 'develop'
  filter: Filter
  sort: SortKey
  thumbSize: number
  recent: string[]
  engine: EngineStatus | null
  toast: { text: string; tone: 'info' | 'error'; action?: ToastAction } | null
  dialog: null | 'export' | 'sync' | 'preset' | 'enhance'
  clipboard: { recipe: Recipe; groups: RecipeGroup[]; source: string | null } | null

  openFolder(folder: string): Promise<void>
  chooseFolder(): Promise<void>
  refresh(): Promise<void>
  patchItems(items: (LibraryItem | undefined)[]): void
  select(key: string, mode: 'only' | 'toggle' | 'range'): void
  selectAll(): void
  setFocus(key: string | null): void
  setView(view: 'library' | 'develop'): void
  setFilter(f: Partial<Filter>): void
  setSort(s: SortKey): void
  setThumbSize(n: number): void
  setMeta(
    patch: { rating?: number; flag?: Flag; label?: ColorLabel },
    keys?: string[]
  ): Promise<void>
  /** A toast; one with an action stays until it is used or replaced. */
  say(text: string, tone?: 'info' | 'error', action?: ToastAction): void
  setDialog(d: LibraryState['dialog']): void
  setClipboard(c: LibraryState['clipboard']): void
  visible(): LibraryItem[]
  targets(): string[]
}

export const useLibrary = create<LibraryState>((set, get) => ({
  folder: null,
  items: [],
  selection: [],
  focus: null,
  view: 'library',
  filter: { minRating: 0, flag: 'notRejected', label: 'all', edited: 'all', text: '' },
  sort: 'name',
  thumbSize: 180,
  recent: [],
  engine: null,
  toast: null,
  dialog: null,
  clipboard: null,

  async openFolder(folder) {
    try {
      const listing = await api.library.openFolder(folder)
      set({
        folder: listing.folder,
        items: listing.items,
        selection: listing.items[0] ? [listing.items[0].key] : [],
        focus: listing.items[0]?.key ?? null,
        view: 'library'
      })
      void api.app.setSetting('library.lastFolder', folder)
      set({ recent: await api.library.recentFolders() })
    } catch (err) {
      get().say(errorText(err), 'error')
    }
  },

  async chooseFolder() {
    const f = await api.library.chooseFolder()
    if (f) await get().openFolder(f)
  },

  async refresh() {
    const folder = get().folder
    if (!folder) return
    const listing = await api.library.openFolder(folder)
    const keep = new Set(listing.items.map((i) => i.key))
    set((s) => ({
      items: listing.items,
      selection: s.selection.filter((k) => keep.has(k)),
      focus: s.focus && keep.has(s.focus) ? s.focus : (listing.items[0]?.key ?? null)
    }))
  },

  patchItems(items) {
    const byKey = new Map(items.filter((i): i is LibraryItem => !!i).map((i) => [i.key, i]))
    if (byKey.size === 0) return
    set((s) => {
      const known = new Set(s.items.map((i) => i.key))
      const merged = s.items.map((i) => byKey.get(i.key) ?? i)
      for (const [k, v] of byKey) if (!known.has(k)) merged.push(v)
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
    } catch (err) {
      get().say(errorText(err), 'error')
    }
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
    const { items, filter, sort } = get()
    const text = filter.text.trim().toLowerCase()
    const out = items.filter((i) => {
      if (i.rating < filter.minRating) return false
      if (filter.flag === 'pick' && i.flag !== 'pick') return false
      if (filter.flag === 'reject' && i.flag !== 'reject') return false
      if (filter.flag === 'unflagged' && i.flag !== null) return false
      if (filter.flag === 'notRejected' && i.flag === 'reject') return false
      if (filter.label !== 'all' && i.label !== filter.label) return false
      if (filter.edited === 'edited' && !i.edited) return false
      if (filter.edited === 'unedited' && i.edited) return false
      if (text) {
        const hay = [i.name, i.copyName, i.camera.model, i.camera.lens]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(text)) return false
      }
      return true
    })
    const by: Record<SortKey, (a: LibraryItem, b: LibraryItem) => number> = {
      name: (a, b) =>
        a.name.localeCompare(b.name) || (a.copyId ?? '').localeCompare(b.copyId ?? ''),
      captured: (a, b) => (a.camera.capturedAt ?? '').localeCompare(b.camera.capturedAt ?? ''),
      rating: (a, b) => b.rating - a.rating,
      size: (a, b) => b.size - a.size,
      edited: (a, b) => Number(b.edited) - Number(a.edited)
    }
    return out.sort(by[sort])
  },

  targets() {
    const { selection, focus } = get()
    return selection.length > 0 ? selection : focus ? [focus] : []
  }
}))

/**
 * The visible items, memoised on what they depend on. (A selector that builds
 * a new array every call would re-render forever.)
 */
export function useVisible(): LibraryItem[] {
  const items = useLibrary((s) => s.items)
  const filter = useLibrary((s) => s.filter)
  const sort = useLibrary((s) => s.sort)
  return useMemo(
    () => useLibrary.getState().visible(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filter, sort]
  )
}

/** The keys an action applies to: the selection, or the focused item. */
export function useTargets(): string[] {
  return useLibrary(
    useShallow((s) => (s.selection.length > 0 ? s.selection : s.focus ? [s.focus] : []))
  )
}
