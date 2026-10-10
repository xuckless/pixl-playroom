/**
 * Export settings: what the export dialog holds and saves as a preset, and
 * the pure translation into the encoder, size and colour parts of a
 * `ConvertRequest`. The grade and framing come from `compile.ts`.
 */
import type {
  Chroma,
  ColorPolicy,
  ColorSpaceRef,
  Depth,
  Encode,
  GainMapEncode,
  GamutMap,
  MasterPolicy,
  HdrLimit,
  SdrRendition,
  MetadataPolicy,
  OutputSharpen,
  PngCompression,
  RenderingIntent,
  Resize,
  Sharpen,
  YCbCrMatrix,
  Subsampling,
  TiffCompression,
  ToneMapOperator
} from './engine-types'
import type { PhotoMeta } from './ipc'
import { DEFAULT_WATERMARK, type WatermarkSettings } from './watermark'
import { flatSubjects } from './keywords'

export type ExportFormat = 'jpeg' | 'png' | 'tiff' | 'webp' | 'avif' | 'jxl'

export const FORMAT_EXT: Record<ExportFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  tiff: 'tif',
  webp: 'webp',
  avif: 'avif',
  jxl: 'jxl'
}

export type ResizeMode =
  | 'none'
  | 'long'
  | 'short'
  | 'width'
  | 'height'
  /** Fit inside a width × height box, the picture's shape kept. */
  | 'box'
  | 'megapixels'
  | 'percent'

/** Output sharpening: after the resize, for where the picture will be seen. */
export interface OutputSharpenSetting {
  enabled: boolean
  media: 'screen' | 'matte' | 'glossy'
  amount: 'low' | 'standard' | 'high'
}

export interface ExportSettings {
  /** null exports beside each original. */
  folder: string | null
  subfolder: string
  /** Tokens: {name} {ext} {seq} {date} {rating} {copy}. */
  template: string
  collision: 'suffix' | 'overwrite' | 'skip'
  format: ExportFormat
  quality: number
  jpegSubsampling: Subsampling
  jxlDistance: number
  jxlEffort: number
  jxlLossless: boolean
  avifSpeed: number
  webpMethod: number
  webpLossless: boolean
  pngCompression: PngCompression
  tiffCompression: TiffCompression
  /** 8 or 16 for PNG, TIFF, JXL; 8, 10 or 12 for AVIF. */
  bitDepth: number
  chroma: Chroma
  lossless: boolean
  colorSpace: 'Srgb' | 'DisplayP3' | 'AdobeRgb' | 'Rec2020'
  intent: RenderingIntent
  blackPointCompensation: boolean
  /** `value` is the width in `box` mode, `valueH` its height; every other mode reads `value` alone. */
  resize: { mode: ResizeMode; value: number; valueH: number; enlarge: boolean }
  metadata: MetadataPolicy
  /** all: the photo's metadata plus its title, caption, keywords; copyrightOnly: only the copyright. */
  metaMode: 'all' | 'copyrightOnly'
  /** Strip GPS from what is written. */
  removeLocation: boolean
  /** Written when the photo has no copyright of its own ("" writes nothing). */
  copyright: string
  outputSharpen: OutputSharpenSetting
  dither: boolean
  hdr: {
    /**
     * sdr: an SDR file (HDR sources are tone mapped); keep: stay PQ/HLG;
     * expand: SDR → PQ/HLG; gainmap: an HDR source as an SDR picture with a
     * gain map (UltraHDR JPEG, AVIF), which HDR displays lift back.
     */
    mode: 'sdr' | 'keep' | 'expand' | 'gainmap'
    /** What happens above the HDR output's peak: a hard clip, or BT.2390's roll-off. */
    limit: 'clip' | 'rolloff'
    /** Where the roll-off starts, as a percentage of the highest knee BT.2390 allows. */
    knee: number
    /** The gain map image's own quality, 1…100. */
    gainMapQuality: number
    operator: ToneMapOperator
    /** For tone mapping: cd/m² the source's brightest content reaches, or null to read it from the file. */
    sourcePeak: number | null
    targetPeak: number
    gamut: GamutMap
    to: 'Rec2100Pq' | 'Rec2100Hlg'
    peak: number
    sdrWhite: number
    referenceWhite: number
    /**
     * PIXL's own tone mapping, gamut compression and gain map (engine 0.17's
     * `ColorPolicy::Master`) for an HDR photo's HDR and gain-map deliveries
     * and its Display P3 SDR file. Off: the classic path (see `masterPolicy`).
     */
    pixl: boolean
    /** The HDR output's ceiling in cd/m² (203…10 000); null holds it to the photo's own peak. */
    ceiling: number | null
  }
  /** A PNG composited onto every exported picture (see `watermark.ts`). */
  watermark: WatermarkSettings
  reveal: boolean
}

