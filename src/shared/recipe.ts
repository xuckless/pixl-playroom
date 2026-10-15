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
import {
  defaultCurvesVs,
  defaultLogWheels,
  defaultPrimaries,
  logRangeBefore021,
  normaliseCurvesVs,
  normaliseLogWheels,
  normalisePrimaries,
  normaliseQualifiers,
  type CurvesVsSetting,
  type LogWheelsSetting,
  type PrimariesSetting,
  type QualifierSetting
} from './resolve'
import { NO_ADD, type AddColourSetting } from './addcolor'
import type { BlendMode, CropRect, KeyBand, MaskMode } from './engine-types'
import { defaultLens, type LensSetting } from './lens'
import { defaultUpright, type UprightSetting } from './upright'
import type { RetouchSpot } from './retouch'
import { normalisePixelStep, type PixelStep } from './pixels'
import { normaliseEdge, type MaskEdge } from './maskedge'
import { migrateLook } from './migratelook'
import { normalisePrompt, PROMPT_VIAS, type PromptGeometry, type PromptVia } from './prompt'
import { conceptOf, type ConceptId } from './concepts'
import { isFacePart, type FaceFound } from './faceparts'
import { tk } from './i18n'
import { isPlaneHash, safeIdOf } from './ids'

/**
 * 3 (engine 0.18): a RAW's untouched default sharpening takes the edge mask
 * (masking 50, HR-0.18-2). 4: Smoothing, 100 for new photos and masks, 0
 * for edits made before it (so they look as they did). 5: a gain-map photo
 * is edited in HDR by default (Photo → Edit as SDR for the stored SDR
 * picture); one with pixel steps (AI Denoise, Enhance, baked heals and
 * removals, which an HDR photo cannot take yet) keeps its SDR base. 6
 * (engine 0.21): the Log wheels grade in PixlLog, their Low and High range
 * its code values; an older recipe's (display-encoded luma) are carried to
 * the same tones, Resolve's defaults to the new ones.
 */
export const RECIPE_VERSION = 6

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

/** Tone's base (compile.ts `toneBaseFor`). */
export type ToneBaseKind = 'none' | 'texture'
export const TONE_BASES: ToneBaseKind[] = ['none', 'texture']

export interface PresenceSetting {
  texture: number
  clarity: number
  dehaze: number
  vibrance: number
  saturation: number
  /** −100…100: turns every hue (a mask's Hue slider; the whole photo has HSL for this). */
  hue: number
  /**
   * 0…100: how much the colour and tone adjustments' change is smoothed where
   * the picture is flat (engine 0.18's `smoothing`, strength = /100), so a
   * hazy sea or a JPEG sky stops going blotchy. Applied when a slider is let
   * go, never while it drags. Not scaled by a mask's Amount.
   */
  smoothing: number
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
   * A Bayer RAW's noise taken out of its sensor data before the demosaic
   * (engine 0.19's `mosaic_denoise`, PMRID, once downloaded): seen at 100%
   * and in the export, which are developed at full size. Off unless chosen.
   */
  rawDenoise: boolean
  /**
   * AI noise reduction as it was before it became a pixel step (`pixels`):
   * a photo whose recipe still has it on is given the step it described when
   * it opens (renderer lib/denoise.ts), and it goes off. Nothing else reads it.
   */
  ai: AiDenoiseSetting
}

export type AiDenoiseModel = 'nafnet-sidd-w32' | 'drunet-color'

/**
 * SCUNet, retired with engine 0.19 (its files go from every disk): what a
 * saved setting, a step's params or a look may still name.
 */
export const RETIRED_DENOISE = 'scunet-color-real'

/**
 * NAFNet SIDD, SCUNet's successor in engine 0.19, is held back: as shipped it
 * turns flat dark areas into bright noise (ENGINE-REQUESTS E55). While held,
 * nothing offers it and whatever named SCUNet runs DRUNet; turned on, the
 * blind choice is NAFNet SIDD again everywhere.
 */
export const NAFNET_DENOISE = false

/** A denoise model as saved, today: SCUNet (or anything unknown) is the blind denoiser there is. */
export function aiDenoiseModel(v: unknown): AiDenoiseModel {
  return v === 'drunet-color' || !NAFNET_DENOISE ? 'drunet-color' : 'nafnet-sidd-w32'
}

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
  /**
   * Highlight priority darkens like light falling off; colour priority
   * (engine 0.21) lightens without washing colours toward white; paint
   * overlay mixes toward black or white.
   */
  vignetteStyle: 'highlight' | 'colour' | 'paint'
  /** A lift toward a colour on the look's code values (see `addcolor.ts`). */
  wash: AddColourSetting
  grainAmount: number
  grainSize: number
  grainRoughness: number
  /** 0…100: a colour grain beside the grey one, the dye clouds of a colour film. */
  grainColour: number
  /** Where in the tones the grain is strongest (`GRAIN_RESPONSES`). */
  grainResponse: GrainResponseKind
  /** A red glow around the highlights, as light bounces back through colour film. The photo's own: a mask has none. */
  halation: HalationSetting
  /** A diffusion filter's veil or a glow off the highlights. The photo's own: a mask has none. */
  bloom: BloomSetting
}

