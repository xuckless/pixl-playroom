/**
 * How a photo enters the engine: which decoder, how a RAW is developed,
 * which way is up, and what an HDR source needs to be shown on an SDR
 * screen. Playroom's decisions, in one place, used by previews, thumbnails,
 * exports and enhancement alike.
 */
import type {
  ColorPolicy,
  ConvertRequest,
  Framing,
  GainMapMode,
  InputFormat,
  Orientation,
  RawMode,
  SourceInfo
} from '../shared/engine-types'
import { STRIP_ALL } from '../shared/engine-types'
import { fromExif } from '../shared/orientation'
import { hash32 } from '../shared/recipe'
import type { PhotoRow } from './db'
import { RAW_DEVELOP_REV } from '../shared/pixels'
import { execFileSync } from 'child_process'
import { cpus } from 'os'

export const RAW_EXTENSIONS = [
  'cr2',
  'cr3',
  'crw',
  'arw',
  'srf',
  'sr2',
  'nef',
  'nrw',
  'dng',
  'raf',
  'rw2',
  'orf',
  'pef',
  'srw',
  'mrw',
  '3fr',
  'iiq',
  'erf',
  'kdc',
  'x3f'
]
export const IMAGE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'heic',
  'heif',
  'avif',
  'jxl',
  'tif',
  'tiff',
  'webp',
  ...RAW_EXTENSIONS
]

export function isRawExt(ext: string): boolean {
  return RAW_EXTENSIONS.includes(ext.toLowerCase())
}

/**
 * A RAW is developed in linear light with the camera's own white balance and
 * colour matrix, cropped to the sensor's best area: the physically honest
 * start, and the right input to the grade's linear stage.
 */
export const RAW_DEVELOP: RawMode = {
  Develop: {
    scaling: true,
    demosaic: true,
    white_balance: true,
    calibrate: true,
    srgb_gamma: false,
    crop: 'Best',
    resolution: 'Full'
  }
}

/** The orientation to hand the engine for a source decoded this way. */
export function sourceOrientation(info: SourceInfo, raw: RawMode | null): Orientation {
  // A developed RAW (PIXL's develop or the scene-linear one) comes out
  // upright, with no Orientation tag in its EXIF; every other path carries
  // the tag.
  if (info.input === 'Raw' && raw !== null && raw !== 'EmbeddedPreview') return 'Normal'
  // A HEIF or AVIF is decoded (by libheif) with its own transforms — irot,
  // imir — applied, and the spec says the EXIF tag must then be ignored: an
  // iPhone writes both, so turning by the tag too lays a portrait on its side.
  if (info.input === 'Heif') return 'Normal'
  return fromExif(info.orientation)
}

/**
 * Framing that only turns a source upright, for a new file that keeps the
 * source's EXIF: null when nothing turns, except for a HEIF, whose EXIF tag
 * still says to turn pixels libheif has already turned — a stated framing
 * makes the engine reset that tag to 1.
 */
export function uprightFraming(
  orientation: Orientation,
  info: Pick<SourceInfo, 'input'>
): Framing | null {
  if (orientation === 'Normal' && info.input !== 'Heif') return null
  return { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null }
}

/** HEIF and AVIF files, whose working copies an older build laid on their side. */
const HEIF_EXT = /^(heic|heif|hif|avif)$/i

/**
 * What names a file version in the caches made from it: its time and size,
 * and a mark on HEIF/AVIF copies made since their orientation was fixed, so
 * the older (sideways) ones are made again, and on RAW developments made by
 * LibRaw and PIXL's own develop (engine 0.16), so rawler's are made again.
 */
export function versionStamp(
  photo: Pick<PhotoRow, 'mtime' | 'size' | 'ext'>,
  /** False for what no develop made (a RAW's embedded preview). */
  developed = true
): string {
  const mark = HEIF_EXT.test(photo.ext)
    ? '-u'
    : developed && isRawExt(photo.ext)
      ? `-${RAW_DEVELOP_REV}`
      : ''
  return `${Math.round(photo.mtime)}-${photo.size}${mark}`
}

/** The peak an HDR source is assumed to reach when it states none. */
export const ASSUMED_HDR_PEAK = 1000
/** Where SDR white sits when an HDR source is shown on an SDR screen (BT.2408). */
export const SDR_WHITE_NITS = 203

/** The colour policy that shows a source on an SDR display in `to`. */
export function displayPolicy(info: SourceInfo, to: 'DisplayP3' | 'Srgb'): ColorPolicy {
  if (info.is_hdr) {
    return {
      ToneMap: {
        to,
        operator: 'Bt2390',
        source_peak: { Nits: info.peak_nits ?? ASSUMED_HDR_PEAK },
        target_peak_nits: SDR_WHITE_NITS,
        gamut: 'Compress',
        intent: 'RelativeColorimetric',
        black_point_compensation: false
      }
    }
  }
  return { ConvertTo: { to, intent: 'RelativeColorimetric', black_point_compensation: false } }
}

/**
 * The cores interactive work can use without starving the UI: on Apple
 * silicon the performance cores (work split evenly across efficiency cores
 * waits on the slowest), elsewhere all but two, for the renderer and GPU
 * processes. Asked once, the first time it is wanted (not as the module
 * loads, on the launch's path).
 */
let interactive: number | undefined
export function interactiveThreads(): number {
  if (interactive !== undefined) return interactive
  interactive = Math.max(1, cpus().length - 2)
  if (process.platform === 'darwin') {
    try {
      const n = parseInt(execFileSync('sysctl', ['-n', 'hw.perflevel0.physicalcpu']).toString(), 10)
      if (n > 0) interactive = n
    } catch {
      // Intel Macs have no performance levels.
    }
  }
  return interactive
}

/** Threads for background work: a few, so the UI stays responsive. */
export const BACKGROUND_THREADS = Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))

/**
 * Which rendition of a gain-map file (an iPhone HEIC, an UltraHDR JPEG) to
 * read: the engine requires the choice exactly when the file carries one.
 * Playroom reads the SDR base.
 */
export function gainMapOf(
  info: Pick<SourceInfo, 'gain_map'> | null | undefined
): GainMapMode | null {
  return info?.gain_map ? 'Base' : null
}

/**
 * A request with every field stated and nothing done; callers spread over it.
 * `info` is the probe of `source` when it is the original file (a proxy or
 * master carries no gain map); it states the rendition a gain-map file needs.
 */
export function blankRequest(
  source: string,
  sink: string,
  input: InputFormat,
  info?: Pick<SourceInfo, 'gain_map'> | null
): ConvertRequest {
  return {
    source: { Path: source },
    sink: { Path: sink },
    input,
    resize: 'None',
    resampler: 'Lanczos3',
    pixel: { depth: null, channels: null },
    encode: { Png: { compression: 'Fast', filter: 'Sub' } },
    metadata: STRIP_ALL,
    color: 'Preserve',
    linear_resample: false,
    raw: null,
    upscaler: null,
    grade: null,
    dither: 'None',
    hdr: null,
    sdr: null,
    gain_map: gainMapOf(info),
    threads: interactiveThreads(),
    framing: null,
    region: null,
    inspect: null,
    overlays: null,
    enhance: null,
    lens: null,
    retouch: null,
    output_sharpen: null,
    measure: null
  }
}

/**
 * A photo's grain and dither seed: from where it was when its project was
 * made (`seed_path`), so its grain stays put when it moves, else its path.
 */
export function seedOf(row: Pick<PhotoRow, 'path' | 'seed_path'>): number {
  return hash32(row.seed_path ?? row.path)
}
