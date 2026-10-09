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
import type { EngineClient } from './engine/client'
import { PLAIN_DEVELOP, scenePlan, withScene, type RawDevelopAsk } from './ai/rawdevelop'
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
  if (info.input !== 'Raw' || info.is_hdr || (await exists(join(dir, `proxies-${s}.json`))))
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
  const raw = info.input === 'Raw' ? rawMaster(colour) : null
  // A RAW's master is Scene in float (engine 0.18): so are its proxies.
  const float = raw !== null
  const orientation = sourceOrientation(info, raw)
  const proxyPath = join(dir, `proxy-${s}.${ext}`)

  // The long edge of the frame is known from probe for everything but a RAW,
  // whose developed frame is a little smaller than its mosaic; either way the
  // report's frame size is the truth, and the scale here only has to be close.
  const long = Math.max(info.width, info.height)
  const develop = (mode: RawMode | null, across: number): ReturnType<EngineClient['convert']> => {
    const factor = Math.min(1, PROXY_EDGE / across)
    return engine.convert({
      ...blankRequest(photo.path, proxyPath, info.input, info),
      raw: mode,
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
  let byCell = raw !== null && proxyByCell(long, cell, PROXY_EDGE)
  let report = byCell
    ? await develop(rawProxyMaster(colour), long / cell).catch(() => null)
    : await develop(raw, long)
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
    frameWidth: report.frame_width * scaleUp,
    frameHeight: report.frame_height * scaleUp
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
  const report = await engine.convert({
    ...blankRequest(px.proxy.path, proxyPath, px.proxy.input),
    pixel: { depth: depthOf(px.proxy), channels: 3 },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    lens,
    // Placed on the base frame, which is what the proxy is.
    retouch,
    // A PQ/HLG proxy is corrected in the HDR working space it is graded in.
    hdr,
    // Baked behind the editing: its share of the cores, not all of them.
    threads: BACKGROUND_THREADS
  })
  const proxy: ProxyFile = {
    path: proxyPath,
    input: px.proxy.input,
    width: report.width,
    height: report.height,
    ...(px.proxy.float ? { float: true } : {})
  }
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
  const k = report.width / px.proxy.width
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
 * A RAW's full-resolution developed frame, for region renders, the noise
 * read and the pixel steps. Other formats decode fast enough to read the
 * original each time. Its demosaic is the best there is now (DemosaicNet once
 * downloaded, else AHD) and PMRID goes first when the edit asks
 * (`ai/rawdevelop.ts`); each names the file, so a model downloaded later
 * makes it again, and the one it replaces goes.
 */
export async function ensureMaster(
  engine: EngineClient,
  photo: PhotoRow,
  info: Pick<SourceInfo, 'raw_cfa'>,
  ask: RawDevelopAsk = PLAIN_DEVELOP
): Promise<ProxyFile> {
  const plan = await scenePlan(info.raw_cfa, ask)
  const s = stamp(photo)
  const key = `${photo.id}:${s}:${plan.tag}`
  let p = mastering.get(key)
  if (!p) {
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
      const { value: report, classic } = await withScene(plan, (scene) => {
        const req = {
          ...blankRequest(photo.path, path, 'Raw'),
          raw: rawMaster(colourOf(photo), scene),
          pixel: { depth: 'F32', channels: 3 } as const,
          encode: { Tiff: { compression: 'None' } } as const,
          metadata: { exif: false, icc: true, xmp: false, iptc: false },
          color: 'Preserve' as const
        }
        request = req
        return engine.convert(req)
      })
      log.info('RAW master developed', plan.tag, classic ? '(classic)' : '', Date.now() - t0, 'ms')
      traceRegion({
        step: 'master',
        photoId: photo.id,
        tag: plan.tag,
        cached: false,
        classic,
        // Not kept when classic stood in: the next 1:1 develops it again.
        keptForNextTime: !classic,
        ms: Date.now() - t0,
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
      // Kept only when it is the plan's: a classic stand-in is made again next time.
      if (!classic) await writeFile(meta, JSON.stringify(out))
      // Masters of another demosaic (the model since downloaded, or removed)
      // and the untagged ones from before: off the disk. With and without
      // PMRID are both kept, for edits that differ.
      const same = `master-${s}-${plan.tag.replace(/-pm$/, '')}`
      for (const f of await readdir(dir).catch(() => [] as string[]))
        if (f.startsWith('master-') && !f.startsWith(`${same}.`) && !f.startsWith(`${same}-pm.`))
          await unlink(join(dir, f)).catch(() => undefined)
      return out
    })().finally(() => mastering.delete(key))
    mastering.set(key, p)
  }
  return p
}
