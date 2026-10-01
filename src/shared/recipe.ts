/**
 * A photo's develop settings — the "recipe". This is what the sliders hold,
 * in the units a photographer reads (−100…100, stops, Kelvin), and what the
 * sidecar beside the photo stores. It never reaches the engine as is:
 * `compile.ts` turns it into an engine `Grade` + `Framing`, and that mapping
 * is the one place the units are given meaning.
 *
 * Every recipe is complete: no field is optional, so an old sidecar is
 * brought up to date by `normaliseRecipe` rather than by `?.` everywhere.
 */
import { NO_ADD, type AddColourSetting } from './addcolor'
import type { BlendMode, CropRect, KeyBand, MaskMode } from './engine-types'
import { defaultLens, type LensSetting } from './lens'
import { defaultUpright, type UprightSetting } from './upright'
import type { RetouchSpot } from './retouch'
import { normalisePixelStep, type PixelStep } from './pixels'

export const RECIPE_VERSION = 2

export const HSL_BANDS = [
  'red',
  'orange',
  'yellow',
  'green',
  'aqua',
  'blue',
  'purple',
  'magenta'
] as const
export type HslBand = (typeof HSL_BANDS)[number]

/** The hue each HSL band is centred on, as the engine defines them. */
export const HSL_BAND_CENTRES: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 275,
  magenta: 315
}

export interface BandSetting {
  hue: number
  saturation: number
  luminance: number
}

/**
 * A colour picked off the photo and moved on its own (the colour mixer's
 * Point tab): the sample in look-space HSV, the shift, and how wide a range
 * of similar colours follows it.
 */
export interface PointColorSetting {
  id: string
  /** The sampled colour: hue 0…360, saturation and luminance 0…1. */
  hue: number
  saturation: number
  luminance: number
  /** −100…100 */
  shiftHue: number
  shiftSat: number
  shiftLum: number
  /** 0…100: how far from the sample the shift reaches. */
  range: number
}

export const MAX_POINT_COLORS = 8

export type ProfileRef =
  | { kind: 'neutral' }
  | { kind: 'standard' }
  | { kind: 'vivid' }
  | { kind: 'monochrome' }
  | { kind: 'lut'; name: string; path: string }

export interface WhiteBalanceSetting {
  /**
   * `as-shot` leaves the white alone (the op is the identity); `custom` uses
   * `temperature`/`tint`. For a RAW with a known as-shot white the numbers
   * are absolute Kelvin and tint units; for everything else they are relative
   * −100…100. `preset` remembers which menu entry set them.
   */
  mode: 'as-shot' | 'custom'
  temperature: number
  tint: number
  preset: string | null
}

export interface BasicSetting {
  /** Stops, −5…5. */
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
}

export interface PresenceSetting {
  texture: number
  clarity: number
  dehaze: number
  vibrance: number
  saturation: number
  /** −100…100: turns every hue (a mask's Hue slider; the whole photo has HSL for this). */
  hue: number
}

export interface CurvePointSetting {
  x: number
  y: number
}

export interface ToneCurveSetting {
  /** The parametric curve's four region sliders, −100…100. */
  highlights: number
  lights: number
  darks: number
  shadows: number
  /** Region split points, 0…100 (Lightroom's 25/50/75). */
  splits: [number, number, number]
  /** Point curves in 0…1; two points at the corners is the identity. */
  master: CurvePointSetting[]
  red: CurvePointSetting[]
  green: CurvePointSetting[]
  blue: CurvePointSetting[]
  /**
   * 0…100: how much saturation the RGB point curve brings with it as it
   * steepens (Refine Saturation). 100 is the curve as it has always run.
   */
  refineSaturation: number
}

export interface WheelSetting {
  hue: number
  saturation: number
  luminance: number
}

export interface ColorGradeSetting {
  shadows: WheelSetting
  midtones: WheelSetting
  highlights: WheelSetting
  global: WheelSetting
  blending: number
  balance: number
  /** Coloured light added over the whole picture (see `addcolor.ts`). */
  add: AddColourSetting
}

export interface DetailSetting {
  sharpenAmount: number
  sharpenRadius: number
  sharpenDetail: number
  sharpenMasking: number
  noiseLuminance: number
  noiseLuminanceDetail: number
  noiseColor: number
  noiseColorDetail: number
  /**
   * AI noise reduction as it was before it became a pixel step (`pixels`):
   * a photo whose recipe still has it on is given the step it described when
   * it opens (renderer lib/denoise.ts), and it goes off. Nothing else reads it.
   */
  ai: AiDenoiseSetting
}

