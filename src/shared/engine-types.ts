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

import { t, tp } from './i18n'

// ── Sources and sinks ────────────────────────────────────────────────────────

/**
 * `GpuFrame` (0.19.2, Phase A §4.3): a drag frame graded from the frame
 * uploaded to the GPU session (`uploadGpuFrame`), named in the call's
 * options; its `input` is `'GpuFrame'` too.
 */
export type Source = { Path: string } | { Bytes: number[] } | { GpuFrame: null }
export type Sink = { Path: string } | 'Bytes'

export type InputFormat =
  | 'Jpeg'
  | 'Png'
  | 'Heif'
  | 'Jxl'
  | 'Tiff'
  | 'WebP'
  | 'Raw'
  | /** 0.19.2: see `Source.GpuFrame`. */ 'GpuFrame'

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

/** A grade's plane, as the inspection of the same name outputs it (0.21.0: `Beside`'s `mask`). */
export type MaskProbe =
  | { LayerMask: { layer: number } }
  | { GroupMask: { layer: number; group: number } }
  /** The n-th Qualifier op's key in the layer, a masked group's own counted in place (E77). */
  | { QualifierKey: { layer: number; qualifier: number } }

/**
 * Output a plane instead of the picture, or (`Beside`) with it: one grey
 * channel, 0 nothing, full scale all. The mask inspections take any colour
 * policy since 0.21.0 (E39), keyed on the layer's input in that pipeline.
 */
export type Inspect =
  /**
   * 0.19.2: the grade's input (everything before the grade), for a GPU
   * frame's upload. 0.21.0 (E61): `pixel.channels` is honoured, 4 adding an
   * opaque alpha, 3 dropping one, either expanding grey; `null` as before.
   */
  | 'GradeInput'
  | { LayerMask: { layer: number } }
  | { GroupMask: { layer: number; group: number } }
  /** 0.21.0 (E77): the n-th Qualifier op's key in the layer, wherever it sits. */
  | { QualifierKey: { layer: number; qualifier: number } }
  /** Where HDR output sits above its white: `clamp(log2(Y / white) / stops, 0, 1)`. */
  | { Headroom: { stops: number } }
  /**
   * 0.21.0 (E22), soft proofing: `clamp(ΔE2000(pixel, to's rendition of it)
   * / scale, 0, 1)` on the working buffer before the egress. `to` is never
   * PQ/HLG; SDR renders only (refused with `hdr`, `Expand`, a `Master`, an
   * HDR `ToneMap`/`Assign`).
   */
  | {
      GamutWarning: {
        to: ColorSpaceRef
        intent: RenderingIntent
        black_point_compensation: boolean
        scale: number
      }
    }
  /**
   * 0.21.0 (E38): the picture as with no inspection, and `mask`'s plane in
   * `report.beside` at `depth`. Refused on the GPU and with `Resampler::Ai`.
   */
  | { Beside: { mask: MaskProbe; depth: Depth } }

// ── RAW ──────────────────────────────────────────────────────────────────────

export type DngCrop = 'None' | 'ActiveArea' | 'Best'

/**
 * How many pixels a RAW develop makes: `Full` is one per photosite (the
 * demosaic); `Cell` one per colour filter array cell (2 × 2 Bayer, 3 × 3
 * X-Trans), each colour the mean of its photosites, no demosaic. A quarter
 * (or a ninth) of the pixels, for previews.
 */
/**
 * `Binned` (0.19.0): one pixel per `factor × factor` photosites, a multiple
 * of the cell, `1..=64`; for thumbnails and filmstrips only (HR-0.19-1:
 * never judge noise on one).
 */
export type RawResolution = 'Full' | 'Cell' | { Binned: { factor: number } }

/** A RAW denoiser ref (`@xuckless/pixl-models`' `ref('pmrid', host)`): PMRID's model and anchor. */
export type RawDenoiserRef = Record<string, unknown>

/**
 * Scene's mosaic denoiser (0.19.0): PMRID on the Bayer mosaic, before the
 * white balance; `noise` is the frame's `variance = k·x + σ²`. Bayer only.
 */
export interface MosaicDenoise {
  model: RawDenoiserRef
  /**
   * `MeasuredFloor` (0.20): measured, with the read-noise floor taken from
   * the frame's darkest tiles. `MeasuredGreenFloor` (0.21.0, E64; the PIXL
   * demosaic's roster ref, 1.0.1, states it): `MeasuredFloor` read from
   * green alone, its line told to red and blue, so a Bayer frame is refused
   * only when its greens have no line (X-Trans: `MeasuredFloor`'s bytes).
   */
  noise: MosaicNoise
}

/** How a mosaic's noise is known: read from the frame, a DNG's NoiseProfile, or stated. */
export type MosaicNoise =
  | 'Measured'
  | 'MeasuredFloor'
  | 'MeasuredGreenFloor'
  | 'DngNoiseProfile'
  | { Stated: { k: number; sigma2: number } }

/**
 * What a learned demosaic reads and answers (the engine's 0.20 work, not
 * released): demosaicnet's own arithmetic, or a stated curve (PIXL's own
 * demosaic: `Log`, `ln(1 + gain·x) / ln(1 + gain·peak)`).
 */
export type MosaicEncoding =
  'Demosaicnet' | { Curve: { encoding: { Log: { gain: number; peak: number } } } }

/** Whether a learned demosaic is told the frame's noise (0.20): a fourth plane, or none. */
export type DemosaicNoise = 'None' | { Map: { noise: MosaicNoise } }

/**
 * A learned demosaic's ref (`@xuckless/pixl-models`' `ref(id, host)` for a
 * `demosaicker`), as far as Playroom reads it. `encoding` and `noise` are
 * required by the 0.20 engine on every learned demosaic and unknown to
 * 0.19.2; the roster installed beside the engine supplies them (the
 * released one has neither, a development kit's has both), and Playroom
 * passes the ref on as it is.
 */
export interface DemosaickerRef extends Record<string, unknown> {
  cfa?: RawCfa
  tiling?: ModelInput
  encoding?: MosaicEncoding
  noise?: DemosaicNoise
}

