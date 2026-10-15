/**
 * ARCHITECTURE — the Library's command context: what a key in the Library
 * acts on, for the commands (lib/commands.ts) and menus (lib/menus.ts).
 *
 * - `libraryMode()`: the Library's view, Grid, Loupe, Compare or Survey
 *   (lib/librarymodes.ts runs them); each view's own commands listen in its
 *   key context (`library.grid`, `library.loupe` …, lib/keys.ts) through
 *   `inGrid()` and `inMode()`.
 * - `metaTargets()` (UX-13): rating, flag and label keys act on the
 *   selection only in the Grid; in Develop, the Loupe and Survey on the
 *   photo shown, in Compare on the pane picked.
 * - `metaItem()`: the photo whose rating, flag or label a menu shows checked.
 * - `developBatch()`: in Develop, ⌘Z right after a paste or sync on several
 *   photos takes the whole batch back, not the open photo's share alone.
 * - The grid's layout (`setGridLayout`, from the virtualised grid) and
 *   `gridStep`: ↑/↓ by row, Home/End, PgUp/PgDn, ⇧ extending the selection.
 */
import { gridMove, metaTargetsFor, type GridMove, type LibraryMode } from '../../../shared/cullnav'
import { batchOf, newestShown, nextRedo } from '../../../shared/history'
import type { LibraryItem } from '../../../shared/ipc'
import type { RecipeEntry } from '../../../shared/libraryundo'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { useLibraryUndo } from '../state/libraryUndo'

export function libraryMode(): LibraryMode {
  return useLibrary.getState().mode
}

/** The Library is up, showing its grid. */
export function inGrid(): boolean {
  return inMode('grid')
}

/** The Library is up, in one of these views. */
export function inMode(...modes: LibraryMode[]): boolean {
  const l = useLibrary.getState()
  return l.view === 'library' && modes.includes(l.mode)
}

/** The photos a rating, flag or label key acts on now. */
export function metaTargets(): string[] {
  const l = useLibrary.getState()
  return metaTargetsFor({
    view: l.view,
    mode: l.mode,
    selection: l.selection,
    focus: l.focus,
    open: useDevelop.getState().session?.key ?? null,
    active: l.mode === 'compare' && l.active === 'candidate' ? l.candidate : null
  })
}

/**
 * The photo whose rating, flag and label the keys and menus read: the shown
 * one in Develop, Compare's picked pane, else the focus.
 */
export function metaItem(): LibraryItem | undefined {
  const l = useLibrary.getState()
  const key =
    l.view === 'develop'
      ? (useDevelop.getState().session?.key ?? l.focus)
      : l.mode === 'compare' && l.active === 'candidate'
        ? l.candidate
        : l.focus
  return l.items.find((i) => i.key === key)
}

/**
 * The Library batch ⌘Z (or ⇧⌘Z) in Develop should take back whole: the open
 * photo's next step to undo (or redo) is a batch's that changed several
 * photos, and that batch is the newest on the Library's stack. Null
 * otherwise (Develop's own undo then).
 */
export function developBatch(redo: boolean): RecipeEntry | null {
  const steps = useDevelop.getState().history.steps
  const step = redo ? nextRedo(steps) : newestShown(steps)
  const id = step ? batchOf(step.label) : null
  if (!id) return null
  const { done, undone } = useLibraryUndo.getState()
  const top = redo ? undone[undone.length - 1] : done[done.length - 1]
  return top?.kind === 'recipe' && top.id === id && top.steps.length > 1 ? top : null
}

/** The grid as laid out: its rows of keys, and how many rows a page shows. */
let layout: { rows: string[][]; pageRows: number } = { rows: [], pageRows: 1 }

/** The grid says how it lays its photos out (each change of columns, rows or size). */
export function setGridLayout(rows: string[][], pageRows: number): void {
  layout = { rows, pageRows: Math.max(1, pageRows) }
}

/** Move the grid's focus; with `extend`, the selection runs from its anchor to the new focus. */
export function gridStep(move: GridMove, extend: boolean): boolean {
  const l = useLibrary.getState()
  const rows = layout.rows.length > 0 ? layout.rows : [l.visible().map((i) => i.key)]
  const to = gridMove(rows, l.focus, move, layout.pageRows)
  if (!to) return false
  l.moveTo(to, extend)
  return true
}