/**
 * Grain by tone: `film` strongest in the midtones (the engine's own, as
 * grain always was), `flat` the same everywhere, `negative` strongest in
 * the shadows, as a scanned colour negative's.
 */
export type GrainResponseKind = 'film' | 'flat' | 'negative'
export const GRAIN_RESPONSES: GrainResponseKind[] = ['film', 'flat', 'negative']

export interface HalationSetting {
  /** 0…100 */
  amount: number
  /** 0…100: how bright a highlight must be (as shown) before it glows. */
  threshold: number
  /** 0…100: how far the glow spreads (`glowRadius`). */
  size: number
  /** 0…45 degrees: from red to amber. */
  hue: number
}

/** `diffusion` veils the whole picture (a Pro-Mist); `glow` spreads only the highlights. */
export type BloomStyle = 'diffusion' | 'glow'
export const BLOOM_STYLES: BloomStyle[] = ['diffusion', 'glow']

export interface BloomSetting {
  style: BloomStyle
  /** 0…100 */
  amount: number
  /** 0…100: how far it spreads (`glowRadius`). */
  size: number
  /** 0…100: where Glow's highlights start (as shown); Diffusion has none. */
  threshold: number
  /** −100…100: cool to warm; 0 is white. */
  warmth: number
}

/**
 * Colour made denser, not greyer, as a slide film's dyes are (engine 0.21's
 * `Density`): `amount` −100…100 darkens saturated colour (lightens it below
 * 0); each band's weight −100…100 says how much of it that hue takes.
 */
export interface DensitySetting {
  amount: number
  bands: Record<HslBand, number>
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
  /** Its edge moved in or out and hardened (shared/maskedge.ts); absent changes nothing. */
  edge?: MaskEdge
  /**
   * Its edge snapped to the picture's (the engine's refine, shared/refine.ts):
   * a brush, a lasso or a model's mask. Absent is off.
   */
  refine?: MaskRefine
  /**
   * 0…100, the engine's `smooth` (0.19.2, Photoshop's Select and Mask):
   * takes the jaggies and speckle out of a contour and keeps it hard. 100
   * is 5% of the shorter side. Offered on drawn edges only (a lasso, a
   * painted brush). Absent is 0.
   */
  smooth?: number
  /**
   * 0…100, the engine's `contrast` (0.19.2): hardens a soft edge about its
   * middle, 100 a hard threshold. Drawn edges only. Absent is 0.
   */
  contrast?: number
}

/** How an edge is snapped (shared/refine.ts `REFINE_METHODS`): the engine's methods, by Playroom's names. */
export type RefineKind = 'guided' | 'guidedColour' | 'edgeSnap' | 'solver' | 'matting'

/**
 * Snap to edges: on or off, the method, and how strongly. A recipe from
 * before the methods (0.19) has neither `method` nor `strength`: it's
 * Guided by its radius, as it rendered.
 */
export interface MaskRefine {
  on: boolean
  /** 0.05…5: how far the picture's edges may pull the selection's, % of the shorter side (Guided). */
  radius: number
  /** Absent is `guided`. */
  method?: RefineKind
  /** 0…100: the method's main setting (EdgeSnap, the solver, Matting); absent is its default. */
  strength?: number
  /** The Advanced settings: a method's parameters in the engine's own units, by name. */
  params?: Record<string, number>
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
  /**
   * What made the plane, when a model did: a preset saved from the photo
   * asks for it again on another (looks/smart.ts `toInstructions`). Unset
   * for a painted plane, which belongs to its photo alone.
   */
  source?: BrushSource
}

/** A model's mask, as what to ask for again (see `BrushComponent.source`). */
export type BrushSource =
  /** `fine`: BiRefNet lite's cut-out (hair, fur), not U²-Netp's quick one. */
  | {
      kind: 'segment'
      target: 'subject' | 'background' | 'sky' | 'vegetation' | 'water'
      fine?: true
    }
  | { kind: 'person'; part: string }
  /** Found by a phrase (SAM 3 or EfficientSAM3, engine 0.19): found again by the same words. */
  | { kind: 'phrase'; text: string }
  /**
   * SAM 2.1 from clicks, a box, strokes or a lasso, and the object's name
   * when it has one. `prompt` is what it was asked (base-frame fractions),
   * so the mask can be made again; `via` how.
   */
  | {
      kind: 'prompt'
      label?: string
      prompt?: PromptGeometry
      via?: PromptVia
      /** The class it was asked for (shared/concepts.ts): found again by name when a finder can. */
      concept?: ConceptId
    }

