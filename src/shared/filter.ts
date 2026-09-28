/**
 * The library's filter bar as a smart-collection rule group, so a filter
 * and a smart collection mean the same thing by the same words: "Canon"
 * finds the same photos in the search field as in a rule.
 */
import type { ColorLabel, LibraryItem } from './ipc'
import { matchSmart, type SmartGroup, type SmartRule } from './smart'

export type FlagFilter = 'all' | 'pick' | 'unflagged' | 'reject' | 'notRejected'

export interface Filter {
  minRating: number
  flag: FlagFilter
  label: ColorLabel | 'all'
  edited: 'all' | 'edited' | 'unedited'
  /** Every word must be found in the name, title, caption, keywords, camera or lens. */
  text: string
  /** A camera name as `cameraName` gives it; '' for any. */
  camera: string
  lens: string
  kind: 'all' | 'raw' | 'nonraw'
  /** Inclusive ranges; null for any. */
  iso: [number, number] | null
  focal: [number, number] | null
  /** Capture days, `YYYY-MM-DD` local, inclusive; '' for open. */
  from: string
  to: string
  /** A keyword path (`|` between levels): that keyword or anything under it. */
  keyword: string
}

export const DEFAULT_FILTER: Filter = {
  minRating: 0,
  flag: 'notRejected',
  label: 'all',
  edited: 'all',
  text: '',
  camera: '',
  lens: '',
  kind: 'all',
  iso: null,
  focal: null,
  from: '',
  to: '',
  keyword: ''
}

/** The far ends of an open date range (the rule wants a pair). */
const EARLIEST = '1000-01-01'
const LATEST = '9999-12-31'

/** The filter as the rules an item must all pass. */
export function filterRules(f: Filter): SmartGroup {
  const rules: SmartRule[] = []
  if (f.minRating > 0) rules.push({ field: 'rating', op: 'gte', value: f.minRating })
  if (f.flag === 'pick') rules.push({ field: 'flag', op: 'is', value: 'pick' })
  if (f.flag === 'reject') rules.push({ field: 'flag', op: 'is', value: 'reject' })
  if (f.flag === 'unflagged') rules.push({ field: 'flag', op: 'is', value: 'none' })
  if (f.flag === 'notRejected') rules.push({ field: 'flag', op: 'isNot', value: 'reject' })
  if (f.label !== 'all') rules.push({ field: 'label', op: 'is', value: f.label ?? 'none' })
  if (f.edited !== 'all') rules.push({ field: 'edited', op: 'is', value: f.edited === 'edited' })
  for (const word of f.text.trim().split(/\s+/).filter(Boolean))
    rules.push({ field: 'text', op: 'contains', value: word })
  if (f.camera) rules.push({ field: 'camera', op: 'is', value: f.camera })
  if (f.lens) rules.push({ field: 'lens', op: 'is', value: f.lens })
  if (f.kind !== 'all') rules.push({ field: 'kind', op: 'is', value: f.kind })
  if (f.iso) rules.push({ field: 'iso', op: 'between', value: f.iso })
  if (f.focal) rules.push({ field: 'focal', op: 'between', value: f.focal })
  if (f.from || f.to)
    rules.push({ field: 'captured', op: 'between', value: [f.from || EARLIEST, f.to || LATEST] })
  if (f.keyword) rules.push({ field: 'keyword', op: 'is', value: f.keyword })
  return { match: 'all', rules }
}

/** The items that pass the filter, in their order. */
export function applyFilter(items: LibraryItem[], f: Filter, now = new Date()): LibraryItem[] {
  const g = filterRules(f)
  if (g.rules.length === 0) return items
  const ctx = { now, members: () => undefined }
  return items.filter((it) => matchSmart(it, g, ctx))
}

/** How many of the popover's filters (beyond the bar's own) are narrowing the view. */
export function extraFilterCount(f: Filter): number {
  return [f.camera, f.lens, f.kind !== 'all', f.iso, f.focal, f.from || f.to, f.keyword].filter(
    Boolean
  ).length
}
