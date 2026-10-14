/**
 * Switching an edit off (the Edits list, a card's eye): a section of the
 * recipe (`EDIT_SECTIONS`) keeps its values but is compiled as the photo's
 * defaults, and a pixel step switched off is not laid on. State, not
 * history: turning Curve off turns the curve off whenever it was made. The
 * switch itself is an edit like any other (History records it, Undo takes
 * it back).
 *
 * `effective` is what is rendered: `compile` reads it, so the picture, the
 * export, the thumbnail and the 1:1 view agree. Pure, for tests.
 */
import { CARDS, cardBase, type CardId } from './cards'
import { activeSteps } from './pixels'
import { EDIT_SECTIONS, type EditSection, type Recipe } from './recipe'

// Every card can be switched off: its id is a section.
const _cards: readonly EditSection[] = [] as CardId[]
void _cards

/** The recipe paths each section holds (as `changedFields` gives them). */
export const SECTION_FIELDS: Record<EditSection, string[][]> = {
  ...(Object.fromEntries(CARDS.map((c) => [c.id, c.fields])) as Record<CardId, string[][]>),
  profile: [['profile'], ['profileAmount'], ['treatment']],
  crop: [
    ['geometry', 'straighten'],
    ['geometry', 'crop'],
    ['geometry', 'aspect']
  ],
  heal: [['retouch']]
}

/** The sections switched off in `r`, in the list's order. */
export function sectionsOff(r: Pick<Recipe, 'off'>): EditSection[] {
  const off = r.off ?? {}
  return EDIT_SECTIONS.filter((s) => off[s] === true)
}

function valueAt(o: unknown, path: string[]): unknown {
  let v = o
  for (const k of path) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  return v
}

/** `o` with `path` set to `value`: the objects on the way copied, the rest shared. */
function setAt<T>(o: T, path: string[], value: unknown): T {
  if (path.length === 0) return value as T
  const [k, ...rest] = path
  const here = o as Record<string, unknown>
  const next = rest.length === 0 ? value : setAt(here[k] ?? {}, rest, value)
  return { ...here, [k]: next } as T
}

const made = new WeakMap<Recipe, { raw?: Recipe; other?: Recipe }>()

/**
 * The recipe as rendered: each switched-off section at the photo's defaults
 * (for its kind of file), switched-off pixel steps left out, nothing marked
 * off. `r` itself when nothing is off; otherwise made once per recipe and
 * kind, its unchanged parts shared with `r`.
 */
export function effective(r: Recipe, isRaw: boolean): Recipe {
  const off = sectionsOff(r)
  const steps = activeSteps(r.pixels)
  if (off.length === 0 && steps === r.pixels) return r
  const kind = isRaw ? 'raw' : 'other'
  const memo = made.get(r)
  const known = memo?.[kind]
  if (known) return known
  const base = cardBase(r, isRaw, false)
  let out: Recipe = { ...r, pixels: steps, off: {} }
  for (const s of off)
    for (const path of SECTION_FIELDS[s])
      out = setAt(out, path, structuredClone(valueAt(base, path)))
  made.set(r, { ...memo, [kind]: out })
  return out
}
