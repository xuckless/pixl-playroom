/**
 * The PIXL engine's request and report model, in the serde shape the Node
 * binding speaks: externally tagged enums (`{ Variant: { ...fields } }`, unit
 * variants as bare strings, newtype variants as `{ Variant: value }`),
 * snake_case fields, every field present. A restatement of
 * pixl-engine/src/request.rs, analyze.rs, framing.rs, source_info.rs,
 * color/mod.rs, color/grade.rs and color/mask.rs — there is one model, and it
 * lives in the engine.
 *
 * Nothing here has a default. The engine makes no decisions; Playroom does,
 * in `recipe.ts` (what the sliders mean) and `compile.ts` (how they become a
 * grade).
 */

// ── Sources and sinks ────────────────────────────────────────────────────────

export type Source = { Path: string } | { Bytes: number[] }
export type Sink = { Path: string } | 'Bytes'

export type InputFormat = 'Jpeg' | 'Png' | 'Heif' | 'Jxl' | 'Tiff' | 'WebP' | 'Raw'

/** `F32` is unbounded 32-bit float: only TIFF and `Encode.Pixels` take it. */
export type Depth = 'Eight' | 'Sixteen' | 'F32'

// ── Geometry ─────────────────────────────────────────────────────────────────

export type Resize =
  'None' | { Exact: { width: number; height: number } } | { Scale: { factor: number } }

export type Resampler = 'Nearest' | 'Bilinear' | 'CatmullRom' | 'Lanczos3' | 'Ai'

export interface PixelSpec {
  depth: Depth | null
  /** 1 grey, 2 grey+alpha, 3 RGB, 4 RGBA */
  channels: number | null
}

/** The eight EXIF orientations, as operations (EXIF values 1–8 in order). */
export type Orientation =
  | 'Normal'
  | 'FlipHorizontal'
  | 'Rotate180'
  | 'FlipVertical'
  | 'Transpose'
  | 'Rotate90'
  | 'Transverse'
  | 'Rotate270'

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What happens to canvas pixels a rotation, transform or lens correction
 * leaves with no picture behind them. `Crop` keeps the largest clean
 * rectangle inside the crop at its aspect and centre; `Transparent` keeps
 * them, transparent (the pipeline must carry alpha); `Refuse` refuses.
 */
export type Outside = 'Crop' | 'Transparent' | 'Refuse'

/**
 * A perspective correction (an Upright): the picture re-seen by a virtual
 * camera. Degrees for the turns (vertical/horizontal ±80, rotate ±45);
 * `focal` is a fraction of the frame's diagonal (35 mm-equivalent ÷ 43.27);
 * `aspect` ±1, `scale` 0.1…10, `offset` ±1. Identity: all 0, scale 1.
 */
export interface Transform {
  vertical: number
  horizontal: number
  rotate: number
  focal: number
  aspect: number
  scale: number
  offset: Point
}

export interface Framing {
  orientation: Orientation
  /** −45…45, positive turns the picture clockwise. */
  rotate_degrees: number
  rotate_resampler: Resampler
  crop: CropRect | null
  /** Applied before the rotation, in the same resample. */
  transform?: Transform | null
  /** Required exactly when the framing rotates or transforms; refused otherwise. */
  outside?: Outside | null
}

/** A rectangle of the oriented frame, in its pixels, output alone (a 1:1 view). */
export interface Region {
  x: number
  y: number
  width: number
  height: number
  margin: number
}

export type Inspect =
  | { LayerMask: { layer: number } }
  | { GroupMask: { layer: number; group: number } }
  /** Where HDR output sits above its white: `clamp(log2(Y / white) / stops, 0, 1)`. */
  | { Headroom: { stops: number } }

// ── RAW ──────────────────────────────────────────────────────────────────────

export type DngCrop = 'None' | 'ActiveArea' | 'Best'

export type RawMode =
  | {
      Develop: {
        scaling: boolean
        demosaic: boolean
        white_balance: boolean
        calibrate: boolean
        srgb_gamma: boolean
        crop: DngCrop
      }
    }
  | 'EmbeddedPreview'
  /** PIXL's own scene-linear develop: F32 linear Rec.2020, unclamped. */
  | {
      Scene: {
        white_balance: 'AsShot' | { Stated: { temperature_kelvin: number; tint: number } }
        highlights: 'Clip' | 'Unclipped' | 'Blend' | 'InpaintOpposed'
        crop: DngCrop
        denoise: Denoise | null
      }
    }

// ── The generative upscaler ──────────────────────────────────────────────────

export type CoreMlUnits = 'All' | 'CpuAndNeuralEngine' | 'CpuAndGpu' | 'CpuOnly'
export type CoreMlFormat = 'MlProgram' | 'NeuralNetwork'

