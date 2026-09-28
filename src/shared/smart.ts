/**
 * Smart collections: a rule tree over what the library knows of each item.
 * Evaluated in memory, by the index host for a smart collection and by the
 * renderer's filter bar, so both agree on what a rule means.
 */
import type { LibraryItem } from './ipc'

export type SmartField =
  | 'rating'
  | 'flag'
  | 'label'
  | 'edited'
  | 'kind'
  | 'ext'
  | 'name'
  | 'folder'
  | 'title'
  | 'caption'
  | 'keyword'
  | 'text'
  | 'camera'
  | 'lens'
  | 'iso'
  | 'focal'
  | 'aperture'
  | 'shutter'
  | 'captured'
  | 'collection'

export type SmartOp =
  | 'is'
  | 'isNot'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'gte'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'inLast'
  | 'isEmpty'
  | 'isNotEmpty'

export interface SmartRule {
  field: SmartField
  op: SmartOp
  /**
   * What the rule compares against, by the field's `SMART_FIELDS[field].type`:
   * a number (a pair for `between`), text, true/false for `edited`, an enum
   * value (`flag`/`label` take 'none' for unset), a collection id, or for
   * `captured` an ISO date (`YYYY-MM-DD`, local) or a pair of them; `inLast`
   * takes a count and `unit`.
   */
  value?: string | number | boolean | null | [number, number] | [string, string]
  /** For `inLast`. */
  unit?: 'days' | 'weeks' | 'months' | 'years'
}

export interface SmartGroup {
  match: 'all' | 'any' | 'none'
  rules: (SmartRule | SmartGroup)[]
}

export const isGroup = (r: SmartRule | SmartGroup): r is SmartGroup =>
  (r as SmartGroup).rules !== undefined

// ── what the rule editor needs: each field's kind of value and its operators ──

export type SmartValueType =
  'number' | 'rating' | 'text' | 'enum' | 'boolean' | 'date' | 'collection'

export interface SmartFieldInfo {
  label: string
  type: SmartValueType
  /** The operators that make sense for the field, the first the default. */
  ops: SmartOp[]
  /** For `enum` fields. */
  options?: { value: string; label: string }[]
  /** Shown beside a number (the value itself is in these units). */
  unit?: string
}

const TEXT_OPS: SmartOp[] = [
  'contains',
  'notContains',
  'is',
  'isNot',
  'startsWith',
  'isEmpty',
  'isNotEmpty'
]
const NUMBER_OPS: SmartOp[] = ['is', 'isNot', 'gte', 'lte', 'between', 'isEmpty', 'isNotEmpty']

export const SMART_FIELDS: Record<SmartField, SmartFieldInfo> = {
  rating: { label: 'Rating', type: 'rating', ops: ['gte', 'lte', 'is', 'isNot', 'between'] },
  flag: {
    label: 'Flag',
    type: 'enum',
    ops: ['is', 'isNot'],
    options: [
      { value: 'pick', label: 'Picked' },
      { value: 'reject', label: 'Rejected' },
      { value: 'none', label: 'Unflagged' }
    ]
  },
  label: {
    label: 'Colour label',
    type: 'enum',
    ops: ['is', 'isNot', 'isEmpty', 'isNotEmpty'],
    options: [
      { value: 'red', label: 'Red' },
      { value: 'yellow', label: 'Yellow' },
      { value: 'green', label: 'Green' },
      { value: 'blue', label: 'Blue' },
      { value: 'purple', label: 'Purple' },
      { value: 'none', label: 'None' }
    ]
  },
  edited: { label: 'Edited', type: 'boolean', ops: ['is'] },
  kind: {
    label: 'File kind',
    type: 'enum',
    ops: ['is', 'isNot'],
    options: [
      { value: 'raw', label: 'RAW' },
      { value: 'nonraw', label: 'Not RAW' }
    ]
  },
  ext: { label: 'Extension', type: 'text', ops: ['is', 'isNot'] },
  name: { label: 'File name', type: 'text', ops: TEXT_OPS },
  folder: { label: 'Folder', type: 'text', ops: TEXT_OPS },
  title: { label: 'Title', type: 'text', ops: TEXT_OPS },
  caption: { label: 'Caption', type: 'text', ops: TEXT_OPS },
  keyword: {
    label: 'Keyword',
    type: 'text',
    ops: ['is', 'isNot', 'contains', 'notContains', 'startsWith', 'isEmpty', 'isNotEmpty']
  },
  text: { label: 'Any text', type: 'text', ops: ['contains', 'notContains'] },
  camera: { label: 'Camera', type: 'text', ops: TEXT_OPS },
  lens: { label: 'Lens', type: 'text', ops: TEXT_OPS },
  iso: { label: 'ISO', type: 'number', ops: NUMBER_OPS },
  focal: { label: 'Focal length', type: 'number', ops: NUMBER_OPS, unit: 'mm' },
  aperture: { label: 'Aperture', type: 'number', ops: NUMBER_OPS, unit: 'f/' },
  shutter: { label: 'Shutter speed', type: 'number', ops: NUMBER_OPS, unit: 's' },
  captured: {
    label: 'Capture date',
    type: 'date',
    ops: ['inLast', 'before', 'after', 'between', 'isEmpty', 'isNotEmpty']
  },
  collection: { label: 'Collection', type: 'collection', ops: ['is', 'isNot'] }
}