/**
 * Scene's demosaic (0.19.0): `Classic` (PPG / Markesteijn, 0.18's bytes),
 * `Ahd` (Bayer, no model), or a learned one (`demosaicnet-bayer` /
 * `-xtrans`, by `SourceInfo.raw_cfa`; `resolution` must be `Full`). With a
 * development kit, PIXL's own (`pixl-demosaic-v1-bayer` / `-v1-xtrans`), which
 * denoises as it develops: `mosaic_denoise` stays null beside it.
 */
export type SceneDemosaic = 'Classic' | 'Ahd' | { Model: DemosaickerRef }

/** A RAW's colour filter when PIXL demosaics it (0.19.0). */
export type RawCfa = 'Bayer' | 'XTrans'

/**
 * What a RAW says about its colour. `Pixl` is refused on a body the version
 * does not hold. `Dcp` (0.21.0, E21): a DNG camera profile as
 * `readCameraProfile` reads it, three-colour sensors only; its tables and
 * tone curve are `Scene`'s, the tone curve on an SDR `Master` with `look:
 * 'Colorimetric'` only (state `tone_curve: null` otherwise).
 */
export type CameraColour =
  'Container' | { Pixl: { version: number } } | { Stated: unknown } | { Dcp: DcpProfile }

/**
 * A ProfileHueSatMap or ProfileLookTable: value slowest, then hue, then
 * saturation; each entry `[hue shift °, saturation scale, value scale]`.
 */
export interface HueSatTable {
  hue_divisions: number
  sat_divisions: number
  val_divisions: number
  entries: [number, number, number][]
}

export type TableEncoding = 'Linear' | 'Srgb'

/**
 * A DNG camera profile (`.dcp`), as `readCameraProfile` reads it and
 * `CameraColour.Dcp` states it (0.21.0, E21). `camera` is a `Stated`
 * profile (`analog_balance` null). The engine never matches it to a camera
 * (compare `unique_camera_model` with the probe's) and never adds
 * `baseline_exposure_offset` (stops): the host does.
 */
export interface DcpProfile {
  name: string | null
  unique_camera_model: string | null
  calibration_signature: string | null
  copyright: string | null
  camera: unknown
  hue_sat_maps: HueSatTable[]
  hue_sat_map_encoding: TableEncoding
  look_table: HueSatTable | null
  look_table_encoding: TableEncoding
  tone_curve: [number, number][] | null
  baseline_exposure_offset: number
}

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
        highlights: 'Clip' | 'Unclipped' | 'Blend' | 'InpaintOpposed' | 'Diffused'
        crop: DngCrop
        denoise: Denoise | null
        /** 0.19.0: `null` develops as 0.18 did. */
        mosaic_denoise: MosaicDenoise | null
        /** 0.19.0: `'Classic'` develops as 0.18 did. */
        demosaic: SceneDemosaic
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
        /** 0.21.0 (OBS-4): a compile cache the host owns; absent or `null` compiles at every load. */
        cache?: CoreMlCache | null
      }
    }
  | { Cuda: { device: number } }
  | { DirectMl: { device: number } }

/**
 * A CoreML compile cache (0.21.0, OBS-4): `dir` an existing, writable,
 * absolute directory; `sha256` the model file's (the roster's), checked at
 * every load. Each load compiles into `<dir>/<sha256>-<16 hex>`, keyed by
 * everything that changes the compile.
 */
export interface CoreMlCache {
  dir: string
  sha256: string
}

/** What a load did with its CoreML cache: the keyed folder, and whether a compile was there. */
export interface CoreMlCacheUse {
  key: string
  path: string
  existed: boolean
  hash_ms: number
}

export type GraphOptimisation = 'Disable' | 'Basic' | 'Extended' | 'All'

export interface SessionSpec {
  threads: number
  optimisation: GraphOptimisation
  deterministic: boolean
  /**
   * 0.19.0: the graph's free input dimensions fixed by name (the roster's
   * `files[i].dimensions`), for CoreML static shapes; `[]` builds as 0.18.
   */
  dimensions: { name: string; value: number }[]
  /** 0.19.0: ONNX Runtime's intra-op spinning; `false` lets an idle host sleep (Playroom). */
  intra_op_spinning: boolean
  /**
   * 0.19.2 (Phase A §1.2): ONNX Runtime's CPU arena. `false` gives a big
   * model's working memory back between runs (SAM 3's encoder: about 3.6 GB
   * resident instead of 9 GB, as fast); `true` is 0.19's behaviour. A
   * session loaded one way is refused for a request asking the other.
   */
  cpu_arena: boolean
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

/**
 * What a model reads (0.20 adds `PixlRgb`: linear PixlRGB through a stated
 * log curve, so a Scene frame goes in with its highlights; PIXL's own
 * models state it, and run in no other).
 */
export type ModelSpace =
  'Srgb' | 'SourceEncoding' | { PixlRgb: { encoding: { Log: { gain: number; peak: number } } } }

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

/**
 * One step of `ConvertRequest.enhance`, run straight after decode and
 * orientation. 0.21.0 (E70): a float source goes through when every step is
 * a `PixlRgb` `Model` step (kept above white up to the curve's peak); any
 * other step on one is refused by its own field, `enhance[i]` or
 * `enhance[i].model_space`.
 */
export type EnhanceStep =
  { JpegReconstruct: JpegReconstruct } | { Model: EnhancerRef } | { Upscale: UpscalerRef }

// ── Encoders ─────────────────────────────────────────────────────────────────

export type Subsampling = 'None' | 'Half' | 'Quarter' | 'Grey'
export type Chroma = 'Half' | 'Wide' | 'Full'
export type PngCompression = 'Fast' | 'Balanced' | 'Best'
export type PngFilter = 'NoFilter' | 'Sub' | 'Up' | 'Average' | 'Paeth' | 'Adaptive'
export type TiffCompression = 'None' | 'Lzw' | 'Deflate'
/**
 * `JxlLossless` (0.21.0, E46): lossless JPEG XL tiles (DNG 1.7), `effort`
 * 1–9, `interleave` 1 or the CFA's repeat (2 Bayer, 6 X-Trans); read back
 * by PIXL's DNG reader only, and `interleave: 1` for files other readers
 * must open.
 */
export type DngCompression =
  'Uncompressed' | 'Lossless' | { JxlLossless: { effort: number; interleave: number } }
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
  | LogSpace

/**
 * The log grading spaces (0.21.0, E73), entered from the working space and
 * left for it by their published formulas:
 * - `AcesCct`: ACES AP1, the ACEScct curve (18% grey 0.4135884, white 0.5547945).
 * - `DavinciIntermediate`: DaVinci Wide Gamut (grey 0.336043, white 0.513837).
 * - `PixlLog`: PixlRGB, the models' log curve (gain 64, peak 8), unclamped
 *   (grey 0.405, white 0.669, 8× white 1).
 * Grading only: refused as `color.to` and `sdr.to`. A log stage refuses
 * WhiteBalance, a parametric curve, a paint-overlay vignette and the
 * display-range blend modes, and `'Gpu'` refuses it by its `space`.
 */
export type LogSpace = 'AcesCct' | 'DavinciIntermediate' | 'PixlLog'

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
 * `smoothing` on Tone, Vibrance, Dehaze, ColorGrade, HslBands, Qualifier
 * (0.18) and LogWheels (0.21.0): the op's change smoothed where the picture
 * is flat. `radius` is
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
  /**
   * Where the bands' weights read the picture (0.19.2, Phase A §1.5, §3.2):
   * a smoothed luma, so texture keeps its contrast. Absent or `null` is the
   * op as it always ran.
   */
  base?: ToneBase | null
}