/** Where a model runs. The engine never falls back: a missing provider is an error. */
export type ExecutionProvider =
  | 'Cpu'
  | {
      CoreMl: {
        units: CoreMlUnits
        format: CoreMlFormat
        static_shapes: boolean
        low_precision_gpu: boolean
      }
    }
  | { Cuda: { device: number } }
  | { DirectMl: { device: number } }

export type GraphOptimisation = 'Disable' | 'Basic' | 'Extended' | 'All'

export interface SessionSpec {
  threads: number
  optimisation: GraphOptimisation
  deterministic: boolean
}

/** A model file and the ONNX Runtime it runs on. One runtime per process. */
export interface ModelRef {
  model_path: string
  runtime_library: string
  provider: ExecutionProvider
  session: SessionSpec
}

export interface TensorSpec {
  name: string
  layout: 'Nchw' | 'Nhwc'
  order: 'Rgb' | 'Bgr'
  element: 'F32' | 'F16'
  mean: Rgb
  std: Rgb
}

export type ModelInput =
  | { Dynamic: { tile: number; overlap: number; multiple: number } }
  | { Fixed: { width: number; height: number; overlap: number } }

export type ModelSpace = 'Srgb' | 'SourceEncoding'

export type AlphaUpscale = 'Model' | { Resample: Resampler }

export interface UpscalerRef {
  model: ModelRef
  model_space: ModelSpace
  input: TensorSpec
  output: TensorSpec
  /** 2, 3 or 4, checked against what the model produces. */
  scale: number
  tiling: ModelInput
  then: Resampler | null
  alpha: AlphaUpscale
}

export type ConditionValue = { Stated: { value: number } } | { MeasuredNoise: { gain: number } }
export type Conditioning =
  { Channel: { value: ConditionValue } } | { Tensor: { name: string; value: ConditionValue } }

/** A restoring model, ×1: denoise, deblur, JPEG artefacts. */
export interface EnhancerRef {
  model: ModelRef
  model_space: ModelSpace
  input: TensorSpec
  output: TensorSpec
  tiling: ModelInput
  /** 0 < strength ≤ 1: blends the model's output with its input. */
  strength: number
  conditioning: Conditioning[]
}

export type ChromaUpsample = 'Triangle' | { LumaGuided: { radius: number; epsilon: number } }

/** Rebuild a JPEG from its DCT coefficients (no model). */
export interface JpegReconstruct {
  iterations: number
  second_order: number
  fidelity: number
  /** Required exactly when the file subsamples chroma. */
  chroma: ChromaUpsample | null
}

/** One step of `ConvertRequest.enhance`, run straight after decode and orientation. */
export type EnhanceStep =
  { JpegReconstruct: JpegReconstruct } | { Model: EnhancerRef } | { Upscale: UpscalerRef }

// ── Encoders ─────────────────────────────────────────────────────────────────

export type Subsampling = 'None' | 'Half' | 'Quarter' | 'Grey'
export type Chroma = 'Half' | 'Wide' | 'Full'
export type PngCompression = 'Fast' | 'Balanced' | 'Best'
export type PngFilter = 'NoFilter' | 'Sub' | 'Up' | 'Average' | 'Paeth' | 'Adaptive'
export type TiffCompression = 'None' | 'Lzw' | 'Deflate'
export type DngCompression = 'Uncompressed' | 'Lossless'

export type Encode =
  | { JxlLossy: { distance: number; effort: number; threads: number } }
  | { JxlLossless: { effort: number; threads: number } }
  | { JxlJpegRepack: { effort: number; threads: number } }
  | 'JpegFromJxl'
  | {
      Jpeg: {
        quality: number
        subsampling: Subsampling
        optimize: boolean
        /** An UltraHDR JPEG: a gain map lifting this SDR base to the HDR master. */
        gain_map?: GainMapEncode | null
      }
    }
  | { Png: { compression: PngCompression; filter: PngFilter } }
  | {
      Heic: {
        quality: number
        lossless: boolean
        bit_depth: number
        chroma: Chroma
        matrix: YCbCrMatrix
        gain_map?: GainMapEncode | null
      }
    }
  | {
      Avif: {
        quality: number
        lossless: boolean
        bit_depth: number
        chroma: Chroma
        speed: number
        matrix: YCbCrMatrix
        gain_map?: GainMapEncode | null
      }
    }
  | { Tiff: { compression: TiffCompression } }
  | { WebP: { quality: number; lossless: boolean; method: number } }
  | {
      Dng: {
        compression: DngCompression
        embed_original: boolean
        preview: boolean
        thumbnail: boolean
        crop: DngCrop
        apply_scaling: boolean
        predictor: number
        index: number
      }
    }
  /** Raw interleaved samples, no container; `Bytes` sink only. */
  | { Pixels: { sample: 'U8' | 'U16' | 'F16' | 'F32' } }

