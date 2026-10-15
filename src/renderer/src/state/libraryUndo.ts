/**
 * ARCHITECTURE — the Library's undo stack, run (the rules are pure, in
 * shared/libraryundo.ts).
 *
 * One stack for the Library: ⌘Z / ⇧⌘Z while the Library is shown, the Edit
 * menu's Undo there (named after the entry), and the Undo of every toast that
 * changed more than one photo, in either view. What goes on it:
 *
 * - `setMeta` (state/library.ts) pushes a **meta** entry for each rating,
 *   flag or colour label change.
 * - `runRecipeBatch` (lib/batch.ts) pushes a **recipe** entry for each
 *   batch of settings: paste, sync, auto white balance, and the looks and
 *   Quick develop nudges built on it. Its undo and redo go through each
 *   photo's own history in main (main/batchcommit.ts).
 *
 * The API the culling and Quick develop work builds on: `pushUndo`,
 * `undoLibrary`, `redoLibrary`, `undoAction` (a toast's Undo button) and
 * `undoTitles` (what ⌘Z would take back, for menus and hints).
 */
import { create } from 'zustand'
import {
  afterRedo,
  afterUndo,
  EMPTY_STACK,
  metaRedoPlan,
  metaUndoPlan,
  onlyKeys,
  pushEntry,
  withoutEntry,
  type MetaEntry,
  type MetaValues,
  type RecipeEntry,
  type UndoEntry,
  type UndoStack
} from '../../../shared/libraryundo'
import type { BatchUndoResult } from '../../../shared/ipc'
import { api, errorText } from '../lib/api'
import { t, tp } from '../lib/i18n'
import { useLibrary, type ToastAction } from './library'

export const useLibraryUndo = create<UndoStack>(() => EMPTY_STACK)

/** Put an entry on top of the stack (it ends what can be redone). */
export function pushUndo(e: UndoEntry): void {
  useLibraryUndo.setState((s) => pushEntry(s, e))
}

/** What ⌘Z in the Library would take back, and what ⇧⌘Z would bring back. */
export function undoTitles(): { undo: string | null; redo: string | null } {
  const { done, undone } = useLibraryUndo.getState()
  return {
    undo: done[done.length - 1]?.title ?? null,
    redo: undone[undone.length - 1]?.title ?? null
  }
}

/** A toast's Undo: this entry, wherever it is on the stack. */
export function undoAction(e: UndoEntry): ToastAction {
  return { label: t('Undo'), run: () => void undoLibrary(e.id) }
}

/** One write at a time: an undo pressed twice quickly takes back two entries, in order. */
let running: Promise<unknown> = Promise.resolve()
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const p = running.then(fn, fn)
  running = p.catch(() => undefined)
  return p
}

const valuesNow = (key: string): MetaValues | undefined => {
  const it = useLibrary.getState().items.find((i) => i.key === key)
  return it && { rating: it.rating, flag: it.flag, label: it.label }
}

/** The photo open in Develop shows what a batch's undo or redo wrote (its recipe and history). */
let developFollows: (keys: string[]) => Promise<void> = () => Promise.resolve()
/** Set by lib/batch.ts (which knows Develop), so this module needs no Develop import. */
export function onBatchWritten(fn: (keys: string[]) => Promise<void>): void {
  developFollows = fn
}

async function runRecipe(e: RecipeEntry, redo: boolean): Promise<BatchUndoResult> {
  const r = redo ? await api.library.redoBatch(e.steps) : await api.library.undoBatch(e.steps)
  useLibrary.getState().patchItems(r.items)
  await developFollows(r.done).catch(() => undefined)
  return r
}

async function runMeta(
  e: MetaEntry,
  redo: boolean
): Promise<{ done: string[]; skipped: string[] }> {
  const lib = useLibrary.getState()
  if (redo) {
    const plan = metaRedoPlan(e, valuesNow)
    if (plan.keys.length > 0 && !(await lib.writeMeta(e.patch, plan.keys)))
      return { done: [], skipped: Object.keys(e.before) }
    return { done: plan.keys, skipped: plan.skipped }
  }
  const plan = metaUndoPlan(e, valuesNow)
  const done: string[] = []
  for (const w of plan.writes) if (await lib.writeMeta(w.patch, w.keys)) done.push(...w.keys)
  return { done, skipped: plan.skipped }
}

/** What an undo or redo did, said (and how many photos a later edit kept as they are). */
function report(e: UndoEntry, redo: boolean, done: number, skipped: number): void {
  const lib = useLibrary.getState()
  if (done === 0) {
    lib.say(
      skipped > 0
        ? t('Nothing to undo: every photo was changed since')
        : redo
          ? t('Nothing to redo')
          : t('Nothing to undo')
    )
    return
  }
  const what = redo
    ? t('Redone: {{what}}', { what: e.title })
    : t('Undone: {{what}}', { what: e.title })
  const on = tp('on {{count}} photo', 'on {{count}} photos', done)
  const kept =
    skipped > 0
      ? ` · ${tp('{{count}} edited since, kept', '{{count}} edited since, kept', skipped)}`
      : ''
  lib.say(`${what} ${on}${kept}`)
}

/**
 * Undo the newest entry, or the entry `id` (a toast's Undo, which may no
 * longer be the newest: it is taken back all the same, only where nothing
 * changed it since). Resolves once it is written.
 */
export function undoLibrary(id?: string): Promise<void> {
  return inTurn(async () => {
    const { done } = useLibraryUndo.getState()
    const e = id ? done.find((x) => x.id === id) : done[done.length - 1]
    if (!e) {
      if (!id) useLibrary.getState().say(t('Nothing to undo'))
      return
    }
    const newest = done[done.length - 1]?.id === e.id
    try {
      const r = e.kind === 'meta' ? await runMeta(e, false) : await runRecipe(e, false)
      const kept = onlyKeys(e, r.done)
      // Taken back out of order: redoing it later could undo what came after.
      useLibraryUndo.setState((s) => (newest ? afterUndo(s, e, kept) : withoutEntry(s, e.id)))
      report(e, false, r.done.length, r.skipped.length)
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
    }
  })
}

/** Redo what the last undo took back. */
export function redoLibrary(): Promise<void> {
  return inTurn(async () => {
    const { undone } = useLibraryUndo.getState()
    const e = undone[undone.length - 1]
    if (!e) {
      useLibrary.getState().say(t('Nothing to redo'))
      return
    }
    try {
      const r = e.kind === 'meta' ? await runMeta(e, true) : await runRecipe(e, true)
      useLibraryUndo.setState((s) => afterRedo(s, e, onlyKeys(e, r.done)))
      report(e, true, r.done.length, r.skipped.length)
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
    }
  })
}
