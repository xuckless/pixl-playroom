/**
 * Versions: a photo's recipe kept as it was at a moment worth coming back to
 * (History's top). Named ones are the user's (the old Snapshots, kept for
 * good); automatic ones are made by Playroom at the moments an edit can go
 * wrong: the end of an editing session, before a look or an AI step, at an
 * export, before settings pasted or synced over it, before a rebuild. The
 * automatic ones are thinned (`pruneVersions`) so a photo never piles them up.
 * Stored in the item's `snapshots` (its project), recipes slimmed. Pure.
 */
import type { Snapshot } from './ipc'
import { sameValue } from './recipe'

export type VersionReason = 'session' | 'look' | 'ai' | 'export' | 'paste' | 'rebuild'

/** The newest automatic versions always kept. */
export const AUTO_KEEP = 10
/** Automatic versions from these last days kept too… */
export const AUTO_DAYS = 7
/** …up to this many in all. */
export const AUTO_MAX = 30

/** A version the user named (or kept): never thinned. A snapshot from before Versions is one. */
export const isNamed = (v: Snapshot): boolean => v.kind !== 'auto'

/** Newest first. */
export const newestFirst = (a: Snapshot, b: Snapshot): number => b.at.localeCompare(a.at)

/**
 * Automatic versions thinned: the newest AUTO_KEEP, and those of the last
 * AUTO_DAYS days, AUTO_MAX at most. Named ones all stay; the order is kept.
 */
export function pruneVersions(list: Snapshot[], now: number): Snapshot[] {
  const autos = list.filter((v) => !isNamed(v)).sort(newestFirst)
  const recent = (v: Snapshot): boolean => now - Date.parse(v.at) < AUTO_DAYS * 86_400_000
  const keep = new Set(
    autos
      .filter((v, i) => i < AUTO_KEEP || recent(v))
      .slice(0, AUTO_MAX)
      .map((v) => v.id)
  )
  return list.filter((v) => isNamed(v) || keep.has(v.id))
}

/**
 * `list` with `v` added: an automatic one that is the newest version's
 * recipe again is not (nothing changed since), and the automatic ones are
 * thinned.
 */
export function withVersion(list: Snapshot[], v: Snapshot, now: number): Snapshot[] {
  if (!isNamed(v)) {
    const newest = [...list].sort(newestFirst)[0]
    if (newest && sameValue(newest.recipe, v.recipe)) return list
  }
  return pruneVersions([...list, v], now)
}
