/**
 * The catalog: every look PIXL ships, by id. Both processes import it
 * (it is code, not data sent over IPC); an id, once shipped, is kept for
 * good, since My Looks stores ids. A look renamed or retired leaves an
 * alias behind.
 */
import { BW } from './bw'
import { CANON } from './canon'
import { CINEMA } from './cinema'
import { CREATIVE } from './creative'
import { ESSENTIALS } from './essentials'
import { FILM_BW } from './film-bw'
import { FILM_COLOUR } from './film-colour'
import { FILM_INSTANT } from './film-instant'
import { FUJIFILM } from './fujifilm'
import { HASSELBLAD } from './hasselblad'
import { LEICA } from './leica'
import { MOVIES } from './movies'
import { NIKON } from './nikon'
import { OTHER_CAMERAS } from './other-cameras'
import { PANASONIC } from './panasonic'
import { RICOH } from './ricoh'
import { SONY } from './sony'
import type { Look } from './types'

/** In browsing order: camera colour first, as the collections are. */
export const LOOKS: Look[] = [
  ...FUJIFILM,
  ...LEICA,
  ...HASSELBLAD,
  ...CANON,
  ...NIKON,
  ...SONY,
  ...RICOH,
  ...PANASONIC,
  ...OTHER_CAMERAS,
  ...CINEMA,
  ...FILM_COLOUR,
  ...FILM_INSTANT,
  ...FILM_BW,
  ...MOVIES,
  ...BW,
  ...CREATIVE,
  ...ESSENTIALS
]

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
