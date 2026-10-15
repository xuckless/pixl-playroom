/**
 * Moving through a row or list of choices from the keys (segmented controls,
 * tabs, the dropdown's list). Pure, so it runs under `node --test`.
 */

/**
 * Arrow keys across a row of choices (a segmented control, tabs): which
 * enabled one is next, wrapping, Home and End to the ends; -1 for any
 * other key. A row takes either pair of arrows; a column (`vertical`) only
 * Up and Down.
 */
export function rovingNext(key: string, at: number, enabled: boolean[], vertical = false): number {
  const n = enabled.length
  const first = enabled.indexOf(true)
  const last = enabled.lastIndexOf(true)
  if (first < 0) return -1
  if (key === 'Home') return first
  if (key === 'End') return last
  const fwd = key === 'ArrowDown' || (!vertical && key === 'ArrowRight')
  const back = key === 'ArrowUp' || (!vertical && key === 'ArrowLeft')
  if (!fwd && !back) return -1
  const dir = fwd ? 1 : -1
  const from = at < 0 ? (dir > 0 ? -1 : 0) : at
  for (let k = 1; k <= n; k++) {
    const i = (((from + dir * k) % n) + n) % n
    if (enabled[i]) return i
  }
  return -1
}

/**
 * Keys moving through a list that does not wrap (a dropdown's choices):
 * arrows a step, Page Up and Page Down ten, Home and End the ends, skipping
 * what cannot be chosen; -1 for any other key.
 */
export function listMove(key: string, at: number, enabled: boolean[]): number {
  const first = enabled.indexOf(true)
  const last = enabled.lastIndexOf(true)
  if (first < 0) return -1
  if (key === 'Home') return first
  if (key === 'End') return last
  const by =
    key === 'ArrowDown'
      ? 1
      : key === 'ArrowUp'
        ? -1
        : key === 'PageDown'
          ? 10
          : key === 'PageUp'
            ? -10
            : 0
  if (by === 0) return -1
  if (at < 0) return by > 0 ? first : last
  const dir = by > 0 ? 1 : -1
  // Onto one that can be chosen, the way it was going; at the end, the last that can.
  for (let i = Math.max(first, Math.min(last, at + by)); i >= first && i <= last; i += dir)
    if (enabled[i]) return i
  return at
}

/** Text folded for matching: no case, no accents. */
const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Type-ahead: the choice whose label starts with what was typed (case and
 * accents aside), looking on from `from` and wrapping. One letter, or the
 * same letter again and again, steps on through the choices it starts, as a
 * native list does; a longer word stays on a choice that still fits. Where
 * nothing matches, `from`.
 */
export function typeAhead(
  labels: string[],
  enabled: boolean[],
  from: number,
  typed: string
): number {
  const want = fold(typed)
  if (!want) return from
  const repeat = [...want].every((c) => c === want[0])
  const prefix = repeat ? want[0] : want
  const n = labels.length
  const start = repeat || from < 0 ? from + 1 : from
  for (let k = 0; k < n; k++) {
    const i = (((start + k) % n) + n) % n
    if (enabled[i] && fold(labels[i]).startsWith(prefix)) return i
  }
  return from
}