export function defaultExportSettings(): ExportSettings {
  return {
    folder: null,
    subfolder: '',
    template: '{name}-edit',
    collision: 'suffix',
    format: 'jpeg',
    quality: 90,
    jpegSubsampling: 'Quarter',
    jxlDistance: 1,
    jxlEffort: 7,
    jxlLossless: false,
    avifSpeed: 6,
    webpMethod: 4,
    webpLossless: false,
    pngCompression: 'Balanced',
    tiffCompression: 'Deflate',
    bitDepth: 8,
    chroma: 'Full',
    lossless: false,
    colorSpace: 'Srgb',
    intent: 'RelativeColorimetric',
    blackPointCompensation: true,
    resize: { mode: 'none', value: 2048, valueH: 2048, enlarge: false },
    metadata: { exif: true, icc: true, xmp: true, iptc: true },
    metaMode: 'all',
    removeLocation: false,
    copyright: '',
    outputSharpen: { enabled: false, media: 'screen', amount: 'standard' },
    dither: true,
    hdr: {
      mode: 'sdr',
      operator: 'Bt2390',
      sourcePeak: null,
      targetPeak: 203,
      gamut: 'Compress',
      to: 'Rec2100Pq',
      // SDR → HDR's defaults (the owner): an Apple XDR screen's sustained
      // peak, and a white bright enough to sit beside it.
      peak: 1600,
      sdrWhite: 350,
      referenceWhite: 203,
      limit: 'clip',
      knee: 100,
      gainMapQuality: 85,
      pixl: true,
      ceiling: null
    },
    watermark: { ...DEFAULT_WATERMARK },
    reveal: true
  }
}

/** Which bit depths the format writes. */
export function depthsFor(format: ExportFormat): number[] {
  switch (format) {
    case 'png':
    case 'tiff':
    case 'jxl':
      return [8, 16]
    case 'avif':
      return [8, 10, 12]
    default:
      return [8]
  }
}

/** Formats that carry a gain map beside an SDR picture. */
export function supportsGainMap(format: ExportFormat): boolean {
  return format === 'jpeg' || format === 'avif'
}

/**
 * Settings saved by an older build (or a preset), brought up to date: every
 * field there is, nested ones included.
 */
export function normaliseExportSettings(
  v: Partial<ExportSettings> | null | undefined
): ExportSettings {
  const d = defaultExportSettings()
  if (!v) return d
  return {
    ...d,
    ...v,
    // HEIC export left with engine 0.17 (no GPL x265): AVIF is its successor.
    format: (v.format as string) === 'heic' ? 'avif' : (v.format ?? d.format),
    resize: { ...d.resize, ...v.resize },
    metadata: { ...d.metadata, ...v.metadata },
    outputSharpen: { ...d.outputSharpen, ...v.outputSharpen },
    hdr: { ...d.hdr, ...v.hdr },
    watermark: { ...d.watermark, ...v.watermark }
  }
}

// ── HDR delivery ─────────────────────────────────────────────────────────────

const PQ = { m1: 0.1593017578125, m2: 78.84375, c1: 0.8359375, c2: 18.8515625, c3: 18.6875 }

/** Nits → the PQ signal (SMPTE ST 2084), 0…1. */
export function pq(nits: number): number {
  const y = Math.max(0, nits) / 10000
  const p = y ** PQ.m1
  return ((PQ.c1 + PQ.c2 * p) / (1 + PQ.c3 * p)) ** PQ.m2
}

/** The PQ signal → nits. */
export function pqNits(e: number): number {
  const p = Math.max(0, e) ** (1 / PQ.m2)
  return 10000 * (Math.max(0, p - PQ.c1) / (PQ.c2 - PQ.c3 * p)) ** (1 / PQ.m1)
}

/**
 * The highest knee BT.2390's roll-off takes for a peak and a source maximum
 * (above it the curve would overshoot): KS = 1.5 · maxLum − 0.5 of the
 * source range, in PQ.
 */
export function rolloffKneeMax(peak: number, sourceMax: number): number {
  const range = pq(sourceMax)
  const maxLum = pq(peak) / range
  return pqNits(Math.max(0, 1.5 * maxLum - 0.5) * range)
}