/** A lasso or pen outline, in normalised base-frame coordinates. */
export interface PolygonComponent extends ComponentBase {
  kind: 'polygon'
  points: { x: number; y: number }[]
  /**
   * More outlines beside `points`, all filled even-odd: a face part's other
   * eye, the mouth cut out of the lips, other faces' (shared/faceparts.ts).
   * A lasso drawn by hand has none.
   */
  rings?: { x: number; y: number }[][]
  /** A face part (engine 0.19's `faces`): every face's outline, and which is shown. */
  found?: FaceFound
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
 * angles to start→end. It reaches the engine as its own shape
 * (`LinearGradient`, shared/gradients.ts); `width × height` is the base
 * frame's aspect at a small size, which its handles measure in.
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

/**
 * A bidirectional linear gradient (Camera Raw's): the full effect on the line
 * through the point `centre` of the way from `start` to `end` (0…1), fading
 * to nothing at the lines through `start` and through `end`, each side its
 * own width; every line at right angles to start→end. In normalised
 * base-frame coordinates, as a linear gradient's are.
 */
export interface BidirectionalComponent extends ComponentBase {
  kind: 'bidirectional'
  start: { x: number; y: number }
  end: { x: number; y: number }
  /** Where the full effect is, as a share of the way from `start` to `end`. */
  centre: number
  width: number
  height: number
}

export type GradientComponent = LinearComponent | RadialComponent | BidirectionalComponent

/**
 * A depth range: the part of the photo between two distances, from a depth
 * map a model made of it (Depth Anything V2: disparity, normalised per
 * photo, so 255 is the nearest thing in it and 0 the farthest). The map is
 * an 8-bit grey PNG in the base frame, held as a brush's plane is (`png`
 * here, by `ref` across IPC). `near` and `far` are 0…100 of the photo's
 * depth, 0 the nearest; `softness` 0…100 how far past them it fades.
 */
export interface DepthComponent extends ComponentBase {
  kind: 'depth'
  width: number
  height: number
  png: string
  ref?: string
  near: number
  far: number
  softness: number
}

/** A component that carries a grey plane of its own (a painted or model mask, a depth map). */
export type PlaneComponent = BrushComponent | DepthComponent

export function hasPlane(c: MaskComponentSetting): c is PlaneComponent {
  return c.kind === 'brush' || c.kind === 'depth'
}

export type MaskComponentSetting =
  | BrushComponent
  | PolygonComponent
  | RangeComponent
  | LinearComponent
  | RadialComponent
  | BidirectionalComponent
  | DepthComponent

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
  'primaries',
  'logWheels',
  'curvesVs',
  'qualifiers',
  'density',
  'detail',
  'effects',
  'calibration'
] as const

export type SettingsKey = (typeof SETTINGS_KEYS)[number]

/**
 * What can be switched off as a whole (the Edits list, a card's eye): every
 * card of the right column (`cards.ts` CARD_IDS, kept the same here: cards.ts
 * reads this module as it loads), the profile, the crop and straighten, and
 * the heal spots. A section switched off keeps its values and is compiled as
 * the photo's defaults (`edits.ts` `effective`). The turns and flips never
 * are: everything is placed by them.
 */
export const EDIT_SECTIONS = [
  'profile',
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
  'geometry',
  'crop',
  'heal'
] as const

export type EditSection = (typeof EDIT_SECTIONS)[number]

/** The sections switched off: each one `true`, absent when on. */
export type OffSections = Partial<Record<EditSection, true>>
export type LayerSettings = Pick<Recipe, SettingsKey>

