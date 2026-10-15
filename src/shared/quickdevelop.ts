/**
 * ARCHITECTURE — Quick develop (pure; the Library's drawer tab is
 * views/library/QuickDevelop.tsx, its writes lib/quickdevelop.ts and
 * main/quickdevelop.ts).
 *
 * The Library's way to move a few sliders on many photos at once, as
 * Lightroom's Quick Develop does: each row nudges every photo's own value by
 * a step (`<` `>`) or a big step (`<<` `>>`), never sets one value on all.
 * What the rows show is the change made so far on this selection ("+2/3"),
 * since every photo has its own value.
 *
 * - `NUDGE_ROWS`: the rows and their steps. Exposure goes in thirds of a
 *   stop; Temp in mired on a RAW with an as-shot white (absolute Kelvin)
 *   and in slider units on anything else (relative), 5 and 20 either way.
 * - `nudgeRecipe`: a photo's recipe with a burst's total change on it,
 *   clamped to the sliders' ranges (and says where it was held).
 * - `lookAt`: a look on a photo at an Amount, as Develop's rail blends it.
 * - `pickerSections`: the look picker's list (pinned, presets, recent, the
 *   collections), or one ranked list while searching.
 * - `targetsSummary`: what the tab's header says about the photos it acts on.
 */
import { keepWrittenOn } from './edits'
import { t, tk } from './i18n'
import type { LibraryItem, Preset } from './ipc'
import { blendLook } from './looks/amount'
import { applyLook, lookFields, type ApplyContext } from './looks/apply'
import { COLLECTION_BY_ID } from './looks/collections'
import { searchLooks } from './looks/search'
import { planSmart, smartReadiness, type SmartPart } from './looks/smart'
import type { LocalLayer, Recipe } from './recipe'
import { absoluteWb } from './compile'
import { KELVIN_MAX } from './wb'
import type { WbContext } from './wbconvert'

export type NudgeId =
  'exposure' | 'contrast' | 'temp' | 'tint' | 'vibrance' | 'clarity' | 'saturation'

export interface NudgeRow {
  id: NudgeId
  /** The slider's name, as Develop shows it. */
  label: string
  /** The section it is under in the tab. */
  group: 'tone' | 'wb' | 'presence'
  /** `<` and `>`, `<<` and `>>`, in the row's units (exposure: thirds of a stop). */
  small: number
  large: number
  /** Behind "More" (Clarity, Saturation). */
  more?: boolean
}

export const NUDGE_ROWS: readonly NudgeRow[] = [
  { id: 'exposure', label: tk('Exposure'), group: 'tone', small: 1, large: 3 },
  { id: 'contrast', label: tk('Contrast'), group: 'tone', small: 5, large: 20 },
  { id: 'temp', label: tk('Temp'), group: 'wb', small: 5, large: 20 },
  { id: 'tint', label: tk('Tint'), group: 'wb', small: 2, large: 10 },
  { id: 'vibrance', label: tk('Vibrance'), group: 'presence', small: 5, large: 20 },
  { id: 'clarity', label: tk('Clarity'), group: 'presence', small: 5, large: 20, more: true },
  { id: 'saturation', label: tk('Saturation'), group: 'presence', small: 5, large: 20, more: true }
]

export const ROW_BY_ID = new Map(NUDGE_ROWS.map((r) => [r.id, r]))

/** A change in the rows' units (exposure in thirds of a stop). */
export type QuickDelta = Partial<Record<NudgeId, number>>

/** The most a delta from the renderer may hold, per row: past every slider's whole range. */
const DELTA_LIMIT = 30_000

/** A delta as the renderer sent it, checked: known rows, whole numbers within reason. */
export function quickDeltaOf(v: unknown): QuickDelta {
  const out: QuickDelta = {}
  if (!v || typeof v !== 'object') return out
  for (const row of NUDGE_ROWS) {
    const n = (v as Record<string, unknown>)[row.id]
    if (typeof n === 'number' && Number.isInteger(n) && n !== 0 && Math.abs(n) <= DELTA_LIMIT)
      out[row.id] = n
  }
  return out
}