/**
 * How a HEIF-family sink turns RGB into Y/Cb/Cr, stated in its `nclx` box.
 * `Bt601` is what libheif assumed when nothing was said (0.13's output).
 */
export type YCbCrMatrix = 'Bt601' | 'Bt709' | 'Bt2020Ncl' | 'Identity'

export type EncodeVariant =
  | 'JxlLossy'
  | 'JxlLossless'
  | 'JxlJpegRepack'
  | 'JpegFromJxl'
  | 'Jpeg'
  | 'Png'
  | 'Heic'
  | 'Avif'
  | 'Tiff'
  | 'WebP'
  | 'Dng'
  | 'Pixels'

/** The variant name of an `Encode` value. */
export function encodeVariant(e: Encode): EncodeVariant {
  if (typeof e === 'string') return e
  return Object.keys(e)[0] as EncodeVariant
}

export interface MetadataPolicy {
  exif: boolean
  icc: boolean
  xmp: boolean
  iptc: boolean
}

export const STRIP_ALL: MetadataPolicy = { exif: false, icc: false, xmp: false, iptc: false }
export const PRESERVE_ALL: MetadataPolicy = { exif: true, icc: true, xmp: true, iptc: true }

export type Dither = 'None' | { TriangularNoise: { seed: number } }

// ── Colour ───────────────────────────────────────────────────────────────────

export type ColorSpaceRef =
  | 'Srgb'
  | 'LinearSrgb'
  | 'DisplayP3'
  | 'AdobeRgb'
  | 'Rec2020'
  | 'Rec2100Pq'
  | 'Rec2100Hlg'
  | 'GenericGray22'
  | { Icc: number[] }

export type RenderingIntent =
  'Perceptual' | 'RelativeColorimetric' | 'Saturation' | 'AbsoluteColorimetric'

export type ToneMapOperator = 'Bt2390' | 'Hable' | 'Reinhard' | 'Clip'
export type ExpandOperator = { Linear: { sdr_white_nits: number } } | 'Bt2446A'
export type Peak = 'FromFile' | { Nits: number }
export type GamutMap = 'Clip' | 'Compress'

/**
 * What happens to luminance above the peak when PQ/HLG pixels leave the
 * working space. `Clip` is 0.13's behaviour; `Rolloff` is BT.2390's knee
 * (`0 < knee_nits < peak < source_max_nits ≤ 10000`).
 */
export type HdrLimit = 'Clip' | { Rolloff: { knee_nits: number; source_max_nits: number } }

export interface HdrWorking {
  reference_white_nits: number
  peak_nits: number
  limit: HdrLimit
}

/** How a PQ/HLG signal is read into linear light for `analyze`. */
export interface HdrSignal {
  reference_white_nits: number
  peak_nits: number
}

export type ColorPolicy =
  | 'Preserve'
  | { Assign: { to: ColorSpaceRef } }
  | {
      ConvertTo: { to: ColorSpaceRef; intent: RenderingIntent; black_point_compensation: boolean }
    }
  | {
      ToneMap: {
        to: ColorSpaceRef
        operator: ToneMapOperator
        source_peak: Peak
        target_peak_nits: number
        gamut: GamutMap
        intent: RenderingIntent
        black_point_compensation: boolean
      }
    }
  | {
      Expand: { to: ColorSpaceRef; operator: ExpandOperator; peak_nits: number; limit: HdrLimit }
    }

export type ColorSource = 'IccProfile' | 'Cicp' | 'Assumed'

// ── Grading ──────────────────────────────────────────────────────────────────

export interface Rgb {
  r: number
  g: number
  b: number
}

export type GradeSpace =
  | 'LinearWorking'
  | {
      Encoded: {
        space: ColorSpaceRef
        intent: RenderingIntent
        black_point_compensation: boolean
      }
    }

export type BlendMode =
  | 'Normal'
  | 'Multiply'
  | 'Screen'
  | 'Overlay'
  | 'SoftLight'
  | 'HardLight'
  | 'Darken'
  | 'Lighten'
  | 'Difference'
  | 'Add'

export interface Blend {
  mode: BlendMode
  space: GradeSpace
}

export interface Primary {
  exposure: number
  lift: Rgb
  gamma: Rgb
  gain: Rgb
  contrast: number
  contrast_pivot: number
  saturation: number
  hue_shift: number
}

export interface KeyBand {
  centre: number
  width: number
  softness: number
}

export interface HslKey {
  hue: KeyBand | null
  saturation: KeyBand | null
  luma: KeyBand | null
  blur_radius: number
  invert: boolean
}

export interface Tone {
  highlights: number
  shadows: number
  whites: number
  blacks: number
}

export interface WhiteBalance {
  temperature_kelvin: number
  tint: number
}

export interface Vibrance {
  amount: number
  skin_protection: number
}

export interface CurvePoint {
  x: number
  y: number
}