/**
 * Tone's base, a method (0.19.2). `Guided` is 0.19's `{ radius, epsilon }`
 * bit for bit; `LocalLaplacian` keeps more local contrast with about an
 * eighth of the halo (the owner's pick), at about 250 ms on a 2560 px
 * preview against guided's 70. The GPU drag path refuses `Guided`.
 */
export type ToneBase =
  | { Guided: { radius: number; epsilon: number } }
  | { LocalLaplacian: { radius: number; sigma: number; spacing: number } }

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
  /**
   * 0.21.0 (E71): `x` hue/360, `y` a luminance move in stops (0 none),
   * weighed by saturation so a neutral is untouched. Periodic: the first and
   * last `y` equal.
   */
  hue_vs_luma: Curve | null
  /** 0.21.0 (E72): `x` HSV saturation 0…1, `y` a saturation multiplier (1 none). */
  saturation_vs_saturation: Curve | null
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
  /** Required since 0.21.0 (E19). */
  reach: CurveReach
}

/**
 * How far a region slider at ±1 moves its region (0.21.0, E19): `HalfGap`
 * is the curve before 0.21.0, bit for bit (half the room to the next
 * point); `{ Range: r }` moves it by `r` of the whole range, `0 < r ≤ 0.5`
 * (0.25 for a 17-point slider curve's reach), held monotone and pinned.
 */
export type CurveReach = 'HalfGap' | { Range: number }

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

/**
 * `Exposure` darkens like light falling off; `PaintOverlay` paints black or
 * white over. `ColorPriority` (0.21.0, E24): the gain with no protection, a
 * lightening held per pixel so its largest channel stops at white (hue and
 * saturation kept); a lightening is refused in a pipeline with headroom.
 */
export type VignetteStyle = { Exposure: { highlights: number } } | 'ColorPriority' | 'PaintOverlay'

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

/**
 * Film grain. 0.21.0 (E43): `response` and `chroma` are required;
 * `response: 'Midtones', chroma: { amount: 0, size: 1 }` is 0.20's grain
 * byte for byte. A `chroma.amount` above 0 is refused on one channel, and
 * colour grain is CPU only.
 */
export interface Grain {
  amount: number
  size: number
  roughness: number
  seed: number
  response: GrainResponse
  chroma: ChromaGrain
}

/**
 * How strong the grain is at each tone `l`: `Midtones` is `4l(1 − l)`
 * (0.20's), a `Curve` the caller's monotone weights (`x` 0…1, `y` 0…2).
 */
export type GrainResponse = 'Midtones' | { Curve: Curve }

