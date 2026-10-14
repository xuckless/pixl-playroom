/**
 * The right column's cards: the adjustments in Lightroom Classic's order,
 * its Basic panel's White balance, Light and Presence shown together as
 * Basic corrections.
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
  'curve',
  'rcurves',
  'mixer',
  'grading',
  'calibration',
  'primaries',
  'logwheels',
  'qualifier',
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
  /**
   * The colour tools it belongs to (Settings → Interface → Colour tools):
   * shown only with them; absent, with both. Hidden, it still acts.
   */
  set?: ColourToolSet
  /** Its name among the Resolve tools, where that differs (the mixer is HSL there). */
  resolveTitle?: string
  /** Shown as a part of Basic corrections, not as a panel of its own. */
  basic?: true
}

/** Lightroom's colour cards, or DaVinci Resolve's. */
export type ColourToolSet = 'lightroom' | 'resolve'

/** Whether a card shows with `tools`. */
export const cardShows = (card: CardSpec, tools: ColourToolSet): boolean =>
  !card.set || card.set === tools

/** The cards `tools` shows, in the order the column shows them. */
export function cardsFor(tools: ColourToolSet): CardSpec[] {
  return CARDS.filter((c) => cardShows(c, tools))
}

/** A card's name with `tools`. */
export const cardTitle = (card: CardSpec, tools: ColourToolSet): string =>
  tools === 'resolve' && card.resolveTitle ? card.resolveTitle : card.title

/**
 * In both sets the same order: Basic corrections (Treatment and Profile,
 * White balance, Light, Presence), the curves, the HSL, then the other
 * colour tools, then Detail, Effects, Optics and Geometry.
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
  { id: 'curve', title: tk('Tone curve'), fields: [['toneCurve']], inMask: true, set: 'lightroom' },
  {
    id: 'rcurves',
    // Its Custom tab is the tone curve itself (the Tone curve card's section).
    title: tk('Curves'),
    fields: [['curvesVs']],
    inMask: true,
    set: 'resolve'
  },
  {
    id: 'mixer',
    title: tk('Colour mixer'),
    fields: [['hsl'], ['bwMix'], ['pointColors']],
    inMask: true,
    // Both sets: with Resolve's it is the compact HSL.
    resolveTitle: tk('HSL')
  },
  {
    id: 'grading',
    title: tk('Colour grading'),
    fields: [['colorGrade']],
    inMask: true,
    set: 'lightroom'
  },
  {
    id: 'calibration',
    title: tk('Calibration'),
    fields: [['calibration']],
    inMask: true,
    set: 'lightroom'
  },
  {
    id: 'primaries',
    title: tk('Primaries'),
    fields: [['primaries']],
    inMask: true,
    set: 'resolve'
  },
  {
    id: 'logwheels',
    title: tk('Log wheels'),
    fields: [['logWheels']],
    inMask: true,
    set: 'resolve'
  },
  {
    id: 'qualifier',
    title: tk('Qualifier'),
    fields: [['qualifiers']],
    inMask: true,
    set: 'resolve'
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

/** The panels `tools` offers, in order (in a mask, those a mask carries). */
export function panelsFor(tools: ColourToolSet, inMask = false): PanelId[] {
  const out: PanelId[] = []
  for (const c of cardsFor(tools)) {
    if (inMask && !c.inMask) continue
    const p = panelOf(c.id)
    if (!out.includes(p)) out.push(p)
  }
  return out
}

/**
 * Lightroom's panels whose keys (⌘2, ⌘4) show a Resolve tool with Resolve's
 * set: the curves, and the grading wheels.
 */
export const RESOLVE_TWIN: Partial<Record<PanelId, PanelId>> = {
  curve: 'rcurves',
  grading: 'primaries'
}

/** The panel whose key shows `id` (itself, or the Lightroom panel it stands in for). */
export const keyedAs = (id: PanelId): PanelId =>
  (Object.keys(RESOLVE_TWIN) as PanelId[]).find((k) => RESOLVE_TWIN[k] === id) ?? id

/** A panel's name with `tools`. */
export const panelTitle = (id: PanelId, tools: ColourToolSet): string =>
  id === 'basic' ? BASIC_TITLE : cardTitle(cardSpec(id), tools)

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
