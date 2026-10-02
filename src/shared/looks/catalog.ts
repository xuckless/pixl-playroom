/**
 * The catalog: every look PIXL ships, by id. Both processes import it
 * (it is code, not data sent over IPC); an id, once shipped, is kept for
 * good, since My Looks stores ids. A look renamed or retired leaves an
 * alias behind.
 */
import { ESSENTIALS } from './essentials'
import type { Look } from './types'

export const LOOKS: Look[] = [...ESSENTIALS]

export const LOOK_BY_ID = new Map(LOOKS.map((l) => [l.id, l]))

/** Retired or renamed ids, to the look that took their place. */
export const LOOK_ALIASES: Record<string, string> = {}

/** The look an id names now, or undefined when it names none. */
export function resolveLook(id: string): Look | undefined {
  return LOOK_BY_ID.get(LOOK_ALIASES[id] ?? id)
}

/** What a new user's My Looks starts with, until they change it. */
export const STARTER_LOOK_IDS = [
  'builtin:bw-contrast',
  'builtin:bw-soft',
  'builtin:warm-film',
  'builtin:cool-matte',
  'builtin:vivid',
  'builtin:teal-orange',
  'builtin:landscape',
  'builtin:portrait',
  'builtin:vignette'
]