export interface Curve {
  points: CurvePoint[]
}

export interface Curves {
  master: Curve | null
  red: Curve | null
  green: Curve | null
  blue: Curve | null
  luma_vs_saturation: Curve | null
  hue_vs_saturation: Curve | null
  hue_vs_hue: Curve | null
  /** 0…1: keep saturation as the master curve changes contrast. Needs `master`. */
  refine_saturation: number | null
}

/**
 * Lightroom's region curve, in the engine: each amount −1…1 bends its
 * region; `0 < low < mid < high < 1`. Display-referred stages only.
 */
export interface ParametricCurve {
  shadows: number
  darks: number
  lights: number
  highlights: number
  splits: { low: number; mid: number; high: number }
}

export interface BandAdjust {
  hue: number
  saturation: number
  luminance: number
}

export interface HslBands {
  red: BandAdjust
  orange: BandAdjust
  yellow: BandAdjust
  green: BandAdjust
  aqua: BandAdjust
  blue: BandAdjust
  purple: BandAdjust
  magenta: BandAdjust
}

export interface Cdl {
  slope: Rgb
  offset: Rgb
  power: Rgb
  saturation: number
}

export interface Denoise {
  luminance: number
  luminance_detail: number
  color: number
  color_detail: number
}

export interface Sharpen {
  amount: number
  radius: number
  detail: number
  masking: number
}

export interface LocalContrast {
  amount: number
  radius: number
  midtones: number
}

export interface Dehaze {
  amount: number
  radius: number
}

export interface Point {
  x: number
  y: number
}

/** `Exposure` darkens like light falling off; `PaintOverlay` paints black or white over. */
export type VignetteStyle = { Exposure: { highlights: number } } | 'PaintOverlay'

export interface Vignette {
  amount: number
  midpoint: number
  roundness: number
  feather: number
  style: VignetteStyle
  centre: Point
  half_size: Point
  rotation_degrees: number
}

export interface Grain {
  amount: number
  size: number
  roughness: number
  seed: number
}

export interface Wheel {
  hue: number
  saturation: number
  luminance: number
}

export interface ColorGrade {
  shadows: Wheel
  midtones: Wheel
  highlights: Wheel
  global: Wheel
  blending: number
  balance: number
}

export interface ChannelMixer {
  red: Rgb
  green: Rgb
  blue: Rgb
}

export type LutRef = { Path: string } | { Cube: string }

/** A fringe hue (degrees) and how much of it is neutralised, 0…1. */
export interface FringeBand {
  hue: KeyBand
  amount: number
}

export interface Defringe {
  purple: FringeBand
  green: FringeBand
  edges: EdgeKey
}

/** Light added, in `space`: `color` ≥ 0 per channel, times `amount` ≥ 0. */
export interface AddColor {
  color: Rgb
  space: ColorSpaceRef
  amount: number
}

export interface Fill {
  color: Rgb
  space: ColorSpaceRef
}

export type GradeOp =
  | { Lut: { lut: LutRef; amount: number } }
  | { Primary: Primary }
  | { Qualifier: { key: HslKey; correction: Primary } }
  | { Tone: Tone }
  | { WhiteBalance: WhiteBalance }
  | { Vibrance: Vibrance }
  | { Curves: Curves }
  | { ParametricCurve: ParametricCurve }
  | { HslBands: HslBands }
  | { Cdl: Cdl }
  | { Denoise: Denoise }
  | { Sharpen: Sharpen }
  | { LocalContrast: LocalContrast }
  | { Dehaze: Dehaze }
  | { Vignette: Vignette }
  | { Grain: Grain }
  | { ColorGrade: ColorGrade }
  | { ChannelMixer: ChannelMixer }
  | { Defringe: Defringe }
  | { AddColor: AddColor }
  | { Fill: Fill }
  | { Masked: { mask: Mask; opacity: number; ops: GradeOp[] } }

export type GradeOpKind = GradeOp extends infer T ? (T extends object ? keyof T : never) : never

export function opKind(op: GradeOp): GradeOpKind {
  return Object.keys(op)[0] as GradeOpKind
}

export interface GradeStage {
  space: GradeSpace
  ops: GradeOp[]
}

export interface GradeLayer {
  name: string
  enabled: boolean
  opacity: number
  mask: Mask | null
  blend: Blend
  stages: GradeStage[]
}

export interface Grade {
  layers: GradeLayer[]
}

// ── Masks ────────────────────────────────────────────────────────────────────

export type MaskMode = 'Add' | 'Subtract' | 'Intersect'
export type FeatherEdge = 'Zero' | 'Extend'
export type FillRule = 'NonZero' | 'EvenOdd'

export interface Feather {
  /** Fraction of the frame's shorter side, 0…0.5. */
  radius: number
  edge: FeatherEdge
}

export interface Contour {
  points: Point[]
}