export interface Recipe {
  version: typeof RECIPE_VERSION
  profile: ProfileRef
  /** 0…200 for a LUT profile; 100 is the table as written. */
  profileAmount: number
  treatment: 'color' | 'bw'
  wb: WhiteBalanceSetting
  basic: BasicSetting
  /**
   * Where Highlights, Shadows, Whites and Blacks read the picture (engine
   * 0.19.2's Tone base): `none` as they always ran; `texture` the local
   * Laplacian, so fine texture keeps its contrast where they pull (the
   * owner's pick). The photo's and its masks' alike. None by default.
   */
  toneBase: ToneBaseKind
  presence: PresenceSetting
  toneCurve: ToneCurveSetting
  hsl: Record<HslBand, BandSetting>
  bwMix: Record<HslBand, number>
  pointColors: PointColorSetting[]
  /** HSL's Density tab. */
  density: DensitySetting
  colorGrade: ColorGradeSetting
  /** DaVinci Resolve's primaries (shared/resolve.ts): the Resolve colour tools' first card. */
  primaries: PrimariesSetting
  /** Resolve's vs curves (Hue vs Hue, Hue vs Sat, …); its Custom curve is `toneCurve`. */
  curvesVs: CurvesVsSetting
  /** Resolve's Log wheels (Shadow, Midtone, Highlight, Offset). */
  logWheels: LogWheelsSetting
  /** Resolve's qualifiers, the photo's own (a mask has none): each a key and its correction. */
  qualifiers: QualifierSetting[]
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
   * The editing space of a photo with a gain map (an iPhone HEIC, an UltraHDR
   * JPEG): the HDR rendition the map lifts it to (the default), or the SDR
   * picture the file stores (Photo → Edit as SDR). Other photos ignore it.
   */
  gainMap: GainMapEdit
  /** Sections switched off, their values kept (see `EDIT_SECTIONS`). */
  off: OffSections
}

export type GainMapEdit = 'base' | 'hdr'

/**
 * Whether a gain-map photo is edited in HDR: its recipe asks for it and it
 * has no pixel steps (AI Denoise, Enhance, baked heals and removals were
 * made on the SDR picture, and an HDR photo cannot take them yet). Main
 * opens the photo on this, and the renderer follows the same rule.
 */
export function editsInHdr(
  recipe: Pick<Recipe, 'gainMap' | 'pixels'>,
  hasGainMap: boolean
): boolean {
  return hasGainMap && recipe.gainMap === 'hdr' && recipe.pixels.length === 0
}

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
    gainMap: 'hdr',
    wb: { mode: 'as-shot', temperature: 0, tint: 0, preset: null },
    basic: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 },
    toneBase: 'none',
    presence: {
      texture: 0,
      clarity: 0,
      dehaze: 0,
      vibrance: 0,
      saturation: 0,
      hue: 0,
      smoothing: 100
    },
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
    // Every band whole, so the overall amount works by itself.
    density: {
      amount: 0,
      bands: Object.fromEntries(HSL_BANDS.map((b) => [b, 100])) as Record<HslBand, number>
    },
    colorGrade: {
      shadows: zeroWheel(),
      midtones: zeroWheel(),
      highlights: zeroWheel(),
      global: zeroWheel(),
      blending: 50,
      balance: 0,
      add: { ...NO_ADD }
    },
    primaries: defaultPrimaries(),
    curvesVs: defaultCurvesVs(),
    logWheels: defaultLogWheels(),
    qualifiers: [],
    detail: {
      sharpenAmount: isRaw ? 40 : 0,
      sharpenRadius: 1,
      sharpenDetail: 25,
      // A RAW sharpens edges, not the denoised grain of flat areas (HR-0.18-2).
      sharpenMasking: isRaw ? 50 : 0,
      noiseLuminance: 0,
      noiseLuminanceDetail: 50,
      noiseColor: isRaw ? 25 : 0,
      noiseColorDetail: 50,
      rawDenoise: false,
      ai: { enabled: false, model: aiDenoiseModel(RETIRED_DENOISE), strength: 100 }
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
      grainRoughness: 50,
      grainColour: 0,
      grainResponse: 'film',
      halation: { amount: 0, threshold: 80, size: 50, hue: 12 },
      bloom: { style: 'diffusion', amount: 0, size: 65, threshold: 75, warmth: 0 }
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
    custom: [],
    off: {}
  }
}

/**
 * The photo as it came, for Before/After and the hue chart's ghost bars: its
 * defaults on the Neutral profile, whatever the default profile (a RAW's
 * Playroom Standard is already a look; the owner, 2026-10-14).
 */