/** Where the sliders end (as Develop's panels have them). */
const EXPOSURE_LIMIT = 5
const BIPOLAR = 100
/** The absolute Temp slider's range on a RAW, and its Tint's. */
const KELVIN_LOW = 2000
const ABS_TINT_LIMIT = 150

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4

function clampTo(v: number, lo: number, hi: number, held: { at: boolean }): number {
  if (v < lo || v > hi) held.at = true
  return Math.min(hi, Math.max(lo, v))
}

/**
 * `recipe` with `delta` on it: each row's value moved by its change and held
 * at the slider's end (`limited`: some row was). A white balance as shot
 * becomes custom, starting from the photo's own white (the as-shot Kelvin on
 * a RAW, the middle elsewhere). A section switched off that a nudge wrote is
 * on again, as a paste turns it on.
 */
export function nudgeRecipe(
  recipe: Recipe,
  delta: QuickDelta,
  wb: WbContext | null
): { recipe: Recipe; limited: boolean } {
  const held = { at: false }
  const next = structuredClone(recipe)
  const d = (id: NudgeId): number => delta[id] ?? 0
  if (d('exposure'))
    next.basic.exposure = round4(
      clampTo(next.basic.exposure + d('exposure') / 3, -EXPOSURE_LIMIT, EXPOSURE_LIMIT, held)
    )
  if (d('contrast'))
    next.basic.contrast = clampTo(next.basic.contrast + d('contrast'), -BIPOLAR, BIPOLAR, held)
  if (d('vibrance'))
    next.presence.vibrance = clampTo(
      next.presence.vibrance + d('vibrance'),
      -BIPOLAR,
      BIPOLAR,
      held
    )
  if (d('clarity'))
    next.presence.clarity = clampTo(next.presence.clarity + d('clarity'), -BIPOLAR, BIPOLAR, held)
  if (d('saturation'))
    next.presence.saturation = clampTo(
      next.presence.saturation + d('saturation'),
      -BIPOLAR,
      BIPOLAR,
      held
    )
  if (d('temp') || d('tint')) {
    if (!wb) throw new Error(t('its white balance cannot be read'))
    next.wb = nudgeWb(recipe.wb, d('temp'), d('tint'), wb, held)
  }
  return { recipe: keepWrittenOn(recipe, next), limited: held.at }
}

/** The white balance moved `temp` mired (or units) warmer and `tint` units towards magenta. */
function nudgeWb(
  wb: Recipe['wb'],
  temp: number,
  tint: number,
  ctx: WbContext,
  held: { at: boolean }
): Recipe['wb'] {
  const abs = absoluteWb(ctx)
  const shot = ctx.asShot
  // As shot: the white it was shot at, as Develop's sliders show it.
  const fromTemp = wb.mode === 'custom' ? wb.temperature : abs && shot ? shot.temperature_kelvin : 0
  const fromTint = wb.mode === 'custom' ? wb.tint : abs && shot ? shot.tint * 3000 : 0
  let temperature = fromTemp
  if (temp) {
    if (abs) {
      // Warmer is a higher Kelvin: the light the scene is said to have had.
      const mired = 1e6 / fromTemp - temp
      const k = mired > 0 ? 1e6 / mired : KELVIN_MAX + 1
      temperature = Math.round(clampTo(k, KELVIN_LOW, KELVIN_MAX, held))
    } else temperature = clampTo(fromTemp + temp, -BIPOLAR, BIPOLAR, held)
  }
  const limit = abs ? ABS_TINT_LIMIT : BIPOLAR
  const nextTint = tint ? Math.round(clampTo(fromTint + tint, -limit, limit, held)) : fromTint
  return { mode: 'custom', temperature, tint: nextTint, preset: null }
}

