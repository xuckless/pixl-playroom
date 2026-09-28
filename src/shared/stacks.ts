/**
 * Stacks in the grid: a stack's members sit together, where its cover sits
 * in whatever order the grid has, and a collapsed stack shows only the
 * cover. Copies travel with their photo (they share its stack).
 */
import type { LibraryItem } from './ipc'

/** Members in stack order: by position, a photo before its copies, then as they came. */
function stackOrder(a: { it: LibraryItem; i: number }, b: { it: LibraryItem; i: number }): number {
  return (
    (a.it.stack?.position ?? 0) - (b.it.stack?.position ?? 0) ||
    Number(a.it.copyId !== null) - Number(b.it.copyId !== null) ||
    a.i - b.i
  )
}

/**
 * The grid's items with stacks gathered: each stack at its cover's place
 * (the lowest position present, when the cover itself is not in this
 * listing), all members when its id is in `expanded`, only the cover
 * otherwise. Items outside stacks keep their place.
 */
export function collapseStacks(items: LibraryItem[], expanded: Set<string>): LibraryItem[] {
  const members = new Map<string, { it: LibraryItem; i: number }[]>()
  items.forEach((it, i) => {
    if (!it.stack) return
    const list = members.get(it.stack.id)
    if (list) list.push({ it, i })
    else members.set(it.stack.id, [{ it, i }])
  })
  if (members.size === 0) return items
  const head = new Map<string, number>()
  for (const [id, list] of members) {
    list.sort(stackOrder)
    head.set(id, list[0].i)
  }
  const out: LibraryItem[] = []
  items.forEach((it, i) => {
    if (!it.stack) {
      out.push(it)
      return
    }
    if (head.get(it.stack.id) !== i) return
    const list = members.get(it.stack.id) as { it: LibraryItem; i: number }[]
    if (expanded.has(it.stack.id)) for (const m of list) out.push(m.it)
    else out.push(it)
  })
  return out
}
