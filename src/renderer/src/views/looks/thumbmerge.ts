import type { LookThumbEvent } from '../../../../shared/ipc'

/**
 * `byId` with a frame's worth of look thumbnails in it (those of another
 * photo than `key` left out): itself when none is, so nothing draws again.
 */
export function withThumbs(
  byId: Record<string, LookThumbEvent>,
  key: string | null,
  events: LookThumbEvent[]
): Record<string, LookThumbEvent> {
  const mine = events.filter((e) => e.key === key)
  if (mine.length === 0) return byId
  const next = { ...byId }
  for (const e of mine) next[e.id] = e
  return next
}