/** A delta's one row with something in it (a burst is one row's). */
export function deltaRow(delta: QuickDelta): NudgeId | null {
  const ids = (Object.keys(delta) as NudgeId[]).filter((id) => delta[id])
  return ids.length === 1 ? ids[0] : null
}

/** Thirds of a stop as photographers say them: "+2/3", "+1", "−1 1/3", "0". */
export function thirds(n: number): string {
  if (n === 0) return '0'
  const sign = n > 0 ? '+' : '−'
  const a = Math.abs(n)
  const whole = Math.floor(a / 3)
  const part = a % 3
  if (part === 0) return `${sign}${whole}`
  return whole === 0 ? `${sign}${part}/3` : `${sign}${whole} ${part}/3`
}

/**
 * What a row shows for its change (`n`, in its units): Exposure in thirds,
 * Temp warmer or cooler on a selection of RAWs and other photos together
 * (a step is mired on the one and slider units on the other).
 */
export function readout(id: NudgeId, n: number, mixed = false): string {
  if (n === 0) return '0'
  if (id === 'exposure') return thirds(n)
  if (id === 'temp' && mixed) return n > 0 ? t('Warmer') : t('Cooler')
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}`
}

/**
 * A burst's history step, as stored (English, the head translated when
 * shown: "Exposure: +2/3", "Temp: Warmer").
 */
export function nudgeLabel(id: NudgeId, n: number, mixed = false): string {
  const row = ROW_BY_ID.get(id) as NudgeRow
  const value =
    id === 'temp' && mixed ? (n > 0 ? tk('Warmer') : tk('Cooler')) : readoutEnglish(id, n)
  return `${row.label}: ${value}`
}

const readoutEnglish = (id: NudgeId, n: number): string =>
  id === 'exposure' ? thirds(n) : `${n > 0 ? '+' : '−'}${Math.abs(n)}`

// ── looks on a selection ────────────────────────────────────────────────────

/**
 * `p` on a photo standing at `before`, at `amount` (0…100): what Develop's
 * rail does with a look and its Amount, for one photo of a batch. `smart`:
 * the masks a smart look makes without a model (main works them out for
 * the photo's frame), scaled with the rest.
 */
export function lookAt(
  before: Recipe,
  p: Preset,
  ctx: ApplyContext,
  amount: number,
  smart: LocalLayer[] = []
): Recipe {
  const after = applyLook(before, p, ctx)
  after.layers.push(...structuredClone(smart))
  const k = Math.min(1, Math.max(0, amount / 100))
  if (k === 1) return after
  // A smart look's masks are its own, scaled by its Amount; the rest blends.
  const fields = lookFields(before, after).filter((f) => f[0] !== 'layers' && f[0] !== 'pixels')
  const out = blendLook(before, after, fields, k)
  const made = new Set(smart.map((l) => l.id))
  out.layers = [
    ...before.layers,
    ...after.layers
      .filter((l) => made.has(l.id))
      .map((l) => ({ ...l, amount: Math.round(l.amount * k) }))
  ]
  return out
}

/** What a build that has everything could do: to ask whether a look needs a model at all. */
const EVERYTHING = smartReadiness({
  models: true,
  subjectModel: true,
  drunetModel: true,
  nafnetModel: true,
  samModel: true,
  enhance: true,
  sceneModel: true,
  partsModel: true,
  faceModels: true,
  phraseModel: true,
  engine: {
    sky: true,
    people: true,
    sam2: true,
    detector: true,
    nafnet: true,
    faces: true,
    phrase: true
  }
})

/**
 * Whether a smart look has model work (masks from a model, AI steps): on a
 * Library selection it brings only the masks it makes without one.
 */
export function needsModels(smart: SmartPart): boolean {
  return planSmart(smart, EVERYTHING, { frameWidth: 1000, frameHeight: 1000 }).ops.length > 0
}

/** A look's step label: `Look: X`, with its Amount when it is not whole. */
export function lookLabel(p: Pick<Preset, 'name' | 'meta'>, amount: number): string {
  const head = p.meta ? `Look: ${p.name}` : `Preset: ${p.name}`
  return amount === 100 ? head : `${head} · ${amount}%`
}

export interface PickerSection {
  id: string
  /** English, translated where shown; '' for the one list a search gives. */
  label: string
  looks: Preset[]
}

/** How many looks applied in the Library the picker remembers. */
export const RECENT_LOOKS = 8

/** `id` first among the recent looks, the oldest dropped past RECENT_LOOKS. */
export function noteRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_LOOKS)
}

/**
 * The look picker's list: My Looks (pinned), the user's presets, the looks
 * applied lately, then each collection in the catalog's order; one ranked
 * list while there is a search. `usable` leaves out what this build cannot
 * do (the browser's Works now).
 */
export function pickerSections(o: {
  catalog: Preset[]
  user: Preset[]
  mine: readonly string[]
  recent: readonly string[]
  query: string
  usable: (p: Preset) => boolean
}): PickerSection[] {
  const all = [...o.catalog, ...o.user].filter(o.usable)
  const byId = new Map(all.map((p) => [p.id, p]))
  if (o.query.trim()) return [{ id: 'found', label: '', looks: searchLooks(all, o.query) }]
  const pick = (ids: readonly string[]): Preset[] =>
    ids.flatMap((id) => {
      const p = byId.get(id)
      return p ? [p] : []
    })
  const out: PickerSection[] = [
    { id: 'mine', label: tk('My Looks'), looks: pick(o.mine) },
    { id: 'user', label: tk('My presets'), looks: o.user.filter(o.usable) },
    { id: 'recent', label: tk('Recent'), looks: pick(o.recent) }
  ]
  const shelves = new Map<string, Preset[]>()
  for (const p of o.catalog) {
    if (!o.usable(p) || !p.meta) continue
    const list = shelves.get(p.meta.collection)
    if (list) list.push(p)
    else shelves.set(p.meta.collection, [p])
  }
  for (const [id, looks] of shelves)
    out.push({ id, label: COLLECTION_BY_ID.get(id)?.label ?? id, looks })
  return out.filter((s) => s.looks.length > 0)
}

/** The picker's rows in order, each look under the section it is shown in. */
export function pickerRows(sections: PickerSection[]): { row: string; look: Preset }[] {
  return sections.flatMap((s) => s.looks.map((look) => ({ row: `${s.id}:${look.id}`, look })))
}

// ── what the tab acts on ────────────────────────────────────────────────────

export interface TargetsSummary {
  count: number
  raw: number
  hdr: number
  /** Not where the index last saw them: settings only (Auto cannot measure them). */
  offline: number
  /** Their thumbnail failed: the engine cannot read them. */
  unreadable: number
  /** Covers of collapsed stacks: only the cover is changed. */
  stacks: number
  /** The selection mixes RAWs (Temp in mired) and other photos (Temp in units). */
  mixed: boolean
}

/** The photos Quick develop acts on, counted. `expanded`: the stacks shown whole. */
export function targetsSummary(
  items: readonly (LibraryItem | undefined)[],
  expanded: ReadonlySet<string>
): TargetsSummary {
  const s: TargetsSummary = {
    count: 0,
    raw: 0,
    hdr: 0,
    offline: 0,
    unreadable: 0,
    stacks: 0,
    mixed: false
  }
  for (const it of items) {
    if (!it) continue
    s.count++
    if (it.isRaw) s.raw++
    if (it.hdr) s.hdr++
    if (it.offline) s.offline++
    if (it.unreadable) s.unreadable++
    if (it.stack && it.stack.size > 1 && !expanded.has(it.stack.id)) s.stacks++
  }
  s.mixed = s.raw > 0 && s.raw < s.count
  return s
}
