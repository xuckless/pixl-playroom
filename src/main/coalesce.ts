/**
 * Calls for a key gathered into one: `run(key)` once `waitMs` pass without
 * another, and at most `maxMs` after the first (a steady stream still gets
 * through). A folder opening says it changed three times in a second (the
 * scan, the sidecars, the EXIF), each a whole listing for the window to
 * take: gathered, it takes one.
 *
 * Free of Electron, for tests/perf.test.ts.
 */
export function coalesceByKey(
  run: (key: string) => void,
  waitMs: number,
  maxMs: number
): (key: string) => void {
  const waiting = new Map<string, { timer: ReturnType<typeof setTimeout>; first: number }>()
  const fire = (key: string): void => {
    waiting.delete(key)
    run(key)
  }
  return (key) => {
    const now = Date.now()
    const w = waiting.get(key)
    const first = w?.first ?? now
    if (w) clearTimeout(w.timer)
    const delay = Math.max(0, Math.min(waitMs, first + maxMs - now))
    const timer = setTimeout(() => fire(key), delay)
    timer.unref?.()
    waiting.set(key, { timer, first })
  }
}

/**
 * What a folder's gathered changes come to: the photos whose facts changed
 * (`photos` added to `was`'s), or null for the whole listing, once any of
 * them was a change to what the folder holds.
 */
export function mergeChanged(
  was: Set<number> | null | undefined,
  photos: number[] | undefined
): Set<number> | null {
  if (was === null || !photos) return null
  const out = new Set(was ?? [])
  for (const id of photos) out.add(id)
  return out
}

/**
 * Of a fill's items, those whose thumbnails are queued again: the ones the
 * window lists now (`listed`, the last listing's keys) and that are there.
 * A listing asked for again queued just those; a photo opened on its own
 * fills its whole folder, and that folder's thumbnails are not wanted yet.
 */
export function thumbsAgain<T extends { key: string; offline?: boolean }>(
  items: T[],
  listed: ReadonlySet<string>
): T[] {
  return items.filter((it) => !it.offline && listed.has(it.key))
}