/** A colour grain beside the luminance grain: `amount` 0…1 (0 none), `size` 1…4 × the grain's cell. */
export interface ChromaGrain {
  amount: number
  size: number
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

/**
 * A master (Y) lift, gamma and gain moving luminance alone (0.21.0, E78):
 * `mix` 1 keeps hue and saturation, 0 is the per-channel lift/gamma/gain (a
 * `Primary` with the same value on each channel). `(0, 1, 1)` is none.
 */
export interface LumaPrimary {
  lift: number
  gamma: number
  gain: number
  mix: number
}

/**
 * Temperature and tint as one gain per channel on the stage's values as
 * they stand (0.21.0, E75): a grading panel's Temp/Tint, in an encoded
 * stage beside the primaries. The white of `temperature_kelvin`/`tint`
 * (the WhiteBalance locus, 1667–25000 K, ±0.1 Δuv) goes to 6504 K in the
 * stage's primaries; `hold_luminance` keeps a grey's luma. Refused in an
 * ICC profile's stage and on one channel.
 */
export interface GainBalance {
  temperature_kelvin: number
  tint: number
  hold_luminance: boolean
}

/**
 * Resolve's Log wheels (0.21.0, E74), meant for a log stage (refused in
 * linear light). With `y` the stage's luma and `t` the transition, shadow
 * weight `1 − smoothstep(low − t, low + t, y)`, highlight weight
 * `smoothstep(high − t, high + t, y)`, the midtone the rest; each channel
 * gains `offset + midtone + w_s (shadow − midtone) + w_h (highlight −
 * midtone)`. Refused by field: `transition < 0`, or `low_range + transition
 * > high_range − transition` (by `high_range`). Every field at zero is none.
 */
export interface LogWheels {
  shadow: Rgb
  midtone: Rgb
  highlight: Rgb
  offset: Rgb
  low_range: number
  high_range: number
  transition: number
  smoothing: AdjustmentSmoothing | null
}

/**
 * A coloured glow spread around the highlights (0.21.0, E41): `amount` 0…1
 * (0 none); `threshold` and `softness` 0…1 on the effects' tone (the
 * knee); `radius` 0.001…0.1 of the shorter side; `color` (each ≥ 0) stated
 * in `space`. Light in a linear stage, a softer glow in an encoded one.
 * CPU only.
 */
export interface Halation {
  amount: number
  threshold: number
  softness: number
  radius: number
  color: Rgb
  space: ColorSpaceRef
}

/**
 * Where a Bloom's light comes from: `All` mixes a blurred copy back (a
 * Pro-Mist: a flat field keeps its level); `Highlights` adds the blurred
 * highlights (a glow).
 */
export type BloomSource = 'All' | { Highlights: { threshold: number; softness: number } }

/**
 * A diffusion on Halation's kernel (0.21.0, E42): `amount` 0…1 (0 none),
 * `radius` 0.001…0.1 of the shorter side, `color` its warmth (white for
 * none) in `space`. CPU only.
 */
export interface Bloom {
  amount: number
  radius: number
  source: BloomSource
  color: Rgb
  space: ColorSpaceRef
}

/** Density's eight band weights, each −1…1. */
export interface DensityBands {
  red: number
  orange: number
  yellow: number
  green: number
  aqua: number
  blue: number
  purple: number
  magenta: number
}

/**
 * A colour made denser, not greyer (0.21.0, E44): darkened in proportion to
 * its ICtCp chroma (one stop at chroma 0.25 for `amount` × band 1), its hue
 * kept. `amount` −1…1 (0 none); refused on one channel. Any stage, CPU only.
 */
export interface Density {
  amount: number
  bands: DensityBands
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
  /** 0.21.0 (E78). */
  | { LumaPrimary: LumaPrimary }
  /** 0.21.0 (E75). */
  | { GainBalance: GainBalance }
  /** 0.21.0 (E41). */
  | { Halation: Halation }
  /** 0.21.0 (E42). */
  | { Bloom: Bloom }
  /** 0.21.0 (E44). */
  | { Density: Density }
  /** 0.21.0 (E74). */
  | { LogWheels: LogWheels }

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

/**
 * Where a raster's pixels come from (a mask's, a depth range's map, an
 * overlay, a flat field). 0.21.0 (E33, E47) adds TIFF (one page, any
 * compression; uncompressed is the cheap one) and lossless JPEG XL: 8- or
 * 16-bit integer samples read exactly, so the same pixels render the same
 * bytes from each. One the engine cannot read (float samples among them) is
 * refused as `InvalidRequest` by the variant's field (`….source.Tiff`).
 */
export type RasterRef =
  | { Png: string }
  | { PngBytes: number[] }
  | { Tiff: string }
  | { TiffBytes: number[] }
  | { Jxl: string }
  | { JxlBytes: number[] }

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
  /** 0.21.0 (E36). */
  | { Strokes: BrushStrokes }

/**
 * Brush strokes as vectors, rasterised at the frame's own size (0.21.0,
 * E36). Flow is per stroke and a stroke never builds up over itself;
 * strokes combine by screen; pressure scales a dab's flow. An eraser is a
 * stroke in a `Subtract` component. At most 100,000 dabs a component, and
 * strokes whose boxes add up past 256 frames are refused (paint them into a
 * `Raster`).
 */
export interface BrushStrokes {
  strokes: BrushStroke[]
}

export interface BrushStroke {
  /** At least one, in the order laid down. */
  dabs: Dab[]
  /** 0…1 of a dab's radius, the falloff from its edge inward; 0 is hard. */
  softness: number
  /** 0…1, the stroke's strength. */
  flow: number
}

export interface Dab {
  /** Fractions of the frame, −1…2. */
  x: number
  y: number
  /** (0, 1] of the frame's shorter side. */
  radius: number
  /** 0…1, a scale on the stroke's flow at this dab (1 for a mouse). */
  pressure: number
}

/** What a guided refine reads its edges from: the luminance, or colour edges too. */
export type RefineGuide = 'Luma' | 'Colour'

/**
 * Snap an edge to the picture's (0.19.2, Phase A §1.4, §4.2): a method.
 * Lengths are fractions of the frame's shorter side.
 *
 * - `Guided`: 0.19's refine bit for bit with `guide: 'Luma'` (`radius`
 *   0.0005…0.05, `epsilon` 1e-6…1). Cheap: the one to use while dragging.
 * - `EdgeSnap`: a hard edge snapped onto the strongest edge within
 *   `distance`; sharp corners come back. Best on sky and vegetation.
 * - `BilateralSolver`: a soft, edge-aware snap.
 * - `Matting`: partial alpha in a `band` about the edge, for hair, twigs
 *   and branches. Best on people.
 *
 * EdgeSnap, the solver and Matting read the whole frame: a region using one
 * is never the full render, cut, so they're applied on release.
 */
export type Refine =
  | { Guided: { radius: number; epsilon: number; guide: RefineGuide } }
  | { EdgeSnap: { distance: number } }
  | {
      BilateralSolver: {
        sigma_spatial: number
        sigma_luma: number
        sigma_chroma: number
        lambda: number
        iterations: number
      }
    }
  | { Matting: { band: number; epsilon: number; iterations: number } }

/** A refine method's name, as its JSON key. */
export type RefineMethod = 'Guided' | 'EdgeSnap' | 'BilateralSolver' | 'Matting'

/**
 * Built in this order: shape → feather → refine → invert → opacity → mode.
 * 0.19.2 (Phase A §1.3, §4.1), Photoshop's Select and Mask: `smooth`
 * (0…0.05 of the shorter side) takes the jaggies out of a contour and keeps
 * it hard, `contrast` (0…1, 1 a hard threshold at the middle) hardens a
 * soft edge, `shift` (−0.05…0.05) moves it, positive growing the selection
 * with round corners (0.19's `refine.contract: c` is `shift: -c`). Each 0
 * leaves the component as it was.
 */
export interface MaskComponent {
  shape: MaskShape
  mode: MaskMode
  opacity: number
  invert: boolean
  feather: Feather
  refine: Refine | null
  smooth: number
  contrast: number
  shift: number
}

/** The whole mask's edge (0.19.2), after its components are combined. */
export interface MaskEdgeSpec {
  smooth: number
  feather: Feather
  refine: Refine | null
  contrast: number
  shift: number
}

export interface Mask {
  components: MaskComponent[]
  invert: boolean
  space: GradeSpace | null
  /** 0.19.2: `null` leaves the combined mask as it was. */
  edge: MaskEdgeSpec | null
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
  /** 0.21.0 (E37): a masked layer's counts only inside the crop rectangle. */
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

/** 0.21.0 (E37): `clamped_samples` and `qualifier_coverage` count only inside the crop. */
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
  /**
   * 0.19.2 (Phase A §4.2): the spot's edge snapped to the photo's. Playroom
   * offers plain (`null`), EdgeSnap (keeps the strong edges a spot crosses)
   * and Matting (a softer, wider blend), the owner's decision (2026-10-11).
   */
  refine?: Refine | null
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

/**
 * AI remove: the hole filled by an inpainting model shown a crop around it
 * (`context`: the hole's box grown by this many times its longer side, 0…4).
 * `model` is an inpainter's filled ref (`migan-512`).
 */
export interface AiRemove {
  shape: SpotShape
  feather: Feather
  opacity: number
  context: number
  model: Record<string, unknown>
}

export type RetouchStep =
  | { Clone: Spot }
  | { Heal: Spot }
  | { Fill: ContentFill }
  | { Remove: AiRemove }
  | { RedEye: RedEye }
  | { PetEye: PetEye }

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
  /**
   * 0.21.0 (E76): the scopes of the buffer measured; absent or `null`
   * measures none. Checked before the render (a waveform's `columns`
   * against the output's width), and a refused one refuses the whole render.
   */
  scopes?: ScopeSpec | null
}

/**
 * What scopes to measure (0.21.0, E76), on `analyze` or `measure`: each
 * absent (or `null`) or its grid, at least one named.
 */
export interface ScopeSpec {
  /**
   * `columns` 1…65536 and at most the measured frame's width (`⌈width /
   * stride⌉`); `levels` 2…65536; `columns × levels ≤ 2²⁴`.
   */
  waveform?: WaveformSpec | null
  vectorscope?: VectorscopeSpec | null
  /** Over u′, v′ in 0…0.65; `domain: 'Linear'` only. */
  chromaticity?: { size: number } | null
}

export interface WaveformSpec {
  columns: number
  levels: number
  planes: 'Luma' | 'Channels' | 'LumaAndChannels'
}

/**
 * `size` 2…1024; `extent` the half-width of the Cb and Cr axes in the
 * domain's units (0.5 holds every encoded colour). No P3 matrix.
 */
export interface VectorscopeSpec {
  size: number
  matrix: Exclude<YCbCrMatrix, 'Identity'>
  extent: number
}

/**
 * The scopes' grids (0.21.0, E76): whole counts, row-major, row 0 at the
 * bottom of the vertical axis (a waveform's `[level * columns + column]`,
 * level 0 black; a vectorscope's `[crRow * size + cbColumn]`, row 0 at Cr =
 * −extent; a chromaticity's `[vRow * size + uColumn]`, row 0 at v′ = 0).
 * `Float64Array`s from the binding.
 */
export interface ScopeReport {
  waveform: {
    columns: number
    levels: number
    luma: Float64Array | null
    /** One per colour channel (R, G, B; one for grey): side by side, a parade. */
    channels: Float64Array[]
  } | null
  vectorscope: { size: number; counts: Float64Array; outside: number } | null
  chromaticity: {
    size: number
    counts: Float64Array
    outside: number
    undefined: number
  } | null
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
  /**
   * 0.19.2 (Phase A §1.1): where the grade runs. `'Cpu'` is what 0.19 did;
   * `'Gpu'` is the drag path (a frame uploaded once, §4.3). Required: a
   * request without it is refused, naming `grade_device`.
   */
  grade_device: GradeDevice
  /**
   * Required (0.21.0, E62): `true` on a CPU render of the whole frame that
   * carries no `held` also keeps each mask refine that reads the whole
   * frame (EdgeSnap, BilateralSolver, Matting) in `report.held`, so a 1:1
   * tile given it is the full render, cut (up to 4 bytes a pixel of the
   * refine's box). Refused on `'Gpu'`. `false` keeps none, as before.
   */
  hold_refines: boolean
  /**
   * 0.21.0 (OBS-1): a JPEG (`input: 'Jpeg'`, or a camera format's JPEG
   * preview under `raw: 'EmbeddedPreview'`) decoded at 1/2, 1/4 or 1/8 of
   * its size, `⌈w / d⌉ × ⌈h / d⌉`. Refused by `decode_reduce` for every
   * other decoder; absent or `null` decodes at full size.
   */
  decode_reduce?: DecodeReduce | null
}

export type GradeDevice = 'Cpu' | 'Gpu'

/** How far `decode_reduce` reduces a JPEG's decode, per side. */
export type DecodeReduce = 'Half' | 'Quarter' | 'Eighth'

export type AnalysisDomain = 'Encoded' | 'Linear'
export type TransparentPixels = 'Include' | 'Exclude'

/** A region `focus` measures: a normalised box, or a mask raster. */
export type MeasureRegion =
  { Box: { x: number; y: number; width: number; height: number } } | { Mask: RasterMask }

/** 0.19.0: what `focus` measures, per region. */
export interface FocusSpec {
  regions: MeasureRegion[]
  orientation_bins: number
}

export interface FocusRegionReport {
  laplacian_variance: number
  gradient_energy: number
  /** The structure tensor's coherence, 0..1. */
  coherence: number
  /** The dominant gradient's angle, degrees (blur runs perpendicular to it). */
  gradient_angle_deg: number
  orientation_histogram: number[]
  /** Pixels the region weighed. */
  pixels: number
  [k: string]: unknown
}

export interface FocusReport {
  regions: FocusRegionReport[]
  [k: string]: unknown
}

export interface AnalyzeRequest {
  /** 0.19.0: report `ImageStats.phash`. */
  phash: boolean
  /** 0.19.0: report `ImageStats.focus`. */
  focus: FocusSpec | null
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
  /** 0.21.0 (E76): the scopes on stated grids; absent or `null` measures none. */
  scopes?: ScopeSpec | null
}

/**
 * `rawNoise`'s request (0.21.0, E65): the RAW, the area a `Scene` develop
 * with the same `crop` and `dng_opcodes` reads, and how its noise is read
 * (`Stated` is refused by `noise`). Nothing is developed.
 */
export interface RawNoiseRequest {
  source: Source
  crop: DngCrop
  dng_opcodes: DngOpcodes
  noise: Exclude<MosaicNoise, { Stated: unknown }>
  threads: number
  limits: Limits | null
}

/** One plane's line (`variance = k·x + σ²`), as a develop's `noise_planes` holds it. */
export interface MosaicPlaneNoise {
  plane: string
  k: number
  sigma2: number
  fit: Record<string, unknown> | null
}

/** Each plane's line, or why it has none (`unread`): the call is not refused for a plane. */
export interface RawNoiseReport {
  cfa: RawCfa
  area: MaskBounds
  noise_from: string
  planes: { plane: string; noise: MosaicPlaneNoise | null; unread: string | null }[]
  read_ms: number
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
  /** 0.19.2: what the grade read around a pixel (`regionReach`'s report). */
  reach?: ReachReport
  /** 0.19.2: how far the margin fell short of `reach`; non-zero means tiles may disagree at their edges. */
  short_by?: number
  /** 0.21.0: the canvas rectangle the render read for the region. */
  source?: MaskBounds
  /**
   * 0.21.0 (E66): the canvas rectangle a RAW develop with a learned
   * demosaic made for this region alone; `null` when the frame was
   * developed whole.
   */
  developed?: MaskBounds | null
}

/**
 * `regionReach`'s request (0.19.2, host rule HR-0.20-1): the same grade and
 * frame as the render. Ask again whenever the grade changes.
 */
export interface ReachRequest {
  grade: Grade | null
  sdr_grade: Grade | null
  frame_width: number
  frame_height: number
  output_width: number
  output_height: number
}

export interface ReachReport {
  /** How far a pixel's result reads around it: the region's margin must be at least this. */
  pixels: number
  /**
   * The ops that measure the whole photo (Denoise, Dehaze, and the refine
   * methods EdgeSnap, the solver and matting): a region of those can differ
   * at any margin, unless the measurement is held (`HeldMeasurements`).
   */
  measured: string[]
  /** The SDR look's reach; the engine covers it itself, so the margin needn't grow for it. */
  sdr_edge: number
}

/**
 * Dehaze's and Denoise's whole-photo measurements (0.19.2, Phase A §4.4),
 * returned by a whole-frame render that ran one. Passed back on a drag, the
 * measurement is reused, and a region is then the full render, cut, exactly.
 * Since 0.21.0 (E62) also the refined planes of masks refined over the
 * whole frame, from a render with `hold_refines: true` (their `fields` are
 * the refine paths, `grade.layers[0].mask.components[0].refine`); a plane
 * made for another mask is refused by `held`. A native handle: it lives in
 * the engine host that made it.
 */
export interface HeldMeasurements {
  fields: string[]
  closed: boolean
  close(): void
}

/** The GPU drag path (0.19.2, Phase A §4.3): one per app, a frame per open photo. */
export interface GpuSessionSpec {
  backend: 'Metal' | 'Dx12'
  adapter: 'HighPerformance' | 'LowPower'
}

export interface GpuSession {
  closed: boolean
  close(): void
}

export interface GpuFrameSpec {
  width: number
  height: number
  sample: 'F16'
  alpha: boolean
}

export interface GpuFrame {
  closed: boolean
  close(): void
}

/**
 * A raster mask's plane decoded and resampled to one frame size once
 * (0.21.0, E37, `prepareRaster`), named beside every render of that frame
 * (`maskPlanes`). Native memory V8 does not see (`bytes`): `close()` it when
 * the photo or the size changes.
 */
export interface PreparedRaster {
  readonly width: number
  readonly height: number
  /** The SHA-256 of the file's bytes, lower-case hex. */
  readonly sha256: string
  readonly bytes: number
  readonly closed: boolean
  close(): void
}

/**
 * `prepareRaster`'s request: `source` and `resampler` exactly the
 * component's, `width` × `height` the frame its mask is planned on.
 */
export interface PreparedRasterRequest {
  source: RasterRef
  resampler: Exclude<Resampler, 'Ai'>
  width: number
  height: number
  /** 1…1024, for the resample; the plane is the same at any count. */
  threads: number
  limits: Limits | null
}

/**
 * What a call holding a token has counted so far (0.21.0, E68): `done` of
 * the `total` steps it has laid out (a model's windows, a RAW develop's
 * bands). `total` grows as the call reaches each stage that loops, so
 * `done / total` can step back; nothing of that kind counts `0 / 0`.
 */
export interface Progress {
  done: number
  total: number
}

/**
 * The engine's cancel flag and step counter for one call (0.21.0, E6,
 * E68), passed as `token`: read `progress` on a timer while the call runs
 * (nothing is pushed). A call's rejection with `Cancelled` comes once the
 * engine has stopped.
 */
export interface CancelToken {
  cancel(): void
  readonly cancelled: boolean
  readonly progress: Progress
}

/**
 * What `convert` takes beside the request (0.19.2 adds the GPU frame and the
 * held measurements; 0.21.0 the token and prepared mask planes).
 */
export interface ConvertOptions {
  signal?: AbortSignal
  /** 0.21.0: the caller's own token, for its `progress`; a `signal` given too cancels it. */
  token?: CancelToken
  gpu?: GpuSession
  frame?: GpuFrame
  held?: HeldMeasurements
  /**
   * 0.21.0 (E37): raster masks prepared for this render's frame. Refused by
   * `mask_planes[i]`: a plane no raster component of the request reads, two
   * of one source, resampler and size, one at another size, a changed file,
   * a closed plane.
   */
  maskPlanes?: PreparedRaster[]
}

export interface ConvertReport {
  /** 0.19.0: the float pass's way in and out, both inside `color_ms`. */
  ingest_ms?: number
  egress_ms?: number
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
  /** 0.21.0 (E38): under `inspect: { Beside }`, the mask's plane from the same render. */
  beside?: InspectPlane | null
  /**
   * Every check of the pixels between stages that ran (0.18). A failed one
   * is never here: it rejects with code `Invariant`.
   */
  checks: CheckReport[]
  /**
   * 0.19.2: a whole-frame render that ran Dehaze or Denoise returns their
   * measurements (null otherwise, and for a region). Only the host process
   * holds the handle; across IPC it arrives as its `fields`.
   */
  held?: HeldMeasurements | HeldRef | null
  /**
   * 0.19.2: what a `Pixels` encode's bytes are (`output`): the grade input a
   * GPU frame is uploaded from is described by it (Phase A §4.3).
   */
  pixels?: PixelsReport | null
}

/**
 * `report.beside` (0.21.0, E38): one grey channel, `width × height` samples,
 * no padding; 16-bit and F32 samples in the machine's byte order.
 */
export interface InspectPlane {
  inspected: string
  width: number
  height: number
  depth: Depth
  quantisations: number
  /** A Buffer from the binding. */
  data: Uint8Array
}

/** A `Pixels` output's layout (0.19.2). */
export interface PixelsReport {
  width: number
  height: number
  /** 3 RGB, 4 RGBA. */
  channels: number
  [k: string]: unknown
}

/**
 * Held measurements as main sees them: their `fields`, and the id the host
 * keeps the native handle under when it was asked to (`NativeRefs.keepHeld`).
 * No `id`: the host closed them.
 */
export interface HeldRef {
  fields: string[]
  id?: string
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
  /** Present when a learned demosaic ran (0.19.0): the model's file, where it ran, what it cost. */
  demosaic_model?: {
    model: string
    provider: ExecutionProvider
    /** The model passes made (0.21.0: only those under a region developed alone, E66). */
    tiles: number
    /** 0.21.0 (E66): the passes a develop of the whole frame makes. */
    frame_tiles?: number
    model_load_ms: number
    model_ms: number
    /**
     * 0.20: where the noise it was told came from (`measured, with the
     * floor`, `stated`; 0.21.0's roster: `measured from green, with the floor`).
     */
    noise_from?: string
    /**
     * 0.20: the noise read of each plane (`variance = k·x + σ²`). Under
     * 0.21.0's `MeasuredGreenFloor` on a Bayer frame, R and B carry `fit: null`.
     */
    noise_planes?: unknown
  } | null
  /** What decoded the file: `"LibRaw 0.22.2"` or `"PIXL DNG reader (DNG 1.7.1)"`. */
  decoder: string
  /** 0.21.0 (E21): present when a DCP's tables ran; which, their sizes and encodings. */
  profile_tables?: string | null
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
  /** 0.19.0: a RAW's colour filter (which learned demosaic fits); `null` for anything else. */
  raw_cfa?: RawCfa | null
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
  /**
   * 0.21.0 (OBS-1): a RAW's embedded previews, in the order `raw:
   * 'EmbeddedPreview'` tries them (the first `decodable` one is the frame it
   * makes, at the upright size stated); empty for any other format. Size a
   * preview thumbnail's `resize` from it, not from the sensor's size.
   */
  raw_previews?: RawPreview[]
}

/** How a RAW's embedded preview is stored. */
export type RawPreviewFormat = 'Jpeg' | 'Bitmap' | 'JpegXl' | 'Other'

/** One embedded preview of a RAW (0.21.0), read from the container without decoding a pixel. */
export interface RawPreview {
  format: RawPreviewFormat
  /** The upright frame `raw: 'EmbeddedPreview'` makes of it. */
  width: number
  height: number
  /** The EXIF orientation (1–8) the preview is turned by. */
  orientation: number
  /** Its stored length in the file. */
  bytes: number
  /** `raw: 'EmbeddedPreview'` accepts it before decoding. */
  decodable: boolean
  /** `decode_reduce` can read it: a camera format's JPEG preview, never a DNG's. */
  reducible: boolean
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
  /** 0.19.0: a 64-bit perceptual hash, 16 hex digits, when `phash` was asked. */
  phash?: string | null
  /** 0.19.0: per region, sharpness and direction, when `focus` was asked. */
  focus?: FocusReport | null
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
  /** 0.21.0 (E76): the grids asked for with `scopes`; `null` without. */
  scopes?: ScopeReport | null
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
    return t(
      'This RAW holds several frames (dual pixel, pixel shift or a burst), which Playroom cannot develop yet.'
    )
  if (op === 'raw decode')
    return typeof d?.['detail'] === 'string' && d['detail']
      ? t("This RAW format isn't supported ({{detail}}).", { detail: d['detail'] })
      : t("This RAW format isn't supported.")
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
    const size =
      px !== null
        ? tp('{{count}} megapixel', '{{count}} megapixels', Math.round(px / 1e6))
        : t('too large')
    return side !== null
      ? t('This picture is {{size}} ({{side}} px on its longest side), more than Playroom opens.', {
          size,
          side
        })
      : t('This picture is {{size}}, more than Playroom opens.', { size })
  }
  if (code === 'StaleCache')
    return t('A saved render was made by another engine and is made again.')
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
  /** 0.19.0: the classes summed into this plane (was `index`). */
  indices: number[]
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
  /**
   * 0.21.0 (OBS-6): the rectangle of the frame the model was shown (the
   * request's `region`, or the whole frame), frame pixels.
   */
  shown?: MaskBounds
  /** 0.21.0: the plane pixels that rectangle covers; every sample outside it is 0. */
  shown_in_plane?: MaskBounds
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
  /** 0.21.0 (OBS-4): how the load used its CoreML cache; `null` without one. */
  readonly coremlCache?: CoreMlCacheUse | null
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
  /** 0.21.0: the caller's own token, for its `progress`. */
  token?: CancelToken
  sessions?: ModelSession[]
}

/** Which build the loaded addon is (0.21.0, E69): two addons of one version differ by `commit`. */
export interface BuildInfo {
  engine: string
  binding: string
  /** The commit it was built from, or `'unknown'`. */
  commit: string
  /** Changes to tracked files when it was built; `null` when not known. */
  dirty: boolean | null
  /** `'release'` only for the release workflow's builds. */
  kind: 'release' | 'development'
  /** Cargo features compiled in: `'enhance'`, `'gpu'`, `'vendored'`. */
  features: string[]
}

// ── The binding ──────────────────────────────────────────────────────────────

/** The contract the Node binding fulfils. */
export interface PixlEngineModule {
  /** The version of the engine compiled into the loaded addon. */
  engineVersion(): string
  /** The binding's own version; equal to `engineVersion()`, or the load fails. */
  bindingVersion(): string
  /** 0.21.0 (E69): which build the addon is (its commit, release or development). */
  buildInfo?(): BuildInfo
  /** 0.21.0 (E6, E68): a call's cancel flag and step counter, passed as `token`. */
  CancelToken?: new () => CancelToken
  hasEnhance(): boolean
  probe(path: string): Promise<SourceInfo>
  convert(request: ConvertRequest, options?: ConvertOptions): Promise<ConvertReport>
  /** 0.19.2: the margin a region of this grade needs (HR-0.20-1). */
  regionReach?(request: ReachRequest, options?: { held?: HeldMeasurements }): ReachReport
  /** 0.19.2: whether this addon was built with the GPU grade path (macOS and Windows). */
  hasGpu?(): boolean
  openGpuSession?(spec: GpuSessionSpec): Promise<GpuSession>
  uploadGpuFrame?(gpu: GpuSession, spec: GpuFrameSpec, bytes: Uint8Array): Promise<GpuFrame>
  analyze(
    request: AnalyzeRequest,
    options?: { signal?: AbortSignal; token?: CancelToken }
  ): Promise<ImageStats>
  /** 0.21.0 (E65): a RAW mosaic's noise per plane, read as a learned demosaic reads it. */
  rawNoise?(
    request: RawNoiseRequest,
    options?: { signal?: AbortSignal; token?: CancelToken }
  ): Promise<RawNoiseReport>
  /** 0.21.0 (E21): a `.dcp`'s bytes as `CameraColour.Dcp` states it; refused by `bytes`. */
  readCameraProfile?(bytes: Uint8Array): DcpProfile
  /** 0.21.0 (E37): a raster mask's plane at one frame size, for `maskPlanes`. */
  prepareRaster?(request: PreparedRasterRequest): Promise<PreparedRaster>
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
  /** 0.19.0: every instance of a phrase on an embedding's frame (SAM 3). */
  segmentConcept?(
    request: Record<string, unknown>,
    options?: { embedding?: PromptEmbedding; signal?: AbortSignal }
  ): Promise<{
    instances: {
      png: Uint8Array
      score: number
      coverage: number
      rect: { x: number; y: number; width: number; height: number }
    }[]
    presence: number
  }>
  /** 0.19.0: faces (YuNet) and, with a landmarker, each one's outlines (Face Mesh v2). */
  faces(request: Record<string, unknown>, options?: ModelCallOptions): Promise<unknown>
  benchmark(
    request: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<Record<string, unknown>>
  /**
   * Load a model once, for the calls that name it in `sessions`. 0.21.0
   * (OBS-5): `signal` or `token` stops the load between its steps; ONNX
   * Runtime's build of the session (a CoreML compile) runs to its end first.
   */
  loadModelSession(
    model: ModelRef,
    options?: { signal?: AbortSignal; token?: CancelToken }
  ): Promise<ModelSession>
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
  /** Native objects the host keeps, by id, for this call's options (`NativeRefs`). */
  native?: NativeRefs
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
  /**
   * `F16`: half floats, linear Display P3 with 1.0 = SDR white (Full HDR,
   * engine 0.18); `U8` (or absent): 8-bit Display P3, as drafts always were.
   */
  sample?: 'U8' | 'F16'
  /** With an F16 frame: the same render's 8-bit SDR picture, RGBA, for what reads it. */
  companion?: { width: number; height: number; data: Uint8Array }
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
  /**
   * SAM 3 (or EfficientSAM3) on a phrase (engine 0.19's `segmentConcept`):
   * the image encoder makes the frame's embedding (kept as `key`, the one
   * most recent, so the next phrase on the same frame skips it) and is let
   * go before the text encoder loads; then every instance of `request`'s
   * phrase.
   */
  | {
      op: 'concept'
      key: string
      embed: PromptEmbeddingRequest
      request: Record<string, unknown>
    }

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
  | {
      op: 'concept'
      instances: {
        png: Uint8Array
        score: number
        coverage: number
        rect: { x: number; y: number; width: number; height: number }
      }[]
      presence: number
      /** The embedding came from before (the same frame, another phrase). */
      reused: boolean
      embedMs: number
      conceptMs: number
    }

/**
 * The native objects a `convert` (or `regionReach`) is given or returns,
 * named by main and kept in the host (Phase A §4.3–4.4): a GPU frame, the
 * held measurements, which can't cross IPC. The host resolves them into the
 * call's options.
 */
export interface NativeRefs {
  /** An uploaded frame (`GpuOp` `upload`): the call runs on the GPU session with it. */
  frame?: string
  /** Held measurements kept earlier under this id, passed as `held`. */
  held?: string
  /** Keep the report's held measurements under this id (else they are closed). */
  keepHeld?: string
  /** Drop the output's bytes in the host: a render made only for its measurements. */
  discardOutput?: boolean
  /**
   * An SDR render sent as an F16 frame (linear Display P3): the host makes
   * its 8-bit companion at this longest side (shared/sdrcompanion.ts), as
   * the engine does only for a Master.
   */
  sdrCompanion?: number
}

/**
 * The GPU drag path's calls (0.19.2, Phase A §4.3), whose objects (the
 * session, each photo's uploaded frame, held measurements) are native and
 * stay in the host: main names them by id, as SAM's.
 *
 * - `open`: the app's GPU session (once; kept while it is open).
 * - `upload`: `request` (the grade input: `gradeInputRequest`) rendered on
 *   the CPU and uploaded as frame `id`, replacing what `id` held. `only`
 *   closes every other frame first (the 8 GB M1: one open at a time).
 * - `release`: let go of frames, held measurements and (`session`) the
 *   GPU session.
 */
export type GpuOp =
  | { op: 'open'; spec: GpuSessionSpec }
  | { op: 'upload'; id: string; request: ConvertRequest; only: boolean }
  | { op: 'release'; frames?: string[]; held?: string[]; session?: boolean }

/** What a `gpu` call answers. */
export type GpuResult =
  | { op: 'open'; ms: number }
  | {
      op: 'upload'
      width: number
      height: number
      alpha: boolean
      renderMs: number
      uploadMs: number
    }
  | { op: 'release' }

export interface EngineGpuMessage {
  kind: 'gpu'
  id: number
  call: GpuOp
  cancellable?: boolean
}

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
  /** 0.19.2: the addon was built with the GPU grade path (`hasGpu`; macOS and Windows). */
  gpu?: boolean
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
  | EngineRequestMessage
  | EngineSamMessage
  | EngineGpuMessage
  | EngineCancelMessage
  | EnginePortMessage