/** How far above the peak a roll-off reaches: two stops, room for an edit's highlights. */
const ROLLOFF_REACH = 4

/** The output's limit at `peak` cd/m²: a clip, or a roll-off from the knee the settings choose. */
export function hdrLimit(s: ExportSettings, peak: number): HdrLimit {
  if (s.hdr.limit !== 'rolloff') return 'Clip'
  const sourceMax = Math.min(10000, peak * ROLLOFF_REACH)
  if (!(sourceMax > peak)) return 'Clip'
  const max = rolloffKneeMax(peak, sourceMax)
  const knee = Math.floor(max * Math.min(1, Math.max(0.1, s.hdr.knee / 100)))
  return knee > 0
    ? { Rolloff: { knee_nits: knee, source_max_nits: Math.round(sourceMax) } }
    : 'Clip'
}

/** What `masterPolicy` needs to know of the source. */
export interface MasterSource {
  /** PQ or HLG. */
  isHdr: boolean
  /** The file carries a gain map (UltraHDR JPEG, an iPhone HEIC). */
  hasGainMap: boolean
  /** A gain-map photo edited on its SDR base (`recipe.gainMap === 'base'`): the engine would read the map. */
  editsBase: boolean
}

/** The ceiling's bounds the engine accepts, in cd/m². */
export const CEILING_MIN = 203
export const CEILING_MAX = 10000

/**
 * The engine's built-in colour path for this export, or null for the classic
 * one (`buildColor`). It applies to an HDR source's HDR deliveries (a gain
 * map in a JPEG or AVIF; PQ in JXL or PNG) and its SDR file when that is
 * Display P3, which is all `Master` writes for SDR. An SDR source being
 * expanded, a PQ AVIF and any other colour space stay classic: `Master`
 * refuses `hdr`, `sdr` and `gain_map`, reads a gain map itself, and has no
 * way to expand or to name a space. A gain-map photo edited on its SDR base
 * stays classic too, because the engine would apply the map under the edit.
 */
export function masterPolicy(s: ExportSettings, src: MasterSource): MasterPolicy | null {
  if (!s.hdr.pixl) return null
  if (!src.isHdr && !src.hasGainMap) return null
  if (src.hasGainMap && src.editsBase) return null
  let headroom: boolean
  if (s.hdr.mode === 'gainmap' && supportsGainMap(s.format)) headroom = true
  else if (s.hdr.mode === 'keep' && (s.format === 'jxl' || s.format === 'png')) headroom = true
  else if (s.hdr.mode === 'sdr' && s.colorSpace === 'DisplayP3') headroom = false
  else return null
  const ceiling =
    s.hdr.ceiling === null
      ? 'Peak'
      : { Nits: Math.min(CEILING_MAX, Math.max(CEILING_MIN, Math.round(s.hdr.ceiling))) }
  return {
    headroom,
    // The 99.9th percentile of the render; a region would state it (not used by an export).
    peak: 'Measured',
    ceiling: headroom ? ceiling : null,
    reach: 'Measured',
    // PIXL's look acts on a RAW developed in Scene; an HDR source here is never one.
    look: 'Colorimetric',
    // 0.17's bytes: a float sink gets linear PixlRGB, and no SDR companion.
    float: 'LinearPixlRgb',
    companion: null
  }
}

/** The SDR picture a gain-map export writes: the HDR master tone mapped as an SDR export would be. */
export function sdrRendition(s: ExportSettings, peak: number): SdrRendition {
  return {
    to: s.colorSpace as ColorSpaceRef,
    operator: s.hdr.operator,
    mode: 'PerChannel',
    source_peak_nits: peak,
    target_peak_nits: s.hdr.targetPeak,
    gamut: s.hdr.gamut,
    intent: s.intent,
    black_point_compensation: s.blackPointCompensation,
    grade: null
  }
}

/**
 * The gain map beside it: one channel at half size (the map is smooth), its
 * range the master's headroom over the SDR white — a little below 1 too, where
 * the tone map lifted a shadow — and reaching full strength on a display with
 * that much headroom.
 */
export function gainMapEncode(s: ExportSettings, peak: number): GainMapEncode {
  const stops = Math.max(0.5, Math.log2(peak / s.hdr.targetPeak))
  return {
    scale: 2,
    channels: 1,
    quality: Math.round(Math.min(100, Math.max(1, s.hdr.gainMapQuality))),
    gamma: 1,
    offset_sdr: 1 / 64,
    offset_hdr: 1 / 64,
    gain_min_log2: -0.5,
    gain_max_log2: Math.round(stops * 1000) / 1000,
    hdr_capacity_min: 0,
    hdr_capacity_max: Math.round(stops * 1000) / 1000
  }
}