export type AiDenoiseModel = 'scunet-color-real' | 'drunet-color'

export interface AiDenoiseSetting {
  enabled: boolean
  model: AiDenoiseModel
  /** 1…100: how much of the model's result replaces the photo. */
  strength: number
}

export interface EffectsSetting {
  vignetteAmount: number
  vignetteMidpoint: number
  vignetteRoundness: number
  vignetteFeather: number
  vignetteHighlights: number
  /** Highlight priority darkens like light falling off; paint overlay mixes toward black or white. */
  vignetteStyle: 'highlight' | 'paint'
  /** A lift toward a colour on the look's code values (see `addcolor.ts`). */
  wash: AddColourSetting
  grainAmount: number
  grainSize: number
  grainRoughness: number
}

export interface CalibrationSetting {
  shadowsTint: number
  redHue: number
  redSaturation: number
  greenHue: number
  greenSaturation: number
  blueHue: number
  blueSaturation: number
}

export interface GeometrySetting {
  /** Clockwise quarter turns on top of the file's own orientation. */
  quarterTurns: number
  flipHorizontal: boolean
  /** −45…45 degrees, positive clockwise. */
  straighten: number
  /** A rectangle of the straightened canvas, 0…1 on each axis; null keeps the frame. */
  crop: { x: number; y: number; width: number; height: number } | null
  /** Width over height the crop tool holds, or null for free. */
  aspect: number | null
  /** Perspective correction (see `upright.ts`). */
  upright: UprightSetting
}

// ── Local adjustments ────────────────────────────────────────────────────────

interface ComponentBase {
  id: string
  /** The user's name for it; unset, the list shows the kind's own label. */
  name?: string
  mode: MaskMode
  /** 0…100 */
  opacity: number
  invert: boolean
  /** 0…100, a fraction of the frame's shorter side (100 = 10%). */
  feather: number
}

/**
 * A painted plane: 8-bit grey PNG, base64, in the base frame's aspect. Across
 * IPC (and in the renderer's state and the edit history) the plane travels
 * by reference: `png` is empty and `ref` names it in the main process's
 * plane store. Sidecars always hold the PNG itself.
 */
export interface BrushComponent extends ComponentBase {
  kind: 'brush'
  width: number
  height: number
  png: string
  ref?: string
}

/** A lasso or pen outline, in normalised base-frame coordinates. */
export interface PolygonComponent extends ComponentBase {
  kind: 'polygon'
  points: { x: number; y: number }[]
}

/** A colour and/or luminance range (the engine's HSL key), keyed in Display P3. */
export interface RangeComponent extends ComponentBase {
  kind: 'range'
  hue: KeyBand | null
  saturation: KeyBand | null
  luma: KeyBand | null
  /** 0…100: blurs the selection's edges (the key's blur, up to 1% of the short side). */
  smoothness: number
}

/**
 * A linear gradient (Lightroom's), in normalised base-frame coordinates: the
 * full effect at `start`, fading to nothing at `end`, across lines at right
 * angles to start→end. It reaches the engine as a raster plane of
 * `width × height` (the base frame's aspect), drawn from these numbers.
 */
export interface LinearComponent extends ComponentBase {
  kind: 'linear'
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
  height: number
}

/**
 * A radial gradient: an ellipse centred at `centre` (normalised base frame)
 * with semi-axes as fractions of the frame's shorter side, turned by `angle`
 * degrees. Full effect inside, fading out over the outer `softness`% of the
 * radius. `invert` on the component selects the outside instead.
 */
export interface RadialComponent extends ComponentBase {
  kind: 'radial'
  centre: { x: number; y: number }
  radiusX: number
  radiusY: number
  angle: number
  softness: number
  width: number
  height: number
}

export type MaskComponentSetting =
  BrushComponent | PolygonComponent | RangeComponent | LinearComponent | RadialComponent

/** Components drawn into a raster plane before they reach the engine. */
export type RasterComponent = BrushComponent | LinearComponent | RadialComponent

/**
 * A mask's sliders before version 2, when a mask had its own small set:
 * kept only to read old sidecars, histories and presets (`settingsFromAdjust`).
 */
