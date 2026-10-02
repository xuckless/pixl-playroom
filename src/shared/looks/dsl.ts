/**
 * The words looks are written in. A look is a list of steps over a default
 * recipe; what it changed becomes its `fields`, so applying it moves only
 * those sliders and leaves the photo's others alone:
 *
 *   look('chrome-reportage', 'Chrome Reportage', { tags: [...], inspiredBy: '…' },
 *     tone({ contrast: 15, shadows: -10 }),
 *     presence({ saturation: -20 }),
 *     split(200, 8, 50, 8),
 *     hsl({ green: [-10, -25, 0] }))
 *
 * Steps add to what is there, so two steps on one slider sum. `fade` and
 * `rolloff` work on the finished master curve, whatever shaped it.
 */
import {
  changedFields,
  defaultRecipe,
  HSL_BANDS,
  type CalibrationSetting,
  type CurvePointSetting,
  type HslBand,
  type Recipe,
  type RecipeGroup
} from '../recipe'
import { COLLECTION_BY_ID } from './collections'
import type { Look, LookApproximation, LookMeta } from './types'

interface BuildState {
  /** Black and white output levels the master curve is squeezed into. */
  lift: number
  drop: number
  approximates: Set<LookApproximation>
  /** Fields the look sets even where they equal the default (grain's size with its amount). */
  include: Set<string>
}

export type LookStep = (r: Recipe, s: BuildState) => void

/** What a look file gives besides its steps; the collection stamps the rest. */
export interface LookInfo {
  tags: string[]
  inspiredBy?: string
  description?: string
  version?: number
}

/** A look before its collection is known. */
export interface LookDraft {
  slug: string
  name: string
  info: LookInfo
  recipe: Recipe
  approximates: LookApproximation[]
  include: string[][]
}

const ROOT_GROUP: Record<string, RecipeGroup> = {
  basic: 'basicTone',
  presence: 'presence',
  toneCurve: 'toneCurve',
  hsl: 'hsl',
  bwMix: 'hsl',
  pointColors: 'hsl',
  colorGrade: 'colorGrade',
  effects: 'effects',
  calibration: 'calibration',
  treatment: 'treatment'
}

/** The groups a set of field paths falls in, in `RECIPE_GROUPS`' sense. */
export function groupsOf(fields: string[][]): RecipeGroup[] {
  const out = new Set<RecipeGroup>()
  for (const f of fields) {
    const g = ROOT_GROUP[f[0]]
    if (g) out.add(g)
  }
  return [...out]
}

const round = (v: number, d = 4): number => Math.round(v * 10 ** d) / 10 ** d

export function look(slug: string, name: string, info: LookInfo, ...steps: LookStep[]): LookDraft {
  const recipe = defaultRecipe(false)
  const s: BuildState = { lift: 0, drop: 0, approximates: new Set(), include: new Set() }
  for (const step of steps) step(recipe, s)
  if (s.lift !== 0 || s.drop !== 0) {
    const lo = s.lift
    const hi = 1 - s.drop
    recipe.toneCurve.master = recipe.toneCurve.master.map((p) => ({
      x: p.x,
      y: round(lo + p.y * (hi - lo))
    }))
  }
  return {
    slug,
    name,
    info,
    recipe,
    approximates: [...s.approximates],
    include: [...s.include].map((p) => p.split('.'))
  }
}

/** Looks placed in a collection: built in, by PIXL, at version 1 unless retuned. */
export function collection(id: string, drafts: LookDraft[]): Look[] {
  const shelf = COLLECTION_BY_ID.get(id)
  if (!shelf) throw new Error(`no collection ${id}`)
  const base = defaultRecipe(false)
  return drafts.map((d) => {
    const fields = changedFields(d.recipe, base)
    for (const p of d.include) if (!fields.some((f) => f.join('.') === p.join('.'))) fields.push(p)
    const meta: LookMeta = {
      collection: id,
      tags: d.info.tags,
      author: { kind: 'pixl' },
      version: d.info.version ?? 1
    }
    if (d.info.inspiredBy) meta.inspiredBy = d.info.inspiredBy
    if (d.info.description) meta.description = d.info.description
    if (d.approximates.length) meta.approximates = d.approximates
    return {
      id: `builtin:${d.slug}`,
      name: d.name,
      group: shelf.label,
      builtin: true,
      groups: groupsOf(fields),
      recipe: d.recipe,
      fields,
      meta
    }
  })
}