/** An encoder with a gain map, for the formats that carry one. */
export function withGainMap(encode: Encode, map: GainMapEncode): Encode {
  if (typeof encode !== 'object') return encode
  if ('Jpeg' in encode) return { Jpeg: { ...encode.Jpeg, gain_map: map } }
  if ('Avif' in encode) return { Avif: { ...encode.Avif, gain_map: map } }
  return encode
}

export function supportsHdr(format: ExportFormat): boolean {
  return format === 'avif' || format === 'jxl' || format === 'png'
}

/**
 * How a HEIF-family file turns RGB into Y/Cb/Cr: none at all for a lossless
 * file (the one exact round trip), BT.2020's matrix for wide-gamut and HDR
 * output, and BT.601 otherwise — what libheif assumed before the engine made
 * it a choice, so an SDR export's pixels are unchanged.
 */
export function heifMatrix(s: ExportSettings, hdrOut: boolean): YCbCrMatrix {
  if (s.lossless) return 'Identity'
  if (hdrOut || s.colorSpace === 'Rec2020') return 'Bt2020Ncl'
  return 'Bt601'
}

/**
 * The encoder and the depth the engine must hand it. `hdrOut` when the file
 * will hold PQ/HLG: those need at least 10 bits (the engine refuses 8-bit PQ
 * out of a float pass, and it would band).
 */
export function buildEncode(
  s: ExportSettings,
  threads: number,
  hdrOut = false
): { encode: Encode; depth: Depth } {
  const deep = s.bitDepth > 8 || hdrOut
  const heifBits = hdrOut ? Math.max(10, s.bitDepth) : s.bitDepth
  switch (s.format) {
    case 'jpeg':
      return {
        encode: { Jpeg: { quality: s.quality, subsampling: s.jpegSubsampling, optimize: true } },
        depth: 'Eight'
      }
    case 'png':
      return {
        encode: { Png: { compression: s.pngCompression, filter: 'Adaptive' } },
        depth: deep ? 'Sixteen' : 'Eight'
      }
    case 'tiff':
      return {
        encode: { Tiff: { compression: s.tiffCompression } },
        depth: deep ? 'Sixteen' : 'Eight'
      }
    case 'webp':
      return {
        encode: { WebP: { quality: s.quality, lossless: s.webpLossless, method: s.webpMethod } },
        depth: 'Eight'
      }
    case 'avif':
      return {
        encode: {
          Avif: {
            quality: s.quality,
            lossless: s.lossless,
            bit_depth: heifBits,
            chroma: s.lossless ? 'Full' : s.chroma,
            // The aom plug-in never took 10 (engine 0.17 refuses it).
            speed: Math.min(9, Math.max(0, s.avifSpeed)),
            matrix: heifMatrix(s, hdrOut),
            // From 2 up the file is byte-identical at any count; 1 is another encode.
            threads: Math.min(64, Math.max(2, threads)),
            // 0.16.0's tuning, which libheif chose unasked; `Iq` needs aom 3.12.
            tune: 'Ssim',
            tiling: 'Single'
          }
        },
        depth: deep ? 'Sixteen' : 'Eight'
      }
    case 'jxl':
      return {
        encode: s.jxlLossless
          ? { JxlLossless: { effort: s.jxlEffort, threads } }
          : { JxlLossy: { distance: s.jxlDistance, effort: s.jxlEffort, threads } },
        depth: deep ? 'Sixteen' : 'Eight'
      }
  }
}

/** The longest side an export preview is rendered at: enough to judge colour and tone on one screen. */
export const PREVIEW_EDGE = 1600

/**
 * The settings an export preview renders with: what the picture will look
 * like through the same colour path and encoder, as the window can show it.
 * A format the window cannot show (JPEG XL, TIFF) is written as PNG, an HDR
 * output kept or expanded is shown as its SDR picture, and the metadata a
 * preview does not need (all but the profile, which the colour needs) is
 * left out. Everything that moves pixels stays as it is.
 */
export function previewSettings(s: ExportSettings): ExportSettings {
  const format: ExportFormat = s.format === 'jxl' || s.format === 'tiff' ? 'png' : s.format
  const hdr =
    s.hdr.mode === 'keep' || s.hdr.mode === 'expand' ? { ...s.hdr, mode: 'sdr' as const } : s.hdr
  return {
    ...s,
    format,
    bitDepth: 8,
    hdr,
    metaMode: 'all',
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    removeLocation: false,
    copyright: ''
  }
}

