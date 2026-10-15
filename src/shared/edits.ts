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
import { BASIC_HEAD_FIELDS, CARDS, cardBase, type CardId } from './cards'
import type { LensCorrection } from './engine-types'
import { tk } from './i18n'
import { lensCorrection } from './lens'
import { activeSteps } from './pixels'
import {
  changedFields,
  EDIT_SECTIONS,
  neutralSettings,
  sameValue,
  type EditSection,
  type Recipe
} from './recipe'

// Every card can be switched off: its id is a section.
const _cards: readonly EditSection[] = [] as CardId[]
void _cards

/** The recipe paths each section holds (as `changedFields` gives them). */
export const SECTION_FIELDS: Record<EditSection, string[][]> = {
  ...(Object.fromEntries(CARDS.map((c) => [c.id, c.fields])) as Record<CardId, string[][]>),
  profile: BASIC_HEAD_FIELDS,
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

/**
 * The lens correction the photo is rendered with: none while Optics is
 * switched off. What a model must see the photo through, so a mask it finds
 * is placed on the picture it is applied to.
 */
export function renderedLens(r: Recipe, isRaw: boolean): LensCorrection | null {
  return lensCorrection(effective(r, isRaw).lens)
}

/** What each section is called (the cards' own titles, and the three that are not cards). */
export const SECTION_TITLE: Record<EditSection, string> = {
  ...(Object.fromEntries(CARDS.map((c) => [c.id, c.title])) as Record<CardId, string>),
  profile: tk('Profile'),
  crop: tk('Crop & straighten'),
  heal: tk('Heal')
}

/** Switch a section off or on, in place (an `edit` callback's recipe). */
export function setSectionOff(r: Recipe, s: EditSection, off: boolean): void {
  const next = { ...(r.off ?? {}) }
  if (off) next[s] = true
  else delete next[s]
  r.off = next
}

/**
 * `after` with each switched-off section a look, a preset or a paste wrote
 * switched on again: what was just put there is meant to show.
 */
export function keepWrittenOn(before: Recipe, after: Recipe): Recipe {
  const written = sectionsOff(after).filter((s) =>
    SECTION_FIELDS[s].some((p) => !sameValue(valueAt(before, p), valueAt(after, p)))
  )
  if (written.length === 0) return after
  const off = { ...after.off }
  for (const s of written) delete off[s]
  return { ...after, off }
}

/**
 * The sliders the Edits list names, by path: a change to one shows with its
 * value ("Exposure +0.60"); anything else a section holds counts as "+n".
 */
export const FIELD_LABELS: Record<string, string> = {
  'wb.temperature': tk('Temp'),
  'wb.tint': tk('Tint'),
  'basic.exposure': tk('Exposure'),
  'basic.contrast': tk('Contrast'),
  'basic.highlights': tk('Highlights'),
  'basic.shadows': tk('Shadows'),
  'basic.whites': tk('Whites'),
  'basic.blacks': tk('Blacks'),
  toneBase: tk('Tone base'),
  'presence.texture': tk('Texture'),
  'presence.clarity': tk('Clarity'),
  'presence.dehaze': tk('Dehaze'),
  'presence.vibrance': tk('Vibrance'),
  'presence.saturation': tk('Saturation'),
  'presence.hue': tk('Hue'),
  'presence.smoothing': tk('Smoothing'),
  'detail.sharpenAmount': tk('Sharpening'),
  'detail.noiseLuminance': tk('Noise reduction'),
  'effects.vignetteAmount': tk('Vignette'),
  'effects.grainAmount': tk('Grain'),
  profileAmount: tk('Amount'),
  'geometry.straighten': tk('Straighten'),
  'geometry.crop': tk('Crop')
}

/** One named change: its label (English, translated where shown) and its value if a number. */
export interface Change {
  label: string
  value: number | null
}

/** One row of the Edits list: what was changed, how, and whether it is on. */
export interface EditRow {
  /** Stable across renders: the section, mask, custom layer or step it is. */
  id: string
  kind: 'section' | 'mask' | 'custom' | 'step'
  /** A section's title (English, translated where shown), or the mask's, layer's or step's own name. */
  name: string
  /** Whether `name` is a title to translate (a mask's own name is not). */
  translate: boolean
  /** The named changes, in the section's order. */
  changes: Change[]
  /** Changes it holds beyond those named. */
  more: number
  /** Heal's spots, counted. */
  count?: number
  on: boolean
  section?: EditSection
}

/** How `now` differs from `base` under `paths`: named changes first, the rest counted. */
function changesOf(
  now: unknown,
  base: unknown,
  paths: string[][]
): { changes: Change[]; more: number } {
  const changes: Change[] = []
  let more = 0
  for (const p of paths)
    for (const leaf of changedFields(valueAt(now, p), valueAt(base, p), p)) {
      const label = FIELD_LABELS[leaf.join('.')]
      const v = valueAt(now, leaf)
      if (label) changes.push({ label, value: typeof v === 'number' ? v : null })
      else more++
    }
  return { changes, more }
}

/**
 * The Edits list: one row for each section changed (or switched off), each
 * mask, each Advanced layer and each pixel step, in that order. A section's
 * row says its net change against the photo's defaults, a mask's against
 * neutral settings: what the edit is, not how it was made.
 */
export function editRows(r: Recipe, isRaw: boolean): EditRow[] {
  const base = cardBase(r, isRaw, false)
  const off = r.off ?? {}
  const rows: EditRow[] = []
  for (const s of EDIT_SECTIONS) {
    const { changes, more } =
      s === 'heal' ? { changes: [], more: 0 } : changesOf(r, base, SECTION_FIELDS[s])
    const spots = s === 'heal' ? r.retouch.length : 0
    if (changes.length === 0 && more === 0 && spots === 0 && off[s] !== true) continue
    rows.push({
      id: `section:${s}`,
      kind: 'section',
      name: SECTION_TITLE[s],
      translate: true,
      changes,
      more,
      ...(s === 'heal' ? { count: spots } : {}),
      on: off[s] !== true,
      section: s
    })
  }
  const neutral = neutralSettings()
  const settingPaths = CARDS.filter((c) => c.inMask).flatMap((c) => c.fields)
  for (const l of r.layers) {
    const { changes, more } = changesOf(l.settings, neutral, settingPaths)
    rows.push({
      id: `mask:${l.id}`,
      kind: 'mask',
      name: l.name,
      translate: false,
      changes,
      more,
      on: l.enabled
    })
  }
  for (const c of r.custom)
    rows.push({
      id: `custom:${c.id}`,
      kind: 'custom',
      name: c.name,
      translate: false,
      changes: [],
      more: 0,
      on: c.enabled
    })
  for (const p of r.pixels)
    rows.push({
      id: `step:${p.id}`,
      kind: 'step',
      name: p.label,
      translate: true,
      changes: [],
      more: 0,
      on: !p.off
    })
  return rows
}
