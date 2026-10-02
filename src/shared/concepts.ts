/**
 * What a mask can be asked for by name — a class: the sky, and a person's
 * parts as smart looks name them — and how each is found.
 *
 * Each class lists its finders, best first; the first this build can run
 * finds it. Today only SAM 2.1 runs, and SAM has no idea what "hair" is: it
 * selects what it is shown. So today's finder is the user's click, the
 * class saying what to click and which of SAM's answers to keep (its
 * smallest for a part, its largest for a whole person). Later finders find
 * the class by name with no click: a text-prompted segmenter (SAM 3, or a
 * detector boxing it for SAM), a people-parts model, a sky model. A mask
 * keeps its class (`BrushSource.concept`), so it can be found again by a
 * better finder when one ships.
 *
 * Measured with SAM 2.1 (tiny) on a 24 MP half-body portrait: a click on a
 * cheek, an eye or the lips gave the whole person, the face, or the head and
 * shoulders, never the eye or the lips (an eye there is about 7 of SAM's
 * pixels). Small parts (eyes, lips, teeth) answer on close-ups only.
 */
import type { PersonPart } from './looks/smart'

export type ConceptId = 'sky' | PersonPart

/** How a class is found: by the user's click (SAM 2.1), or by name (models to come). */
export type Finder = 'click' | 'text' | 'parts' | 'sky-model'

/** Which of SAM's answers to a click to keep: its smallest, its largest, or its surest. */
export type ConceptSize = 'small' | 'large' | 'best'

export interface Concept {
  id: ConceptId
  label: string
  /** What the click tool asks for. */
  ask: string
  /** Several of it (both eyes, every patch of skin): each click is one more, kept as it lands. */
  many: boolean
  size: ConceptSize
  finders: Finder[]
  group: 'people' | 'scene'
}

const person = (
  id: PersonPart,
  label: string,
  ask: string,
  many = false,
  size: ConceptSize = 'small'
): Concept => ({ id, label, ask, many, size, finders: ['parts', 'text', 'click'], group: 'people' })

export const CONCEPTS: Concept[] = [
  {
    id: 'sky',
    label: 'Sky',
    ask: 'Click the sky',
    many: false,
    size: 'best',
    finders: ['sky-model', 'text', 'click'],
    group: 'scene'
  },
  person('body', 'Person', 'Click the person', false, 'large'),
  person('face', 'Face', 'Click the face'),
  person('hair', 'Hair', 'Click the hair'),
  person('skin', 'Skin', 'Click each patch of skin', true),
  person('eyes', 'Eyes', 'Click each eye', true),
  person('lips', 'Lips', 'Click the lips'),
  person('teeth', 'Teeth', 'Click the teeth'),
  person('clothes', 'Clothes', 'Click each piece of clothing', true)
]

const BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]))

export function conceptOf(id: unknown): Concept | null {
  return typeof id === 'string' ? (BY_ID.get(id as ConceptId) ?? null) : null
}

/** The finders this build can run. */
export interface Finders {
  click: boolean
  text: boolean
  parts: boolean
  'sky-model': boolean
}

/** How a class is found here and now: its best finder this build can run, or null. */
export function finderFor(c: Concept, can: Finders): Finder | null {
  return c.finders.find((f) => can[f]) ?? null
}

/**
 * Which of SAM's answers a class keeps (`area` each one's coverage, `iou`
 * the decoder's own estimate of it): its smallest or largest of those the
 * decoder is fairly sure of, or simply its surest. -1 for none.
 */
export function pickBySize(size: ConceptSize, area: number[], iou: number[]): number {
  const sure = area.map((_, i) => i).filter((i) => iou[i] >= 0.5)
  const pool = sure.length ? sure : area.map((_, i) => i)
  if (pool.length === 0) return -1
  if (size === 'best') return pool.reduce((b, i) => (iou[i] > iou[b] ? i : b), pool[0])
  return pool.reduce(
    (b, i) => ((size === 'small' ? area[i] < area[b] : area[i] > area[b]) ? i : b),
    pool[0]
  )
}