/** The size a preview is rendered at: the export's own when that is smaller than the preview edge. */
export function previewResize(
  s: ExportSettings,
  w: number,
  h: number,
  edge = PREVIEW_EDGE
): Resize {
  const full = buildResize(s, w, h)
  const out =
    full === 'None'
      ? { w, h }
      : 'Exact' in full
        ? { w: full.Exact.width, h: full.Exact.height }
        : { w, h }
  const long = Math.max(out.w, out.h)
  if (long <= edge) return full
  const k = edge / long
  return {
    Exact: { width: Math.max(1, Math.round(out.w * k)), height: Math.max(1, Math.round(out.h * k)) }
  }
}

/** The output size for a framed picture of `w × h`, or `None`. */
export function buildResize(s: ExportSettings, w: number, h: number): Resize {
  const { mode, value, valueH, enlarge } = s.resize
  if (mode === 'none' || !(value > 0) || (mode === 'box' && !(valueH > 0))) return 'None'
  let k: number
  switch (mode) {
    case 'box':
      k = Math.min(value / w, valueH / h)
      break
    case 'long':
      k = value / Math.max(w, h)
      break
    case 'short':
      k = value / Math.min(w, h)
      break
    case 'width':
      k = value / w
      break
    case 'height':
      k = value / h
      break
    case 'megapixels':
      k = Math.sqrt((value * 1e6) / (w * h))
      break
    case 'percent':
      k = value / 100
      break
  }
  if (!enlarge && k >= 1) return 'None'
  return {
    Exact: { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) }
  }
}

/**
 * An HDR output's peak is a display's (HR-0.18-8): 100–10 000 cd/m². Below
 * about 21.5 the engine holds HLG's system gamma at 0.5, so a stray value
 * (a file's clli, an old stored setting) would make a dark picture.
 */
export function displayPeak(nits: number): number {
  return Number.isFinite(nits) ? Math.min(10000, Math.max(100, nits)) : 1000
}

/**
 * The colour policy for an export, given whether the source is PQ/HLG and
 * the peak it states (null when it states none). A peak the user did not set
 * comes from the file when the file has one, else 1000 cd/m² — BT.2100's
 * nominal display, and the usual mastering peak.
 */
export function buildColor(
  s: ExportSettings,
  sourceIsHdr: boolean,
  statedPeak: number | null = null
): ColorPolicy {
  const to = s.colorSpace as ColorSpaceRef
  if (sourceIsHdr) {
    if (s.hdr.mode === 'keep') return 'Preserve'
    return {
      ToneMap: {
        to,
        operator: s.hdr.operator,
        mode: 'PerChannel',
        source_peak:
          s.hdr.sourcePeak !== null
            ? { Nits: s.hdr.sourcePeak }
            : statedPeak !== null
              ? 'FromFile'
              : { Nits: 1000 },
        target_peak_nits: s.hdr.targetPeak,
        gamut: s.hdr.gamut,
        intent: s.intent,
        black_point_compensation: s.blackPointCompensation
      }
    }
  }
  if (s.hdr.mode === 'expand' && supportsHdr(s.format)) {
    return {
      Expand: {
        to: s.hdr.to,
        operator: { Linear: { sdr_white_nits: s.hdr.sdrWhite } },
        peak_nits: displayPeak(s.hdr.peak),
        limit: hdrLimit(s, displayPeak(s.hdr.peak))
      }
    }
  }
  return {
    ConvertTo: { to, intent: s.intent, black_point_compensation: s.blackPointCompensation }
  }
}

/**
 * Output sharpening's radius in output pixels: a screen shows every pixel,
 * gloss keeps a print's edges, and matte paper softens them the most.
 */
const OUTPUT_RADIUS: Record<OutputSharpenSetting['media'], number> = {
  screen: 0.6,
  glossy: 1,
  matte: 1.3
}
const OUTPUT_AMOUNT: Record<OutputSharpenSetting['amount'], number> = {
  low: 0.45,
  standard: 0.75,
  high: 1.1
}

/**
 * The sharpening applied after the resize, in engine units (the recipe's
 * default RAW sharpening compiles to amount 0.8, radius 1), or null when
 * there is none: switched off, or an HDR delivery, whose values above SDR
 * white a display-referred sharpen would clip.
 */