export const SMART_OPS: Record<SmartOp, string> = {
  is: 'is',
  isNot: 'is not',
  contains: 'contains',
  notContains: 'does not contain',
  startsWith: 'starts with',
  gte: 'is at least',
  lte: 'is at most',
  between: 'is between',
  before: 'is before',
  after: 'is after',
  inLast: 'is in the last',
  isEmpty: 'is empty',
  isNotEmpty: 'is not empty'
}

/** Operators that take no value. */
export const opTakesValue = (op: SmartOp): boolean => op !== 'isEmpty' && op !== 'isNotEmpty'

/** A fresh rule for a field: its default operator and a harmless value. */
export function defaultRule(field: SmartField): SmartRule {
  const info = SMART_FIELDS[field]
  const op = info.ops[0]
  switch (info.type) {
    case 'rating':
      return { field, op, value: 3 }
    case 'number':
      return { field, op, value: 0 }
    case 'boolean':
      return { field, op, value: true }
    case 'enum':
      return { field, op, value: info.options?.[0].value ?? null }
    case 'date':
      return { field, op: 'inLast', value: 30, unit: 'days' }
    default:
      return { field, op, value: '' }
  }
}

/** A rule in words ("Rating is at least 3"), for tooltips and summaries. */
export function describeRule(r: SmartRule, collectionName?: (id: string) => string): string {
  const info = SMART_FIELDS[r.field]
  const head = `${info.label} ${SMART_OPS[r.op]}`
  if (!opTakesValue(r.op)) return head
  const v = r.value
  if (r.op === 'inLast') return `${head} ${v} ${r.unit ?? 'days'}`
  if (Array.isArray(v)) return `${head} ${v[0]} and ${v[1]}`
  if (info.type === 'enum') return `${head} ${info.options?.find((o) => o.value === v)?.label ?? v}`
  if (info.type === 'collection') return `${head} ${collectionName?.(String(v)) ?? v}`
  if (info.type === 'boolean') return `${head} ${v ? 'yes' : 'no'}`
  return `${head} ${v ?? ''}`.trimEnd()
}

// ── evaluation ──

export interface SmartContext {
  now: Date
  /** The keys of a collection's items; undefined for an unknown collection (or a cycle). */
  members: (collectionId: string) => Set<string> | undefined
}

/** The camera as one name: make and model, the make once when the model repeats it. */
export function cameraName(item: Pick<LibraryItem, 'camera'>): string {
  const { make, model } = item.camera
  if (make && model && model.toLowerCase().startsWith(make.toLowerCase())) return model
  return [make, model].filter(Boolean).join(' ')
}

/** Everything the "text" field searches, lower-cased, one string per source. */
export function itemTexts(item: LibraryItem): string[] {
  return [
    item.name,
    item.copyName,
    item.title,
    item.caption,
    ...item.keywords,
    item.camera.make,
    item.camera.model,
    item.camera.lens
  ]
    .filter((s): s is string => !!s)
    .map((s) => s.toLowerCase())
}

const lower = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).toLowerCase()

function textMatch(values: string[], op: SmartOp, value: unknown): boolean {
  const want = lower(value)
  const vals = values.map(lower).filter((s) => s !== '')
  switch (op) {
    case 'is':
      return vals.some((s) => s === want)
    case 'isNot':
      return !vals.some((s) => s === want)
    case 'contains':
      return vals.some((s) => s.includes(want))
    case 'notContains':
      return !vals.some((s) => s.includes(want))
    case 'startsWith':
      return vals.some((s) => s.startsWith(want))
    case 'isEmpty':
      return vals.length === 0
    case 'isNotEmpty':
      return vals.length > 0
    default:
      return false
  }
}