// ── Steps ───────────────────────────────────────────────────────────────────

/** Anything the words below do not cover, written against the recipe itself. */
export const raw =
  (edit: (r: Recipe) => void): LookStep =>
  (r) =>
    edit(r)

type Tone = Partial<Record<'contrast' | 'highlights' | 'shadows' | 'whites' | 'blacks', number>>

export const tone =
  (t: Tone): LookStep =>
  (r) => {
    for (const [k, v] of Object.entries(t)) r.basic[k as keyof Tone] += v
  }

type Presence = Partial<
  Record<'texture' | 'clarity' | 'dehaze' | 'vibrance' | 'saturation', number>
>

export const presence =
  (p: Presence): LookStep =>
  (r) => {
    for (const [k, v] of Object.entries(p)) r.presence[k as keyof Presence] += v
  }

/** Bands as [hue, saturation, luminance], each −100…100. */
export const hsl =
  (bands: Partial<Record<HslBand, [number, number, number]>>): LookStep =>
  (r) => {
    for (const [b, [h, s, l]] of Object.entries(bands) as [HslBand, [number, number, number]][]) {
      r.hsl[b].hue += h
      r.hsl[b].saturation += s
      r.hsl[b].luminance += l
    }
  }

/**
 * Foliage, as [hue, saturation, luminance]. Leaves sit mostly in the yellow
 * band (yellow-greens, 60–100°) and only partly in green, so "mute the
 * greens" moves green fully and yellow at 60%; a bare `hsl({ green })` barely
 * touches a tree.
 */
export const foliage =
  (h: number, s: number, l: number): LookStep =>
  (r) => {
    const k = 0.6
    r.hsl.green.hue += h
    r.hsl.green.saturation += s
    r.hsl.green.luminance += l
    r.hsl.yellow.hue += Math.round(h * k)
    r.hsl.yellow.saturation += Math.round(s * k)
    r.hsl.yellow.luminance += Math.round(l * k)
  }

/**
 * An S on the master curve: `k` −100…100 pulls the quarter tones apart
 * (positive) or together; `pivot` 0…1 moves where it turns.
 */
export const sCurve =
  (k: number, pivot = 0.5): LookStep =>
  (r) => {
    const d = (k / 100) * 0.12
    const q1 = pivot / 2
    const q3 = pivot + (1 - pivot) / 2
    r.toneCurve.master = [
      { x: 0, y: 0 },
      { x: round(q1), y: round(Math.max(0, q1 - d)) },
      { x: round(pivot), y: round(pivot) },
      { x: round(q3), y: round(Math.min(1, q3 + d)) },
      { x: 1, y: 1 }
    ]
  }

/** Blacks lifted to `lift` (0…1 of output): a faded, matte base. */
export const fade =
  (lift: number): LookStep =>
  (_r, s) => {
    s.lift += lift
  }

/** Whites held down by `drop` (0…1 of output): a soft, printed top end. */
export const rolloff =
  (drop: number): LookStep =>
  (_r, s) => {
    s.drop += drop
  }

type Points = [number, number][]
const toPoints = (p: Points): CurvePointSetting[] => p.map(([x, y]) => ({ x, y }))

/** A point curve on one channel, points in 0…1. */
export const curve =
  (channel: 'master' | 'red' | 'green' | 'blue', points: Points): LookStep =>
  (r) => {
    r.toneCurve[channel] = toPoints(points)
  }

/** Per-channel curves (crossovers, a print's tint by tone). */
export const rgb =
  (c: { r?: Points; g?: Points; b?: Points }): LookStep =>
  (r) => {
    if (c.r) r.toneCurve.red = toPoints(c.r)
    if (c.g) r.toneCurve.green = toPoints(c.g)
    if (c.b) r.toneCurve.blue = toPoints(c.b)
  }

export const parametric =
  (p: Partial<Record<'highlights' | 'lights' | 'darks' | 'shadows', number>>): LookStep =>
  (r) => {
    for (const [k, v] of Object.entries(p)) r.toneCurve[k as keyof typeof p] += v
  }

type Region = 'shadows' | 'midtones' | 'highlights' | 'global'

/** One grading wheel: hue 0…360, saturation 0…100, luminance −100…100. */
export const wheel =
  (region: Region, hue: number, saturation: number, luminance = 0): LookStep =>
  (r) => {
    r.colorGrade[region] = { hue, saturation, luminance }
  }

