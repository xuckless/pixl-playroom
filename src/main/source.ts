/**
 * How a photo enters the engine: which decoder, how a RAW is developed,
 * which way is up, and what an HDR source needs to be shown on an SDR
 * screen. Playroom's decisions, in one place, used by previews, thumbnails,
 * exports and enhancement alike.
 */
import type {
  ColorPolicy,
  ConvertRequest,
  InputFormat,
  Orientation,
  RawMode,
  SourceInfo
} from '../shared/engine-types'
import { STRIP_ALL } from '../shared/engine-types'
import { fromExif } from '../shared/orientation'
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
    crop: 'Best'
  }
}

/** The orientation to hand the engine for a source decoded this way. */
export function sourceOrientation(info: SourceInfo, raw: RawMode | null): Orientation {
  // A developed RAW comes out upright; every other path carries the tag.
  if (info.input === 'Raw' && raw !== null && raw !== 'EmbeddedPreview') return 'Normal'
  return fromExif(info.orientation)
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
 * processes. Sync on purpose: asked once, as the module loads.
 */
function interactiveThreads(): number {
  if (process.platform === 'darwin') {
    try {
      const n = parseInt(execFileSync('sysctl', ['-n', 'hw.perflevel0.physicalcpu']).toString(), 10)
      if (n > 0) return n
    } catch {
      // Intel Macs have no performance levels.
    }
  }
  return Math.max(1, cpus().length - 2)
}

/** Threads for interactive work: the performance cores. */
export const INTERACTIVE_THREADS = interactiveThreads()
/** Threads for background work: a few, so the UI stays responsive. */
export const BACKGROUND_THREADS = Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))

/** A request with every field stated and nothing done; callers spread over it. */
export function blankRequest(source: string, sink: string, input: InputFormat): ConvertRequest {
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
    threads: INTERACTIVE_THREADS,
    framing: null,
    region: null,
    inspect: null
  }
}
