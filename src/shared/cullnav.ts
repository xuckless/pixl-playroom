/**
 * ARCHITECTURE — moving through the Library while culling (pure; the
 * renderer's lib/librarycontext.ts and state/library.ts use it).
 *
 * - **Grid moves**: ↑/↓ by row, Home/End, PgUp/PgDn over the grid's rows as
 *   the grid lays them out (a duplicates group starts a row of its own, so
 *   rows are not all the same length); ⇧ extends the selection from its
 *   anchor.
 * - **Sticky hide**: a photo the filter now hides (rejecting it while
 *   rejects are hidden, the default) stays where it is, dimmed and tagged,
 *   while it has the focus; the grid never reflows under the pointer. The
 *   pinned key goes into the visible list's memo (`keepPinned`).
 * - **Who a rating key acts on** (UX-13): the selection only in the Grid;
 *   anywhere a single photo is shown (Develop, and the Library's Loupe,
 *   Compare and Survey), the shown photo only: in Compare, the pane picked.
 * - **The culling views** (lib/librarymodes.ts runs them): Compare's Select
 *   and Candidate (`compareStart`, `promoted`, `stepFrom` past the Select),
 *   Survey's tiles (`surveyOf`, `dropFrom`, `restoreTo`, `surveyLayout`) and
 *   auto-advance with Caps Lock flipping it (`advancing`).
 */

/** Where the Library is: the grid, or (from the culling views) one photo or a few. */
export type LibraryMode = 'grid' | 'loupe' | 'compare' | 'survey'

export type GridMove = 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown'

/**
 * The key a move lands on: `rows` are the grid's rows of keys, top to
 * bottom; `pageRows` how many rows a page holds. Up and down keep the
 * column (the last tile of a shorter row when the column is past its end).
 * Null when there is nothing to move to.
 */
export function gridMove(
  rows: readonly (readonly string[])[],
  focus: string | null,
  move: GridMove,
  pageRows = 1
): string | null {
  const filled = rows.filter((r) => r.length > 0)
  if (filled.length === 0) return null
  const first = filled[0][0]
  const lastRow = filled[filled.length - 1]
  const last = lastRow[lastRow.length - 1]
  if (move === 'home') return first
  if (move === 'end') return last
  let r = -1
  let c = 0
  if (focus !== null)
    for (let i = 0; i < filled.length && r < 0; i++) {
      const j = filled[i].indexOf(focus)
      if (j >= 0) {
        r = i
        c = j
      }
    }
  // Nothing focused (or it went): a move down starts at the top, up at the bottom.
  if (r < 0) return move === 'up' || move === 'pageUp' ? last : first
  const by = move === 'up' ? -1 : move === 'down' ? 1 : move === 'pageUp' ? -pageRows : pageRows
  const to = Math.max(0, Math.min(filled.length - 1, r + Math.sign(by) * Math.max(1, Math.abs(by))))
  // Past the first or last row, a page move goes to the end of the grid.
  if (to === r) {
    if (move === 'pageUp') return first
    if (move === 'pageDown') return last
    return filled[r][c]
  }
  const row = filled[to]
  return row[Math.min(c, row.length - 1)]
}

/** The keys from `anchor` to `key` along `order` (both ends included). */
export function rangeKeys(order: readonly string[], anchor: string | null, key: string): string[] {
  const b = order.indexOf(key)
  if (b < 0) return [key]
  const a = anchor === null ? -1 : order.indexOf(anchor)
  if (a < 0) return [key]
  const [lo, hi] = a < b ? [a, b] : [b, a]
  return order.slice(lo, hi + 1)
}

/**
 * The items the filter let through (`passed`, in any order) with the pinned
 * one kept, all in `all`'s order. `passed` comes back as it is when the
 * pinned one is in it already, or there is none.
 */
export function keepPinned<T extends { key: string }>(
  all: readonly T[],
  passed: T[],
  pinned: string | null
): T[] {
  if (pinned === null || passed.some((i) => i.key === pinned)) return passed
  if (!all.some((i) => i.key === pinned)) return passed
  const keep = new Set(passed.map((i) => i.key))
  keep.add(pinned)
  return all.filter((i) => keep.has(i.key))
}

/**
 * Whether the pinned item shows only because it is pinned (the filter,
 * `passes`, would hide it): it is not counted among the photos shown.
 */
export function pinnedOnly<T extends { key: string }>(
  items: readonly T[],
  pinned: string | null,
  passes: (item: T) => boolean
): boolean {
  if (pinned === null) return false
  const it = items.find((i) => i.key === pinned)
  return it !== undefined && !passes(it)
}

/**
 * The photos a rating, flag or label key acts on (UX-13): the selection (or
 * the focus) in the Grid; the shown photo in Develop and in the Library's
 * single-photo modes (in Compare, the pane picked: `active`).
 */
export function metaTargetsFor(s: {
  view: 'library' | 'develop'
  mode: LibraryMode
  selection: readonly string[]
  focus: string | null
  /** The photo Develop shows. */
  open: string | null
  /** Compare's picked pane's photo, when it is the Candidate. */
  active?: string | null
}): string[] {
  if (s.view === 'develop') {
    const k = s.open ?? s.focus
    return k ? [k] : []
  }
  if (s.mode === 'compare' && s.active) return [s.active]
  if (s.mode !== 'grid') return s.focus ? [s.focus] : []
  return s.selection.length > 0 ? [...s.selection] : s.focus ? [s.focus] : []
}

