/**
 * The words looks are written in. A look is a list of steps over a default
 * recipe; what it changed becomes its `fields`, so applying it moves only
 * those sliders and leaves the photo's others alone:
 *
 *   look('chrome-reportage', 'Chrome Reportage', { tags: [...], inspiredBy: '…' },
 *     prim({ contrast: 1.09, sat: -20 }),
 *     tone({ shadows: -10 }),
 *     lift(200, 8),
 *     gain(50, 8),
 *     hueCurve('hueSat', [[120, 0.75]]))
 *
 * Looks are built on Playroom's colour tools (the Primaries' wheels and bar,
 * the hue and Lum vs Sat curves, HSL for brightness by colour), never on
 * Lightroom's retired Colour grading wheels.
 *
 * Steps add to what is there, so two steps on one slider sum. `fade` and
 * `rolloff` work on the finished master curve, whatever shaped it.
 */
import {
  changedFields,
  defaultRecipe,
  HSL_BANDS,
  type BloomStyle,
  type CalibrationSetting,
  type CurvePointSetting,
  type GrainResponseKind,
  type HslBand,
  type Recipe,
  type RecipeGroup
} from '../recipe'
import { COLLECTION_BY_ID } from './collections'
import { discToward } from '../resolve'
import type { MaskMode } from '../engine-types'
import type { MaskPart, MaskTarget, PersonPart, SmartDenoiseModel, SmartPart } from './smart'
import type { Look, LookApproximation, LookMeta } from './types'

interface BuildState {
  /** Black and white output levels the master curve is squeezed into. */
  lift: number
  drop: number
  approximates: Set<LookApproximation>
  /** Fields the look sets even where they equal the default (grain's size with its amount). */
  include: Set<string>
  /** Masks and AI steps, for a smart look. */
  smart: SmartPart
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
  smart?: SmartPart
}

const ROOT_GROUP: Record<string, RecipeGroup> = {
  primaries: 'primaries',
  logWheels: 'primaries',
  qualifiers: 'primaries',
  curvesVs: 'toneCurve',
  basic: 'basicTone',
  presence: 'presence',
  toneCurve: 'toneCurve',
  hsl: 'hsl',
  bwMix: 'hsl',
  pointColors: 'hsl',
  density: 'hsl',
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
  const s: BuildState = {
    lift: 0,
    drop: 0,
    approximates: new Set(),
    include: new Set(),
    smart: { masks: [], steps: [] }
  }
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
    include: [...s.include].map((p) => p.split('.')),
    ...(s.smart.masks.length || s.smart.steps.length ? { smart: s.smart } : {})
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
      meta,
      ...(d.smart ? { smart: d.smart } : {})
    }
  })
}

// ── Steps: DaVinci Resolve's tools ─────────────────────────────────────────

type Wheel = 'lift' | 'gamma' | 'gain' | 'offset'

/**
 * How far a wheel's disc goes for each point of a Lightroom grading wheel's
 * saturation: measured on a grey ramp, the tint at the wheel's own tones
 * matches (Lift for Shadows, Gamma for Midtones, Gain for Highlights, Offset
 * for Global). So "lift(200, 30)" is the strength Lightroom calls 30.
 */
const DISC_PER_POINT: Record<Wheel, number> = {
  lift: 0.00103,
  gamma: 0.0034,
  gain: 0.0011,
  offset: 0.00118
}

/** A Resolve wheel's disc pushed toward `hue` (degrees) at Lightroom-wheel `strength` 0…100. */
export const push =
  (wheel: Wheel, hue: number, strength: number): LookStep =>
  (r) => {
    const t = discToward(hue, strength * DISC_PER_POINT[wheel])
    const w = r.primaries[wheel]
    w.r = round(w.r + t.r)
    w.g = round(w.g + t.g)
    w.b = round(w.b + t.b)
  }
export const lift = (hue: number, strength: number): LookStep => push('lift', hue, strength)
export const gamma = (hue: number, strength: number): LookStep => push('gamma', hue, strength)
export const gain = (hue: number, strength: number): LookStep => push('gain', hue, strength)
export const offset = (hue: number, strength: number): LookStep => push('offset', hue, strength)

/** A wheel's master (Y): Lift, Gamma and Offset add, Gain multiplies. */
export const master =
  (wheel: Wheel, v: number): LookStep =>
  (r) => {
    const w = r.primaries[wheel]
    w.y = round(wheel === 'gain' ? w.y * v : w.y + v)
  }

/**
 * A matte base: the blacks lifted to `lift` and the whites held to 1 − `drop`
 * with the Lift and Gain masters (exactly the squeeze `fade` and `rolloff`
 * make on the master curve, `lift + v·(gain − lift)`).
 */
