/**
 * Proxies: every photo is decoded once into a 16-bit working copy at screen
 * size, upright, in its own colour, and every preview is graded from that.
 * A RAW is developed (the slow part) exactly once per file version. The
 * grade does not care: masks and every normalised size are fractions of the
 * frame, and pixel-sized knobs are scaled by `scale` in `compile.ts`.
 *
 * - `proxy`: long edge ≤ 2560, for settled previews and thumbnails of edits;
 * - `draft`: long edge ≤ 1280, made from the proxy, for renders while a
 *   slider is moving;
 * - `master`: full resolution, only for RAWs, only when a 1:1 view asks —
 *   the developed frame, so region renders never re-develop.
 *
 * HDR sources keep their PQ/HLG signal in a 16-bit PNG (which carries CICP);
 * everything else is an uncompressed 16-bit TIFF, the fastest to decode.
 */
import { readFile, readdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import type { InputFormat, SourceInfo } from '../shared/engine-types'
import type { EngineClient } from './engine/client'
import { exists } from './exists'
import type { PhotoRow } from './db'
import { paths } from './paths'
import { blankRequest, RAW_DEVELOP, sourceOrientation } from './source'

export const PROXY_EDGE = 2560
export const DRAFT_EDGE = 1280

export interface ProxyFile {
  path: string
  input: InputFormat
  width: number
  height: number
}

export interface Proxies {
  proxy: ProxyFile
  draft: ProxyFile
  /** The full-resolution base frame (upright, before the user's turns). */
  frameWidth: number
  frameHeight: number
}

const building = new Map<string, Promise<Proxies>>()

function stamp(photo: PhotoRow): string {
  return `${Math.round(photo.mtime)}-${photo.size}`
}

/** Make (or find) a photo's proxy and draft. Concurrent callers share one build. */
export function ensureProxies(
  engine: EngineClient,
  photo: PhotoRow,
  info: SourceInfo
): Promise<Proxies> {
  const key = `${photo.id}:${stamp(photo)}`
  let p = building.get(key)
  if (!p) {
    p = build(engine, photo, info).finally(() => building.delete(key))
    building.set(key, p)
  }
  return p
}

async function build(engine: EngineClient, photo: PhotoRow, info: SourceInfo): Promise<Proxies> {
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
    )
      return known
  }
  // An older version of the file: clear its working copies.
  for (const f of await readdir(dir)) {
    if (
      f.startsWith('proxies-') ||
      f.startsWith('proxy-') ||
      f.startsWith('draft-') ||
      f.startsWith('master-')
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
  const raw = info.input === 'Raw' ? RAW_DEVELOP : null
  const orientation = sourceOrientation(info, raw)
  const proxyPath = join(dir, `proxy-${s}.${ext}`)

  // The long edge of the frame is known from probe for everything but a RAW,
  // whose developed frame is a little smaller than its mosaic; either way the
  // report's frame size is the truth, and the scale here only has to be close.
  const long = Math.max(info.width, info.height)
  const factor = Math.min(1, PROXY_EDGE / long)
  const report = await engine.convert({
    ...blankRequest(photo.path, proxyPath, info.input),
    raw,
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
        : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null }
  })
  const proxy: ProxyFile = { path: proxyPath, input, width: report.width, height: report.height }

  const draftPath = join(dir, `draft-${s}.${ext}`)
  const dFactor = Math.min(1, DRAFT_EDGE / Math.max(proxy.width, proxy.height))
  const draftReport = await engine.convert({
    ...blankRequest(proxyPath, draftPath, input),
    resize: dFactor < 1 ? { Scale: { factor: dFactor } } : 'None',
    pixel: { depth: 'Sixteen', channels: null },
    encode,
    metadata: { exif: false, icc: true, xmp: false, iptc: false },
    color: 'Preserve'
  })
  const draft: ProxyFile = {
    path: draftPath,
    input,
    width: draftReport.width,
    height: draftReport.height
  }
  const out: Proxies = {
    proxy,
    draft,
    // An engine build that does not report the frame gets it from the proxy,
    // scaled back up: close enough for geometry, and never NaN.
    frameWidth: Number.isFinite(report.frame_width)
      ? report.frame_width
      : Math.round(report.width / factor),
    frameHeight: Number.isFinite(report.frame_height)
      ? report.frame_height
      : Math.round(report.height / factor)
  }
  await writeFile(meta, JSON.stringify(out))
  return out
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
        raw: RAW_DEVELOP,
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
