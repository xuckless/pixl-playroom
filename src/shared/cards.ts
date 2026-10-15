/**
 * The right column's cards: Playroom's colour tools, DaVinci Resolve's
 * workflow (Curves, Primaries, Log wheels, the Qualifier) with Lightroom's
 * Basic panel and HSL. White balance, Light and Presence show together as
 * Basic corrections. (Lightroom's own set, once a choice in Settings, is
 * retired: everything it did is here.)
 * Each card names the recipe fields it holds (paths, as `changedFields`
 * gives them), so whether it changed, putting it back, and turning it off
 * all read from one list. In a mask the same paths are read in the mask's
 * settings (`scopedView`), against neutral ones.
 */
import { defaultRecipe, neutralSettings, sameValue, SETTINGS_KEYS, type Recipe } from './recipe'
import { tk } from './i18n'

export const CARD_IDS = [
  'wb',
  'light',
  'presence',
  'curve',
  'mixer',
  'primaries',
  'logwheels',
  'qualifier',
  'calibration',
  'grading',
  'detail',
  'effects',
  'optics',
  'geometry'
] as const

export type CardId = (typeof CARD_IDS)[number]

export interface CardSpec {
  id: CardId
  title: string
  fields: string[][]
  /** Whether a mask carries it (its fields are among a mask's settings). */
  inMask: boolean
  /** Shown as a part of Basic corrections, not as a panel of its own. */
  basic?: true
  /**
   * Lightroom's, kept for the photos edited with it: offered only where it
   * holds edits (it still acts, and can be put back), never for new ones.
   */
  legacy?: true
}

/** Lightroom's Colour grading wheels: Primaries and Log wheels do what they did. */
const GRADING_WHEELS: string[][] = [
  ['colorGrade', 'shadows'],
  ['colorGrade', 'midtones'],
  ['colorGrade', 'highlights'],
  ['colorGrade', 'global'],
  ['colorGrade', 'blending'],
  ['colorGrade', 'balance']
]

/**
 * In order: Basic corrections (Treatment and Profile, White balance, Light,
 * Presence), Curves, HSL, then the other colour tools, then Detail,
 * Effects, Optics and Geometry.
 */
export const CARDS: CardSpec[] = [
  { id: 'wb', title: tk('White balance'), fields: [['wb']], inMask: true, basic: true },
  // Tone base is the photo's own (a mask has none): it resets with Light, outside a mask.
  { id: 'light', title: tk('Light'), fields: [['basic'], ['toneBase']], inMask: true, basic: true },
  {
    id: 'presence',
    title: tk('Presence'),
    // As in Lightroom: local contrast, then how strong colour is.
    fields: [['presence']],
    inMask: true,
    basic: true
  },
  {
    id: 'curve',
    // Custom (the tone curve: points, YRGB, its regions) and the vs curves.
    title: tk('Curves'),
    fields: [['toneCurve'], ['curvesVs']],
    inMask: true
  },
  {
    id: 'mixer',
    title: tk('HSL'),
    fields: [['hsl'], ['bwMix'], ['pointColors'], ['density']],
    inMask: true
  },
  {
    id: 'primaries',
    title: tk('Primaries'),
    // Add colour (light of a colour laid on the scene) sits under the wheels.
    fields: [['primaries'], ['colorGrade', 'add']],
    inMask: true
  },
  { id: 'logwheels', title: tk('Log wheels'), fields: [['logWheels']], inMask: true },
  { id: 'qualifier', title: tk('Qualifier'), fields: [['qualifiers']], inMask: true },
  { id: 'calibration', title: tk('Calibration'), fields: [['calibration']], inMask: true },
  {
    id: 'grading',
    title: tk('Colour grading'),
    fields: GRADING_WHEELS,
    inMask: true,
    legacy: true
  },
  { id: 'detail', title: tk('Detail'), fields: [['detail']], inMask: true },
  { id: 'effects', title: tk('Effects'), fields: [['effects']], inMask: true },
  { id: 'optics', title: tk('Optics'), fields: [['lens']], inMask: false },
  { id: 'geometry', title: tk('Geometry'), fields: [['geometry', 'upright']], inMask: false }
]

/** The panel the dropdown offers: Basic corrections (its cards together), or one card. */
export type PanelId = CardId | 'basic'

export const BASIC_TITLE = tk('Basic corrections')

/** The fields Basic corrections holds above its cards (the whole photo's only). */
export const BASIC_HEAD_FIELDS: string[][] = [['profile'], ['profileAmount'], ['treatment']]

/** The panel a card shows in. */
export const panelOf = (id: CardId): PanelId => (cardSpec(id).basic ? 'basic' : id)

export const isPanelId = (v: unknown): v is PanelId => v === 'basic' || isCardId(v)

/** The cards a panel shows: Basic corrections' parts, or the one card. */
export const panelCards = (id: PanelId): CardSpec[] =>
  id === 'basic' ? CARDS.filter((c) => c.basic) : [cardSpec(id)]

/**
 * The panels offered, in order (in a mask, those a mask carries). A legacy
 * card shows only where `held` says it holds edits.
 */
export function panelsFor(inMask = false, held?: (card: CardSpec) => boolean): PanelId[] {
  const out: PanelId[] = []
  for (const c of CARDS) {
    if (inMask && !c.inMask) continue
    if (c.legacy && !held?.(c)) continue
    const p = panelOf(c.id)
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/** A panel's name. */
export const panelTitle = (id: PanelId): string =>
  id === 'basic' ? BASIC_TITLE : cardSpec(id).title

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