// ── the culling views (Loupe, Compare, Survey) ──

/**
 * The photo `dir` steps from `from` along `order`, passing over `skip`
 * (Compare's Select, when its Candidate moves). Null at either end.
 */
export function stepFrom(
  order: readonly string[],
  from: string | null,
  dir: 1 | -1,
  skip: string | null = null
): string | null {
  let i = from === null ? -1 : order.indexOf(from)
  if (i < 0) return order.find((k) => k !== skip) ?? null
  for (;;) {
    i += dir
    if (i < 0 || i >= order.length) return null
    if (order[i] !== skip) return order[i]
  }
}

/** The photo after `key` (before it, at the end), passing over `skip`: what comes up next. */
export function nextOrBefore(
  order: readonly string[],
  key: string | null,
  skip: string | null = null
): string | null {
  return stepFrom(order, key, 1, skip) ?? stepFrom(order, key, -1, skip)
}

/**
 * What Compare opens on: exactly two photos selected, those two (the
 * focused one the Select); otherwise the focus and the next photo shown.
 * Null with fewer than two photos.
 */
export function compareStart(
  order: readonly string[],
  selection: readonly string[],
  focus: string | null
): { select: string; candidate: string } | null {
  if (selection.length === 2) {
    const select = focus && selection.includes(focus) ? focus : selection[0]
    const candidate = selection.find((k) => k !== select)
    if (candidate) return { select, candidate }
  }
  const select = focus ?? order[0] ?? null
  if (select === null) return null
  const candidate = nextOrBefore(order, select, select)
  return candidate ? { select, candidate } : null
}

/**
 * ↑ in Compare: the Candidate becomes the Select, and the photo after it
 * (before it, at the end) the Candidate. Null when nothing else is left.
 */
export function promoted(
  order: readonly string[],
  select: string,
  candidate: string
): { select: string; candidate: string } | null {
  const next = stepFrom(order, candidate, 1, select) ?? stepFrom(order, candidate, -1, select)
  if (next) return { select: candidate, candidate: next }
  // Only the two of them: they swap.
  return order.includes(select) ? { select: candidate, candidate: select } : null
}

/**
 * The pane a photo's menu (right-click) acts on in Compare: the Candidate's
 * own, when it is the Candidate; any other photo becomes the Select.
 */
export function comparePaneOf(candidate: string | null, key: string): 'select' | 'candidate' {
  return key === candidate ? 'candidate' : 'select'
}

/** The most photos Survey shows at once. */
export const SURVEY_MAX = 12

/**
 * The photos Survey shows: the selection in the order shown, at most
 * `SURVEY_MAX`; `total` says how many were selected.
 */
export function surveyOf(
  order: readonly string[],
  selection: readonly string[],
  max = SURVEY_MAX
): { keys: string[]; total: number } {
  // Sets, not lists: ⌘A on a folder of thousands is surveyed at once.
  const chosen = new Set(selection)
  const inOrder = order.filter((k) => chosen.has(k))
  const shown = new Set(inOrder)
  // Selected but not shown (a filter hides them): after those shown.
  const rest = [...chosen].filter((k) => !shown.has(k))
  return { keys: [...inOrder, ...rest].slice(0, max), total: inOrder.length + rest.length }
}

/** A tile dropped from Survey: the photos left, and which has the focus now. */
export function dropFrom(
  keys: readonly string[],
  key: string
): { keys: string[]; focus: string | null } {
  const i = keys.indexOf(key)
  if (i < 0) return { keys: [...keys], focus: keys[0] ?? null }
  const left = keys.filter((k) => k !== key)
  return { keys: left, focus: left[Math.min(i, left.length - 1)] ?? null }
}

/** A dropped tile put back where it was. */
export function restoreTo(keys: readonly string[], key: string, at: number): string[] {
  if (keys.includes(key)) return [...keys]
  const out = [...keys]
  out.splice(Math.max(0, Math.min(at, out.length)), 0, key)
  return out
}

/**
 * Whether a rating, flag or label moves on to the next photo: auto-advance
 * on, or Caps Lock down while it is off (and the other way round), as in
 * Lightroom. Never in Survey, and only for one photo.
 */
export function advancing(on: boolean, capsLock: boolean): boolean {
  return on !== capsLock
}

/**
 * Survey's tiles laid out in `box`: the columns that make the largest tiles
 * of pictures `aspect` wide to high, `gap` between them.
 */
export function surveyLayout(
  n: number,
  box: { w: number; h: number },
  aspect = 1.5,
  gap = 12
): { cols: number; rows: number; w: number; h: number } {
  if (n <= 0 || box.w <= 0 || box.h <= 0) return { cols: 1, rows: 1, w: 0, h: 0 }
  let best = { cols: 1, rows: n, w: 0, h: 0 }
  let fitted = 0
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols)
    const cw = (box.w - gap * (cols - 1)) / cols
    const ch = (box.h - gap * (rows - 1)) / rows
    if (cw <= 0 || ch <= 0) continue
    // The picture's width fitted in its cell.
    const w = Math.min(cw, ch * aspect)
    if (w > fitted) {
      fitted = w
      best = { cols, rows, w: cw, h: ch }
    }
  }
  return best
}