export interface Polygon {
  contours: Contour[]
  fill_rule: FillRule
}

export type RasterRef = { Png: string } | { PngBytes: number[] }

export interface RasterMask {
  source: RasterRef
  resampler: Resampler
}

/**
 * Edge strength: `sigma` is a fraction of the shorter side (0.0001…0.05),
 * `low ≤ high` in luminance steps (0…10).
 */
export interface EdgeKey {
  sigma: number
  low: number
  high: number
}

export type MaskShape =
  { Polygon: Polygon } | { Range: HslKey } | { Raster: RasterMask } | { Edges: EdgeKey }

export interface MaskComponent {
  shape: MaskShape
  mode: MaskMode
  opacity: number
  invert: boolean
  feather: Feather
}

export interface Mask {
  components: MaskComponent[]
  invert: boolean
  space: GradeSpace | null
}

export interface MaskBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface MaskReport {
  components: string[]
  coverage: number
  weighted_coverage: number
  bounds: MaskBounds | null
  ran_over: MaskBounds
}

export interface GradeStageReport {
  space: string
  ops: string[]
}

export interface GradeLayerReport {
  name: string
  applied: boolean
  opacity: number
  blend: string
  mask: MaskReport | null
  masks: MaskReport[]
  stages: GradeStageReport[]
  layer_ms: number
}

export interface GradeReport {
  layers: GradeLayerReport[]
  clamped_samples: number
  qualifier_coverage: number[]
  grade_ms: number
}

// ── Lens, retouch, overlays ──────────────────────────────────────────────────

export type RadiusUnit =
  'HalfShorterSide' | 'HalfDiagonal' | 'FarthestCorner' | { Focal: { x: number; y: number } }

export interface LensGeometry {
  centre: Point
  unit: RadiusUnit
}

/** Adobe's WarpRectilinear (DNG opcode); identity k0 = 1, the rest 0. */
export interface WarpRectilinear {
  k0: number
  k1: number
  k2: number
  k3: number
  p1: number
  p2: number
}

export type DistortionModel =
  | { Poly3: { k1: number } }
  | { Poly5: { k1: number; k2: number } }
  | { PtLens: { a: number; b: number; c: number } }
  | { Rectilinear: WarpRectilinear }
  | { RectilinearPlanes: { red: WarpRectilinear; green: WarpRectilinear; blue: WarpRectilinear } }

export interface Distortion {
  model: DistortionModel
  geometry: LensGeometry
  /** 0…2; 1 applies the model as stated. */
  amount: number
}

export interface TcaPoly3 {
  v: number
  c: number
  b: number
}

export type LateralCaModel =
  | { Scale: { red: number; blue: number } }
  | { Poly3: { red: TcaPoly3; blue: TcaPoly3 } }
  | { Rectilinear: { red: WarpRectilinear; blue: WarpRectilinear } }

export interface LateralCa {
  model: LateralCaModel
  geometry: LensGeometry
  amount: number
}

export interface Vignetting {
  /** 1…5 coefficients of the radial gain polynomial. */
  k: number[]
  apply: 'Divide' | 'Multiply'
  at: 'Source' | 'Corrected'
  geometry: LensGeometry
  amount: number
}

/** `outside` and `resampler` are required exactly when distortion or lateral CA is set. */
export interface LensCorrection {
  distortion: Distortion | null
  lateral_ca: LateralCa | null
  vignetting: Vignetting | null
  outside: Outside | null
  resampler: Resampler | null
}

export interface LensReport {
  canvas_width: number
  canvas_height: number
  frame: MaskBounds
  outside: Outside | null
  outside_pixels: number
  max_displacement_px: number[]
  gain_min: number | null
  gain_max: number | null
  max_minification: number
  lines: string[]
}

/** Positions are fractions of the frame; radii fractions of its shorter side. */
export type SpotShape =
  { Circle: { centre: Point; radius: number } } | { Stroke: { points: Point[]; radius: number } }

export interface Spot {
  shape: SpotShape
  /** Where the source is, relative to the spot, as fractions of the frame (±1). */
  source_offset: Point
  feather: Feather
  opacity: number
}

export interface ContentFill {
  shape: SpotShape
  feather: Feather
  opacity: number
  /** Odd, 3…15. */
  patch: number
  iterations: number
  seed: number
}

export interface Ellipse {
  centre: Point
  radius_x: number
  radius_y: number
  rotate_degrees: number
}

export interface RedEye {
  pupils: Ellipse[]
  feather: Feather
  desaturate: number
  darken: number
}

export interface PetEye {
  pupils: Ellipse[]
  feather: Feather
  amount: number
  pupil_level: number
}

export type RetouchStep =
  { Clone: Spot } | { Heal: Spot } | { Fill: ContentFill } | { RedEye: RedEye } | { PetEye: PetEye }

