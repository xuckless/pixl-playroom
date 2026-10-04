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
import { readFile, readdir, unlink, writeFile } from 'fs/promises'
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
import { exists } from './exists'
import type { PhotoRow } from './db'
import { paths } from './paths'
import {
  BACKGROUND_THREADS,
  blankRequest,
  cellFactor,
  interactiveThreads,
  proxyByCell,
  colourOf,
  rawDevelop,
  rawProxyDevelop,
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
  const raw = info.input === 'Raw' ? rawDevelop(colour) : null
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
      pixel: { depth: 'Sixteen', channels: 3 },
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
  // (`rawProxyDevelop`): the full frame's size is the cells' times their
  // width, to within a pixel or two of the full develop's crop, which only
  // the full-size master is cut by (its own size is used there).
  const cell = raw ? cellFactor(photo) : 1
  let byCell = raw !== null && proxyByCell(long, cell, PROXY_EDGE)
  let report = byCell
    ? await develop(rawProxyDevelop(colour), long / cell).catch(() => null)
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
  const proxy: ProxyFile = { path: proxyPath, input, width: report.width, height: report.height }
  const scaleUp = byCell ? cell : 1

  const draftPath = join(dir, `draft-${s}.${ext}`)
  const dFactor = Math.min(1, DRAFT_EDGE / Math.max(proxy.width, proxy.height))
  const draftReport = await engine.convert({
    ...blankRequest(proxyPath, draftPath, input),
    resize: dFactor < 1 ? { Scale: { factor: dFactor } } : 'None',
    pixel: { depth: 'Sixteen', channels: null },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    threads
  })
  const draft: ProxyFile = {
    path: draftPath,
    input,
    width: draftReport.width,
    height: draftReport.height
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
    pixel: { depth: 'Sixteen', channels: null },
    encode: png
      ? { Png: { compression: 'Fast', filter: 'Sub' } }
      : { Tiff: { compression: 'None' } },
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve',
    threads
  })
  return { path, input: from.input, width: report.width, height: report.height }
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
    pixel: { depth: 'Sixteen', channels: 3 },
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
    height: report.height
  }
  const draftPath = join(dir, `${prefix}-draft.${ext}`)
  const dFactor = Math.min(1, px.draft.width / px.proxy.width)
  const draftReport = await engine.convert({
    ...blankRequest(proxyPath, draftPath, px.proxy.input),
    resize: dFactor < 1 ? { Scale: { factor: dFactor } } : 'None',
    pixel: { depth: 'Sixteen', channels: null },
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
 * A RAW's full-resolution developed frame, for region renders. Other formats
 * decode fast enough to read the original each time.
 */
export function ensureMaster(engine: EngineClient, photo: PhotoRow): Promise<ProxyFile> {
  const key = `${photo.id}:${stamp(photo)}`
  let p = mastering.get(key)
  if (!p) {
    p = (async (): Promise<ProxyFile> => {
      const path = join(paths.photoCache(photo.id), `master-${stamp(photo)}.tiff`)
      const meta = `${path}.json`
      if ((await exists(path)) && (await exists(meta)))
        return JSON.parse(await readFile(meta, 'utf8')) as ProxyFile
      const report = await engine.convert({
        ...blankRequest(photo.path, path, 'Raw'),
        raw: rawDevelop(colourOf(photo)),
        pixel: { depth: 'Sixteen', channels: 3 },
        encode: { Tiff: { compression: 'None' } },
        metadata: { exif: false, icc: true, xmp: false, iptc: false },
        color: 'Preserve'
      })
      const out: ProxyFile = { path, input: 'Tiff', width: report.width, height: report.height }
      await writeFile(meta, JSON.stringify(out))
      return out
    })().finally(() => mastering.delete(key))
    mastering.set(key, p)
  }
  return p
}