export interface LocalAdjust {
  temperature: number
  tint: number
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  texture: number
  clarity: number
  dehaze: number
  hue: number
  saturation: number
  sharpness: number
  noise: number
  /** A colour laid over the selection: hue 0…360, strength 0…100. */
  tintHue: number
  tintAmount: number
  /** Coloured light added in the selection: hue 0…360, saturation and amount 0…100. */
  addHue: number
  addSaturation: number
  addAmount: number
}

export interface LocalLayer {
  id: string
  name: string
  enabled: boolean
  /** 0…100 */
  opacity: number
  blend: BlendMode
  invert: boolean
  components: MaskComponentSetting[]
  /**
   * What the mask does where it selects: the same settings the whole photo
   * has, as a change on top of it (neutral is no change). The panels edit
   * these while the mask is selected (see `scope.ts` in the renderer).
   */
  settings: LayerSettings
  /** 0…200: scales every adjustment of the mask at once (Lightroom's Amount). */
  amount: number
  /** The mask's own overlay colour, a hue in 0…360; unset uses the overlay's colour. */
  overlayHue?: number
}

/**
 * A layer written directly in the engine's own terms — the Advanced view.
 * `layer` is an engine `GradeLayer` as JSON, passed through untouched.
 */
export interface CustomLayer {
  id: string
  name: string
  enabled: boolean
  layer: unknown
}

/**
 * The settings a mask can carry: the photo's colour and tone, without what
 * only makes sense once (profile, treatment, lens, geometry, retouch).
 */
export const SETTINGS_KEYS = [
  'wb',
  'basic',
  'presence',
  'toneCurve',
  'hsl',
  'pointColors',
  'colorGrade',
  'detail',
  'effects',
  'calibration'
] as const

export type SettingsKey = (typeof SETTINGS_KEYS)[number]
export type LayerSettings = Pick<Recipe, SettingsKey>

export interface Recipe {
  version: typeof RECIPE_VERSION
  profile: ProfileRef
  /** 0…200 for a LUT profile; 100 is the table as written. */
  profileAmount: number
  treatment: 'color' | 'bw'
  wb: WhiteBalanceSetting
  basic: BasicSetting
  presence: PresenceSetting
  toneCurve: ToneCurveSetting
  hsl: Record<HslBand, BandSetting>
  bwMix: Record<HslBand, number>
  pointColors: PointColorSetting[]
  colorGrade: ColorGradeSetting
  detail: DetailSetting
  /** Lens corrections: profile, manual, chromatic aberration, defringe (see `lens.ts`). */
  lens: LensSetting
  effects: EffectsSetting
  calibration: CalibrationSetting
  geometry: GeometrySetting
  /** Heal, clone and fill spots, red and pet eye, in the order they run (see `retouch.ts`). */
  retouch: RetouchSpot[]
  /**
   * Pixel steps (an AI denoise…), in order: images computed once and kept in
   * the photo's project, laid over the photo before anything else (see
   * `pixels.ts`). Never copied to another photo: they are this photo's pixels.
   */
  pixels: PixelStep[]
  layers: LocalLayer[]
  custom: CustomLayer[]
  /**
   * A photo with a gain map (an iPhone HEIC, an UltraHDR JPEG) edited on its
   * SDR base, or on the HDR rendition the map lifts it to. Other photos
   * ignore it.
   */
  gainMap: GainMapEdit
}

export type GainMapEdit = 'base' | 'hdr'

// ── Defaults ─────────────────────────────────────────────────────────────────

const IDENTITY_CURVE = (): CurvePointSetting[] => [
  { x: 0, y: 0 },
  { x: 1, y: 1 }
]

const zeroBands = (): Record<HslBand, BandSetting> =>
  Object.fromEntries(HSL_BANDS.map((b) => [b, { hue: 0, saturation: 0, luminance: 0 }])) as Record<
    HslBand,
    BandSetting
  >

const zeroMix = (): Record<HslBand, number> =>
  Object.fromEntries(HSL_BANDS.map((b) => [b, 0])) as Record<HslBand, number>

const zeroWheel = (): WheelSetting => ({ hue: 0, saturation: 0, luminance: 0 })

export const ZERO_LOCAL: LocalAdjust = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  hue: 0,
  saturation: 0,
  sharpness: 0,
  noise: 0,
  tintHue: 0,
  tintAmount: 0,
  addHue: 0,
  addSaturation: 0,
  addAmount: 0
}