/** Run after the lens correction, before a region, the grade and framing. */
export interface Retouch {
  space: GradeSpace
  steps: RetouchStep[]
}

export interface RetouchStepReport {
  ran: boolean
  pixels: number
  bounds: MaskBounds | null
  heal: { ring_pixels: number; cycles: number; residual: number; converged: boolean } | null
  fill: { levels: number; hole_pixels: number; mean_distance: number } | null
  line: string
}

export interface RetouchReport {
  space: string
  steps: RetouchStepReport[]
}

/** A picture composited on the output: `rect` in fractions of it; height follows the picture's aspect. */
export interface Overlay {
  source: RasterRef
  rect: { x: number; y: number; width: number }
  opacity: number
  blend: Blend
  resampler: Resampler
}

export interface OverlayReport {
  placed: MaskBounds
  clamped_samples: number
  line: string
}

// ── HDR renditions and gain maps ─────────────────────────────────────────────

/** An HDR master rendered for an SDR display (the policy states the master). */
export interface SdrRendition {
  to: ColorSpaceRef
  operator: ToneMapOperator
  source_peak_nits: number
  target_peak_nits: number
  gamut: GamutMap
  intent: RenderingIntent
  black_point_compensation: boolean
  grade: Grade | null
}

/** Which rendition of a gain-map file to read. Required exactly when the file has one. */
export type GainMapMode =
  'Base' | { Apply: { headroom_stops: number; signal: 'Rec2100Pq' | 'Rec2100Hlg' } }

export interface GainMapEncode {
  /** 1, 2, 4 or 8: the map's downscale from the base. */
  scale: number
  channels: number
  quality: number
  gamma: number
  offset_sdr: number
  offset_hdr: number
  gain_min_log2: number
  gain_max_log2: number
  hdr_capacity_min: number
  hdr_capacity_max: number
}

export type GainMapKind = 'Iso21496' | 'UltraHdrXmp' | 'AppleLegacy'

export interface GainMapInfo {
  kind: GainMapKind
  width: number
  height: number
  channels: number
  base_headroom_stops: number | null
  alternate_headroom_stops: number | null
}

// ── Measuring and output sharpening ──────────────────────────────────────────

/** Measure the conversion's own pixels; the numbers come back as `report.stats`. */
export interface Measure {
  /** `Output`: the encoder's buffer. `Working`: the float buffer (needs `Linear`). */
  at: 'Output' | 'Working'
  domain: AnalysisDomain
  bins: number
  percentiles: number[]
  clip_low: number
  clip_high: number
  hue_bins: number
  stride: number
  transparent: TransparentPixels
  noise: boolean
}