export const matte =
  (liftBy: number, drop = 0): LookStep =>
  (r) => {
    r.primaries.lift.y = round(r.primaries.lift.y + liftBy)
    r.primaries.gain.y = round(r.primaries.gain.y * (1 - drop))
  }

/** The Primaries' bar: contrast (1 untouched), pivot, and Sat and Hue as Lightroom-style changes (−100…100). */
export const prim =
  (p: { contrast?: number; pivot?: number; sat?: number; hue?: number }): LookStep =>
  (r) => {
    if (p.contrast !== undefined) r.primaries.contrast = round(r.primaries.contrast * p.contrast)
    if (p.pivot !== undefined) r.primaries.pivot = p.pivot
    if (p.sat !== undefined)
      r.primaries.saturation = round(r.primaries.saturation * (1 + p.sat / 100))
    if (p.hue !== undefined) r.primaries.hue = round(r.primaries.hue + p.hue / 3.6)
  }

/** A Log wheel's push toward `hue` at Lightroom-wheel strength (its own tones only). */
export const logPush =
  (part: 'shadow' | 'midtone' | 'highlight', hue: number, strength: number): LookStep =>
  (r) => {
    const t = discToward(hue, strength * DISC_PER_POINT.offset)
    const w = r.logWheels[part]
    w.r = round(w.r + t.r)
    w.g = round(w.g + t.g)
    w.b = round(w.b + t.b)
  }

/**
 * A hue curve's change at a few hues, each a bump that eases back to none
 * `width` degrees either side: Hue vs Hue in degrees turned, Hue vs Sat as a
 * multiplier (1 untouched). The colour alone moves, the rest stays.
 */
export const hueCurve =
  (curve: 'hueHue' | 'hueSat', at: [number, number][], width = 35): LookStep =>
  (r) => {
    const y = (v: number): number =>
      curve === 'hueHue' ? round(0.5 + v / 360) : round(Math.min(1, Math.max(0, v / 2)))
    const pts = new Map<number, number>()
    const wrap = (h: number): number => round((((h % 360) + 360) % 360) / 360)
    // Each bump eases back to none at its sides; a side that would land
    // within 12° of another bump or side is left out (one point there is
    // enough, and a curve keeps at most 16).
    const apart = (a: number, b: number): number => {
      const d = Math.abs((((a - b) % 360) + 360) % 360)
      return Math.min(d, 360 - d)
    }
    const placed = at.map(([h]) => h)
    for (const [h] of at) {
      for (const side of [-width, width]) {
        if (placed.some((o) => apart(h + side, o) < 12)) continue
        placed.push(h + side)
        pts.set(wrap(h + side), 0.5)
      }
    }
    for (const [h, v] of at) pts.set(wrap(h), y(v))
    r.curvesVs[curve] = [...pts.entries()]
      .map(([x, yy]) => ({ x, y: yy }))
      .sort((a, b) => a.x - b.x)
  }

