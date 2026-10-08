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

/** `{ max_pixels, max_side }`: a picture past either is `TooLarge`, before its pixels are allocated. */
export interface Limits {
  max_pixels: number
  max_side: number
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

/**
 * How many pixels a RAW develop makes: `Full` is one per photosite (the
 * demosaic); `Cell` one per colour filter array cell (2 × 2 Bayer, 3 × 3
 * X-Trans), each colour the mean of its photosites, no demosaic. A quarter
 * (or a ninth) of the pixels, for previews.
 */
export type RawResolution = 'Full' | 'Cell'

/** What a RAW says about its colour. `Pixl` is refused on a body the version does not hold. */
export type CameraColour = 'Container' | { Pixl: { version: number } } | { Stated: unknown }
export type OpcodeUse = 'Apply' | 'Skip'
export interface DngOpcodes {
  list1: OpcodeUse
  list2: OpcodeUse
}

export type RawMode =
  | {
      Develop: {
        scaling: boolean
        demosaic: boolean
        white_balance: boolean
        /** Without it the frame is camera RGB: the request must `Assign` a colour space. */
        calibrate: boolean
        srgb_gamma: boolean
        crop: DngCrop
        /** `Cell` with `demosaic: false` is refused. */
        resolution: RawResolution
        colour: CameraColour
        dng_opcodes: DngOpcodes
      }
    }
  | 'EmbeddedPreview'
  /** PIXL's own scene-linear develop: F32 linear PixlRGB, unclamped. */
  | {
      Scene: {
        white_balance: 'AsShot' | { Stated: { temperature_kelvin: number; tint: number } }
        highlights: 'Clip' | 'Unclipped' | 'Blend' | 'InpaintOpposed'
        crop: DngCrop
        denoise: Denoise | null
        resolution: RawResolution
        colour: CameraColour
        dng_opcodes: DngOpcodes
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
export type LinearDngCompression = 'Uncompressed' | { Lossless: { predictor: number } } | 'Deflate'

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
      Avif: {
        quality: number
        lossless: boolean
        bit_depth: number
        chroma: Chroma
        /** 0–9: 10 is refused. */
        speed: number
        matrix: YCbCrMatrix
        gain_map?: GainMapEncode | null
        /** The AV1 encoder's own threads, 1–64. */
        threads: number
        tune: AvifTune
        tiling: AvifTiling
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
   * The rendered frame, every edit baked in, as a LinearRaw DNG for another
   * raw editor: three channels, 16-bit or F32, the conversion's output linear
   * light in primaries 1, 9 or 12.
   */
  | { LinearDng: { compression: LinearDngCompression } }

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
  | 'LinearDng'

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

export type AvifTune = 'Psnr' | 'Ssim' | 'Iq'
export type AvifTiling = 'Single' | { Grid: { tile: number } }

export type Dither = 'None' | { TriangularNoise: { seed: number } }

// ── Colour ───────────────────────────────────────────────────────────────────

export type ColorSpaceRef =
  | 'Srgb'
  | 'LinearSrgb'
  | 'DisplayP3'
  | 'AdobeRgb'
  | 'Rec2020'
  /** PIXL's working space. Refused at 8 bits. */
  | 'PixlRgb'
  | 'LinearPixlRgb'
  | 'Rec2100Pq'
  | 'Rec2100Hlg'
  | 'GenericGray22'
  | { Icc: number[] }
  /** Linear Display P3 (CICP 12/8), built in (0.18). */
  | 'LinearDisplayP3'

export type RenderingIntent =
  'Perceptual' | 'RelativeColorimetric' | 'Saturation' | 'AbsoluteColorimetric'

export type ToneMapOperator = 'Bt2390' | 'Hable' | 'Reinhard' | 'Clip'
export type ExpandOperator = { Linear: { sdr_white_nits: number } } | 'Bt2446A'
export type Peak = 'FromFile' | { Nits: number }
export type GamutMap = 'Clip' | 'Compress'
/** How a tone map treats the channels: `PerChannel` is 0.16.0 bit for bit. */
export type ToneMapMode = 'PerChannel' | 'MaxRgb' | 'Luminance'

/** `ColorPolicy::Master`: every field is required. */
export type MasterPeak = 'Measured' | { Nits: number }
/**
 * `Display` (0.18) takes the display's SDR white and peak in cd/m², as
 * Playroom reads them (the engine never probes a display), and resolves to
 * `203 · peak / white`.
 */
export type MasterCeiling =
  'Peak' | { Nits: number } | { Display: { white_nits: number; peak_nits: number } }
export type MasterReach = 'Measured' | { Stated: number }
export type MasterLook = 'Colorimetric' | { Pixl: { version: 1 | 2 } }
/**
 * What a float sink (an F32 TIFF, `Pixels` F16/F32) receives (0.18):
 * `LinearPixlRgb` is 0.17's; `ExtendedLinearDisplayP3` is linear Display P3
 * with 1.0 = SDR white, up to the ceiling over white with headroom on.
 */
export type MasterFloat = 'LinearPixlRgb' | 'ExtendedLinearDisplayP3'
/** A second, small 8-bit Display P3 picture of the same render (0.18). */
export interface SdrCompanion {
  longest_side: number
  resampler: 'Nearest' | 'Bilinear' | 'CatmullRom' | 'Lanczos3'
}
export interface MasterPolicy {
  headroom: boolean
  peak: MasterPeak
  /** `null` with `headroom: false`. */
  ceiling: MasterCeiling | null
  reach: MasterReach
  look: MasterLook
  float: MasterFloat
  companion: SdrCompanion | null
}

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
        mode: ToneMapMode
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
  /** The engine's own path from any source to an HDR or SDR output. */
  | { Master: MasterPolicy }

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

/**
 * `smoothing` on Tone, Vibrance, Dehaze, ColorGrade, HslBands and Qualifier
 * (0.18): the op's change smoothed where the picture is flat. `radius` is
 * 0.001–0.1 of the shorter side, `strength` 0–1; `null` is the op as it
 * always ran. Sent on release, never while a slider drags.
 */
export interface AdjustmentSmoothing {
  radius: number
  strength: number
}

export interface Tone {
  highlights: number
  shadows: number
  whites: number
  blacks: number
  smoothing: AdjustmentSmoothing | null
}

export interface WhiteBalance {
  temperature_kelvin: number
  tint: number
}

export interface Vibrance {
  amount: number
  skin_protection: number
  smoothing: AdjustmentSmoothing | null
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
  smoothing: AdjustmentSmoothing | null
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
  /**
   * The coarsest band's reach, a fraction of the shorter side, `0 < reach ≤
   * 0.25` (0.18): the same number in the preview and the export denoises the
   * same structures at any size.
   */
  reach: number
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
  smoothing: AdjustmentSmoothing | null
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
  smoothing: AdjustmentSmoothing | null
}

export interface ChannelMixer {
  red: Rgb
  green: Rgb
  blue: Rgb
}

export type LutRef = { Path: string } | { Cube: string }

/**
 * What a value past the top of a LUT's table gets (below the domain it is
 * always clamped). `Clamp` is 0.15's rule, bit for bit; `ScaleHeadroom`
 * keeps the channels' ratios and the table's own values at and below white,
 * for an HDR frame; `ExtendSlope` carries the table's edge slope on.
 */
export type LutOutOfDomain = 'Clamp' | 'ScaleHeadroom' | 'ExtendSlope'

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
  | { Lut: { lut: LutRef; amount: number; out_of_domain: LutOutOfDomain } }
  | { Primary: Primary }
  | { Qualifier: { key: HslKey; correction: Primary; smoothing: AdjustmentSmoothing | null } }
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

/** How a gradient's coverage falls across its transition; stated every time. */
export type Ramp = 'Linear' | 'Smoothstep'

/**
 * Full coverage on `from`'s side, none past `to`, perpendicular to `from → to`
 * in pixels. Points are fractions of the frame, −1…2 each; `from ≠ to`.
 */
export interface LinearGradient {
  from: Point
  to: Point
  ramp: Ramp
}

/**
 * Full on the line through `centre`, none at the lines through `from` and
 * `to` (each side its own width). `centre` must project strictly between them.
 */
export interface BidirectionalGradient {
  from: Point
  centre: Point
  to: Point
  ramp: Ramp
}

/**
 * Full inside the ellipse scaled by `1 − feather`, none outside the drawn
 * one (Lightroom's radial). Radii are fractions of the shorter side, (0, 4];
 * `rotation` degrees clockwise on screen.
 */
export interface RadialGradient {
  centre: Point
  radii: { x: number; y: number }
  rotation: number
  feather: number
  ramp: Ramp
}

/** A band of a depth map (the map's own 0…1 units), with smoothstep ramps `softness` wide. */
export interface DepthRange {
  depth: { Raster: RasterRef }
  quantity: 'Depth' | 'Disparity'
  near: number
  far: number
  softness: number
  resampler: Resampler
}

export type MaskShape =
  | { Polygon: Polygon }
  | { Range: HslKey }
  | { Raster: RasterMask }
  | { Edges: EdgeKey }
  | { LinearGradient: LinearGradient }
  | { RadialGradient: RadialGradient }
  | { BidirectionalGradient: BidirectionalGradient }
  | { DepthRange: DepthRange }

/**
 * Snap a component's edge to the picture's, after its feather: a guided
 * filter of its plane by the luminance in `Mask.space` (which a refined
 * component needs), then a contraction. `radius` 0.0005…0.05 and `contract`
 * −0.05…0.05 (positive shrinks) are fractions of the shorter side; `epsilon`
 * 1e-6…1 is how strong an edge must be to hold the selection.
 */
export interface Refine {
  radius: number
  epsilon: number
  contract: number
}

/** Built in this order: shape → feather → refine → invert → opacity → mode. */
export interface MaskComponent {
  shape: MaskShape
  mode: MaskMode
  opacity: number
  invert: boolean
  feather: Feather
  refine: Refine | null
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
  /** Makes a fisheye rectilinear (a defish). */
  | { Fisheye: Fisheye }

/** The projection `g(θ)` a fisheye was made with (Lensfun's `fisheye_thoby` is Thoby 1.47, 0.713). */
export type FisheyeProjection =
  | 'Equidistant'
  | 'Equisolid'
  | 'Orthographic'
  | 'Stereographic'
  | { Thoby: { k1: number; k2: number } }

/** Lensfun's radial polynomials, on a fisheye's own radius. */
export type FisheyePolynomial =
  | { Poly3: { k1: number } }
  | { Poly5: { k1: number; k2: number } }
  | { PtLens: { a: number; b: number; c: number } }

export interface Fisheye {
  projection: FisheyeProjection
  /** In the geometry's unit, > 0 (Lensfun's normalised focal length with its normalisation). */
  focal: number
  /** The lens's departure from its ideal projection; null is the ideal one. */
  polynomial: FisheyePolynomial | null
}

export interface Distortion {
  model: DistortionModel
  geometry: LensGeometry
  /** 0…2; 1 applies the model as stated. */
  amount: number
  /**
   * 0.1…10: the corrected frame's magnification about the model's centre.
   * 1 keeps the picture's scale (0.15's render, byte for byte); below 1
   * shows more of the field and leaves corners to `outside`.
   */
  scale: number
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

/** `Frame` is the source's own primaries (0.16.0); `Camera` is a developed RAW's camera planes. */
export type CaPlanes = 'Frame' | 'Camera'

export interface LateralCa {
  model: LateralCaModel
  geometry: LensGeometry
  amount: number
  planes: CaPlanes
}

export interface Vignetting {
  /** 1…5 coefficients of the radial gain polynomial. */
  k: number[]
  apply: 'Divide' | 'Multiply'
  at: 'Source' | 'Corrected'
  geometry: LensGeometry
  amount: number
}

/**
 * A gain plane applied to the light at the source, before the warp: a flat
 * shot's falloff (`Divide`) or a gain grid (`Multiply`). The plane is an 8 or
 * 16-bit grey or RGB PNG at the canvas's aspect; a sample is
 * `code / max × full_scale` (0…64]; `amount` 0…2.
 */
export interface FlatField {
  plane: RasterRef
  resampler: Resampler
  apply: 'Divide' | 'Multiply'
  full_scale: number
  amount: number
  planes: CaPlanes
}

/** `outside` and `resampler` are required exactly when distortion or lateral CA is set. */
export interface LensCorrection {
  distortion: Distortion | null
  lateral_ca: LateralCa | null
  vignetting: Vignetting | null
  outside: Outside | null
  resampler: Resampler | null
  flat_field?: FlatField | null
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
  /** `[]` is 0.16.0 byte for byte. */
  catchlights: unknown[]
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
  mode: ToneMapMode
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
  /** Refuses a picture past it from its header; `null` checks nothing. */
  limits: Limits | null
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
  /** `'Normal'` is 0.16.0. With a lens or a turn, `weights` must have the corrected frame's aspect. */
  orientation: Orientation
  lens: LensCorrection | null
  /** Refuses a picture past it from its header. Set it on every request that reads a user's file. */
  limits: Limits | null
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

/** What `ColorPolicy::Master` did, each built-in number it used and every choice it made, in words. */
export interface MasterReport {
  headroom: boolean
  entered: string
  primaries: string
  white_nits: number
  peak_nits: number
  peak_measured: boolean
  ceiling_nits: number | null
  output: string
  sdr_space: string | null
  display_tone_map_version: number | null
  rolloff: unknown | null
  final_guard_pixels: number
  look: string
  look_pixels: number
  look_guarded_pixels: number
  /** Under `Ceiling.Display` (0.18): the display it rendered for, `headroom` = peak / white. */
  display: { white_nits: number; peak_nits: number; headroom: number } | null
  gamut: {
    reach: number
    reach_measured: boolean
    knee: number
    moved_pixels: number
    [k: string]: unknown
  } | null
  notes: string[]
}

export interface ColorReport {
  /** The engine's own path, when `color` was `Master`. */
  master?: MasterReport | null
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
  /** Output values that were NaN or ±∞ (0.18); not 0 says the model misbehaved. */
  non_finite: number
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
  /** Output values that were NaN or ±∞ (0.18). */
  non_finite: number
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
  /**
   * The output's EXIF Orientation was rewritten to 1: the pixels were upright
   * already (`framing`, or a HEIF's `irot`/`imir` applied by the decoder; 0.16.1).
   */
  exif_orientation_reset: boolean
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
  /** Present when a `RawMode::Scene` develop ran. */
  raw: RawReport | null
  /** Present when a DNG was written (`Dng`, `LinearDng`): what it holds and left out. */
  dng: DngWritten | null
  /** `Master.companion`'s SDR picture of the same render (0.18). */
  companion: Companion | null
  /**
   * Every check of the pixels between stages that ran (0.18). A failed one
   * is never here: it rejects with code `Invariant`.
   */
  checks: CheckReport[]
}

/** One check between stages; `op` is the grade field just checked, `check_us` in microseconds. */
export interface CheckReport {
  stage: string
  op: string | null
  samples: number
  check_us: number
}

/** 8-bit Display P3 pixels of the same render at the asked longest side (never enlarged). */
export interface Companion {
  width: number
  height: number
  /** 3 RGB, 4 RGBA (the output's alpha, straight). */
  channels: number
  row_bytes: number
  icc: number[]
  cicp: { primaries: number; transfer: number; matrix: number; full_range: boolean } | null
  quantisations: number
  dither: unknown
  rolloff: unknown | null
  gamut: unknown | null
  /** A Buffer from the binding. */
  data: Uint8Array
}

/** What a `Scene` develop used (the parts Playroom reads). */
export interface RawReport {
  white_temperature_kelvin: number | null
  white_tint: number | null
  demosaic: string
  /** What decoded the file: `"LibRaw 0.22.2"` or `"PIXL DNG reader (DNG 1.7.1)"`. */
  decoder: string
}

/** What a DNG PIXL wrote holds, and what it left out. */
export interface DngWritten {
  compression: string
  width: number
  height: number
  samples_per_pixel: number
  floating_point: boolean
  white_level: number[]
  black_repeat: number[]
  baseline_exposure: number
  matrices: string[]
  preview: boolean
  thumbnail: boolean
  original_embedded: boolean
  maker_note: boolean
  opcode_lists: number
  notes: string[]
}

/** What a DNG says about itself; its opcode lists are named, never run. */
export interface DngInfo {
  version: string
  compression: string
  linear: boolean
  floating_point: boolean
  baseline_exposure: number
  has_forward_matrix: boolean
  opcodes1: number[]
  opcodes2: number[]
  opcodes3: number[]
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

/** Which names a RAW's camera is known by (PIXL's camera database matches them exactly). */
export type CameraNameForm = 'LibRaw' | 'Exif'

/**
 * A RAW's camera and which versions of PIXL's camera database hold it, so a
 * host can choose its colour without trying a develop. `as_shot_white` is the
 * white the camera balanced for, found through the newest of those versions'
 * calibrations: where the temperature and tint start under `Pixl` (R5 3671 →
 * 3327 K). Null when none holds the camera.
 */
export interface CameraColourInfo {
  form: CameraNameForm
  make: string
  model: string
  /** Oldest first; empty when none holds the camera (`Container` is then the only built-in colour). */
  pixl_versions: number[]
  pixl_camera: string | null
  as_shot_white: WhitePoint | null
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
  /**
   * The orientation (EXIF values, 0 for none) still to apply to the decoded
   * frame: 1 for a HEIF whose `irot`/`imir` libheif applied (0.16.1). A RAW's
   * is the camera's, for information: every call turns a RAW upright itself.
   */
  orientation: number
  /** The EXIF Orientation tag as the file states it; informational (0.16.1). */
  exif_orientation: number
  is_raw_mosaic: boolean
  jpeg: JpegInfo | null
  heif: HeifInfo | null
  png: PngInfo | null
  webp: WebpInfo | null
  jxl: JxlInfo | null
  tiff: TiffInfo | null
  as_shot_white: WhitePoint | null
  /** A RAW's camera and what PIXL's database holds of it; null for any other file. */
  camera_colour: CameraColourInfo | null
  gain_map: GainMapInfo | null
  /** What the file says about the lens. The engine never looks up a correction. */
  lens: ShotLens | null
  /** A DNG's own description (PIXL reads DNG itself since 0.16). */
  dng: DngInfo | null
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
  /** What `AnalyzeRequest::lens` did; `null` without a lens. */
  lens?: LensReport | null
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
   * before 0.15), `Cancelled`, `Invariant` (0.18: an op made pixels that are
   * not numbers; the detail names its grade field), or one of the app's own: EngineUnavailable,
   * EngineCrashed, BadRequest, Unknown.
   */
  code: string
  detail?: PixlErrorDetail
}

/**
 * A RAW the engine refuses by name (0.16, LibRaw): several frames in one
 * file (dual pixel, pixel shift, a burst), or a format or compression it
 * has no decoder for (Foveon, SuperCCD, IIQ, sRAW/mRAW, floating-point
 * camera RAW). Null for anything else.
 */
export function unsupportedRaw(detail: EngineErrorShape['detail']): string | null {
  const d = detail?.['Unsupported']
  const op = d && typeof d['operation'] === 'string' ? d['operation'] : null
  if (op === 'raw frames')
    return 'This RAW holds several frames (dual pixel, pixel shift or a burst), which Playroom cannot develop yet.'
  if (op === 'raw decode')
    return `This RAW format isn't supported${typeof d?.['detail'] === 'string' && d['detail'] ? ` (${d['detail']})` : ''}.`
  return null
}

/**
 * Plainer words for the errors engine 0.17 added: a picture past `limits`
 * (`TooLarge`: `{ field, pixels, side }`) and a master cache made by another
 * engine (`StaleCache`). Null for every other code.
 */
export function describeEngineError(
  code: string,
  detail: EngineErrorShape['detail']
): string | null {
  if (code === 'TooLarge') {
    const d = detail?.['TooLarge']
    const px = d && typeof d['pixels'] === 'number' ? (d['pixels'] as number) : null
    const side = d && typeof d['side'] === 'number' ? (d['side'] as number) : null
    const size = px !== null ? `${Math.round(px / 1e6)} megapixels` : 'too large'
    return `This picture is ${size}${side !== null ? ` (${side} px on its longest side)` : ''}, more than Playroom opens.`
  }
  if (code === 'StaleCache') return 'A saved render was made by another engine and is made again.'
  return null
}

// ── Segmentation and prompts ─────────────────────────────────────────────────

/** How a model's coarse plane reaches the frame's (or `plane_longest`'s) size. */
export type PlaneUpsample =
  { Guided: { radius: number; epsilon: number } } | { Resample: { kernel: Resampler } }

export interface PlanePng {
  compression: PngCompression
  filter: PngFilter
}

export interface SegmentPlane {
  name: string
  tensor: string
  index: number
  /** 16-bit grey PNG, plane_width × plane_height: a Buffer from the binding. */
  png: Uint8Array
  coverage: number
  raw_min: number
  raw_max: number
  clamped: number
  /** With `bounds_at`: the box around every sample at or above it, frame pixels. */
  bounds: MaskBounds | null
  /** The output's `quantity`, echoed (0.18). */
  quantity: PlaneQuantity
}

/** What a plane holds (0.18): a class's share, depth (larger farther) or disparity (larger nearer). */
export type PlaneQuantity = 'Coverage' | 'Depth' | 'Disparity'

export interface SegmentReport {
  planes: SegmentPlane[]
  frame_width: number
  frame_height: number
  /** Every plane's size: the frame's, or `plane_longest`'s. */
  plane_width: number
  plane_height: number
  model_load_ms: number
  session_wait_ms: number | null
}

/** A box and clicks, fractions of the embedding's frame. */
export interface Prompt {
  rect: CropRect | null
  points: { at: Point; label: 'Foreground' | 'Background' }[]
}

export interface PromptEmbeddingRequest {
  source: Source
  input: InputFormat
  raw: RawMode | null
  gain_map: GainMapMode | null
  /** Applied straight after decode: the prompts and planes are fractions of the oriented frame. */
  orientation: Orientation
  /** The lens the `convert` that uses the planes names. */
  lens: LensCorrection | null
  encoder: Record<string, unknown>
  /** Keep the frame's luminance, which a `Guided` decode needs. */
  guide: boolean
  limits: Limits | null
  threads: number
}

export interface PromptSegmentRequest {
  decoder: Record<string, unknown>
  prompt: Prompt
  candidates: 'All' | 'HighestPredictedIou' | { Index: number }
  activation: 'Sigmoid' | 'None'
  upsample: PlaneUpsample
  bounds_at: number | null
  png: PlanePng
  threads: number
  /** The planes at this longer side (the frame's aspect), for a live preview; null is the frame's. */
  plane_longest?: number | null
}

export interface PromptPlane {
  candidate: number
  predicted_iou: number
  /** 16-bit grey PNG, plane_width × plane_height. */
  png: Uint8Array
  coverage: number
  bounds: MaskBounds | null
  logits_width: number
  logits_height: number
  /** The decoder's raw answer: given back as `maskInput` to refine it. */
  logits: Float32Array
}

export interface PromptSegmentReport {
  planes: PromptPlane[]
  frame_width: number
  frame_height: number
  mask_input: boolean
  model_load_ms: number
  session_wait_ms: number | null
  model_ms: number
  plane_width: number
  plane_height: number
}

export interface EmbeddingProvenance {
  encoder_sha256: string
  frame_width: number
  frame_height: number
  orientation: string
  lens_applied: boolean
  guide: boolean
}

/** A model loaded once (native memory, invisible to V8: `close()` it). */
export interface ModelSession {
  readonly model: ModelRef
  readonly loadMs: number
  readonly closed: boolean
  close(): void
}

/** What SAM's encoder made of one frame (16 MB and up, native: `close()` it). */
export interface PromptEmbedding {
  readonly provenance: EmbeddingProvenance
  readonly closed: boolean
  toBytes(): Uint8Array
  close(): void
}

/** What the model calls take beside the request. */
export interface ModelCallOptions {
  signal?: AbortSignal
  sessions?: ModelSession[]
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
  segment(request: Record<string, unknown>, options?: ModelCallOptions): Promise<SegmentReport>
  benchmark(
    request: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<Record<string, unknown>>
  /** Load a model once, for the calls that name it in `sessions`. */
  loadModelSession(model: ModelRef): Promise<ModelSession>
  /** SAM's encoder over one frame: the embedding every `segmentPrompt` on it takes. */
  promptEmbedding(
    request: PromptEmbeddingRequest,
    options?: ModelCallOptions
  ): Promise<PromptEmbedding>
  promptEmbeddingFromBytes(bytes: Uint8Array): PromptEmbedding
  /** A box and clicks on an embedding's frame: the decoder's candidate masks. */
  segmentPrompt(
    request: PromptSegmentRequest,
    options: ModelCallOptions & { embedding: PromptEmbedding; maskInput?: Float32Array }
  ): Promise<PromptSegmentReport>
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
  /** The call may be cancelled (`convert` and `analyze` take a signal). */
  cancellable?: boolean
  /**
   * A `convert` to a `Bytes` sink whose output is a preview frame: the host
   * posts the bytes straight to the window under this id (its preview port)
   * and answers with the report alone.
   */
  frame?: string
}

/** One end of the channel previews travel to the window on (the message's port). */
export interface EnginePortMessage {
  kind: 'port'
}

/** A preview frame, as it reaches the window: RGBA bytes, 8 bits a sample, Display P3. */
export interface PreviewFrame {
  frame: string
  width: number
  height: number
  data: Uint8Array
}

/**
 * SAM 2.1's calls, whose objects (a loaded model, an embedding, a decode's
 * logits) are native and stay in the host: main names them by id.
 *
 * - `load`: the model `ref` loaded once as session `session` (kept while
 *   its ref is the same).
 * - `embed`: the encoder (session `session`) over a frame, kept as
 *   embedding `id` (the host keeps the few most recent).
 * - `decode`: the decoder (session `session`) on embedding `embedding`. On
 *   `lane` (a selection) the answer's logits are kept (`keep`) and fed to
 *   the next decode that asks (`maskInput`), so clicks refine the mask.
 * - `release`: let go of embeddings, lanes and sessions.
 */
export type SamOp =
  | { op: 'load'; session: string; ref: ModelRef }
  | { op: 'embed'; id: string; session: string; request: PromptEmbeddingRequest }
  | {
      op: 'decode'
      embedding: string
      session: string
      lane: string
      request: PromptSegmentRequest
      maskInput: boolean
      keep: boolean
      /**
       * With `candidates: 'All'`: the one answer to keep (and answer with),
       * chosen by size (shared/concepts.ts `pickBySize`); its logits feed
       * the lane's next decode.
       */
      pick?: 'small' | 'large' | 'best'
    }
  | { op: 'release'; embeddings?: string[]; lanes?: string[]; sessions?: string[] }

/** What a `sam` call answers. */
export type SamResult =
  | { op: 'load'; loadMs: number }
  | { op: 'embed'; provenance: EmbeddingProvenance; modelMs: number | null }
  | {
      op: 'decode'
      planes: {
        png: Uint8Array
        predicted_iou: number
        coverage: number
        bounds: MaskBounds | null
      }[]
      plane_width: number
      plane_height: number
      model_ms: number
    }
  | { op: 'release' }

export interface EngineSamMessage {
  kind: 'sam'
  id: number
  call: SamOp
  cancellable?: boolean
}

/** Stop request `id`: the engine returns `Cancelled` at its next stage boundary. */
export interface EngineCancelMessage {
  kind: 'cancel'
  id: number
}

export interface EngineHelloMessage {
  kind: 'hello'
  status: 'ready' | 'unavailable'
  version?: string
  enhance?: boolean
  /** The ONNX Runtime bundled with the addon (0.15+): what model steps run on. */
  runtime?: { library: string; version: string; providers: string[] }
  /** The binding has SAM 2.1's prompt calls (0.16+). */
  prompt?: boolean
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
export type MainToHost =
  EngineRequestMessage | EngineSamMessage | EngineCancelMessage | EnginePortMessage