/** Sharpening for the output's size, after the resize; `radius` in output pixels. */
export interface OutputSharpen {
  space: GradeSpace
  sharpen: Sharpen
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** One conversion, fully specified. */
export interface ConvertRequest {
  source: Source
  sink: Sink
  input: InputFormat
  resize: Resize
  resampler: Resampler
  pixel: PixelSpec
  encode: Encode
  metadata: MetadataPolicy
  color: ColorPolicy
  linear_resample: boolean
  raw: RawMode | null
  upscaler: UpscalerRef | null
  grade: Grade | null
  dither: Dither
  hdr: HdrWorking | null
  /** Render the HDR master for an SDR display instead of writing it. */
  sdr: SdrRendition | null
  /** Required exactly when the source carries a gain map (`SourceInfo.gain_map`). */
  gain_map: GainMapMode | null
  threads: number
  framing: Framing | null
  region: Region | null
  inspect: Inspect | null
  overlays: Overlay[] | null
  enhance: EnhanceStep[] | null
  lens: LensCorrection | null
  retouch: Retouch | null
  output_sharpen: OutputSharpen | null
  measure: Measure | null
}

export type AnalysisDomain = 'Encoded' | 'Linear'
export type TransparentPixels = 'Include' | 'Exclude'

export interface AnalyzeRequest {
  source: Source
  input: InputFormat
  raw: RawMode | null
  domain: AnalysisDomain
  bins: number
  percentiles: number[]
  clip_low: number
  clip_high: number
  hue_bins: number
  stride: number
  transparent: TransparentPixels
  threads: number
  weights: RasterMask | null
  noise: boolean
  /**
   * How a PQ/HLG source enters the `Linear` domain (1.0 is the reference
   * white; the measurement spans to the peak). Required exactly for a PQ/HLG
   * source measured in `Linear`, refused otherwise.
   */
  hdr: HdrSignal | null
  gain_map: GainMapMode | null
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface LightLevel {
  max_cll_nits: number
  max_fall_nits: number
  working_white_nits: number
  headroom_stops: number | null
}

export interface ColorReport {
  space: string
  source: ColorSource
  converted: boolean
  icc_written: boolean
  cicp_written: boolean
  tone_mapped: {
    source_transfer: string
    operator: ToneMapOperator
    source_peak_nits: number
    target_peak_nits: number
    gamut: GamutMap
  } | null
  expanded: { operator: ExpandOperator; peak_nits: number; output_transfer: string } | null
  light_level: LightLevel | null
  limit: { peak_nits: number; limit: HdrLimit; limited_samples: number } | null
  graded: GradeReport | null
  sdr: {
    space: string
    operator: ToneMapOperator
    source_peak_nits: number
    target_peak_nits: number
    gamut: GamutMap
    graded: GradeReport | null
  } | null
}

export interface LossReport {
  source_bits: number
  output_bits: number
  quantisations: number
  dither: Dither
  single_float_pass: boolean
  resampled: boolean
  warps: number
  channels_changed: boolean
  depth_narrowed: boolean
  colour_transformed: boolean
  graded: boolean
  lossy_encoder: boolean
  chroma_subsampled: boolean
  /** Pixels were made up (content fill, a model), not recovered. */
  synthesised: boolean
}

export interface UpscaleReport {
  model: string
  provider: ExecutionProvider
  scale: number
  tiles: number
  model_load_ms: number
  model_ms: number
  post_resample: Resampler | null
  model_space: string
  input_clipped: number
  output_clamped: number
  runtime_version: string
}

export interface ModelStepReport {
  model: string
  provider: ExecutionProvider
  runtime_version: string
  model_space: string
  scale: number
  tiles: number
  model_load_ms: number
  model_ms: number
  input_clipped: number
  output_clamped: number
  strength: number
  conditioning: string[]
  grey_as_rgb: boolean
  alpha: AlphaUpscale | null
}

export type EnhanceStepReport =
  | { JpegReconstruct: Record<string, unknown> }
  | { Model: ModelStepReport }
  | { Upscale: ModelStepReport }

export interface FramingReport {
  orientation: Orientation
  rotate_degrees: number
  transform: Transform | null
  crop: MaskBounds
  exif_orientation_reset: boolean
  outside: Outside | null
  outside_pixels: number
  max_minification: number
}

export interface RegionReport {
  output: MaskBounds
  context: MaskBounds
}

export interface ConvertReport {
  input_bytes: number
  output_bytes: number
  width: number
  height: number
  channels: number
  depth: Depth
  decode_ms: number
  resize_ms: number
  color_ms: number
  encode_ms: number
  /** Present only for a `Bytes` sink: a Buffer from the binding. */
  output: Uint8Array | null
  metadata_written: MetadataPolicy
  color: ColorReport
  upscale: UpscaleReport | null
  loss: LossReport
  frame_width: number
  frame_height: number
  framing: FramingReport | null
  lens: LensReport | null
  retouch: RetouchReport | null
  region: RegionReport | null
  overlays: OverlayReport[]
  inspected: string | null
  enhance: EnhanceStepReport[]
  enhance_ms: number
  output_sharpen: GradeStageReport | null
  /** The measurement asked for with `measure`. */
  stats: ImageStats | null
  gain_map: {
    read: Record<string, unknown> | null
    written: Record<string, unknown> | null
  } | null
}

export interface JpegInfo {
  quality: number | null
  luma_quant_table: number[]
  chroma_quant_table: number[] | null
  subsampling: Subsampling | null
  progressive: boolean
  optimized_huffman: boolean
  restart_interval: number
  components: number
}

export type HeifCodec = 'Hevc' | 'Av1'

export interface HeifInfo {
  codec: HeifCodec
  chroma: Chroma | null
  bit_depth: number
  matrix: YCbCrMatrix | null
}

export interface PngInfo {
  bit_depth: number
  color_type: string
  interlaced: boolean
  has_palette: boolean
}

export interface WebpInfo {
  lossless: boolean
  has_alpha: boolean
  animated: boolean
}

export interface JxlInfo {
  has_jpeg_reconstruction: boolean
  uses_original_profile: boolean
  lossless: boolean | null
}

export interface TiffInfo {
  compression: TiffCompression | null
  compression_tag: number
  predictor: number
  planar: boolean
}

export interface WhitePoint {
  x: number
  y: number
  temperature_kelvin: number
  tint: number
}

/** What a source actually is. Returned by `probe`. */
export interface SourceInfo {
  format: string
  input: InputFormat
  width: number
  height: number
  channels: number
  depth: Depth
  bits: number
  bytes: number
  has_exif: boolean
  has_icc: boolean
  has_xmp: boolean
  has_cicp: boolean
  has_iptc: boolean
  color: string
  color_source: ColorSource
  is_hdr: boolean
  peak_nits: number | null
  orientation: number
  is_raw_mosaic: boolean
  jpeg: JpegInfo | null
  heif: HeifInfo | null
  png: PngInfo | null
  webp: WebpInfo | null
  jxl: JxlInfo | null
  tiff: TiffInfo | null
  as_shot_white: WhitePoint | null
  gain_map: GainMapInfo | null
  /** What the file says about the lens. The engine never looks up a correction. */
  lens: ShotLens | null
}

export interface ShotLens {
  make: string | null
  model: string | null
  focal_mm: number | null
  focal_35mm: number | null
  f_number: number | null
  focus_distance_m: number | null
}

export interface Histogram {
  counts: number[]
}

export interface Percentile {
  percentile: number
  value: number
}

export interface HueBin {
  hue_start: number
  hue_end: number
  count: number
  mean_saturation: number
}

export interface NoiseEstimate {
  luminance: number
  color: number[]
}

/** What the pixels look like. Returned by `analyze`. */
export interface ImageStats {
  width: number
  height: number
  channels: number
  depth: Depth
  domain: AnalysisDomain
  space: string
  /**
   * The top of every histogram and percentile, and what `clip_low`/`clip_high`
   * are fractions of: 1 in `Encoded` and for an SDR source; `peak_nits /
   * reference_white_nits` for a PQ/HLG source measured in `Linear` with `hdr`.
   */
  range_max: number
  pixels_measured: number
  histograms: Histogram[]
  luma_histogram: Histogram
  luma_percentiles: Percentile[]
  luma_mean: number
  luma_stddev: number
  channel_mean: number[]
  clipped_low: number[]
  clipped_high: number[]
  grey_world_gain: (number | null)[]
  mean_saturation: number
  hue_histogram: HueBin[]
  neutral_pixels: number
  noise: NoiseEstimate | null
  decode_ms: number
  analyze_ms: number
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** The serialised `PixlError` enum: `{ <Variant>: { ...fields } }`. */
export type PixlErrorDetail = Record<string, Record<string, unknown>>

/** What an engine error looks like once it crosses into JS. */
export interface EngineErrorShape {
  message: string
  /**
   * A `PixlError` variant, `VersionMismatch` (the loaded addon is not the
   * installed package's release), `Model` (a model step failed; `Upscale`
   * before 0.15), `Cancelled`, or one of the app's own: EngineUnavailable,
   * EngineCrashed, BadRequest, Unknown.
   */
  code: string
  detail?: PixlErrorDetail
}

// ── The binding ──────────────────────────────────────────────────────────────

/** The contract the Node binding fulfils. */
export interface PixlEngineModule {
  /** The version of the engine compiled into the loaded addon. */
  engineVersion(): string
  /** The binding's own version; equal to `engineVersion()`, or the load fails. */
  bindingVersion(): string
  hasEnhance(): boolean
  probe(path: string): Promise<SourceInfo>
  convert(request: ConvertRequest, options?: { signal?: AbortSignal }): Promise<ConvertReport>
  analyze(request: AnalyzeRequest, options?: { signal?: AbortSignal }): Promise<ImageStats>
  suggestEncode(info: SourceInfo, threads: number): Encode
  whiteBalanceFromPixel(rgb: Rgb, space: GradeSpace): WhiteBalance
  lensFrame(lens: LensCorrection, width: number, height: number, threads: number): LensReport
  framingCrop(framing: Framing, width: number, height: number): MaskBounds
  uprightFromLines(
    lines: { from: Point; to: Point }[],
    frameWidth: number,
    frameHeight: number,
    focal: number
  ): Transform
  suggestUpright(request: Record<string, unknown>): Promise<Record<string, unknown>>
  suggestLateralCa(request: Record<string, unknown>): Promise<Record<string, unknown>>
  suggestHealSource(request: Record<string, unknown>): Promise<Record<string, unknown>>
  segment(request: Record<string, unknown>): Promise<Record<string, unknown>>
  benchmark(request: Record<string, unknown>): Promise<Record<string, unknown>>
  /** The ONNX Runtime shipped in the platform package. */
  bundledRuntime(): { library: string; version: string; providers: string[] }
}

export type EngineMethod = keyof PixlEngineModule

// ── Host ↔ main messages ─────────────────────────────────────────────────────

export interface EngineRequestMessage {
  kind: 'request'
  id: number
  method: EngineMethod
  args: unknown[]
}

export interface EngineHelloMessage {
  kind: 'hello'
  status: 'ready' | 'unavailable'
  version?: string
  enhance?: boolean
  /** The ONNX Runtime bundled with the addon (0.15+): what model steps run on. */
  runtime?: { library: string; version: string; providers: string[] }
  reason?: string
  /** The load error's code when the engine is unavailable, e.g. `VersionMismatch`. */
  code?: string
}

export interface EngineResponseMessage {
  kind: 'response'
  id: number
  ok: boolean
  result?: unknown
  error?: EngineErrorShape
}

export type HostToMain = EngineHelloMessage | EngineResponseMessage
export type MainToHost = EngineRequestMessage