/** Equal enough: an aperture of 2.8 or a shutter of 1/250 s read back as floats. */
const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= Math.max(1e-9, Math.abs(b) * 1e-3)

function numberMatch(n: number | null, op: SmartOp, value: unknown): boolean {
  if (op === 'isEmpty') return n === null
  if (op === 'isNotEmpty') return n !== null
  if (op === 'isNot') return n === null || !near(n, Number(value))
  if (n === null) return false
  switch (op) {
    case 'is':
      return near(n, Number(value))
    case 'gte':
      return n >= Number(value) || near(n, Number(value))
    case 'lte':
      return n <= Number(value) || near(n, Number(value))
    case 'between': {
      if (!Array.isArray(value)) return false
      const [a, b] = [Number(value[0]), Number(value[1])]
      const [lo, hi] = a <= b ? [a, b] : [b, a]
      return (n >= lo || near(n, lo)) && (n <= hi || near(n, hi))
    }
    default:
      return false
  }
}

/** A date-only value is a local calendar day; anything else is parsed as it is. */
function dayStart(v: unknown): number {
  const s = String(v ?? '')
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
  return new Date(s).getTime()
}

const isDay = (v: unknown): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''))

/** The end of a value: the next day's start for a day, the instant itself otherwise. */
function dayEnd(v: unknown): number {
  const start = dayStart(v)
  if (!isDay(v)) return start
  const d = new Date(start)
  d.setDate(d.getDate() + 1)
  return d.getTime()
}

function dateMatch(iso: string | null, r: SmartRule, now: Date): boolean {
  const t = iso ? new Date(iso).getTime() : NaN
  const has = Number.isFinite(t)
  if (r.op === 'isEmpty') return !has
  if (r.op === 'isNotEmpty') return has
  if (!has) return false
  switch (r.op) {
    case 'before':
      return t < dayStart(r.value)
    case 'after':
      return t >= dayEnd(r.value)
    case 'between': {
      if (!Array.isArray(r.value)) return false
      const a = dayStart(r.value[0])
      const b = dayStart(r.value[1])
      const [lo, hi] = a <= b ? [r.value[0], r.value[1]] : [r.value[1], r.value[0]]
      return t >= dayStart(lo) && t < dayEnd(hi)
    }
    case 'inLast': {
      const n = Number(r.value)
      if (!Number.isFinite(n)) return false
      const from = new Date(now)
      const unit = r.unit ?? 'days'
      if (unit === 'days') from.setDate(from.getDate() - n)
      else if (unit === 'weeks') from.setDate(from.getDate() - 7 * n)
      else if (unit === 'months') from.setMonth(from.getMonth() - n)
      else from.setFullYear(from.getFullYear() - n)
      return t >= from.getTime() && t <= now.getTime()
    }
    default:
      return false
  }
}

/** A keyword rule: `is` a path means that keyword or any keyword under it. */
function keywordMatch(keywords: string[], op: SmartOp, value: unknown): boolean {
  const want = lower(value)
  const under = (k: string): boolean => {
    const s = k.toLowerCase()
    return s === want || s.startsWith(want + '|')
  }
  // Text ops look at each level, so "contains can" finds "Places|Canada".
  const levels = keywords.flatMap((k) => k.split('|'))
  switch (op) {
    case 'is':
      return keywords.some(under)
    case 'isNot':
      return !keywords.some(under)
    case 'isEmpty':
      return keywords.length === 0
    case 'isNotEmpty':
      return keywords.length > 0
    default:
      return textMatch(levels, op, value)
  }
}

