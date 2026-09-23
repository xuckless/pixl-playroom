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

export type Depth = 'Eight' | 'Sixteen'

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

export interface Framing {
  orientation: Orientation
  /** −45…45, positive turns the picture clockwise. */
  rotate_degrees: number
  rotate_resampler: Resampler
  crop: CropRect | null
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
  { LayerMask: { layer: number } } | { GroupMask: { layer: number; group: number } }

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

// ── The generative upscaler ──────────────────────────────────────────────────

export type ExecutionProvider =
  'Cpu' | 'CoreMl' | { Cuda: { device: number } } | { DirectMl: { device: number } }

export type AlphaUpscale = 'Model' | { Resample: Resampler }

export interface UpscalerRef {
  model_path: string
  runtime_library: string
  provider: ExecutionProvider
  threads: number
  scale: number
  tile: number
  overlap: number
  input_multiple: number
  then: Resampler | null
  alpha: AlphaUpscale
}

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
  | { Jpeg: { quality: number; subsampling: Subsampling; optimize: boolean } }
  | { Png: { compression: PngCompression; filter: PngFilter } }
  | { Heic: { quality: number; lossless: boolean; bit_depth: number; chroma: Chroma } }
  | {
      Avif: { quality: number; lossless: boolean; bit_depth: number; chroma: Chroma; speed: number }
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

export interface HdrWorking {
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
  | { Expand: { to: ColorSpaceRef; operator: ExpandOperator; peak_nits: number } }

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

export interface Vignette {
  amount: number
  midpoint: number
  roundness: number
  feather: number
  highlights: number
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

export type GradeOp =
  | { Lut: { lut: LutRef; amount: number } }
  | { Primary: Primary }
  | { Qualifier: { key: HslKey; correction: Primary } }
  | { Tone: Tone }
  | { WhiteBalance: WhiteBalance }
  | { Vibrance: Vibrance }
  | { Curves: Curves }
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

export type MaskShape = { Polygon: Polygon } | { Range: HslKey } | { Raster: RasterMask }

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
  threads: number
  framing: Framing | null
  region: Region | null
  inspect: Inspect | null
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
}

// ── Reports ──────────────────────────────────────────────────────────────────

export interface LightLevel {
  max_cll_nits: number
  max_fall_nits: number
  working_white_nits: number
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
  graded: GradeReport | null
}

export interface LossReport {
  source_bits: number
  output_bits: number
  quantisations: number
  dither: Dither
  single_float_pass: boolean
  resampled: boolean
  channels_changed: boolean
  depth_narrowed: boolean
  colour_transformed: boolean
  graded: boolean
  lossy_encoder: boolean
  chroma_subsampled: boolean
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
}

export interface FramingReport {
  orientation: Orientation
  rotate_degrees: number
  crop: MaskBounds
  exif_orientation_reset: boolean
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
  region: RegionReport | null
  inspected: string | null
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
  /** A `PixlError` variant, or one of the app's own: EngineUnavailable, EngineCrashed, BadRequest, Cancelled, Unknown. */
  code: string
  detail?: PixlErrorDetail
}

// ── The binding ──────────────────────────────────────────────────────────────

/** The contract the Node binding fulfils. */
export interface PixlEngineModule {
  engineVersion(): string
  hasEnhance(): boolean
  probe(path: string): Promise<SourceInfo>
  convert(request: ConvertRequest): Promise<ConvertReport>
  analyze(request: AnalyzeRequest): Promise<ImageStats>
  suggestEncode(info: SourceInfo, threads: number): Encode
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
  reason?: string
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