/**
 * The recipe a photo starts with. RAWs get the Standard profile and capture
 * sharpening, as a RAW converter gives them; rendered files start neutral —
 * their look was already decided by whatever rendered them.
 */
export function defaultRecipe(isRaw: boolean): Recipe {
  return {
    version: RECIPE_VERSION,
    profile: isRaw ? { kind: 'standard' } : { kind: 'neutral' },
    profileAmount: 100,
    treatment: 'color',
    gainMap: 'base',
    wb: { mode: 'as-shot', temperature: 0, tint: 0, preset: null },
    basic: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    presence: { texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0, hue: 0 },
    toneCurve: {
      highlights: 0,
      lights: 0,
      darks: 0,
      shadows: 0,
      splits: [25, 50, 75],
      master: IDENTITY_CURVE(),
      red: IDENTITY_CURVE(),
      green: IDENTITY_CURVE(),
      blue: IDENTITY_CURVE(),
      refineSaturation: 100
    },
    hsl: zeroBands(),
    bwMix: zeroMix(),
    pointColors: [],
    colorGrade: {
      shadows: zeroWheel(),
      midtones: zeroWheel(),
      highlights: zeroWheel(),
      global: zeroWheel(),
      blending: 50,
      balance: 0,
      add: { ...NO_ADD }
    },
    detail: {
      sharpenAmount: isRaw ? 40 : 0,
      sharpenRadius: 1,
      sharpenDetail: 25,
      sharpenMasking: 0,
      noiseLuminance: 0,
      noiseLuminanceDetail: 50,
      noiseColor: isRaw ? 25 : 0,
      noiseColorDetail: 50,
      ai: { enabled: false, model: 'scunet-color-real', strength: 100 }
    },
    lens: defaultLens(),
    effects: {
      vignetteAmount: 0,
      vignetteMidpoint: 50,
      vignetteRoundness: 0,
      vignetteFeather: 50,
      vignetteHighlights: 0,
      vignetteStyle: 'highlight',
      wash: { ...NO_ADD },
      grainAmount: 0,
      grainSize: 25,
      grainRoughness: 50
    },
    calibration: {
      shadowsTint: 0,
      redHue: 0,
      redSaturation: 0,
      greenHue: 0,
      greenSaturation: 0,
      blueHue: 0,
      blueSaturation: 0
    },
    geometry: {
      quarterTurns: 0,
      flipHorizontal: false,
      straighten: 0,
      crop: null,
      aspect: null,
      upright: defaultUpright()
    },
    retouch: [],
    pixels: [],
    layers: [],
    custom: []
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Deep-fill `value` from `base`: every field `base` has, `value` gets. */
function fill<T>(base: T, value: unknown): T {
  if (Array.isArray(base)) return (Array.isArray(value) ? value : base) as T
  if (isObject(base)) {
    const out: Record<string, unknown> = {}
    const v = isObject(value) ? value : {}
    for (const k of Object.keys(base)) out[k] = fill((base as Record<string, unknown>)[k], v[k])
    // Unions (profile) carry fields the base does not have.
    for (const k of Object.keys(v)) if (!(k in out)) out[k] = v[k]
    return out as T
  }
  if (base === null) return (value === undefined ? null : value) as T
  return (typeof value === typeof base ? value : base) as T
}

/** Bring a recipe read from a sidecar (maybe older, maybe partial) up to date. */
export function normaliseRecipe(value: unknown, isRaw: boolean): Recipe {
  const base = defaultRecipe(isRaw)
  const r = fill(base, value)
  r.version = RECIPE_VERSION
  if (r.gainMap !== 'hdr') r.gainMap = 'base'
  if (!isObject(value) || !isObject((value as Record<string, unknown>).profile)) {
    r.profile = base.profile
  }
  r.toneCurve = normaliseToneCurve(r.toneCurve)
  r.geometry.crop = normaliseCrop(r.geometry.crop)
  r.layers = (r.layers ?? []).filter(isObject).map(({ overlayHue, ...withOld }) => {
    // Version 1's sliders become settings (`layerSettingsOf`) and go.
    const l: typeof withOld & { adjust?: unknown } = { ...withOld }
    delete l.adjust
    const settings = layerSettingsOf(withOld as unknown as Record<string, unknown>)
    settings.toneCurve = normaliseToneCurve(settings.toneCurve)
    return {
      ...l,
      id: typeof l.id === 'string' && l.id ? l.id : newId(),
      name: typeof l.name === 'string' ? l.name : 'Mask',
      enabled: l.enabled !== false,
      opacity: num(l.opacity, 100, 0, 100),
      blend: BLEND_MODES.includes(l.blend) ? l.blend : 'Normal',
      invert: l.invert === true,
      ...(typeof overlayHue === 'number' && Number.isFinite(overlayHue)
        ? { overlayHue: ((overlayHue % 360) + 360) % 360 }
        : {}),
      amount: num(l.amount, 100, 0, 200),
      settings,
      components: (Array.isArray(l.components) ? (l.components as unknown[]) : [])
        .map(normaliseComponent)
        .filter((c): c is MaskComponentSetting => c !== null)
    }
  })
  r.pixels = (Array.isArray(r.pixels) ? (r.pixels as unknown[]) : [])
    .map(normalisePixelStep)
    .filter((p): p is PixelStep => p !== null)
  r.retouch = (Array.isArray(r.retouch) ? (r.retouch as unknown[]) : []).filter(
    (s): s is RetouchSpot =>
      isObject(s) &&
      typeof s.id === 'string' &&
      typeof s.kind === 'string' &&
      Array.isArray(s.points) &&
      typeof s.radius === 'number'
  )
  r.pointColors = (Array.isArray(r.pointColors) ? (r.pointColors as unknown[]) : [])
    .map(normalisePointColor)
    .filter((p): p is PointColorSetting => p !== null)
    .slice(0, MAX_POINT_COLORS)
  return r
}

const BLEND_MODES: BlendMode[] = [
  'Normal',
  'Multiply',
  'Screen',
  'Overlay',
  'SoftLight',
  'HardLight',
  'Darken',
  'Lighten',
  'Difference',
  'Add'
]

/**
 * A point curve: its points that are points (in 0…1), in order; fewer than
 * two (which the engine refuses) is the identity.
 */
function normaliseCurve(v: unknown): CurvePointSetting[] {
  const points = (Array.isArray(v) ? (v as unknown[]) : [])
    .filter(isObject)
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: num(p.x, 0, 0, 1), y: num(p.y, 0, 0, 1) }))
    .sort((a, b) => a.x - b.x)
  return points.length >= 2 ? points : IDENTITY_CURVE()
}