export function outputSharpen(s: ExportSettings): Sharpen | null {
  const o = s.outputSharpen
  if (!o?.enabled || s.hdr.mode === 'keep' || s.hdr.mode === 'expand') return null
  const matte = o.media === 'matte'
  return {
    amount: Math.round(OUTPUT_AMOUNT[o.amount] * (matte ? 1.2 : 1) * 1e4) / 1e4,
    radius: OUTPUT_RADIUS[o.media],
    detail: matte ? 0.4 : 0.3,
    masking: 0
  }
}

/**
 * Output sharpening as the engine runs it: after the resize, in the export's
 * colour space as encoded, so it acts on the values the file will hold.
 */
export function outputSharpenRequest(s: ExportSettings, sharpen: Sharpen): OutputSharpen {
  return {
    space: {
      Encoded: {
        space: s.colorSpace,
        intent: s.intent,
        black_point_compensation: s.blackPointCompensation
      }
    },
    sharpen
  }
}

/** Expand a filename template (without extension). */
export function expandTemplate(
  template: string,
  t: { name: string; ext: string; seq: number; date: string; rating: number; copy: string }
): string {
  const out = template
    .replaceAll('{name}', t.name)
    .replaceAll('{ext}', t.ext)
    .replaceAll('{seq}', String(t.seq).padStart(4, '0'))
    .replaceAll('{date}', t.date)
    .replaceAll('{rating}', String(t.rating))
    .replaceAll('{copy}', t.copy)
  // Nothing that would leave the folder or trip a filesystem.
  return out.replace(/[\\/:*?"<>|]/g, '_').trim() || t.name
}

/**
 * What an export carries: the blocks the engine copies from the original,
 * then what ExifTool writes into the file after it.
 */
export interface MetadataPlan {
  /** Copied verbatim by the engine. */
  policy: MetadataPolicy
  /** Written afterwards, by group ("XMP-dc:Title"); empty writes nothing. */
  tags: Record<string, string | string[]>
  /** Delete GPS (EXIF and XMP) from the file. */
  removeLocation: boolean
}

/**
 * The metadata plan for one photo. `all` keeps the blocks the settings keep
 * and writes the photo's title, caption, keywords and copyright into those
 * same blocks (no XMP field lands in a file whose XMP was left out);
 * `copyrightOnly` keeps only the profile and writes the copyright alone, in
 * EXIF, XMP and IPTC. The copyright is the photo's own, or the dialog's when
 * it has none.
 */
export function metadataPlan(s: ExportSettings, meta: PhotoMeta | null): MetadataPlan {
  const all = s.metaMode !== 'copyrightOnly'
  const policy: MetadataPolicy = all
    ? { ...s.metadata }
    : { exif: false, icc: s.metadata.icc, xmp: false, iptc: false }
  // Where our fields may go: the blocks kept, or all three for the copyright.
  const into = all ? s.metadata : { exif: true, xmp: true, iptc: true }
  const text = (v: string | null | undefined): string | null => v?.trim() || null
  const copyright = text(meta?.copyright) ?? text(s.copyright)
  const title = all ? text(meta?.title) : null
  const caption = all ? text(meta?.caption) : null
  const keywords = all ? (meta?.keywords ?? []) : []

  const tags: Record<string, string | string[]> = {}
  if (into.exif) {
    if (copyright) tags['EXIF:Copyright'] = copyright
    if (caption) tags['EXIF:ImageDescription'] = caption
  }
  if (into.xmp) {
    if (copyright) tags['XMP-dc:Rights'] = copyright
    if (title) tags['XMP-dc:Title'] = title
    if (caption) tags['XMP-dc:Description'] = caption
    if (keywords.length > 0) {
      tags['XMP-dc:Subject'] = flatSubjects(keywords)
      tags['XMP-lr:HierarchicalSubject'] = keywords
    }
  }
  if (into.iptc) {
    const before = Object.keys(tags).length
    if (copyright) tags['IPTC:CopyrightNotice'] = copyright
    if (title) tags['IPTC:ObjectName'] = title
    if (caption) tags['IPTC:Caption-Abstract'] = caption
    if (keywords.length > 0) tags['IPTC:Keywords'] = flatSubjects(keywords)
    // IPTC's text is Latin-1 unless it says otherwise.
    if (Object.keys(tags).length > before) tags['IPTC:CodedCharacterSet'] = 'UTF8'
  }
  return {
    policy,
    tags,
    // GPS lives in EXIF and XMP: with neither kept there is none to remove.
    removeLocation: s.removeLocation && (policy.exif || policy.xmp)
  }
}
