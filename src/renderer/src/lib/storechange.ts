/**
 * Whether a store's update changed anything but `ignored`'s keys (compared
 * shallowly, as zustand's updates replace what changed): a listener that
 * reads none of a store's busiest keys skips the updates that touch only them.
 */
export function changedBeyond<T extends object>(
  next: T,
  prev: T,
  ignored: ReadonlySet<keyof T>
): boolean {
  for (const k of Object.keys(next) as (keyof T)[]) {
    if (!ignored.has(k) && !Object.is(next[k], prev[k])) return true
  }
  return false
}
