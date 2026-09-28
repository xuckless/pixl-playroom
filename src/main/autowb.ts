/**
 * Auto white balance: the measurement the develop view's Auto runs, and the
 * same measurement across a batch of photos in the library, each getting
 * its own white. The batch runs on the background engine, so the loupe
 * keeps rendering while it works.
 */
import log from 'electron-log/main'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { AUTO_PERCENTILES, wbSliders } from '../shared/auto'
import type { AnalyzeRequest, HdrWorking, SourceInfo, WhitePoint } from '../shared/engine-types'
import { STRIP_ALL } from '../shared/engine-types'
import type { AutoWbResult, SampleResult } from '../shared/ipc'
import { newLocalLayer, type Recipe } from '../shared/recipe'
import type { PhotoRow } from './db'
import type { EngineClient } from './engine/client'
import type { IndexClient } from './indexer/client'
import { parseKey } from './keys'
import type { Library } from './library'
import { paths } from './paths'
import type { PlaneStore } from './planestore'
import { ensureProxies, type ProxyFile } from './proxy'
import type { DevelopSessions } from './render'
import { blankRequest, INTERACTIVE_THREADS } from './source'

/** An `analyze` of a proxy file, with the percentiles auto tone reads. */
export function analyzeRequest(
  path: string,
  input: 'Png' | 'Jpeg' | 'Tiff',
  stride: number
): AnalyzeRequest {
  return {
    source: { Path: path },
    input,
    raw: null,
    domain: 'Encoded',
    bins: 256,
    percentiles: [...AUTO_PERCENTILES, 1, 99],
    clip_low: 0,
    clip_high: 1,
    hue_bins: 36,
    stride,
    transparent: 'Include',
    threads: INTERACTIVE_THREADS,
    weights: null,
    noise: false,
    hdr: null
  }
}

/** How a PQ/HLG source is graded and measured: 1.0 is 203-nit reference white. */
export function hdrWorkingOf(info: SourceInfo): HdrWorking | null {
  return info.is_hdr ? { reference_white_nits: 203, peak_nits: info.peak_nits ?? 1000 } : null
}

/** Where a photo's develop renders (and measurements) are written. */
export const rendersDir = (photoId: number): string => join(paths.photoCache(photoId), 'renders')

/**
 * Auto white balance on a proxy: the mean colour of its near-neutral pixels
 * (low saturation, away from black and clipping), falling back to the
 * whole frame's grey world when too few qualify. `dir` takes the mask it
 * measures through.
 */
export async function measureAutoWb(
  engine: EngineClient,
  src: ProxyFile,
  dir: string,
  hdr: HdrWorking | null,
  isRaw: boolean,
  asShot: WhitePoint | null
): Promise<SampleResult['wb']> {
  // A PQ/HLG draft is measured in linear light as `convert` grades it
  // (1.0 = reference white); the engine refuses it in Linear without `hdr`.
  const linearReq: AnalyzeRequest = {
    ...analyzeRequest(src.path, src.input === 'Png' ? 'Png' : 'Tiff', 1),
    domain: 'Linear',
    hdr
  }
  let means: number[] | null = null
  try {
    const layer = newLocalLayer('neutral')
    const maskOut = join(dir, 'auto-wb-mask.png')
    await engine.convert({
      ...blankRequest(src.path, maskOut, src.input),
      pixel: { depth: 'Eight', channels: 1 },
      encode: { Png: { compression: 'Fast', filter: 'Sub' } },
      metadata: STRIP_ALL,
      color: 'Preserve',
      grade: {
        layers: [
          {
            name: layer.name,
            enabled: true,
            opacity: 1,
            blend: { mode: 'Normal', space: 'LinearWorking' },
            mask: {
              components: [
                {
                  shape: {
                    Range: {
                      hue: null,
                      saturation: { centre: 0, width: 0.3, softness: 0.1 },
                      luma: { centre: 0.5, width: 0.8, softness: 0.08 },
                      blur_radius: 0,
                      invert: false
                    }
                  },
                  mode: 'Add',
                  opacity: 1,
                  invert: false,
                  feather: { radius: 0, edge: 'Zero' }
                }
              ],
              invert: false,
              space: {
                Encoded: {
                  space: 'Srgb',
                  intent: 'RelativeColorimetric',
                  black_point_compensation: false
                }
              }
            },
            stages: [
              {
                space: 'LinearWorking',
                ops: [
                  {
                    Primary: {
                      exposure: 0,
                      lift: { r: 0, g: 0, b: 0 },
                      gamma: { r: 1, g: 1, b: 1 },
                      gain: { r: 1, g: 1, b: 1 },
                      contrast: 1,
                      contrast_pivot: 0.18,
                      saturation: 1,
                      hue_shift: 0
                    }
                  }
                ]
              }
            ]
          }
        ]
      },
      inspect: { LayerMask: { layer: 0 } },
      hdr
    })
    const s = await engine.analyze({
      ...linearReq,
      weights: { source: { Png: maskOut }, resampler: 'Bilinear' }
    })
    const total = src.width * src.height
    if (s.pixels_measured > total * 0.02) means = s.channel_mean
  } catch (err) {
    log.info('grey-pixel white balance unavailable, using grey world', (err as Error).message)
  }
  if (!means) {
    const s = await engine.analyze(linearReq)
    means = s.channel_mean
  }
  return wbSliders([means[0], means[1], means[2]], isRaw, asShot)
}

