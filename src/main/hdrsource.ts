/**
 * A gain-map photo edited as HDR (recipe `gainMap: 'hdr'`): the map applied
 * once, at full resolution and the photo's full headroom, into a PQ master
 * (a 16-bit PNG, which carries CICP), with its proxy and draft. From then on
 * the photo is simply a PQ source — the develop view, the 1:1 region, the
 * thumbnails and the export read the master and grade it as they grade any
 * HDR file — so nothing downstream has to carry `gain_map: Apply` and the
 * working white it needs.
 *
 * The rendition is the one the file states for a display with all the
 * headroom it asks for (`alternate_headroom_stops`); 1.0 is the base's white,
 * which stands for BT.2408's 203 cd/m², so the master peaks at 203 · 2^H.
 *
 * Kept per file version under `cache/photos/<id>/hdr-<stamp>/`.
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import type { GainMapMode, HdrWorking, SourceInfo } from '../shared/engine-types'
import type { Recipe } from '../shared/recipe'
import type { PhotoRow } from './db'
import type { EngineClient } from './engine/client'
import { exists } from './exists'
import { paths } from './paths'
import { DRAFT_EDGE, PROXY_EDGE, type Proxies, type ProxyFile } from './proxy'
import { BACKGROUND_THREADS, blankRequest, sourceOrientation, versionStamp } from './source'

/** What the base's white stands for in the HDR rendition (BT.2408's graphics white). */
export const GAIN_MAP_WHITE_NITS = 203

/** The headroom a map is applied at when the file states none (an older Apple map). */
const FALLBACK_HEADROOM = 3

/** The display headroom, in stops, the photo's full HDR rendition needs. */
export function appliedHeadroom(info: SourceInfo): number {
  const h = info.gain_map?.alternate_headroom_stops
  return h !== null && h !== undefined && h > 0 ? Math.min(h, 5.6) : FALLBACK_HEADROOM
}

/** The master's peak in cd/m²: the base's white lifted by the headroom, within PQ's 10 000. */
export function appliedPeak(info: SourceInfo): number {
  return Math.min(10000, Math.round(GAIN_MAP_WHITE_NITS * 2 ** appliedHeadroom(info)))
}

/** Whether a photo is edited on its gain map's HDR rendition. */
export function editsHdr(recipe: Pick<Recipe, 'gainMap'>, info: SourceInfo): boolean {
  return recipe.gainMap === 'hdr' && !!info.gain_map
}

export interface HdrSource {
  /** The rendition at full resolution, upright: a PQ PNG. */
  master: ProxyFile
  px: Proxies
  /** What the master is: a PQ source at `appliedPeak`, no gain map. */
  info: SourceInfo
}

const stamp = versionStamp

const building = new Map<string, Promise<HdrSource>>()

/** Make (or find) a gain-map photo's HDR master and proxies. Concurrent callers share one build. */
export function ensureHdrSource(
  engine: EngineClient,
  photo: PhotoRow,
  info: SourceInfo
): Promise<HdrSource> {
  const key = `${photo.id}:${stamp(photo)}`
  let p = building.get(key)
  if (!p) {
    p = build(engine, photo, info).finally(() => building.delete(key))
    building.set(key, p)
  }
  return p
}

const png = { Png: { compression: 'Fast', filter: 'Sub' } } as const
const keepProfile = { exif: false, icc: true, xmp: false, iptc: false } as const

async function build(engine: EngineClient, photo: PhotoRow, info: SourceInfo): Promise<HdrSource> {
  const root = paths.photoCache(photo.id)
  const name = `hdr-${stamp(photo)}`
  const dir = join(root, name)
  const meta = join(dir, 'set.json')
  if (await exists(meta)) {
    const known = JSON.parse(await readFile(meta, 'utf8')) as HdrSource
    const files = [known.master.path, known.px.proxy.path, known.px.draft.path]
    if ((await Promise.all(files.map(exists))).every(Boolean)) return known
  }
  // Older versions of the file: their masters go.
  for (const d of await readdir(root).catch(() => [] as string[]))
    if (d.startsWith('hdr-') && d !== name)
      await rm(join(root, d), { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  const peak = appliedPeak(info)
  const hdr: HdrWorking = {
    reference_white_nits: GAIN_MAP_WHITE_NITS,
    peak_nits: peak,
    limit: 'Clip'
  }
  const apply: GainMapMode = {
    Apply: { headroom_stops: appliedHeadroom(info), signal: 'Rec2100Pq' }
  }
  const orientation = sourceOrientation(info, null)
  const masterPath = join(dir, 'master.png')
  const m = await engine.convert({
    ...blankRequest(photo.path, masterPath, info.input),
    gain_map: apply,
    hdr,
    pixel: { depth: 'Sixteen', channels: 3 },
    encode: png,
    metadata: keepProfile,
    // Preserve writes the applied rendition as the signal it was read as.
    color: 'Preserve',
    framing:
      orientation === 'Normal'
        ? null
        : { orientation, rotate_degrees: 0, rotate_resampler: 'Lanczos3', crop: null },
    threads: BACKGROUND_THREADS * 2
  })
  const master: ProxyFile = { path: masterPath, input: 'Png', width: m.width, height: m.height }

  // The proxies as ensureProxies makes an HDR source's: the signal resized as it is.
  const smaller = async (from: ProxyFile, edge: number, file: string): Promise<ProxyFile> => {
    const k = Math.min(1, edge / Math.max(from.width, from.height))
    const path = join(dir, file)
    const r = await engine.convert({
      ...blankRequest(from.path, path, 'Png'),
      resize: k < 1 ? { Scale: { factor: k } } : 'None',
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: png,
      metadata: keepProfile,
      color: 'Preserve',
      threads: BACKGROUND_THREADS * 2
    })
    return { path, input: 'Png', width: r.width, height: r.height }
  }
  const proxy = await smaller(master, PROXY_EDGE, 'proxy.png')
  const draft = await smaller(proxy, DRAFT_EDGE, 'draft.png')

  const probed = await engine.probe(masterPath)
  const set: HdrSource = {
    master,
    px: { proxy, draft, frameWidth: master.width, frameHeight: master.height },
    // The master is a PQ file like any other. Its peak — what the grade has
    // room for and what the display tone map starts from — is what the
    // pixels reach, and at least the file's stated capacity up to BT.2100's
    // nominal 1000 cd/m²: a synthetic map claiming 10 000 would otherwise
    // squash the preview.
    info: {
      ...probed,
      is_hdr: true,
      peak_nits: Math.round(Math.max(probed.peak_nits ?? 0, Math.min(peak, 1000))),
      gain_map: null
    }
  }
  await writeFile(meta, JSON.stringify(set))
  return set
}
