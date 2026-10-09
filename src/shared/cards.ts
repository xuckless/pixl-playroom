/**
 * The right column's cards: the adjustments in Lightroom Classic's order,
 * with its Basic panel split into White balance, Light, Presence and Colour.
 * Each card names the recipe fields it holds (paths, as `changedFields`
 * gives them), so whether it changed, putting it back, and (later) turning
 * it off all read from one list. In a mask the same paths are read in the
 * mask's settings (`scopedView`), against neutral ones.
 */
import { defaultRecipe, neutralSettings, sameValue, SETTINGS_KEYS, type Recipe } from './recipe'
import { tk } from './i18n'

export const CARD_IDS = [
  'wb',
  'light',
  'presence',
  'colour',
  'mixer',
  'grading',
  'curve',
  'detail',
  'effects',
  'optics',
  'geometry',
  'calibration'
] as const

export type CardId = (typeof CARD_IDS)[number]

export interface CardSpec {
  id: CardId
  title: string
  fields: string[][]
  /** Whether a mask carries it (its fields are among a mask's settings). */
  inMask: boolean
}

export const CARDS: CardSpec[] = [
  { id: 'wb', title: tk('White balance'), fields: [['wb']], inMask: true },
  { id: 'light', title: tk('Light'), fields: [['basic']], inMask: true },
  {
    id: 'presence',
    title: tk('Presence'),
    fields: [
      ['presence', 'texture'],
      ['presence', 'clarity'],
      ['presence', 'dehaze']
    ],
    inMask: true
  },
  {
    id: 'colour',
    title: tk('Colour'),
    fields: [
      ['presence', 'vibrance'],
      ['presence', 'saturation'],
      ['presence', 'hue']
    ],
    inMask: true
  },
  {
    id: 'mixer',
    title: tk('Colour mixer'),
    fields: [['hsl'], ['bwMix'], ['pointColors']],
    inMask: true
  },
  { id: 'grading', title: tk('Colour grading'), fields: [['colorGrade']], inMask: true },
  { id: 'curve', title: tk('Tone curve'), fields: [['toneCurve']], inMask: true },
  { id: 'detail', title: tk('Detail'), fields: [['detail']], inMask: true },
  { id: 'effects', title: tk('Effects'), fields: [['effects']], inMask: true },
  { id: 'optics', title: tk('Optics'), fields: [['lens']], inMask: false },
  { id: 'geometry', title: tk('Geometry'), fields: [['geometry', 'upright']], inMask: false },
  { id: 'calibration', title: tk('Calibration'), fields: [['calibration']], inMask: true }
]

export const cardSpec = (id: CardId): CardSpec => CARDS.find((c) => c.id === id) ?? CARDS[0]

export const isCardId = (v: unknown): v is CardId => CARD_IDS.includes(v as CardId)

const SETTINGS = new Set<string>(SETTINGS_KEYS)

/** The fields a card holds in this scope: in a mask, only those a mask's settings carry. */
export function cardFields(card: CardSpec, inMask: boolean): string[][] {
  return inMask ? card.fields.filter((p) => SETTINGS.has(p[0])) : card.fields
}

function valueAt(o: unknown, path: string[]): unknown {
  let v = o
  for (const k of path) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  return v
}

// Made once: they are read for every card on every change of the recipe.
let defaults: { raw: Recipe; other: Recipe; neutral: ReturnType<typeof neutralSettings> } | null =
  null
const made = (): NonNullable<typeof defaults> =>
  (defaults ??= {
    raw: defaultRecipe(true),
    other: defaultRecipe(false),
    neutral: neutralSettings()
  })

/**
 * What a card goes back to: the photo's defaults for its kind of file, or in
 * a mask neutral settings (a mask's change on top of the photo is none).
 * Shared and read-only: copy what is taken from it.
 */
export function cardBase(view: Recipe, isRaw: boolean, inMask: boolean): Recipe {
  const d = made()
  return inMask ? { ...view, ...d.neutral } : isRaw ? d.raw : d.other
}

/** Whether anything the card holds differs from `base`. */
export function cardChanged(card: CardSpec, view: Recipe, base: Recipe, inMask: boolean): boolean {
  return cardFields(card, inMask).some((p) => !sameValue(valueAt(view, p), valueAt(base, p)))
}
