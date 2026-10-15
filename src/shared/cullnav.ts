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
 *   Compare and Survey to come), the shown photo only.
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
 * single-photo modes.
 */
export function metaTargetsFor(s: {
  view: 'library' | 'develop'
  mode: LibraryMode
  selection: readonly string[]
  focus: string | null
  /** The photo Develop shows. */
  open: string | null
}): string[] {
  if (s.view === 'develop') {
    const k = s.open ?? s.focus
    return k ? [k] : []
  }
  if (s.mode !== 'grid') return s.focus ? [s.focus] : []
  return s.selection.length > 0 ? [...s.selection] : s.focus ? [s.focus] : []
}
