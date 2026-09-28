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
  GamutMap,
  Grade,
  MetadataPolicy,
  PngCompression,
  RenderingIntent,
  Resize,
  Sharpen,
  Subsampling,
  TiffCompression,
  ToneMapOperator
} from './engine-types'
import type { PhotoMeta } from './ipc'
import { flatSubjects } from './keywords'

export type ExportFormat = 'jpeg' | 'png' | 'tiff' | 'webp' | 'avif' | 'jxl' | 'heic'

export const FORMAT_EXT: Record<ExportFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  tiff: 'tif',
  webp: 'webp',
  avif: 'avif',
  jxl: 'jxl',
  heic: 'heic'
}

export type ResizeMode = 'none' | 'long' | 'short' | 'width' | 'height' | 'megapixels' | 'percent'

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
  /** 8 or 16 for PNG, TIFF, JXL; 8, 10 or 12 for AVIF and HEIC. */
  bitDepth: number
  chroma: Chroma
  lossless: boolean
  colorSpace: 'Srgb' | 'DisplayP3' | 'AdobeRgb' | 'Rec2020'
  intent: RenderingIntent
  blackPointCompensation: boolean
  resize: { mode: ResizeMode; value: number; enlarge: boolean }
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
    /** sdr: an SDR file (HDR sources are tone mapped); keep: stay PQ/HLG; expand: SDR → PQ/HLG. */
    mode: 'sdr' | 'keep' | 'expand'
    operator: ToneMapOperator
    /** For tone mapping: cd/m² the source's brightest content reaches, or null to read it from the file. */
    sourcePeak: number | null
    targetPeak: number
    gamut: GamutMap
    to: 'Rec2100Pq' | 'Rec2100Hlg'
    peak: number
    sdrWhite: number
    referenceWhite: number
  }
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
    resize: { mode: 'none', value: 2048, enlarge: false },
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
      peak: 1000,
      sdrWhite: 203,
      referenceWhite: 203
    },
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
    case 'heic':
      return [8, 10, 12]
    default:
      return [8]
  }
}

export function supportsHdr(format: ExportFormat): boolean {
  return format === 'avif' || format === 'heic' || format === 'jxl' || format === 'png'
}

/** The encoder and the depth the engine must hand it. */
export function buildEncode(s: ExportSettings, threads: number): { encode: Encode; depth: Depth } {
  const deep = s.bitDepth > 8
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
            bit_depth: s.bitDepth,
            chroma: s.lossless ? 'Full' : s.chroma,
            speed: s.avifSpeed
          }
        },
        depth: deep ? 'Sixteen' : 'Eight'
      }
    case 'heic':
      return {
        encode: {
          Heic: {
            quality: s.quality,
            lossless: s.lossless,
            bit_depth: s.bitDepth,
            chroma: s.lossless ? 'Full' : s.chroma
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

/** The output size for a framed picture of `w × h`, or `None`. */
export function buildResize(s: ExportSettings, w: number, h: number): Resize {
  const { mode, value, enlarge } = s.resize
  if (mode === 'none' || !(value > 0)) return 'None'
  let k: number
  switch (mode) {
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
        peak_nits: s.hdr.peak
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
 * The grade of output sharpening's own pass: the one op, in the export's
 * colour space as encoded, so it acts on the values the file will hold.
 */
export function outputSharpenGrade(s: ExportSettings, sharpen: Sharpen): Grade {
  return {
    layers: [
      {
        name: 'output-sharpen',
        enabled: true,
        opacity: 1,
        mask: null,
        blend: { mode: 'Normal', space: 'LinearWorking' },
        stages: [
          {
            space: {
              Encoded: {
                space: s.colorSpace,
                intent: s.intent,
                black_point_compensation: s.blackPointCompensation
              }
            },
            ops: [{ Sharpen: sharpen }]
          }
        ]
      }
    ]
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