function normaliseToneCurve(tc: ToneCurveSetting): ToneCurveSetting {
  const raw = Array.isArray(tc.splits) ? (tc.splits as unknown[]) : []
  const splits = raw
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    .sort((a, b) => a - b)
  // Three region splits strictly in order inside 0…100, or Lightroom's.
  const ok =
    raw.length === 3 &&
    splits.length === 3 &&
    splits[0] > 0 &&
    splits[0] < splits[1] &&
    splits[1] < splits[2] &&
    splits[2] < 100
  return {
    ...tc,
    splits: ok ? (splits as [number, number, number]) : [25, 50, 75],
    master: normaliseCurve(tc.master),
    red: normaliseCurve(tc.red),
    green: normaliseCurve(tc.green),
    blue: normaliseCurve(tc.blue)
  }
}

/** A crop rectangle inside its frame, or none. */
function normaliseCrop(v: unknown): CropRect | null {
  if (!isObject(v)) return null
  const x = num(v.x, NaN, 0, 1)
  const y = num(v.y, NaN, 0, 1)
  const width = num(v.width, NaN, 0, 1 - x)
  const height = num(v.height, NaN, 0, 1 - y)
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

function normalisePointColor(value: unknown): PointColorSetting | null {
  if (!isObject(value)) return null
  const v = value
  return {
    id: typeof v.id === 'string' && v.id ? v.id : newId(),
    hue: ((num(v.hue, 0) % 360) + 360) % 360,
    saturation: num(v.saturation, 0, 0, 1),
    luminance: num(v.luminance, 0.5, 0, 1),
    shiftHue: num(v.shiftHue, 0, -100, 100),
    shiftSat: num(v.shiftSat, 0, -100, 100),
    shiftLum: num(v.shiftLum, 0, -100, 100),
    range: num(v.range, 50, 0, 100)
  }
}

function num(v: unknown, def: number, lo = -Infinity, hi = Infinity): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def
}

