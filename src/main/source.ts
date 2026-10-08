/**
 * How a photo enters the engine: which decoder, how a RAW is developed,
 * which way is up, and what an HDR source needs to be shown on an SDR
 * screen. Playroom's decisions, in one place, used by previews, thumbnails,
 * exports and enhancement alike.
 */
import type {
  DngOpcodes,
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
import { READ_LIMITS } from '../shared/limits'
import { hash32 } from '../shared/recipe'
import type { PhotoRow } from './db'
import { cameraColourOf, developMark, parseRawColour, type RawColour } from '../shared/rawcolour'
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

/** Both DNG opcode lists applied: what Adobe's readers do, and Playroom's choice (engine 0.17). */
export const DNG_OPCODES: DngOpcodes = { list1: 'Apply', list2: 'Apply' }

/**
 * A RAW is developed in linear light with the camera's own white balance and
 * colour (`colour`: the file's own, or PIXL's fit for the body; see
 * `shared/rawcolour.ts`), cropped to the sensor's best area: the physically
 * honest start, and the right input to the grade's linear stage.
 */
export function rawDevelop(colour: RawColour): RawMode {
  return {
    Develop: {
      scaling: true,
      demosaic: true,
      white_balance: true,
      calibrate: true,
      srgb_gamma: false,
      crop: 'Best',
      resolution: 'Full',
      colour: cameraColourOf(colour),
      dng_opcodes: DNG_OPCODES
    }
  }
}

/**
 * A RAW developed at half size (engine 0.16, `resolution: 'Cell'`): one
 * pixel per cell of the colour filter array, each colour the mean of its
 * photosites, no demosaic. A quarter of a Bayer sensor's pixels (a ninth of
 * an X-Trans one's): for a proxy, which is smaller still, the same picture
 * for much less time and memory (a 102 MP file: 3.4 s and 0.5 GB where the
 * full develop takes 4.9 s and 1.5 GB). Never for what is seen at 1:1 or
 * exported.
 */
export function rawProxyDevelop(colour: RawColour): RawMode {
  const full = rawDevelop(colour) as { Develop: Record<string, unknown> }
  return { Develop: { ...full.Develop, resolution: 'Cell' } } as RawMode
}

/**
 * A RAW's master since engine 0.18 (its rule for a host: a RAW's master is
 * `Scene` in float): PIXL's scene-linear develop, F32 linear PixlRGB,
 * unclamped, the as-shot white, clipped channels rebuilt from the opposite
 * ones (`InpaintOpposed`). Nothing clips at 1.0: up to about 1.65 stops over
 * white on the owner's CR2s, which the 1:1 view, the export and (with Full
 * HDR) the preview keep; an SDR picture rolls it onto white (compile's RAW
 * shoulder). Denoise stays in the grade (`DENOISE_REACH` there, HR-0.18-4).
 */
export function rawMaster(colour: RawColour): RawMode {
  return {
    Scene: {
      white_balance: 'AsShot',
      highlights: 'InpaintOpposed',
      crop: 'Best',
      denoise: null,
      // Engine 0.19's mosaic denoiser and demosaic: as 0.18 until Pass 108.
      mosaic_denoise: null,
      demosaic: 'Classic',
      resolution: 'Full',
      colour: cameraColourOf(colour),
      dng_opcodes: DNG_OPCODES
    }
  }
}

/** The master at half size (`Cell`: one pixel per CFA cell, no demosaic), for a proxy. */
export function rawProxyMaster(colour: RawColour): RawMode {
  const full = rawMaster(colour) as { Scene: Record<string, unknown> }
  return { Scene: { ...full.Scene, resolution: 'Cell' } } as RawMode
}

/** The file's own colour: what a RAW was developed with before engine 0.17 named one. */
export const RAW_DEVELOP: RawMode = rawDevelop('container')
export const RAW_PROXY_DEVELOP: RawMode = rawProxyDevelop('container')

/** A photo's camera colour as recorded; the file's own until it is (shared/rawcolour.ts). */
export const colourOf = (photo: { raw_colour?: string | null }): RawColour =>
  parseRawColour(photo.raw_colour) ?? 'container'

/**
 * How many photosites across a RAW's colour filter array cell is: 3 for
 * Fujifilm's X-Trans, 2 for a Bayer sensor (Fujifilm's GFX are Bayer).
 */
export function cellFactor(photo: Pick<PhotoRow, 'ext' | 'camera'>): 2 | 3 {
  return photo.ext.toLowerCase() === 'raf' && !/gfx/i.test(photo.camera ?? '') ? 3 : 2
}

/**
 * Whether a RAW's proxy can come from a half-size develop: when even its
 * cells are more than the proxy needs (a little margin for the crop).
 */
export function proxyByCell(probeLong: number, cell: number, proxyEdge: number): boolean {
  return proxyEdge * cell * 1.02 <= probeLong
}

/** The orientation to hand the engine for a source decoded this way. */
export function sourceOrientation(info: SourceInfo, raw: RawMode | null): Orientation {
  // A RAW comes out upright, whatever the mode: a develop (PIXL's or the
  // scene-linear one) with no Orientation tag in its EXIF, and since 0.16 the
  // embedded preview too (LibRaw turns it). Its `orientation` is the camera's,
  // for information; stated as framing it would turn the frame again.
  if (info.input === 'Raw' && raw !== null) return 'Normal'
  // A HEIF or AVIF is decoded (by libheif) with its own transforms — irot,
  // imir — applied, and the spec says the EXIF tag must then be ignored: an
  // iPhone writes both, so turning by the tag too lays a portrait on its side.
  // 0.16.1 reports 1 for such a file; a tag no irot backs is ignored as well.
  if (info.input === 'Heif') return 'Normal'
  return fromExif(info.orientation)
}

/**
 * Framing that only turns a source upright, for a new file that keeps the
 * source's EXIF: null when nothing turns, except for a HEIF, whose EXIF tag
 * is never applied — a stated framing makes the engine reset that tag to 1.
 * (0.16.1 resets it by itself when libheif applied irot/imir; the framing
 * still covers a tag no irot backs.)
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
 * LibRaw and PIXL's own develop (engine 0.16), so rawler's are made again;
 * and, for a RAW, the camera colour it was developed with (`developMark`).
 */
export function versionStamp(
  photo: Pick<PhotoRow, 'mtime' | 'size' | 'ext'> & { raw_colour?: string | null },
  /** False for what no develop made (a RAW's embedded preview). */
  developed = true
): string {
  const mark = HEIF_EXT.test(photo.ext)
    ? '-u'
    : developed && isRawExt(photo.ext)
      ? `-${developMark(colourOf(photo))}`
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
        mode: 'PerChannel',
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
 * Threads for a heavy job (a model session, Enhance, an export): twice the
 * background share, but on Apple silicon never more than the performance
 * cores. Engine 0.18 measured a session fastest at 4 threads on the M2 Pro's
 * 6 P-cores, and 12 threads 3.5× slower: work handed to the efficiency cores
 * waits on them.
 */
export function heavyThreads(): number {
  const n = BACKGROUND_THREADS * 2
  return process.platform === 'darwin' ? Math.min(n, interactiveThreads()) : n
}

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
    limits: READ_LIMITS,
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