export function matchRule(item: LibraryItem, r: SmartRule, ctx: SmartContext): boolean {
  const c = item.camera
  switch (r.field) {
    case 'rating':
      return numberMatch(item.rating, r.op, r.value)
    case 'flag': {
      const want = r.value === null || r.value === 'none' ? null : r.value
      return r.op === 'isNot' ? item.flag !== want : item.flag === want
    }
    case 'label': {
      if (r.op === 'isEmpty') return item.label === null
      if (r.op === 'isNotEmpty') return item.label !== null
      const want = r.value === null || r.value === 'none' ? null : r.value
      return r.op === 'isNot' ? item.label !== want : item.label === want
    }
    case 'edited':
      return r.op === 'isNot' ? item.edited !== !!r.value : item.edited === !!r.value
    case 'kind': {
      const raw = r.value === 'raw'
      return r.op === 'isNot' ? item.isRaw !== raw : item.isRaw === raw
    }
    case 'ext':
      return textMatch([item.ext.replace(/^\./, '')], r.op, lower(r.value).replace(/^\./, ''))
    case 'name':
      return textMatch([item.name, item.copyName ?? ''], r.op, r.value)
    case 'folder':
      return textMatch([item.folder], r.op, r.value)
    case 'title':
      return textMatch([item.title ?? ''], r.op, r.value)
    case 'caption':
      return textMatch([item.caption ?? ''], r.op, r.value)
    case 'keyword':
      return keywordMatch(item.keywords, r.op, r.value)
    case 'text':
      return textMatch(itemTexts(item), r.op, r.value)
    case 'camera': {
      // "Canon" and "EOS R5" both find a Canon EOS R5.
      const name = cameraName(item)
      const values = r.op === 'is' || r.op === 'isNot' ? [name, c.model ?? ''] : [name]
      return textMatch(values, r.op, r.value)
    }
    case 'lens':
      return textMatch([c.lens ?? ''], r.op, r.value)
    case 'iso':
      return numberMatch(c.iso, r.op, r.value)
    case 'focal':
      return numberMatch(c.focalLength, r.op, r.value)
    case 'aperture':
      return numberMatch(c.fNumber, r.op, r.value)
    case 'shutter':
      return numberMatch(c.exposureTime, r.op, r.value)
    case 'captured':
      return dateMatch(c.capturedAt, r, ctx.now)
    case 'collection': {
      const inIt = ctx.members(String(r.value ?? ''))?.has(item.key) ?? false
      return r.op === 'isNot' ? !inIt : inIt
    }
    default:
      return false
  }
}

/** Whether an item matches a rule group. An empty group matches everything. */
export function matchSmart(item: LibraryItem, g: SmartGroup, ctx: SmartContext): boolean {
  if (g.rules.length === 0) return true
  const one = (r: SmartRule | SmartGroup): boolean =>
    isGroup(r) ? matchSmart(item, r, ctx) : matchRule(item, r, ctx)
  if (g.match === 'all') return g.rules.every(one)
  if (g.match === 'any') return g.rules.some(one)
  return !g.rules.some(one)
}

/** The collection ids a rule tree names, at any depth. */
export function referencedCollections(g: SmartGroup): string[] {
  return g.rules.flatMap((r) =>
    isGroup(r) ? referencedCollections(r) : r.field === 'collection' ? [String(r.value ?? '')] : []
  )
}

/** A rule tree with its collection references renamed (import gives collections new ids). */
export function remapCollections(g: SmartGroup, map: (id: string) => string): SmartGroup {
  return {
    match: g.match,
    rules: g.rules.map((r) =>
      isGroup(r)
        ? remapCollections(r, map)
        : r.field === 'collection'
          ? { ...r, value: map(String(r.value ?? '')) }
          : r
    )
  }
}

export interface SmartCollectionDef {
  id: string
  kind: 'manual' | 'smart' | 'set'
  parent: string | null
  rules: SmartGroup | null
}

/**
 * Every collection's members, resolved on demand over one set of items: a
 * manual collection's from `manual`, a smart one's by its rules, a set's as
 * the union of its children. A collection met again while it is being
 * resolved (A's rules name B, B's name A) counts as empty there instead of
 * recursing forever. Results are kept for the resolver's life.
 */
export function memberResolver(opts: {
  collections: SmartCollectionDef[]
  items: LibraryItem[]
  manual: (id: string) => Set<string>
  now: Date
}): (id: string) => Set<string> | undefined {
  const byId = new Map(opts.collections.map((c) => [c.id, c]))
  const children = new Map<string, string[]>()
  for (const c of opts.collections) {
    if (c.parent === null) continue
    const list = children.get(c.parent)
    if (list) list.push(c.id)
    else children.set(c.parent, [c.id])
  }
  const done = new Map<string, Set<string>>()
  const visiting = new Set<string>()
  const resolve = (id: string): Set<string> | undefined => {
    const hit = done.get(id)
    if (hit) return hit
    const c = byId.get(id)
    if (!c || visiting.has(id)) return undefined
    visiting.add(id)
    let out: Set<string>
    try {
      if (c.kind === 'manual') out = opts.manual(id)
      else if (c.kind === 'smart') {
        const rules = c.rules ?? { match: 'all', rules: [] }
        const ctx: SmartContext = { now: opts.now, members: resolve }
        out = new Set(opts.items.filter((it) => matchSmart(it, rules, ctx)).map((it) => it.key))
      } else {
        out = new Set()
        for (const child of children.get(id) ?? []) for (const k of resolve(child) ?? []) out.add(k)
      }
    } finally {
      visiting.delete(id)
    }
    done.set(id, out)
    return out
  }
  return resolve
}