function point(v: unknown, def: { x: number; y: number }): { x: number; y: number } {
  return isObject(v) ? { x: num(v.x, def.x), y: num(v.y, def.y) } : def
}

const MASK_MODES = ['Add', 'Subtract', 'Intersect'] as const

/**
 * One mask component from a sidecar: fills what an older version did not
 * write, and drops what this version cannot draw (so an unknown kind never
 * reaches the compiler).
 */
export function normaliseComponent(value: unknown): MaskComponentSetting | null {
  if (!isObject(value)) return null
  const c = value
  const base = {
    id: typeof c.id === 'string' && c.id ? c.id : newId(),
    mode: MASK_MODES.includes(c.mode as MaskMode) ? (c.mode as MaskMode) : ('Add' as MaskMode),
    opacity: num(c.opacity, 100, 0, 100),
    invert: c.invert === true,
    feather: num(c.feather, 0, 0, 100),
    ...(typeof c.name === 'string' && c.name.trim() ? { name: c.name.trim() } : {})
  }
  switch (c.kind) {
    case 'brush':
      if (typeof c.png !== 'string') return null
      return {
        ...base,
        kind: 'brush',
        png: c.png,
        // A plane held by reference (IPC, history, a project) keeps its reference.
        ...(typeof c.ref === 'string' && c.ref ? { ref: c.ref } : {}),
        width: num(c.width, 1),
        height: num(c.height, 1)
      }
    case 'polygon':
      if (!Array.isArray(c.points)) return null
      return {
        ...base,
        kind: 'polygon',
        points: (c.points as unknown[]).map((p) => point(p, { x: 0, y: 0 }))
      }
    case 'range':
      return {
        ...base,
        kind: 'range',
        hue: (c.hue as KeyBand | null) ?? null,
        saturation: (c.saturation as KeyBand | null) ?? null,
        luma: (c.luma as KeyBand | null) ?? null,
        smoothness: num(c.smoothness, 0, 0, 100)
      }
    case 'linear':
      return {
        ...base,
        kind: 'linear',
        start: point(c.start, { x: 0.5, y: 0.25 }),
        end: point(c.end, { x: 0.5, y: 0.75 }),
        width: num(c.width, 512, 1),
        height: num(c.height, 512, 1)
      }
    case 'radial':
      return {
        ...base,
        kind: 'radial',
        centre: point(c.centre, { x: 0.5, y: 0.5 }),
        radiusX: num(c.radiusX, 0.3, 0.001),
        radiusY: num(c.radiusY, 0.3, 0.001),
        angle: num(c.angle, 0),
        softness: num(c.softness, 50, 0, 100),
        width: num(c.width, 512, 1),
        height: num(c.height, 512, 1)
      }
    default:
      return null
  }
}

// ── Groups: what copy, paste, sync and presets move ─────────────────────────

export const RECIPE_GROUPS = [
  'profile',
  'whiteBalance',
  'basicTone',
  'presence',
  'toneCurve',
  'hsl',
  'colorGrade',
  'detailSharpen',
  'detailNoise',
  'lens',
  'effects',
  'calibration',
  'treatment',
  'crop',
  'upright',
  'orientation',
  'retouch',
  'localAdjustments',
  'custom',
  'hdr'
] as const
export type RecipeGroup = (typeof RECIPE_GROUPS)[number]

export const GROUP_LABELS: Record<RecipeGroup, string> = {
  profile: 'Profile',
  whiteBalance: 'White balance',
  basicTone: 'Exposure & tone',
  presence: 'Presence',
  toneCurve: 'Tone curve',
  hsl: 'HSL / B&W mix',
  colorGrade: 'Colour grading',
  detailSharpen: 'Sharpening',
  detailNoise: 'Noise reduction',
  lens: 'Lens corrections',
  effects: 'Effects',
  calibration: 'Calibration',
  treatment: 'Treatment (colour / B&W)',
  crop: 'Crop & straighten',
  upright: 'Upright (perspective)',
  orientation: 'Rotation & flip',
  retouch: 'Spot removal & eyes',
  localAdjustments: 'Masks & local adjustments',
  custom: 'Advanced layers',
  hdr: 'HDR editing (gain map)'
}

