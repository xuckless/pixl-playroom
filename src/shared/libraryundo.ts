/**
 * ARCHITECTURE — the Library's undo stack (pure; the renderer's
 * state/libraryUndo.ts runs it).
 *
 * The Library has one undo stack, ⌘Z / ⇧⌘Z while the Library is shown, and
 * the Undo of every toast that changed more than one photo. Each entry is one
 * of two kinds:
 *
 * - **meta**: ratings, flags and colour labels. They are not history steps,
 *   so the entry keeps what each photo had before and what was set; undo puts
 *   the old values back only on photos that still have what the entry set
 *   (a photo rated again since keeps its newer rating).
 * - **recipe**: a batch of settings written by main/batchcommit.ts (paste,
 *   sync, auto white balance, later looks and Quick develop). The entry keeps
 *   each photo's step seq; undo takes the step back through that photo's own
 *   history, only where it is still the newest step in effect, and says how
 *   many photos were skipped. Nothing is stored of the recipes themselves.
 *
 * The stack keeps the newest RING entries; a new entry ends what can be
 * redone, as any editor's does.
 */
import type { ColorLabel, Flag, MetaPatch } from './ipc'

/** How many entries the stack keeps. */
export const RING = 50

/** Above this many photos, a change asks first (⌘A and a digit is a classic accident). */
export const CONFIRM_ABOVE = 500

/** Steps per call when a batch is taken back or brought back. */
export const UNDO_CHUNK = 50

/** `xs` in runs of `size` (the last may be shorter); none for none. */
export function chunked<T>(xs: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += Math.max(1, size))
    out.push(xs.slice(i, i + Math.max(1, size)))
  return out
}

export interface MetaValues {
  rating: number
  flag: Flag
  label: ColorLabel
}

/** A batch's step on one photo (`seq` in its history). */
export interface StepRef {
  key: string
  seq: number
}

interface EntryBase {
  id: string
  /** What it did, short, for the Edit menu ("Undo Paste settings"). */
  title: string
}

export interface MetaEntry extends EntryBase {
  kind: 'meta'
  /** What was set, on every key. */
  patch: MetaPatch
  /** Each key's values before. */
  before: Record<string, MetaValues>
}

export interface RecipeEntry extends EntryBase {
  kind: 'recipe'
  steps: StepRef[]
}

export type UndoEntry = MetaEntry | RecipeEntry

export interface UndoStack {
  /** Oldest first: the last is what ⌘Z takes back. */
  done: UndoEntry[]
  /** Oldest first: the last is what ⇧⌘Z brings back. */
  undone: UndoEntry[]
}

export const EMPTY_STACK: UndoStack = { done: [], undone: [] }

/** How many photos an entry changed. */
export function entrySize(e: UndoEntry): number {
  return e.kind === 'meta' ? Object.keys(e.before).length : e.steps.length
}

/** A new entry on top: the oldest past RING goes, and nothing is left to redo. */
export function pushEntry(stack: UndoStack, e: UndoEntry, ring = RING): UndoStack {
  if (entrySize(e) === 0) return stack
  const done = [...stack.done, e]
  return { done: done.slice(Math.max(0, done.length - ring)), undone: [] }
}

/**
 * A batch that goes on growing (a nudge burst, a look's Amount or swap):
 * its entry, while it is still the newest, is replaced by the one it grew
 * into; otherwise the entry goes on top as a new one would. An entry left
 * with no step goes (the burst came back to where it started).
 */
export function replaceTop(stack: UndoStack, e: UndoEntry, ring = RING): UndoStack {
  const top = stack.done[stack.done.length - 1]
  if (top?.id !== e.id) return pushEntry(stack, e, ring)
  const rest = stack.done.slice(0, -1)
  return { done: entrySize(e) > 0 ? [...rest, e] : rest, undone: [] }
}

/** The batch's entry is the newest on the stack: it may still grow. */
export function onTop(stack: UndoStack, id: string): boolean {
  return stack.done[stack.done.length - 1]?.id === id
}

/**
 * A growing batch's steps after one more write: each photo written this
 * time (`keys`) has its new step, or none (its step was rewritten to change
 * nothing, so it is gone); every other photo keeps the step it had.
 */
export function mergeSteps(
  had: readonly StepRef[],
  keys: readonly string[],
  fresh: readonly StepRef[]
): StepRef[] {
  const written = new Set(keys)
  return [...had.filter((s) => !written.has(s.key)), ...fresh]
}

