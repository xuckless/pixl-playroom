/**
 * Proxies: every photo is decoded once into a 16-bit working copy at screen
 * size, upright, in its own colour, and every preview is graded from that.
 * A RAW is developed (the slow part) exactly once per file version. The
 * grade does not care: masks and every normalised size are fractions of the
 * frame, and pixel-sized knobs are scaled by `scale` in `compile.ts`.
 *
 * - `proxy`: long edge ≤ 2560, for settled previews and thumbnails of edits;
 * - `mid`: long edge ≤ 1920, made from the proxy, for settled previews on a
 *   loupe it nearly fills (44% fewer pixels to grade than the proxy);
 * - `draft`: long edge ≤ 1280, made from the proxy, for renders while a
 *   slider is moving;
 * - `master`: full resolution, only for RAWs, only when a 1:1 view asks —
 *   the developed frame, so region renders never re-develop;
 * - `lens-…`: the proxy and draft with the lens correction and the spots
 *   (heal, clone, fill, eyes) applied, one set per combination. Both sit
 *   before the grade and change far less often than a slider does, so
 *   previews grade the prepared copy instead of warping and healing the
 *   proxy again on every render (Lightroom caches the same way).
 *
 * HDR sources keep their PQ/HLG signal in a 16-bit PNG (which carries CICP);
 * everything else is an uncompressed 16-bit TIFF, the fastest to decode.
 */
import log from 'electron-log/main'
import { mkdir, readFile, readdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  HdrWorking,
  InputFormat,
  LensCorrection,
  RawMode,
  Retouch,
  SourceInfo
} from '../shared/engine-types'
import { EngineError, type EngineClient } from './engine/client'
import { reduceRefused } from '../shared/engine-types'
import { proxyReduce, reducedSide, uprightSize } from '../shared/thumbsize'
import {
  keptMasterTags,
  PLAIN_DEVELOP,
  scenePlan,
  withScene,
  type RawDevelopAsk
} from './ai/rawdevelop'
import { DEV_KIT, noteDeveloped, providerName } from './devkit'
import { noiseKept } from './ai/noisebook'
import { exists } from './exists'
import type { PhotoRow } from './db'
import { paths } from './paths'
import { traceRegion } from './trace'
import {
  BACKGROUND_THREADS,
  binFactor,
  blankRequest,
  cellFactor,
  interactiveThreads,
  proxyByCell,
  colourOf,
  isLinearRaw,
  rawMaster,
  rawBinnedMaster,
  rawProxyMaster,
  sourceOrientation,
  versionStamp
} from './source'

export const PROXY_EDGE = 2560
export const MID_EDGE = 1920
export const DRAFT_EDGE = 1280

export interface ProxyFile {
  path: string
  input: InputFormat
  width: number
  height: number
  /**
   * F32 samples (a RAW's Scene master and what is made from it, engine 0.18):
   * what is made from this file is float too, or the headroom clips.
   */
  float?: boolean
}

/** The depth to write what is made from `from`: float stays float. */
function depthOf(from: Pick<ProxyFile, 'float'>): 'F32' | 'Sixteen' {
  return from.float ? 'F32' : 'Sixteen'
}

export interface Proxies {
  proxy: ProxyFile
  /** Between the two, when the proxy is larger than MID_EDGE (absent from sets made before it). */
  mid?: ProxyFile
  draft: ProxyFile
  /** The full-resolution base frame (upright, before the user's turns). */
  frameWidth: number
  frameHeight: number
  /**
   * A camera profile's tables as the develop ran them (engine 0.21, E21:
   * `RawReport.profile_tables`), for the info panel; absent when none ran.
   */
  profileTables?: string | null
}

const building = new Map<string, Promise<Proxies>>()

const stamp = versionStamp

/** Make (or find) a photo's proxy and draft. Concurrent callers share one build. */
export function ensureProxies(
  engine: EngineClient,
  photo: PhotoRow,
  info: SourceInfo,
  /** A photo being opened takes every core; work in the background takes its share. */
  threads: number = interactiveThreads()
): Promise<Proxies> {
  const key = `${photo.id}:${stamp(photo)}`
  let p = building.get(key)
  if (!p) {
    p = build(engine, photo, info, threads).finally(() => building.delete(key))
    building.set(key, p)
  }
  return p
}