/** Split toning: a shadow colour and a highlight colour. */
export const split =
  (
    shadowHue: number,
    shadowSat: number,
    highlightHue: number,
    highlightSat: number,
    opts: { balance?: number; blending?: number } = {}
  ): LookStep =>
  (r) => {
    if (shadowSat > 0)
      r.colorGrade.shadows = { hue: shadowHue, saturation: shadowSat, luminance: 0 }
    if (highlightSat > 0)
      r.colorGrade.highlights = { hue: highlightHue, saturation: highlightSat, luminance: 0 }
    if (opts.balance !== undefined) r.colorGrade.balance = opts.balance
    if (opts.blending !== undefined) r.colorGrade.blending = opts.blending
  }

/** Calibration primaries and the shadows' tint, −100…100. */
export const calib =
  (c: Partial<CalibrationSetting>): LookStep =>
  (r) => {
    for (const [k, v] of Object.entries(c)) r.calibration[k as keyof CalibrationSetting] += v
  }

/** Black and white, with a colour filter mix per band (−100…100). */
export const mono =
  (mix: Partial<Record<HslBand, number>> = {}): LookStep =>
  (r, s) => {
    r.treatment = 'bw'
    // The whole mix: a photo's own mix never shows through a mono look's filter.
    for (const b of HSL_BANDS) {
      r.bwMix[b] = mix[b] ?? 0
      s.include.add(`bwMix.${b}`)
    }
  }

export const grain =
  (amount: number, size = 25, roughness = 50): LookStep =>
  (r, s) => {
    r.effects.grainAmount = amount
    r.effects.grainSize = size
    r.effects.grainRoughness = roughness
    // A grain is all three: the photo's own size never mixes with this amount.
    s.include.add('effects.grainSize')
    s.include.add('effects.grainRoughness')
  }

export const vignette =
  (
    amount: number,
    opts: { midpoint?: number; feather?: number; roundness?: number; highlights?: number } = {}
  ): LookStep =>
  (r, s) => {
    r.effects.vignetteAmount = amount
    s.include.add('effects.vignetteMidpoint')
    s.include.add('effects.vignetteFeather')
    if (opts.midpoint !== undefined) r.effects.vignetteMidpoint = opts.midpoint
    if (opts.feather !== undefined) r.effects.vignetteFeather = opts.feather
    if (opts.roundness !== undefined) r.effects.vignetteRoundness = opts.roundness
    if (opts.highlights !== undefined) r.effects.vignetteHighlights = opts.highlights
  }

/** A wash toward a colour over the whole look (lifts blacks as much as whites). */
export const wash =
  (hue: number, saturation: number, amount: number): LookStep =>
  (r) => {
    r.effects.wash = { hue, saturation, amount }
  }

/** Coloured light added in the linear stage (Colour grading → Add colour). */
export const addLight =
  (hue: number, saturation: number, amount: number): LookStep =>
  (r) => {
    r.colorGrade.add = { hue, saturation, amount }
  }

/**
 * Halation as the sliders can suggest it: a warm red in the highlights, a
 * faint red wash, a little less local contrast. Marked, so the look can be
 * redone when the engine has the real thing.
 */
export const halationApprox =
  (k: number): LookStep =>
  (r, s) => {
    r.colorGrade.highlights = {
      hue: 12,
      saturation: Math.round(Math.max(r.colorGrade.highlights.saturation, k * 0.18)),
      luminance: r.colorGrade.highlights.luminance
    }
    r.effects.wash = { hue: 8, saturation: 70, amount: Math.round(k * 0.05) }
    r.presence.clarity -= Math.round(k * 0.08)
    s.approximates.add('halation')
  }

/** Bloom or diffusion as the sliders can suggest it: softer local contrast, lifted shadows. */
export const bloomApprox =
  (k: number): LookStep =>
  (r, s) => {
    r.presence.clarity -= Math.round(k * 0.25)
    r.presence.texture -= Math.round(k * 0.1)
    r.basic.shadows += Math.round(k * 0.15)
    s.approximates.add('bloom')
  }

/** Marks a look as standing in for something the sliders cannot quite do. */
export const approximates =
  (what: LookApproximation): LookStep =>
  (_r, s) => {
    s.approximates.add(what)
  }