/** Lum vs Sat: saturation multipliers at brightnesses 0…1 (1 untouched). */
export const lumSat =
  (at: [number, number][]): LookStep =>
  (r) => {
    r.curvesVs.lumSat = at.map(([x, v]) => ({ x, y: round(Math.min(1, Math.max(0, v / 2))) }))
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

/**
 * Film grain: amount, size and roughness, and for a colour film its colour
 * (0…100) and where in the tones it is strongest (`film`, the midtones, by
 * default).
 */
export const grain =
  (
    amount: number,
    size = 25,
    roughness = 50,
    opts: { colour?: number; response?: GrainResponseKind } = {}
  ): LookStep =>
  (r, s) => {
    r.effects.grainAmount = amount
    r.effects.grainSize = size
    r.effects.grainRoughness = roughness
    r.effects.grainColour = opts.colour ?? 0
    r.effects.grainResponse = opts.response ?? 'film'
    // A grain is all of it: the photo's own size or colour never mixes with this amount.
    s.include.add('effects.grainSize')
    s.include.add('effects.grainRoughness')
    s.include.add('effects.grainColour')
    s.include.add('effects.grainResponse')
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
 * Halation: a red glow around the highlights, as light scattered back
 * through a colour film's base (0…100; threshold and size 0…100, hue 0…45
 * from red to amber). The whole effect, so a photo's own never mixes in.
 */
export const halation =
  (amount: number, opts: { threshold?: number; size?: number; hue?: number } = {}): LookStep =>
  (r, s) => {
    r.effects.halation = {
      amount,
      threshold: opts.threshold ?? 80,
      size: opts.size ?? 50,
      hue: opts.hue ?? 12
    }
    for (const k of ['threshold', 'size', 'hue']) s.include.add(`effects.halation.${k}`)
  }

/**
 * Bloom: `diffusion` veils the whole picture as a diffusion filter does
 * (a Pro-Mist), `glow` spreads only the highlights (neon at night). Amount,
 * size and threshold 0…100, warmth −100…100.
 */
export const bloom =
  (
    amount: number,
    opts: { style?: BloomStyle; size?: number; threshold?: number; warmth?: number } = {}
  ): LookStep =>
  (r, s) => {
    r.effects.bloom = {
      style: opts.style ?? 'diffusion',
      amount,
      size: opts.size ?? 65,
      threshold: opts.threshold ?? 75,
      warmth: opts.warmth ?? 0
    }
    for (const k of ['style', 'size', 'threshold', 'warmth']) s.include.add(`effects.bloom.${k}`)
  }

/**
 * Density (−100…100): saturated colour darkened as a slide film's dyes
 * make it, its hue kept. `bands` weighs each hue (−100…100, 100 untouched).
 * Every band is the look's.
 */
export const density =
  (amount: number, bands: Partial<Record<HslBand, number>> = {}): LookStep =>
  (r, s) => {
    r.density.amount += amount
    for (const b of HSL_BANDS) {
      r.density.bands[b] = bands[b] ?? 100
      s.include.add(`density.bands.${b}`)
    }
  }

/** Marks a look as standing in for something the sliders cannot quite do. */
export const approximates =
  (what: LookApproximation): LookStep =>
  (_r, s) => {
    s.approximates.add(what)
  }

// ── Smart steps (`smart.ts`) ────────────────────────────────────────────────

/** Mask parts, for `mask(…)`: the first adds; `minus` and `within` join the rest. */
export const part = {
  range: (t: Omit<Extract<MaskTarget, { kind: 'range' }>, 'kind'>): MaskPart => ({
    target: { kind: 'range', ...t },
    mode: 'Add'
  }),
  linear: (start: [number, number], end: [number, number]): MaskPart => ({
    target: {
      kind: 'linear',
      start: { x: start[0], y: start[1] },
      end: { x: end[0], y: end[1] }
    },
    mode: 'Add'
  }),
  radial: (
    centre: [number, number],
    radiusX: number,
    radiusY = radiusX,
    softness = 50
  ): MaskPart => ({
    target: {
      kind: 'radial',
      centre: { x: centre[0], y: centre[1] },
      radiusX,
      radiusY,
      angle: 0,
      softness
    },
    mode: 'Add'
  }),
  subject: (): MaskPart => ({ target: { kind: 'subject' }, mode: 'Add' }),
  background: (): MaskPart => ({ target: { kind: 'background' }, mode: 'Add' }),
  sky: (): MaskPart => ({ target: { kind: 'sky' }, mode: 'Add' }),
  person: (p: PersonPart): MaskPart => ({ target: { kind: 'person', part: p }, mode: 'Add' }),
  object: (label: string): MaskPart => ({ target: { kind: 'object', label }, mode: 'Add' })
}

const joined = (p: MaskPart, mode: MaskMode): MaskPart => ({ ...p, mode })
/** Taken away from the parts before it ("sky minus the subject"). */
export const minus = (p: MaskPart): MaskPart => joined(p, 'Subtract')
/** Only where it and the parts before it meet ("skin within the subject"). */
export const within = (p: MaskPart): MaskPart => joined(p, 'Intersect')
/** Everything but it. */
export const inverted = (p: MaskPart): MaskPart => ({ ...p, invert: !p.invert })

/**
 * A mask the look makes: `id` names it for a step's scope; `adjust` is what
 * it does, by dotted path into a mask's settings ("basic.exposure": -0.4).
 */
export const mask =
  (
    id: string,
    name: string,
    parts: MaskPart[],
    adjust: Record<string, number>,
    opts: { feather?: number; amount?: number; required?: boolean } = {}
  ): LookStep =>
  (_r, s) => {
    s.smart.masks.push({
      id,
      name,
      parts: parts.map((p, i) => (i === 0 ? { ...p, mode: 'Add' } : p)),
      adjust,
      ...opts
    })
  }

/** AI denoise, on the whole photo or inside a mask the look makes (`scope`). */
export const denoise =
  (strength: number, opts: { model?: SmartDenoiseModel; scope?: string } = {}): LookStep =>
  (_r, s) => {
    s.smart.steps.push({
      kind: 'denoise',
      model: opts.model ?? 'auto',
      strength,
      ...(opts.scope ? { scope: opts.scope } : {})
    })
  }

/** AI deblur (NAFNet), on the whole photo or inside a mask the look makes. */
export const deblur =
  (strength: number, opts: { scope?: string } = {}): LookStep =>
  (_r, s) => {
    s.smart.steps.push({ kind: 'deblur', strength, ...(opts.scope ? { scope: opts.scope } : {}) })
  }