export interface WbServices {
  index: IndexClient
  planes: PlaneStore
  library: Library
  sessions: DevelopSessions
  bgEngine: EngineClient
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Each key's recipe as it stands: an open session's (which may be newer
 * than its sidecar, and is written first) or the saved one.
 */
async function currentRecipes(
  s: WbServices,
  keys: string[]
): Promise<Map<string, { recipe: Recipe; row: PhotoRow }>> {
  await Promise.all(keys.map((key) => s.sessions.flush(key)))
  const saved = await s.index.recipes(keys)
  return new Map(
    saved.map((r) => [r.key, { row: r.row, recipe: s.sessions.liveRecipe(r.key) ?? r.recipe }])
  )
}

/**
 * Save new recipes the way an edit in Develop would be: the history gets
 * where each photo stood (a base, if it had none; nothing if the history
 * already says so) and then the change, the sidecars are written in one
 * transaction, an open session follows, and the thumbnails re-render.
 */
async function commitWb(
  s: WbServices,
  changes: { key: string; before: Recipe; next: Recipe }[],
  beforeLabel: string,
  label: string
): Promise<AutoWbResult['items']> {
  for (const { key, before, next } of changes) {
    await s.index.appendHistory(key, beforeLabel, s.planes.slim(before))
    await s.index.appendHistory(key, label, s.planes.slim(next))
  }
  const items = await s.index.saveRecipes(changes.map((c) => ({ key: c.key, recipe: c.next })))
  for (const { key, next } of changes) {
    if (s.sessions.liveRecipe(key)) s.sessions.update(key, next, false)
    const { photoId, copyId } = parseKey(key)
    s.library.queueThumb(photoId, copyId, true)
  }
  return items
}

/** Auto white balance on every key, each measured on its own draft proxy. */
export async function autoWbBatch(s: WbServices, keys: string[]): Promise<AutoWbResult> {
  const current = await currentRecipes(s, keys)
  const failed: AutoWbResult['failed'] = []
  const changes: { key: string; before: Recipe; next: Recipe }[] = []
  // The background engine runs a few requests at once: measure side by side.
  await Promise.all(
    keys.map(async (key) => {
      try {
        const cur = current.get(key)
        if (!cur) throw new Error('the photo is not in the library')
        const { row, recipe } = cur
        const info = await s.library.probe(row)
        const px = await ensureProxies(s.bgEngine, row, info)
        const dir = rendersDir(row.id)
        await mkdir(dir, { recursive: true })
        const wb = await measureAutoWb(
          s.bgEngine,
          px.draft,
          dir,
          hdrWorkingOf(info),
          row.is_raw === 1,
          info.as_shot_white
        )
        if (!wb) throw new Error('no neutral to work from')
        changes.push({
          key,
          before: recipe,
          next: {
            ...recipe,
            wb: { mode: 'custom', temperature: wb.temperature, tint: wb.tint, preset: 'auto' }
          }
        })
      } catch (err) {
        failed.push({ key, message: errorText(err) })
      }
    })
  )
  const previous: AutoWbResult['previous'] = {}
  for (const c of changes) previous[c.key] = c.before.wb
  const items = changes.length
    ? await commitWb(s, changes, 'Before auto WB', 'White balance: Auto')
    : []
  return { items, previous, failed }
}

/** Put white balances back (Undo after a batch auto white balance). */
export async function setWbBatch(
  s: WbServices,
  pairs: { key: string; wb: Recipe['wb'] }[]
): Promise<AutoWbResult['items']> {
  const current = await currentRecipes(
    s,
    pairs.map((p) => p.key)
  )
  const changes = pairs.flatMap(({ key, wb }) => {
    const cur = current.get(key)
    return cur ? [{ key, before: cur.recipe, next: { ...cur.recipe, wb } }] : []
  })
  if (changes.length === 0) return []
  return commitWb(s, changes, 'Before restoring white balance', 'White balance: restored')
}