/** Copy the chosen groups of `from` onto `to`, returning a new recipe. */
export function applyGroups(to: Recipe, from: Recipe, groups: Iterable<RecipeGroup>): Recipe {
  const r: Recipe = structuredClone(to)
  const f = structuredClone(from)
  for (const g of groups) {
    switch (g) {
      case 'profile':
        r.profile = f.profile
        r.profileAmount = f.profileAmount
        break
      case 'whiteBalance':
        r.wb = f.wb
        break
      case 'basicTone':
        r.basic = f.basic
        break
      case 'presence':
        r.presence = f.presence
        break
      case 'toneCurve':
        r.toneCurve = f.toneCurve
        break
      case 'hsl':
        r.hsl = f.hsl
        r.bwMix = f.bwMix
        r.pointColors = f.pointColors
        break
      case 'colorGrade':
        r.colorGrade = f.colorGrade
        break
      case 'detailSharpen':
        r.detail.sharpenAmount = f.detail.sharpenAmount
        r.detail.sharpenRadius = f.detail.sharpenRadius
        r.detail.sharpenDetail = f.detail.sharpenDetail
        r.detail.sharpenMasking = f.detail.sharpenMasking
        break
      case 'detailNoise':
        r.detail.noiseLuminance = f.detail.noiseLuminance
        r.detail.noiseLuminanceDetail = f.detail.noiseLuminanceDetail
        r.detail.noiseColor = f.detail.noiseColor
        r.detail.noiseColorDetail = f.detail.noiseColorDetail
        r.detail.ai = f.detail.ai
        break
      case 'lens':
        r.lens = f.lens
        break
      case 'retouch':
        r.retouch = f.retouch
        break
      case 'effects':
        r.effects = f.effects
        break
      case 'calibration':
        r.calibration = f.calibration
        break
      case 'treatment':
        r.treatment = f.treatment
        break
      case 'crop':
        r.geometry.crop = f.geometry.crop
        r.geometry.straighten = f.geometry.straighten
        r.geometry.aspect = f.geometry.aspect
        break
      case 'upright':
        // As measured on the source: a mode re-applied on the target measures its own lines.
        r.geometry.upright = f.geometry.upright
        break
      case 'orientation':
        r.geometry.quarterTurns = f.geometry.quarterTurns
        r.geometry.flipHorizontal = f.geometry.flipHorizontal
        break
      case 'localAdjustments':
        r.layers = f.layers
        break
      case 'custom':
        r.custom = f.custom
        break
      case 'hdr':
        r.gainMap = f.gainMap
        break
    }
  }
  return r
}

/**
 * Whether two plain values are the same, whatever order their keys were
 * written in (a field set to undefined counts as absent, as in JSON).
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => sameValue(x, b[i]))
    )
  }
  if (!isObject(a) || !isObject(b)) return false
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  const kb = Object.keys(b).filter((k) => b[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => sameValue(a[k], b[k]))
}

/**
 * Where `a` differs from `b`, field by field: each path to a value (a number,
 * a string, a list such as a curve's points) that is not the same in both.
 */
export function changedFields(a: unknown, b: unknown, at: string[] = []): string[][] {
  if (isObject(a) && isObject(b)) {
    return Object.keys(a).flatMap((k) => changedFields(a[k], b[k], [...at, k]))
  }
  return sameValue(a, b) ? [] : [at]
}

/** `to` with each of `fields` (paths, as `changedFields` gives them) taken from `from`. */
export function applyFields(to: Recipe, from: Recipe, fields: string[][]): Recipe {
  const r = structuredClone(to)
  for (const path of fields) {
    if (path.length === 0) continue
    let src: unknown = from
    let dst: Record<string, unknown> = r as unknown as Record<string, unknown>
    for (let i = 0; i < path.length - 1; i++) {
      src = isObject(src) ? src[path[i]] : undefined
      const next = dst[path[i]]
      if (!isObject(next)) break
      dst = next
    }
    const last = path[path.length - 1]
    src = isObject(src) ? src[last] : undefined
    if (src !== undefined && last in dst) dst[last] = structuredClone(src)
  }
  return r
}

/** The groups where `a` and `b` differ — what a preset or a sync would carry. */
export function changedGroups(a: Recipe, b: Recipe): RecipeGroup[] {
  const empty = defaultRecipe(false)
  return RECIPE_GROUPS.filter(
    (g) => !sameValue(applyGroups(empty, a, [g]), applyGroups(empty, b, [g]))
  )
}