/** The entry `id` taken off the stack (undone out of order by its toast). */
export function withoutEntry(stack: UndoStack, id: string): UndoStack {
  return {
    done: stack.done.filter((e) => e.id !== id),
    undone: stack.undone.filter((e) => e.id !== id)
  }
}

/** After an undo: the entry moves to the redo side, holding only what was taken back. */
export function afterUndo(stack: UndoStack, e: UndoEntry, kept: UndoEntry | null): UndoStack {
  return {
    done: stack.done.filter((x) => x.id !== e.id),
    undone: kept && entrySize(kept) > 0 ? [...stack.undone, kept] : stack.undone
  }
}

/** After a redo: the entry back on the undo side, holding only what came back. */
export function afterRedo(stack: UndoStack, e: UndoEntry, kept: UndoEntry | null): UndoStack {
  return {
    done: kept && entrySize(kept) > 0 ? [...stack.done, kept] : stack.done,
    undone: stack.undone.filter((x) => x.id !== e.id)
  }
}

/** A photo's values with a patch laid on. */
export function patched(v: MetaValues, p: MetaPatch): MetaValues {
  return {
    rating: p.rating !== undefined ? Math.max(0, Math.min(5, p.rating)) : v.rating,
    flag: p.flag !== undefined ? p.flag : v.flag,
    label: p.label !== undefined ? p.label : v.label
  }
}

/** Whether a photo still has what the patch set (the fields it set, and only those). */
export function stillSet(v: MetaValues, p: MetaPatch): boolean {
  const want = patched(v, p)
  return want.rating === v.rating && want.flag === v.flag && want.label === v.label
}

/** The fields of `v` a patch touched, as a patch that puts them back. */
function restoring(v: MetaValues, p: MetaPatch): MetaPatch {
  const out: MetaPatch = {}
  if (p.rating !== undefined) out.rating = v.rating
  if (p.flag !== undefined) out.flag = v.flag
  if (p.label !== undefined) out.label = v.label
  return out
}

/**
 * What undoing a meta entry writes: one patch per distinct old value, with
 * the keys that take it, leaving out photos changed since (`now` says what
 * each has today; a photo gone from the listing is left too). `skipped`
 * names those left.
 */
export function metaUndoPlan(
  e: MetaEntry,
  now: (key: string) => MetaValues | undefined
): { writes: { patch: MetaPatch; keys: string[] }[]; skipped: string[] } {
  const groups = new Map<string, { patch: MetaPatch; keys: string[] }>()
  const skipped: string[] = []
  for (const [key, before] of Object.entries(e.before)) {
    const cur = now(key)
    if (!cur || !stillSet(cur, e.patch)) {
      skipped.push(key)
      continue
    }
    const patch = restoring(before, e.patch)
    const id = JSON.stringify(patch)
    const g = groups.get(id)
    if (g) g.keys.push(key)
    else groups.set(id, { patch, keys: [key] })
  }
  return { writes: [...groups.values()], skipped }
}

/**
 * What redoing a meta entry writes: the patch again, on photos that still
 * have what the undo put back (a photo changed since keeps its change).
 */
export function metaRedoPlan(
  e: MetaEntry,
  now: (key: string) => MetaValues | undefined
): { keys: string[]; skipped: string[] } {
  const keys: string[] = []
  const skipped: string[] = []
  for (const [key, before] of Object.entries(e.before)) {
    const cur = now(key)
    if (cur && stillSet(cur, restoring(before, e.patch))) keys.push(key)
    else skipped.push(key)
  }
  return { keys, skipped }
}

/**
 * What each of `keys` has now, from `items` (the listing shown, then main's
 * answer for the rest): the values found, added to `into`, and the keys
 * still missing. An undo checks a photo rated in another folder too.
 */
export function metaValuesOf(
  items: Iterable<({ key: string } & MetaValues) | undefined>,
  keys: readonly string[],
  into = new Map<string, MetaValues>()
): { now: Map<string, MetaValues>; missing: string[] } {
  const want = new Set(keys)
  for (const it of items)
    if (it && want.has(it.key))
      into.set(it.key, { rating: it.rating, flag: it.flag, label: it.label })
  return { now: into, missing: keys.filter((k) => !into.has(k)) }
}

/** The entry cut down to `keys` (what an undo or redo actually changed). */
export function onlyKeys<E extends UndoEntry>(e: E, keys: readonly string[]): E {
  const keep = new Set(keys)
  if (e.kind === 'meta')
    return {
      ...e,
      before: Object.fromEntries(Object.entries(e.before).filter(([k]) => keep.has(k)))
    } as E
  return { ...e, steps: e.steps.filter((s) => keep.has(s.key)) } as E
}