export function beforeRecipe(isRaw: boolean): Recipe {
  const r = defaultRecipe(isRaw)
  r.profile = { kind: 'neutral' }
  r.profileAmount = 100
  return r
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
  const saved = isObject(value) && typeof value.version === 'number' ? value.version : 1
  // Before 3, a RAW's default sharpening had no edge mask: an untouched one
  // takes the new default; one the user set is theirs.
  const d = r.detail
  if (
    saved < 3 &&
    isRaw &&
    d.sharpenAmount === 40 &&
    d.sharpenRadius === 1 &&
    d.sharpenDetail === 25 &&
    d.sharpenMasking === 0
  )
    d.sharpenMasking = 50
  // Before 5 every gain-map photo was edited on its SDR base by default: it
  // moves to HDR, unless it has pixel steps, which an HDR photo cannot take.
  if (saved < 5) r.gainMap = r.pixels.length > 0 ? 'base' : 'hdr'
  r.version = RECIPE_VERSION
  if (r.gainMap !== 'base') r.gainMap = 'hdr'
  if (!isObject(value) || !isObject((value as Record<string, unknown>).profile)) {
    r.profile = base.profile
  }
  r.toneCurve = normaliseToneCurve(r.toneCurve)
  r.primaries = normalisePrimaries(r.primaries)
  r.curvesVs = normaliseCurvesVs(r.curvesVs)
  // Before 6 the Log wheels' ranges were display-encoded luma.
  const logRange = saved < 6 && isObject(value) ? logRangeBefore021(value.logWheels) : null
  r.logWheels = normaliseLogWheels(logRange ? { ...r.logWheels, ...logRange } : r.logWheels)
  r.qualifiers = normaliseQualifiers(r.qualifiers)
  // Only sections there are, each switched off by `true` (`fill` keeps any key).
  // Colour (Vibrance, Saturation, Hue) joined Presence: off, it keeps them off.
  const off: Record<string, unknown> = { ...(r.off ?? {}) }
  if (off.colour === true) off.presence = true
  // Resolve's Curves and the Tone curve are one card now: either off is it off.
  if (off.rcurves === true) off.curve = true
  r.off = Object.fromEntries(
    Object.entries(off).filter(
      ([k, v]) => v === true && (EDIT_SECTIONS as readonly string[]).includes(k)
    )
  ) as OffSections
  if (!TONE_BASES.includes(r.toneBase)) r.toneBase = 'none'
  r.calibration = normaliseCalibration(r.calibration)
  d.ai.model = aiDenoiseModel(d.ai.model)
  r.geometry.crop = normaliseCrop(r.geometry.crop)
  r.layers = (r.layers ?? []).filter(isObject).map(({ overlayHue, ...withOld }) => {
    // Version 1's sliders become settings (`layerSettingsOf`) and go.
    const l: typeof withOld & { adjust?: unknown } = { ...withOld }
    delete l.adjust
    const settings = layerSettingsOf(withOld as unknown as Record<string, unknown>)
    settings.toneCurve = normaliseToneCurve(settings.toneCurve)
    const own = isObject(withOld.settings) ? withOld.settings.logWheels : undefined
    const range = saved < 6 ? logRangeBefore021(own) : null
    if (range) settings.logWheels = { ...settings.logWheels, ...range }
    settings.calibration = normaliseCalibration(settings.calibration)
    return {
      ...l,
      // Ids name cache files (a mask's thumbnail): only safe ones are kept (shared/ids.ts).
      id: safeIdOf(l.id) ?? newId(),
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
  // The Advanced view's layers are the engine's own JSON: a 0.19 one is
  // brought to 0.19.2's shapes (Phase A §1.6), or the engine refuses it.
  r.custom = (Array.isArray(r.custom) ? (r.custom as unknown[]) : []).filter(isObject).map((c) => ({
    ...(c as unknown as CustomLayer),
    layer: migrateLook(structuredClone(c.layer))
  }))
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
  r.presence.smoothing = num(r.presence.smoothing, 100, 0, 100)
  r.effects = normaliseEffects(r.effects)
  r.density = normaliseDensity(r.density)
  for (const l of r.layers) {
    l.settings.presence.smoothing = num(l.settings.presence.smoothing, 100, 0, 100)
    l.settings.effects = normaliseEffects(l.settings.effects)
    l.settings.density = normaliseDensity(l.settings.density)
  }
  // An edit made before Smoothing keeps its look: none, in the photo and its
  // masks. An untouched photo takes the new default (it has nothing to smooth).
  if (saved < 4 && isEdited(r, isRaw)) {
    r.presence.smoothing = 0
    for (const l of r.layers) l.settings.presence.smoothing = 0
  }
  return r
}

/**
 * Calibration held to its sliders' ±100 (HR-0.18-7): past them the mixer's
 * matrix degenerates into coefficients that overflow (engine 0.18 refuses
 * the render as `Invariant`).
 */
function normaliseCalibration(c: CalibrationSetting): CalibrationSetting {
  return Object.fromEntries(
    Object.entries(c).map(([k, v]) => [k, num(v, 0, -100, 100)])
  ) as unknown as CalibrationSetting
}

/**
 * Engine 0.21's film effects held to their sliders (an edit from before
 * them has their defaults, from `fill`): the grain's colour and response,
 * halation and bloom.
 */
function normaliseEffects(e: EffectsSetting): EffectsSetting {
  const h = e.halation
  const b = e.bloom
  return {
    ...e,
    grainColour: num(e.grainColour, 0, 0, 100),
    grainResponse: GRAIN_RESPONSES.includes(e.grainResponse) ? e.grainResponse : 'film',
    halation: {
      amount: num(h.amount, 0, 0, 100),
      threshold: num(h.threshold, 80, 0, 100),
      size: num(h.size, 50, 0, 100),
      hue: num(h.hue, 12, 0, 45)
    },
    bloom: {
      style: BLOOM_STYLES.includes(b.style) ? b.style : 'diffusion',
      amount: num(b.amount, 0, 0, 100),
      size: num(b.size, 65, 0, 100),
      threshold: num(b.threshold, 75, 0, 100),
      warmth: num(b.warmth, 0, -100, 100)
    }
  }
}

function normaliseDensity(d: DensitySetting): DensitySetting {
  return {
    amount: num(d.amount, 0, -100, 100),
    bands: Object.fromEntries(HSL_BANDS.map((b) => [b, num(d.bands[b], 100, -100, 100)])) as Record<
      HslBand,
      number
    >
  }
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
    id: safeIdOf(v.id) ?? newId(),
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

function ringsOf(v: unknown): { x: number; y: number }[][] {
  if (!Array.isArray(v)) return []
  return v
    .filter((r): r is unknown[] => Array.isArray(r) && r.length >= 3)
    .map((r) => r.map((p) => point(p, { x: 0, y: 0 })))
}

function foundOf(v: unknown): FaceFound | null {
  if (!isObject(v) || !isFacePart(v.part) || !Array.isArray(v.faces)) return null
  const faces = (v.faces as unknown[])
    .filter(isObject)
    .map((f) => {
      const b = Array.isArray(f.bounds) ? (f.bounds as unknown[]) : []
      return {
        bounds: [0, 1, 2, 3].map((i) => num(b[i], 0)) as [number, number, number, number],
        rings: ringsOf(f.rings)
      }
    })
    .filter((f) => f.rings.length > 0)
  if (faces.length === 0) return null
  const face =
    typeof v.face === 'number' && Number.isInteger(v.face) && v.face >= 0 && v.face < faces.length
      ? v.face
      : null
  return { part: v.part, faces, face }
}

const MASK_MODES = ['Add', 'Subtract', 'Intersect'] as const

function brushSource(v: unknown): BrushSource | null {
  if (!isObject(v)) return null
  if (
    v.kind === 'segment' &&
    (v.target === 'subject' ||
      v.target === 'background' ||
      v.target === 'sky' ||
      v.target === 'vegetation' ||
      v.target === 'water')
  )
    return { kind: 'segment', target: v.target, ...(v.fine === true ? { fine: true } : {}) }
  if (v.kind === 'person' && typeof v.part === 'string') return { kind: 'person', part: v.part }
  if (v.kind === 'phrase' && typeof v.text === 'string' && v.text.trim())
    return { kind: 'phrase', text: v.text.trim().slice(0, 80) }
  if (v.kind === 'prompt') {
    const prompt = normalisePrompt(v.prompt)
    return {
      kind: 'prompt',
      ...(typeof v.label === 'string' && v.label ? { label: v.label } : {}),
      ...(prompt ? { prompt } : {}),
      ...(PROMPT_VIAS.includes(v.via as PromptVia) ? { via: v.via as PromptVia } : {}),
      ...(conceptOf(v.concept) ? { concept: v.concept as ConceptId } : {})
    }
  }
  return null
}

/**
 * One mask component from a sidecar: fills what an older version did not
 * write, and drops what this version cannot draw (so an unknown kind never
 * reaches the compiler).
 */
export function normaliseComponent(value: unknown): MaskComponentSetting | null {
  if (!isObject(value)) return null
  const c = value
  // A plane's reference names its file in the cache: only a SHA-256 is one
  // (shared/ids.ts). Any other is dropped, and the plane named again from its
  // PNG; one named only by a reference that is not a name has no plane. A
  // component with neither is kept as it always was.
  const ref = isPlaneHash(c.ref) ? { ref: c.ref } : {}
  const badRef = typeof c.ref === 'string' && c.ref !== '' && !isPlaneHash(c.ref)
  if ((c.kind === 'brush' || c.kind === 'depth') && badRef && !c.png) return null
  const base = {
    id: safeIdOf(c.id) ?? newId(),
    mode: MASK_MODES.includes(c.mode as MaskMode) ? (c.mode as MaskMode) : ('Add' as MaskMode),
    opacity: num(c.opacity, 100, 0, 100),
    invert: c.invert === true,
    feather: num(c.feather, 0, 0, 100),
    ...(typeof c.name === 'string' && c.name.trim() ? { name: c.name.trim() } : {}),
    ...((e) => (e ? { edge: e } : {}))(normaliseEdge(c.edge)),
    ...((r) => (r ? { refine: r } : {}))(normaliseRefine(c.refine)),
    ...(num(c.smooth, 0, 0, 100) > 0 ? { smooth: num(c.smooth, 0, 0, 100) } : {}),
    ...(num(c.contrast, 0, 0, 100) > 0 ? { contrast: num(c.contrast, 0, 0, 100) } : {})
  }
  switch (c.kind) {
    case 'brush':
      if (typeof c.png !== 'string') return null
      return {
        ...base,
        kind: 'brush',
        png: c.png,
        // A plane held by reference (IPC, history, a project) keeps its reference.
        ...ref,
        ...((src) => (src ? { source: src } : {}))(brushSource(c.source)),
        width: num(c.width, 1),
        height: num(c.height, 1)
      }
    case 'polygon': {
      if (!Array.isArray(c.points)) return null
      const rings = ringsOf(c.rings)
      const found = foundOf(c.found)
      return {
        ...base,
        kind: 'polygon',
        points: (c.points as unknown[]).map((p) => point(p, { x: 0, y: 0 })),
        ...(rings.length ? { rings } : {}),
        ...(found ? { found } : {})
      }
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
    case 'bidirectional':
      return {
        ...base,
        kind: 'bidirectional',
        start: point(c.start, { x: 0.5, y: 0.25 }),
        end: point(c.end, { x: 0.5, y: 0.75 }),
        centre: num(c.centre, 0.5, 0.02, 0.98),
        width: num(c.width, 512, 1),
        height: num(c.height, 512, 1)
      }
    case 'depth': {
      if (typeof c.png !== 'string') return null
      const near = num(c.near, 0, 0, 100)
      return {
        ...base,
        kind: 'depth',
        png: c.png,
        ...ref,
        width: num(c.width, 1),
        height: num(c.height, 1),
        near,
        far: num(c.far, 33, near, 100),
        softness: num(c.softness, 10, 0, 100)
      }
    }
    default:
      return null
  }
}

function normaliseRefine(v: unknown): MaskRefine | null {
  if (!isObject(v)) return null
  const method = REFINE_KINDS.includes(v.method as RefineKind) ? (v.method as RefineKind) : null
  const params = isObject(v.params)
    ? Object.fromEntries(
        Object.entries(v.params).filter(
          (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1])
        )
      )
    : null
  return {
    on: v.on === true,
    radius: num(v.radius, 0.5, 0.05, 5),
    ...(method && method !== 'guided' ? { method } : {}),
    ...(typeof v.strength === 'number' ? { strength: num(v.strength, 50, 0, 100) } : {}),
    ...(params && Object.keys(params).length ? { params } : {})
  }
}

const REFINE_KINDS: RefineKind[] = ['guided', 'guidedColour', 'edgeSnap', 'solver', 'matting']

// ── Groups: what copy, paste, sync and presets move ─────────────────────────

export const RECIPE_GROUPS = [
  'profile',
  'whiteBalance',
  'basicTone',
  'presence',
  'toneCurve',
  'hsl',
  'colorGrade',
  'primaries',
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
  profile: tk('Profile'),
  whiteBalance: tk('White balance'),
  basicTone: tk('Exposure & tone'),
  presence: tk('Presence'),
  toneCurve: tk('Tone curve'),
  hsl: tk('HSL / B&W mix'),
  colorGrade: tk('Colour grading'),
  primaries: tk('Primaries'),
  detailSharpen: tk('Sharpening'),
  detailNoise: tk('Noise reduction'),
  lens: tk('Lens corrections'),
  effects: tk('Effects'),
  calibration: tk('Calibration'),
  treatment: tk('Treatment (colour / B&W)'),
  crop: tk('Crop & straighten'),
  upright: tk('Upright (perspective)'),
  orientation: tk('Rotation & flip'),
  retouch: tk('Spot removal & eyes'),
  localAdjustments: tk('Masks & local adjustments'),
  custom: tk('Advanced layers'),
  hdr: tk('HDR editing (gain map)')
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
        r.toneBase = f.toneBase
        break
      case 'presence':
        r.presence = f.presence
        break
      case 'toneCurve':
        r.toneCurve = f.toneCurve
        r.curvesVs = f.curvesVs
        break
      case 'hsl':
        r.hsl = f.hsl
        r.bwMix = f.bwMix
        r.pointColors = f.pointColors
        r.density = f.density
        break
      case 'colorGrade':
        r.colorGrade = f.colorGrade
        break
      case 'primaries':
        r.primaries = f.primaries
        r.logWheels = f.logWheels
        r.qualifiers = f.qualifiers
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
        r.detail.rawDenoise = f.detail.rawDenoise
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

/**
 * `applyFields` in place: each of `fields` in `to` set from `from`. For a
 * draft (an immer edit), where only what moved should change identity.
 */
export function assignFields(to: Recipe, from: Recipe, fields: string[][]): void {
  for (const path of fields) {
    if (path.length === 0) continue
    let src: unknown = from
    let dst: Record<string, unknown> = to as unknown as Record<string, unknown>
    let ok = true
    for (let i = 0; i < path.length - 1; i++) {
      src = isObject(src) ? src[path[i]] : undefined
      const next = dst[path[i]]
      if (!isObject(next)) {
        ok = false
        break
      }
      dst = next
    }
    if (!ok) continue
    const last = path[path.length - 1]
    src = isObject(src) ? src[last] : undefined
    if (src !== undefined && last in dst && !sameValue(dst[last], src))
      dst[last] = structuredClone(src)
  }
}

/** What a group carries of a recipe (the fields `applyGroups` copies), read in place. */
function groupValues(r: Recipe, g: RecipeGroup): unknown[] {
  const d = r.detail
  switch (g) {
    case 'profile':
      return [r.profile, r.profileAmount]
    case 'whiteBalance':
      return [r.wb]
    case 'basicTone':
      return [r.basic, r.toneBase]
    case 'presence':
      return [r.presence]
    case 'toneCurve':
      return [r.toneCurve, r.curvesVs]
    case 'hsl':
      return [r.hsl, r.bwMix, r.pointColors, r.density]
    case 'colorGrade':
      return [r.colorGrade]
    case 'primaries':
      return [r.primaries, r.logWheels, r.qualifiers]
    case 'detailSharpen':
      return [d.sharpenAmount, d.sharpenRadius, d.sharpenDetail, d.sharpenMasking]
    case 'detailNoise':
      return [d.noiseLuminance, d.noiseLuminanceDetail, d.noiseColor, d.noiseColorDetail, d.ai]
    case 'lens':
      return [r.lens]
    case 'retouch':
      return [r.retouch]
    case 'effects':
      return [r.effects]
    case 'calibration':
      return [r.calibration]
    case 'treatment':
      return [r.treatment]
    case 'crop':
      return [r.geometry.crop, r.geometry.straighten, r.geometry.aspect]
    case 'upright':
      return [r.geometry.upright]
    case 'orientation':
      return [r.geometry.quarterTurns, r.geometry.flipHorizontal]
    case 'localAdjustments':
      return [r.layers]
    case 'custom':
      return [r.custom]
    case 'hdr':
      return [r.gainMap]
  }
}

const groupChanged = (a: Recipe, b: Recipe, g: RecipeGroup): boolean =>
  !sameValue(groupValues(a, g), groupValues(b, g))

/** The groups where `a` and `b` differ — what a preset or a sync would carry. */
export function changedGroups(a: Recipe, b: Recipe): RecipeGroup[] {
  return RECIPE_GROUPS.filter((g) => groupChanged(a, b, g))
}

/** Whether a recipe differs from the default for its kind of file (stopping at the first change). */
export function isEdited(r: Recipe, isRaw: boolean): boolean {
  if (r.pixels.length > 0) return true
  const def = defaultRecipe(isRaw)
  return RECIPE_GROUPS.some((g) => groupChanged(r, def, g))
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

/**
 * The recipe with its brush planes as references, the PNGs left out: what
 * crosses IPC and what is stored. A plane is named by its `ref` when it
 * carries one, else by `refOf` (main/planeref.ts: its SHA-256). `known`
 * receives each PNG it takes out, by reference. The same recipe comes back
 * when it holds no PNG.
 */
export function slimRecipe(
  r: Recipe,
  refOf: (png: string) => string,
  known?: (ref: string, png: string) => void
): Recipe {
  if (!r.layers.some((l) => l.components.some((c) => hasPlane(c) && c.png))) return r
  return {
    ...r,
    layers: r.layers.map((l) => ({
      ...l,
      components: l.components.map((c) => {
        if (!hasPlane(c) || !c.png) return c
        const ref = c.ref ?? refOf(c.png)
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
  if (!r.layers.some((l) => l.components.some((c) => hasPlane(c) && !c.png && c.ref))) return r
  return {
    ...r,
    layers: r.layers.map((l) => ({
      ...l,
      components: l.components.map((c) => {
        if (!hasPlane(c) || c.png || !c.ref) return c
        const png = get(c.ref)
        if (png === undefined) return c
        const out = { ...c, png }
        delete out.ref
        return out
      })
    }))
  }
}

/** A small, stable 32-bit hash for seeds (grain) and cache keys. */
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
