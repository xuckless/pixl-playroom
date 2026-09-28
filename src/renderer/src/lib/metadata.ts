/**
 * The metadata editor's arithmetic over a selection: what the photos share,
 * and the smallest patch that says what the user changed — a field left
 * "Mixed" is never sent, so editing a caption never flattens the titles.
 */
import type { LibraryItem, MetaTextPatch } from '../../../shared/ipc'

export type TextField = 'title' | 'caption' | 'copyright'
export const TEXT_FIELDS: TextField[] = ['title', 'caption', 'copyright']

export interface Shared {
  /** The value every item has ('' for none), or '' when they differ. */
  value: string
  mixed: boolean
}

export function sharedText(items: LibraryItem[], field: TextField): Shared {
  const values = new Set(items.map((i) => i[field] ?? ''))
  if (values.size > 1) return { value: '', mixed: true }
  return { value: [...values][0] ?? '', mixed: false }
}

/** Every keyword in the selection, and whether all of it has that keyword. */
export function keywordPresence(items: LibraryItem[]): { path: string; all: boolean }[] {
  const counts = new Map<string, number>()
  for (const it of items)
    for (const k of new Set(it.keywords)) counts.set(k, (counts.get(k) ?? 0) + 1)
  return [...counts]
    .map(([path, n]) => ({ path, all: n === items.length }))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }))
}

/**
 * The patch for one field's edit, or null when nothing changed: a mixed
 * field left empty stays as it is; a cleared field clears (null).
 */
export function textPatch(before: Shared, typed: string, field: TextField): MetaTextPatch | null {
  const v = typed.trim()
  if (before.mixed ? v === '' : v === before.value.trim()) return null
  return { [field]: v === '' ? null : v }
}
