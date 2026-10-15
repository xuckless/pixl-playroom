/**
 * The library's visible list kept through a folder filling: thumbnails and
 * HDR badges arrive a frame's worth at a time, for minutes on a big folder,
 * and change nothing a filter, the sort or a stack reads. The list then
 * keeps its order with the new items swapped in, rather than filtered and
 * sorted again (state/library.ts `visibleFor`).
 */
import type { LibraryItem } from '../../../shared/ipc'

/** What a thumbnail or an HDR badge arriving changes of an item. */
const COSMETIC: ReadonlySet<string> = new Set(['thumbUrl', 'unreadable', 'hdr'])

/** Whether `a` and `b` differ only in cosmetic fields. */
function onlyCosmetic(a: LibraryItem, b: LibraryItem): boolean {
  const x = a as unknown as Record<string, unknown>
  const y = b as unknown as Record<string, unknown>
  for (const k of Object.keys(x)) if (!COSMETIC.has(k) && x[k] !== y[k]) return false
  for (const k of Object.keys(y))
    if (!COSMETIC.has(k) && !(k in x) && y[k] !== undefined) return false
  return true
}

/**
 * The items `next` has in place of `prev`'s, by key, when that is all that
 * changed and only in cosmetic fields; null when anything else did (an item
 * added, gone or moved, or a field the filter or the sort reads).
 */
export function cosmeticChanges(
  prev: LibraryItem[],
  next: LibraryItem[]
): Map<string, LibraryItem> | null {
  if (prev.length !== next.length) return null
  const changed = new Map<string, LibraryItem>()
  for (let i = 0; i < next.length; i++) {
    const a = prev[i]
    const b = next[i]
    if (a === b) continue
    if (a.key !== b.key || !onlyCosmetic(a, b)) return null
    changed.set(b.key, b)
  }
  return changed
}

/** `list` with the changed items in place of theirs, in its order (itself when none is in it). */
export function withChanged(list: LibraryItem[], changed: Map<string, LibraryItem>): LibraryItem[] {
  if (changed.size === 0) return list
  let out: LibraryItem[] | null = null
  for (let i = 0; i < list.length; i++) {
    const c = changed.get(list[i].key)
    if (!c) continue
    out ??= list.slice()
    out[i] = c
  }
  return out ?? list
}

const edited = new WeakMap<LibraryItem[], number>()

/** How many of `items` are edited: counted once per list, however often it is asked. */
export function editedCount(items: LibraryItem[]): number {
  let n = edited.get(items)
  if (n === undefined) {
    n = 0
    for (const i of items) if (i.edited) n++
    edited.set(items, n)
  }
  return n
}