const thumbing = new Map<string, Promise<Proxies>>()

/**
 * What a library thumbnail is graded from. A RAW not yet opened (or whose
 * proxies went with an update's new develop) needn't wait for its proxies:
 * a binned develop (engine 0.19) of about the draft's size is made instead,
 * one file standing for both, in a fraction of the time. Everything else,
 * and a RAW whose proxies are there, uses its proxies.
 */
export async function ensureThumbSource(
  engine: EngineClient,
  photo: PhotoRow,
  info: SourceInfo,
  threads: number
): Promise<Proxies> {
  const s = stamp(photo)
  const dir = paths.photoCachePath(photo.id)
  // A linear DNG has no photosites to bin (`isLinearRaw`): its proxies, then.
  if (
    info.input !== 'Raw' ||
    info.is_hdr ||
    isLinearRaw(info) ||
    (await exists(join(dir, `proxies-${s}.json`)))
  )
    return ensureProxies(engine, photo, info, threads)
  const cell = cellFactor(photo)
  const long = Math.max(info.width, info.height)
  const factor = binFactor(long, cell, DRAFT_EDGE)
  // No smaller than the proxy's own half size: the proxies, then.
  if (factor <= cell) return ensureProxies(engine, photo, info, threads)
  const key = `${photo.id}:${s}`
  let p = thumbing.get(key)
  if (!p) {
    p = (async (): Promise<Proxies> => {
      const path = join(dir, `thumbsrc-${s}.tiff`)
      const meta = `${path}.json`
      if ((await exists(path)) && (await exists(meta)))
        return JSON.parse(await readFile(meta, 'utf8')) as Proxies
      await mkdir(dir, { recursive: true })
      const raw = rawBinnedMaster(colourOf(photo), factor)
      const orientation = sourceOrientation(info, raw)
      const report = await engine.convert({
        ...blankRequest(photo.path, path, info.input, info),
        raw,
        pixel: { depth: 'F32', channels: 3 },
        encode: { Tiff: { compression: 'None' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: 'Preserve',
        framing:
          orientation === 'Normal'
            ? null
            : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
        threads
      })
      const file: ProxyFile = {
        path,
        input: 'Tiff',
        width: report.width,
        height: report.height,
        float: true
      }
      const out: Proxies = {
        proxy: file,
        draft: file,
        // The bins' frame times their width: the full develop's, to a pixel or two.
        frameWidth: report.frame_width * factor,
        frameHeight: report.frame_height * factor
      }
      await writeFile(meta, JSON.stringify(out))
      return out
    })().finally(() => thumbing.delete(key))
    thumbing.set(key, p)
  }
  return p
}

async function build(
  engine: EngineClient,
  photo: PhotoRow,
  info: SourceInfo,
  threads: number
): Promise<Proxies> {
  const dir = paths.photoCache(photo.id)
  const s = stamp(photo)
  const meta = join(dir, `proxies-${s}.json`)
  if (await exists(meta)) {
    const known = JSON.parse(await readFile(meta, 'utf8')) as Proxies
    if (
      (await exists(known.proxy.path)) &&
      (await exists(known.draft.path)) &&
      Number.isFinite(known.frameWidth) &&
      Number.isFinite(known.frameHeight)
    ) {
      // A set made before the middle size: it gains one, once.
      if (known.mid || Math.max(known.proxy.width, known.proxy.height) <= MID_EDGE) return known
      const mid = await shrink(engine, known.proxy, join(dir, `mid-${s}`), MID_EDGE, threads)
      const out = { ...known, mid }
      await writeFile(meta, JSON.stringify(out))
      return out
    }
  }
  // An older version of the file: clear its working copies.
  for (const f of await readdir(dir)) {
    if (
      f.startsWith('proxies-') ||
      f.startsWith('proxy-') ||
      f.startsWith('draft-') ||
      f.startsWith('mid-') ||
      f.startsWith('master-') ||
      f.startsWith('thumbsrc-') ||
      f.startsWith('lens-')
    ) {
      try {
        await unlink(join(dir, f))
      } catch {
        // in use on Windows; it will be replaced next time
      }
    }
  }

  const hdr = info.is_hdr
  const ext = hdr ? 'png' : 'tiff'
  const input: InputFormat = hdr ? 'Png' : 'Tiff'
  const encode = hdr
    ? ({ Png: { compression: 'Fast', filter: 'Sub' } } as const)
    : ({ Tiff: { compression: 'None' } } as const)
  // The camera colour the photo was recorded with (shared/rawcolour.ts): part of the stamp.
  const colour = colourOf(photo)
  const linear = isLinearRaw(info)
  const raw = info.input === 'Raw' ? rawMaster(colour, undefined, linear) : null
  // A RAW's master is Scene in float (engine 0.18): so are its proxies.
  const float = raw !== null
  const orientation = sourceOrientation(info, raw)
  const proxyPath = join(dir, `proxy-${s}.${ext}`)

  // The long edge of the frame is known from probe for everything but a RAW,
  // whose developed frame is a little smaller than its mosaic; either way the
  // report's frame size is the truth, and the scale here only has to be close.
  const long = Math.max(info.width, info.height)
  // A large camera JPEG decodes at half size (engine 0.21's `decode_reduce`,
  // the owner's choice: only at twice the proxy's edge), Lanczos the rest.
  let reduce = raw ? null : proxyReduce(info, PROXY_EDGE)
  const develop = (mode: RawMode | null, across: number): ReturnType<EngineClient['convert']> => {
    const factor = Math.min(1, PROXY_EDGE / reducedSide(across, reduce))
    return engine.convert({
      ...blankRequest(photo.path, proxyPath, info.input, info),
      raw: mode,
      decode_reduce: reduce,
      resize: factor < 1 ? { Scale: { factor } } : 'None',
      resampler: 'Lanczos3',
      // Averaging in linear light keeps a downscale's tones honest; an HDR
      // signal is resized as it is (its float path would need HDR numbers).
      linear_resample: !hdr && factor < 1,
      pixel: { depth: float ? 'F32' : 'Sixteen', channels: 3 },
      encode,
      metadata: { exif: false, icc: true, xmp: false, iptc: false },
      color: 'Preserve',
      framing:
        orientation === 'Normal'
          ? null
          : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
      threads
    })
  }
  // A RAW whose cells are more than the proxy needs develops at half size
  // (`rawProxyMaster`): the full frame's size is the cells' times their
  // width, to within a pixel or two of the full develop's crop, which only
  // the full-size master is cut by (its own size is used there).
  const cell = raw ? cellFactor(photo) : 1
  let byCell = raw !== null && !linear && proxyByCell(long, cell, PROXY_EDGE)
  let report = byCell
    ? await develop(rawProxyMaster(colour), long / cell).catch(() => null)
    : await develop(raw, long).catch((err) => {
        // A JPEG the scaled decode cannot read (a lossless one): whole, then.
        if (!reduce || !(err instanceof EngineError) || !reduceRefused(err.code, err.detail))
          throw err
        reduce = null
        return develop(raw, long)
      })
  // A sensor the cells were not as expected on (or a develop that refused
  // them): the full develop, as before.
  if (
    byCell &&
    (!report || Math.round(long / Math.max(report.frame_width, report.frame_height)) !== cell)
  ) {
    byCell = false
    report = await develop(raw, long)
  }
  if (!report) throw new Error('the proxy was not made')
  const proxy: ProxyFile = {
    path: proxyPath,
    input,
    width: report.width,
    height: report.height,
    ...(float ? { float } : {})
  }
  const scaleUp = byCell ? cell : 1
  // A reduced decode's report states the reduced frame (`⌈w / 2⌉`, a pixel
  // off): the frame is the probe's, upright.
  const frame = reduce
    ? uprightSize(info, orientation)
    : { width: report.frame_width * scaleUp, height: report.frame_height * scaleUp }

  const draftPath = join(dir, `draft-${s}.${ext}`)
  const dFactor = Math.min(1, DRAFT_EDGE / Math.max(proxy.width, proxy.height))
  const draftReport = await engine.convert({
    ...blankRequest(proxyPath, draftPath, input),
    resize: dFactor < 1 ? { Scale: { factor: dFactor } } : 'None',
    pixel: { depth: depthOf(proxy), channels: null },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    threads
  })
  const draft: ProxyFile = {
    path: draftPath,
    input,
    width: draftReport.width,
    height: draftReport.height,
    ...(float ? { float } : {})
  }
  const mid =
    Math.max(proxy.width, proxy.height) > MID_EDGE
      ? await shrink(engine, proxy, join(dir, `mid-${s}`), MID_EDGE, threads)
      : undefined
  const out: Proxies = {
    proxy,
    ...(mid ? { mid } : {}),
    draft,
    // The develop's frame (its cells' times their width when it was a half
    // size one): what masks and every normalised size are fractions of.
    frameWidth: frame.width,
    frameHeight: frame.height,
    ...(report.raw?.profile_tables ? { profileTables: report.raw.profile_tables } : {})
  }
  await writeFile(meta, JSON.stringify(out))
  return out
}

/** `from` made smaller, to a long edge of `edge` (or `factor` of it), in its own format. */
async function shrink(
  engine: EngineClient,
  from: ProxyFile,
  stem: string,
  edge: number,
  threads: number,
  factor = Math.min(1, edge / Math.max(from.width, from.height))
): Promise<ProxyFile> {
  const png = from.input === 'Png'
  const path = `${stem}.${png ? 'png' : 'tiff'}`
  const report = await engine.convert({
    ...blankRequest(from.path, path, from.input),
    resize: factor < 1 ? { Scale: { factor } } : 'None',
    pixel: { depth: depthOf(from), channels: null },
    encode: png
      ? { Png: { compression: 'Fast', filter: 'Sub' } }
      : { Tiff: { compression: 'None' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    threads
  })
  return {
    path,
    input: from.input,
    width: report.width,
    height: report.height,
    ...(from.float ? { float: true } : {})
  }
}

const lensing = new Map<string, Promise<Proxies>>()

/**
 * A photo's proxies with a lens correction applied, made once per correction
 * (`key` names it) and kept beside the plain ones; only the newest set is
 * kept on disk. The frame is the corrected one — the same shape, a little
 * smaller when the warp crops its empty edges — so every normalised
 * coordinate still means the same place.
 */
export function ensureLensedProxies(
  engine: EngineClient,
  photo: PhotoRow,
  px: Proxies,
  lens: LensCorrection | null,
  retouch: Retouch | null,
  key: string,
  hdr: HdrWorking | null
): Promise<Proxies> {
  const id = `${photo.id}:${stamp(photo)}:${key}`
  let p = lensing.get(id)
  if (!p) {
    p = bakeLens(engine, photo, px, lens, retouch, key, hdr).finally(() => lensing.delete(id))
    lensing.set(id, p)
  }
  return p
}

/**
 * A frame with a lens correction and the spots laid on it (`retouch`,
 * placed on the base frame, which is what every proxy is), at its own size:
 * a lensed set's proxy, or the screen-sized level (render.ts).
 */
export async function lensOn(
  engine: EngineClient,
  from: ProxyFile,
  out: string,
  lens: LensCorrection | null,
  retouch: Retouch | null,
  hdr: HdrWorking | null
): Promise<ProxyFile> {
  const report = await engine.convert({
    ...blankRequest(from.path, out, from.input),
    pixel: { depth: depthOf(from), channels: 3 },
    encode:
      from.input === 'Png'
        ? ({ Png: { compression: 'Fast', filter: 'Sub' } } as const)
        : ({ Tiff: { compression: 'None' } } as const),
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    lens,
    retouch,
    // A PQ/HLG proxy is corrected in the HDR working space it is graded in.
    hdr,
    // Baked behind the editing: its share of the cores, not all of them.
    threads: BACKGROUND_THREADS
  })
  return {
    path: out,
    input: from.input,
    width: report.width,
    height: report.height,
    ...(from.float ? { float: true } : {})
  }
}

/**
 * A frame resized to exactly `width` × `height` (a float one averaged as
 * light): the developed proxies, and the screen-sized level (render.ts).
 */
export async function cutTo(
  engine: EngineClient,
  from: ProxyFile,
  out: string,
  width: number,
  height: number,
  threads = BACKGROUND_THREADS
): Promise<ProxyFile> {
  const report = await engine.convert({
    ...blankRequest(from.path, out, from.input),
    resize: { Exact: { width, height } },
    resampler: 'Lanczos3',
    linear_resample: true,
    pixel: { depth: depthOf(from), channels: 3 },
    encode: { Tiff: { compression: 'None' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    threads
  })
  return {
    path: out,
    input: 'Tiff',
    width: report.width,
    height: report.height,
    ...(from.float ? { float: true } : {})
  }
}

async function bakeLens(
  engine: EngineClient,
  photo: PhotoRow,
  px: Proxies,
  lens: LensCorrection | null,
  retouch: Retouch | null,
  key: string,
  hdr: HdrWorking | null
): Promise<Proxies> {
  const dir = paths.photoCache(photo.id)
  const prefix = `lens-${stamp(photo)}-${key}`
  const meta = join(dir, `${prefix}.json`)
  if (await exists(meta)) {
    const known = JSON.parse(await readFile(meta, 'utf8')) as Proxies
    if ((await exists(known.proxy.path)) && (await exists(known.draft.path))) return known
  }
  const ext = px.proxy.input === 'Png' ? 'png' : 'tiff'
  const encode =
    px.proxy.input === 'Png'
      ? ({ Png: { compression: 'Fast', filter: 'Sub' } } as const)
      : ({ Tiff: { compression: 'None' } } as const)
  const proxyPath = join(dir, `${prefix}-proxy.${ext}`)
  const proxy = await lensOn(engine, px.proxy, proxyPath, lens, retouch, hdr)
  const draftPath = join(dir, `${prefix}-draft.${ext}`)
  const dFactor = Math.min(1, px.draft.width / px.proxy.width)
  const draftReport = await engine.convert({
    ...blankRequest(proxyPath, draftPath, px.proxy.input),
    resize: dFactor < 1 ? { Scale: { factor: dFactor } } : 'None',
    pixel: { depth: depthOf(proxy), channels: null },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    threads: BACKGROUND_THREADS
  })
  const k = proxy.width / px.proxy.width
  const mid = px.mid
    ? await shrink(
        engine,
        proxy,
        join(dir, `${prefix}-mid`),
        MID_EDGE,
        BACKGROUND_THREADS,
        px.mid.width / px.proxy.width
      )
    : undefined
  const out: Proxies = {
    proxy,
    ...(mid ? { mid } : {}),
    draft: {
      path: draftPath,
      input: px.proxy.input,
      width: draftReport.width,
      height: draftReport.height
    },
    frameWidth: Math.round(px.frameWidth * k),
    frameHeight: Math.round(px.frameHeight * k)
  }
  await writeFile(meta, JSON.stringify(out))
  return out
}

/**
 * Drop a photo's lens-corrected sets but each of its items' current one —
 * when an item closes (`itemKey`, its set now `keepKey`, none when empty), so
 * no render still reads them. Virtual copies share the photo's cache: one
 * closing keeps the sets the others were left on.
 */
export async function pruneLensed(
  photo: PhotoRow,
  itemKey: string,
  keepKey: string,
  /** Kept too: the set before (a quick undo back to it finds it made). */
  alsoKeep?: string
): Promise<void> {
  const dir = paths.photoCache(photo.id)
  const file = join(dir, 'keep-lensed.json')
  let kept: Record<string, string> = {}
  try {
    const parsed: unknown = JSON.parse(await readFile(file, 'utf8'))
    if (parsed && typeof parsed === 'object') kept = parsed as Record<string, string>
  } catch {
    // None yet, or unreadable: only this item's set is known.
  }
  if (keepKey) kept[itemKey] = keepKey
  else delete kept[itemKey]
  await writeFile(file, JSON.stringify(kept)).catch(() => undefined)
  const keep = [...Object.values(kept), ...(alsoKeep ? [alsoKeep] : [])].map(
    (k) => `lens-${stamp(photo)}-${k}`
  )
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const isKept = (k: string): boolean => f.startsWith(`${k}.`) || f.startsWith(`${k}-`)
    if (f.startsWith('lens-') && !keep.some(isKept)) await unlink(join(dir, f)).catch(() => {})
  }
}

const mastering = new Map<string, Promise<ProxyFile>>()

/**
 * Masters another develop stood in for, this run, by the plan's key: used
 * again rather than refused and developed again at every 1:1 view (the
 * 0.20.0 audit's B4). One refused for its frame's noise (E64) is tried
 * again once a measurement it could be stated from has been kept.
 */
const stoodIn = new Map<string, { out: ProxyFile; photoOnly: boolean; kept: number }>()

const developed = new Map<string, Promise<Proxies>>()

/**
 * A RAW's proxies cut from its full-size master instead of the half-size
 * develop (the PIXL demosaic, demosaic and denoise in one: the half-size
 * develop the plain proxies come from has neither). The same sizes and frame
 * as the plain ones, which they stand in for, so the zoomed-out picture is
 * what the 1:1 view and the export are. Named by the master's develop (`tag`).
 */
export function ensureDevelopedProxies(
  engine: EngineClient,
  photo: PhotoRow,
  plain: Proxies,
  master: ProxyFile,
  tag: string,
  threads = BACKGROUND_THREADS
): Promise<Proxies> {
  const s = stamp(photo)
  const key = `${photo.id}:${s}:${tag}`
  let p = developed.get(key)
  if (!p) {
    p = (async (): Promise<Proxies> => {
      const dir = paths.photoCache(photo.id)
      const meta = join(dir, `proxies-${s}-${tag}.json`)
      if (await exists(meta)) {
        const known = JSON.parse(await readFile(meta, 'utf8')) as Proxies
        if ((await exists(known.proxy.path)) && (await exists(known.draft.path))) return known
      }
      // The master is scene-linear float: averaged as light.
      const cut = (from: ProxyFile, like: ProxyFile, name: string): Promise<ProxyFile> =>
        cutTo(engine, from, join(dir, `${name}-${s}-${tag}.tiff`), like.width, like.height, threads)
      const proxy = await cut(master, plain.proxy, 'proxy')
      const mid = plain.mid ? await cut(proxy, plain.mid, 'mid') : undefined
      const draft = await cut(proxy, plain.draft, 'draft')
      const out: Proxies = {
        proxy,
        ...(mid ? { mid } : {}),
        draft,
        frameWidth: plain.frameWidth,
        frameHeight: plain.frameHeight
      }
      await writeFile(meta, JSON.stringify(out))
      return out
    })().finally(() => developed.delete(key))
    developed.set(key, p)
  }
  return p
}

/**
 * The proxies a photo is seen from: a RAW's cut from its PIXL demosaic
 * master once one is made (the develop view adopts them), else the plain
 * ones. The models that find masks read these, so a mask is found on the
 * picture it is drawn over.
 */
export async function viewProxies(
  engine: EngineClient,
  photo: PhotoRow,
  info: SourceInfo,
  ask: RawDevelopAsk,
  threads = BACKGROUND_THREADS
): Promise<Proxies> {
  const plain = await ensureProxies(engine, photo, info, threads)
  if (info.input !== 'Raw' || isLinearRaw(info)) return plain
  const plan = await scenePlan(info.raw_cfa, ask)
  if (plan.demosaic !== 'pixl' || !(await masterCached(photo, info, ask))) return plain
  const master = await ensureMaster(engine, photo, info, ask)
  return ensureDevelopedProxies(engine, photo, plain, master, plan.tag, threads)
}

/** A RAW's full-size develop starting or ending, for the window's progress (`MasterEvent`). */
export interface MasterWork {
  photoId: number
  phase: 'start' | 'end'
  /** How long it is expected to take: what the last one of its kind took for its size here. */
  expectedMs: number
}

let masterWork: ((e: MasterWork) => void) | null = null
/** Masters being developed for each photo: over when the last one is. */
const developing = new Map<number, number>()

function masterStarted(photoId: number, expectedMs: number): void {
  developing.set(photoId, (developing.get(photoId) ?? 0) + 1)
  masterWork?.({ photoId, phase: 'start', expectedMs })
}

function masterEnded(photoId: number): void {
  const left = (developing.get(photoId) ?? 1) - 1
  if (left > 0) return void developing.set(photoId, left)
  developing.delete(photoId)
  masterWork?.({ photoId, phase: 'end', expectedMs: 0 })
}

/** Who is told when a master is developed (the open photo's session, which tells the window). */
export function onMasterWork(listener: (e: MasterWork) => void): void {
  masterWork = listener
}

/** What a develop took for each megapixel, by its tag: the last one's, this run. */
const masterRate = new Map<string, number>()
/** Before the first: about what an M2 Pro takes (the PIXL demosaic, DemosaicNet, AHD, the classic). */
function firstRate(demosaic: string): number {
  return demosaic === 'pixl' ? 350 : demosaic === 'model' ? 240 : demosaic === 'ahd' ? 135 : 50
}

/**
 * Whether a RAW's full-size master for this develop is made already (its
 * file and its record there): what the 1:1 view asks before it decides to
 * show a quick master first.
 */
export async function masterCached(
  photo: PhotoRow,
  info: Pick<SourceInfo, 'raw_cfa'>,
  ask: RawDevelopAsk = PLAIN_DEVELOP
): Promise<boolean> {
  const plan = await scenePlan(info.raw_cfa, ask)
  const path = join(paths.photoCachePath(photo.id), `master-${stamp(photo)}-${plan.tag}.tiff`)
  return (await exists(path)) && (await exists(`${path}.json`))
}

/**
 * The quick master for a first 1:1 look (the engine's viewing guide,
 * 2026-10-09): the same Scene develop with the classic demosaic (PPG on a
 * Bayer sensor, about 1.2 s for 24 MP on an M2 Pro, against DemosaicNet's
 * 5 s), shown while the plan's master is made; cached apart as `-ppg`, and
 * gone when the plan's master is made (its clean-up takes it). It never
 * removes another master itself: the plan's may be being written beside it.
 */
export function ensureQuickMaster(engine: EngineClient, photo: PhotoRow): Promise<ProxyFile> {
  const s = stamp(photo)
  const key = `${photo.id}:${s}:quick`
  let p = mastering.get(key)
  if (!p) {
    p = (async (): Promise<ProxyFile> => {
      const dir = paths.photoCache(photo.id)
      const path = join(dir, `master-${s}-ppg.tiff`)
      const meta = `${path}.json`
      if ((await exists(path)) && (await exists(meta)))
        return JSON.parse(await readFile(meta, 'utf8')) as ProxyFile
      const t0 = Date.now()
      const report = await engine.convert({
        ...blankRequest(photo.path, path, 'Raw'),
        raw: rawMaster(colourOf(photo), { demosaic: 'Classic', mosaic_denoise: null }),
        pixel: { depth: 'F32', channels: 3 },
        encode: { Tiff: { compression: 'None' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: 'Preserve'
      })
      traceRegion({
        step: 'quick master',
        photoId: photo.id,
        ms: Date.now() - t0,
        width: report.width,
        height: report.height
      })
      const out: ProxyFile = {
        path,
        input: 'Tiff',
        width: report.width,
        height: report.height,
        float: true
      }
      await writeFile(meta, JSON.stringify(out))
      return out
    })().finally(() => mastering.delete(key))
    mastering.set(key, p)
  }
  return p
}

/**
 * A RAW's full-resolution developed frame, for region renders, the noise
 * read and the pixel steps. Other formats decode fast enough to read the
 * original each time. Its demosaic is the best there is now (DemosaicNet once
 * downloaded, else AHD) and PMRID goes first when the edit asks
 * (`ai/rawdevelop.ts`); each names the file, so a model downloaded later
 * makes it again, and the one it replaces goes. With a development kit
 * (`devkit.ts`) the PIXL demosaic's master and DemosaicNet's stay side by
 * side, and each develop says what ran.
 */
export async function ensureMaster(
  engine: EngineClient,
  photo: PhotoRow,
  info: Pick<SourceInfo, 'raw_cfa' | 'input' | 'dng'> &
    Partial<Pick<SourceInfo, 'width' | 'height'>>,
  ask: RawDevelopAsk = PLAIN_DEVELOP
): Promise<ProxyFile> {
  const plan = await scenePlan(info.raw_cfa, ask)
  const s = stamp(photo)
  const key = `${photo.id}:${s}:${plan.tag}`
  const stood = stoodIn.get(key)
  if (stood && (!stood.photoOnly || stood.kept === noiseKept()) && (await exists(stood.out.path)))
    return stood.out
  let p = mastering.get(key)
  if (!p) {
    // Said over only once the master's record is written: what hears it finds the master made.
    let said = false
    p = (async (): Promise<ProxyFile> => {
      // F32 (engine 0.18: a RAW's master is Scene in float): twice a 16-bit
      // TIFF's size, nothing clipped at 1.0.
      const dir = paths.photoCache(photo.id)
      const name = `master-${s}-${plan.tag}`
      const path = join(dir, `${name}.tiff`)
      const meta = `${path}.json`
      if ((await exists(path)) && (await exists(meta))) {
        const kept = JSON.parse(await readFile(meta, 'utf8')) as ProxyFile
        traceRegion({
          step: 'master',
          photoId: photo.id,
          tag: plan.tag,
          cached: true,
          path,
          width: kept.width,
          height: kept.height
        })
        return kept
      }
      const t0 = Date.now()
      let request: unknown = null
      // The engine says nothing while it develops: the window shows how far by the clock.
      const megapixels = ((info.width ?? 0) * (info.height ?? 0)) / 1e6 || 24
      masterStarted(photo.id, (masterRate.get(plan.tag) ?? firstRate(plan.demosaic)) * megapixels)
      said = true
      const {
        value: report,
        classic,
        ran,
        refused,
        statedFrom,
        photoOnly,
        declined
      } = await withScene(
        plan,
        (scene) => {
          const req = {
            ...blankRequest(photo.path, path, 'Raw'),
            raw: rawMaster(colourOf(photo), scene, isLinearRaw(info)),
            pixel: { depth: 'F32', channels: 3 } as const,
            encode: { Tiff: { compression: 'None' } } as const,
            metadata: { exif: false, icc: true, xmp: false, iptc: false },
            color: 'Preserve' as const
          }
          request = req
          return engine.convert(req)
        },
        undefined,
        { camera: photo.camera, iso: photo.iso }
      )
      const ms = Date.now() - t0
      if (!classic) masterRate.set(plan.tag, ms / megapixels)
      log.info(
        'RAW master developed',
        plan.tag,
        classic ? `(${ran} stood in)` : '',
        statedFrom ? `(noise stated from ${statedFrom})` : '',
        ms,
        'ms'
      )
      // What stood in, for the user (and a development kit's trial: what ran, where and how long).
      noteDeveloped(photo.id, {
        planned: plan.tag,
        ran,
        provider: providerName(report.raw?.demosaic_model?.provider),
        ms,
        refused,
        declined
      })
      traceRegion({
        step: 'master',
        photoId: photo.id,
        tag: plan.tag,
        cached: false,
        classic,
        ran,
        // A stand-in is kept for this run only (`stoodIn`).
        keptForNextTime: !classic,
        ms,
        request,
        report: {
          width: report.width,
          height: report.height,
          input_bytes: report.input_bytes,
          output_bytes: report.output_bytes,
          decode_ms: report.decode_ms,
          color_ms: report.color_ms,
          encode_ms: report.encode_ms,
          raw: report.raw
        }
      })
      const out: ProxyFile = {
        path,
        input: 'Tiff',
        width: report.width,
        height: report.height,
        float: true
      }
      // Kept only when it is the plan's, with what developed it (the engine's
      // `report.raw.demosaic_model`: a later develop can be compared with it).
      // A stand-in is kept for this run only.
      const model = report.raw?.demosaic_model
      if (!classic)
        await writeFile(
          meta,
          JSON.stringify({
            ...out,
            developed: {
              tag: plan.tag,
              model: model?.model ?? null,
              provider: providerName(model?.provider),
              noise_from: model?.noise_from ?? null,
              ms,
              ...(statedFrom ? { stated_from: statedFrom } : {})
            }
          })
        )
      else stoodIn.set(key, { out, photoOnly: photoOnly === true, kept: noiseKept() })
      // Masters of another demosaic (the model since downloaded, or removed)
      // and the untagged ones from before: off the disk. With and without
      // PMRID are both kept, for edits that differ; with a development kit,
      // the PIXL demosaic's and DemosaicNet's too (its switch flips between them).
      const kept = keptMasterTags(plan.tag, DEV_KIT !== null).map((tag) => `master-${s}-${tag}.`)
      for (const f of await readdir(dir).catch(() => [] as string[]))
        if (f.startsWith('master-') && !kept.some((k) => f.startsWith(k)))
          await unlink(join(dir, f)).catch(() => undefined)
      return out
    })().finally(() => {
      mastering.delete(key)
      if (said) masterEnded(photo.id)
    })
    mastering.set(key, p)
  }
  return p
}
