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
  MetadataPolicy,
  PngCompression,
  RenderingIntent,
  Resize,
  Subsampling,
  TiffCompression,
  ToneMapOperator
} from './engine-types'

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
