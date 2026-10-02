/**
 * My Looks: the catalog looks a user keeps at hand, in their order. Stored
 * as ids in the app's settings (`MINE_KEY`). Never written until the user
 * changes it, so a new user's list is the starter set of whichever version
 * they run; an empty list is a choice, kept as one.
 */
import { LOOK_ALIASES, LOOK_BY_ID, STARTER_LOOK_IDS } from './catalog'

export const MINE_KEY = 'looks.mine'

export interface MineSetting {
  v: 1
  ids: string[]
}

/** The ids a stored setting names: aliases followed, unknown and repeated ids dropped. */
export function readMine(raw: unknown): string[] {
  const stored =
    raw && typeof raw === 'object' && Array.isArray((raw as MineSetting).ids)
      ? (raw as MineSetting).ids
      : null
  const ids = stored ?? STARTER_LOOK_IDS
  const out: string[] = []
  for (const id of ids) {
    if (typeof id !== 'string') continue
    const now = LOOK_ALIASES[id] ?? id
    if (LOOK_BY_ID.has(now) && !out.includes(now)) out.push(now)
  }
  return out
}

export function writeMine(ids: string[]): MineSetting {
  return { v: 1, ids: [...ids] }
}

/** `id` added at the end (or left where it is). */
export function addMine(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id]
}

export function removeMine(ids: string[], id: string): string[] {
  return ids.filter((x) => x !== id)
}

/** `id` moved to position `to` (clamped), the others keeping their order. */
export function moveMine(ids: string[], id: string, to: number): string[] {
  const from = ids.indexOf(id)
  if (from < 0) return ids
  const rest = ids.filter((x) => x !== id)
  const at = Math.max(0, Math.min(rest.length, to))
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}