/** Whether a recipe differs from the default for its kind of file. */
export function isEdited(r: Recipe, isRaw: boolean): boolean {
  return r.pixels.length > 0 || changedGroups(r, defaultRecipe(isRaw)).length > 0
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export function newLocalLayer(name: string): LocalLayer {
  return {
    id: newId(),
    name,
    enabled: true,
    opacity: 100,
    blend: 'Normal',
    invert: false,
    components: [],
    settings: neutralSettings(),
    amount: 100
  }
}

/** A small, stable 32-bit hash for seeds (grain) and cache keys. */
/** A brush plane's reference: its content hash and length. */
export function planeRef(png: string): string {
  return `${hash32(png).toString(16)}-${png.length}`
}

/**
 * The recipe with its brush planes as references, the PNGs left out: what
 * crosses IPC. `known` receives each PNG it takes out, by reference. The same
 * recipe comes back when it holds no PNG.
 */
export function slimRecipe(r: Recipe, known?: (ref: string, png: string) => void): Recipe {
  if (!r.layers.some((l) => l.components.some((c) => c.kind === 'brush' && c.png))) return r
  return {
    ...r,
    layers: r.layers.map((l) => ({
      ...l,
      components: l.components.map((c) => {
        if (c.kind !== 'brush' || !c.png) return c
        const ref = c.ref ?? planeRef(c.png)
        known?.(ref, c.png)
        return { ...c, png: '', ref }
      })
    }))
  }
}

/**
 * The recipe with every referenced plane filled in from `get` (and the
 * references dropped), or the same recipe when it names none. A plane `get`
 * does not have stays a reference.
 */
export function hydrateRecipe(r: Recipe, get: (ref: string) => string | undefined): Recipe {
  if (!r.layers.some((l) => l.components.some((c) => c.kind === 'brush' && !c.png && c.ref)))
    return r
  return {
    ...r,
    layers: r.layers.map((l) => ({
      ...l,
      components: l.components.map((c) => {
        if (c.kind !== 'brush' || c.png || !c.ref) return c
        const png = get(c.ref)
        if (png === undefined) return c
        const out = { ...c, png }
        delete out.ref
        return out
      })
    }))
  }
}

export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * A mask's settings that change nothing: zeros, identity curves, the white
 * left alone, no sharpening or noise reduction, no effects.
 */
export function neutralSettings(): LayerSettings {
  const r = defaultRecipe(false)
  const out = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, r[k]])) as LayerSettings
  out.detail.ai = { ...out.detail.ai, enabled: false }
  return out
}

/** Whether a mask's settings change nothing. */
export function isNeutral(s: LayerSettings): boolean {
  return sameValue(s, neutralSettings())
}

/**
 * A mask's old sliders as settings: each where its whole-photo twin lives,
 * so the engine is given the same operations (see compile.test.ts).
 */
export function settingsFromAdjust(a: LocalAdjust): LayerSettings {
  const s = neutralSettings()
  if (a.temperature || a.tint)
    s.wb = { mode: 'custom', temperature: a.temperature, tint: a.tint, preset: null }
  s.basic = {
    exposure: a.exposure,
    contrast: a.contrast,
    highlights: a.highlights,
    shadows: a.shadows,
    whites: a.whites,
    blacks: a.blacks
  }
  s.presence = {
    ...s.presence,
    texture: a.texture,
    clarity: a.clarity,
    dehaze: a.dehaze,
    saturation: a.saturation,
    hue: a.hue
  }
  s.detail.sharpenAmount = a.sharpness
  s.detail.noiseLuminance = a.noise
  if (a.tintAmount > 0)
    s.colorGrade.global = { hue: a.tintHue, saturation: a.tintAmount, luminance: 0 }
  s.colorGrade.add = { hue: a.addHue, saturation: a.addSaturation, amount: a.addAmount }
  return s
}

/** A layer's settings as read from anywhere: version 2's, or made from version 1's sliders. */
function layerSettingsOf(l: Record<string, unknown>): LayerSettings {
  if (isObject(l.settings)) {
    const s = fill(neutralSettings(), l.settings)
    s.pointColors = (Array.isArray(s.pointColors) ? (s.pointColors as unknown[]) : [])
      .map(normalisePointColor)
      .filter((p): p is PointColorSetting => p !== null)
      .slice(0, MAX_POINT_COLORS)
    return s
  }
  return settingsFromAdjust(fill(ZERO_LOCAL, l.adjust))
}
