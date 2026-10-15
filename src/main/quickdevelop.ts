/**
 * ARCHITECTURE — Quick develop's main half (the rules are pure, in
 * shared/quickdevelop.ts; the tab is views/library/QuickDevelop.tsx).
 *
 * Every write is a Library batch (batchcommit.ts), one step per photo:
 *
 * - `nudgeBatch`: a burst of nudges, its total from where each photo stood
 *   before the burst, so ten quick clicks stay one step per photo.
 * - `lookBatch`: a look (or a saved preset) at an Amount; the same batch
 *   written again is the Amount let go, or another look swapped in.
 * - `autoToneBatch`: Auto tone measured on each photo, as Develop's Auto
 *   measures the open one (the tone sliders at zero).
 *
 * `QuickPreviews` makes the tab's one look preview of the focused photo
 * with no Develop session open (the Looks browser's cards need one): the
 * photo's draft graded as its thumbnail is, small, on the background engine.
 */
import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { autoTone } from '../shared/auto'
import type { Measure } from '../shared/engine-types'
import { t } from '../shared/i18n'
import type { BatchResult, BatchTag, LookThumbEvent, LookThumbRequest, Preset } from '../shared/ipc'
import type { ResolvedProfile } from '../shared/lens'
import { needsLens, type ApplyContext } from '../shared/looks/apply'
import { immediateLayers, previewLayers } from '../shared/looks/smart'
import { lookAt, nudgeRecipe, type QuickDelta } from '../shared/quickdevelop'
import { hash32, newId, type LocalLayer, type Recipe } from '../shared/recipe'
import type { WbContext } from '../shared/wbconvert'
import { AUTO_PERCENTILES } from '../shared/auto'
import {
  commitBatch,
  currentRecipes,
  writeBatch,
  type BatchChange,
  type BatchServices
} from './batchcommit'
import { LookThumbQueue, type LookThumb, type ThumbJob } from './lookthumbs'
import { paths } from './paths'
import { cacheUrl } from './protocol'

/** What Quick develop asks of the rest of main (ipc.ts has them). */
export interface QuickHelpers {
  /** A photo's white, for a Temp nudge and a look's saved white balance. */
  wbContext(key: string): Promise<WbContext>
  /** A catalog look or one of the user's presets, by id. */
  look(id: string): Promise<Preset | null>
  /** A lens profile resolved for this photo's lens (null: none matches). */
  lensResolved(key: string, p: Preset): Promise<ResolvedProfile | null>
  /** The photo's base frame, for the masks a smart look makes. */
  frame(key: string): Promise<{ width: number; height: number }>
}

/** A chunk of a nudge burst: `delta` is the burst's total so far. */
export async function nudgeBatch(
  s: BatchServices,
  h: QuickHelpers,
  keys: string[],
  delta: QuickDelta,
  tag: BatchTag,
  prior: { key: string; seq: number }[]
): Promise<BatchResult> {
  const limited: string[] = []
  const wb = !!(delta.temp || delta.tint)
  const out = await writeBatch(s, keys, tag, prior, async (key, before) => {
    const r = nudgeRecipe(before, delta, wb ? await h.wbContext(key) : null)
    if (r.limited) limited.push(key)
    return r.recipe
  })
  return { ...out, limited }
}

/** The look's smart masks this photo gets without a model (fresh ids each time). */
async function smartLayers(h: QuickHelpers, key: string, p: Preset): Promise<LocalLayer[]> {
  if (!p.smart) return []
  const f = await h.frame(key)
  return immediateLayers(p.smart, { frameWidth: f.width, frameHeight: f.height })
}

async function applyContext(h: QuickHelpers, key: string, p: Preset): Promise<ApplyContext> {
  return {
    wb: await h.wbContext(key),
    // A lens profile is each photo's own lens's, not the numbers it was saved with.
    lensResolved: needsLens(p) ? await h.lensResolved(key, p).catch(() => null) : 'keep'
  }
}

/**
 * A chunk of a look batch: `lookId` at `amount` on each photo, from where it
 * stood before the batch (a swap or an Amount rewrites the batch's step).
 * A smart look brings the masks it makes without a model; its model work
 * is Develop's.
 */
export async function lookBatch(
  s: BatchServices,
  h: QuickHelpers,
  keys: string[],
  lookId: string,
  amount: number,
  tag: BatchTag,
  prior: { key: string; seq: number }[]
): Promise<BatchResult> {
  const p = await h.look(lookId)
  if (!p) throw new Error(t('that look is not here any more'))
  const k = Math.round(Math.min(100, Math.max(0, amount)))
  return writeBatch(s, keys, tag, prior, async (key, before) =>
    lookAt(before, p, await applyContext(h, key, p), k, await smartLayers(h, key, p))
  )
}

/** The long edge Auto tone measures at: the draft's share, as Develop measures its own. */
const MEASURE_EDGE = 1024

const TONE_MEASURE: Measure = {
  at: 'Output',
  domain: 'Encoded',
  bins: 256,
  percentiles: [...AUTO_PERCENTILES, 1, 99],
  clip_low: 0,
  clip_high: 1,
  hue_bins: 36,
  stride: 1,
  transparent: 'Include',
  noise: false
}

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Auto tone on every key, each measured on its own (its tone sliders at
 * zero, its masks off, as Develop's Auto measures), two at a time on the
 * background engine; one step of the batch `tag` in each photo's history.
 */
export async function autoToneBatch(
  s: BatchServices,
  keys: string[],
  tag: BatchTag
): Promise<BatchResult> {
  const current = await currentRecipes(s, keys)
  const failed: BatchResult['failed'] = []
  const changes: BatchChange[] = []
  const measure = async (key: string): Promise<void> => {
    const out = join(paths.cacheRoot(), `quick-tone-${process.pid}-${newId()}.png`)
    try {
      const cur = current.get(key)
      if (!cur) throw new Error(t('the photo is not in the library'))
      const flat: Recipe = structuredClone(cur.recipe)
      flat.basic = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 }
      flat.layers = []
      // Measured as Develop measures the open photo: in Display P3.
      const { report } = await s.library.render(key, flat, out, {
        edge: MEASURE_EDGE,
        space: 'DisplayP3',
        request: { encode: { Png: { compression: 'Fast', filter: 'Sub' } }, measure: TONE_MEASURE }
      })
      if (!report.stats) throw new Error(t('the engine measured nothing'))
      changes.push({
        key,
        before: cur.recipe,
        next: { ...cur.recipe, basic: autoTone(report.stats) }
      })
    } catch (err) {
      failed.push({ key, message: errorText(err) })
    } finally {
      await rm(out, { force: true }).catch(() => undefined)
    }
  }
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < keys.length) await measure(keys[next++])
  }
  await Promise.all([worker(), worker()])
  changes.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))
  return changes.length ? commitBatch(s, changes, tag, failed) : { items: [], steps: [], failed }
}

/** Each photo's settings as they stand, stamped: the clipboard sees its photo change since a copy. */
export async function recipeStamps(
  s: BatchServices,
  keys: string[]
): Promise<Record<string, string>> {
  const current = await currentRecipes(s, keys)
  const out: Record<string, string> = {}
  for (const [key, c] of current)
    out[key] = hash32(JSON.stringify(s.planes.slim(c.recipe))).toString(16)
  return out
}

// ── the look preview, with no Develop session ───────────────────────────────

const PREVIEW_EDGE_MIN = 96
const PREVIEW_EDGE_MAX = 640
/** Previews kept (and their files) before the oldest go. */
const PREVIEW_KEEP = 120

interface PreviewJob {
  key: string
  recipe: Recipe
}

export class QuickPreviews {
  private queue: LookThumbQueue<PreviewJob>
  private made = new Map<string, LookThumb & { file: string }>()
  private edge = 192

  constructor(
    private readonly s: BatchServices,
    private readonly h: QuickHelpers,
    send: (e: LookThumbEvent) => void
  ) {
    let key = ''
    this.queue = new LookThumbQueue<PreviewJob>(
      (job, signal) => {
        key = job.recipe.key
        return this.make(job.recipe, signal)
      },
      (token, id, thumb) =>
        send({ key, token, id, url: thumb.url, width: thumb.width, height: thumb.height }),
      (a, b) => a.key === b.key && JSON.stringify(a.recipe) === JSON.stringify(b.recipe)
    )
  }

  /**
   * The cards asked for (`looks.thumbs` on a photo with no session): each
   * look on the photo as it stands, or as it stood before the batch step
   * `under` (a look swapped is shown in place of the one applied), at the
   * request's Amount.
   */
  async request(req: LookThumbRequest): Promise<void> {
    this.edge = Math.round(
      Math.max(PREVIEW_EDGE_MIN, Math.min(PREVIEW_EDGE_MAX, req.edge || PREVIEW_EDGE_MIN))
    )
    const before = req.under !== undefined ? await this.s.index.batchBase(req.key, req.under) : null
    const base = before ?? (await currentRecipes(this.s, [req.key])).get(req.key)?.recipe
    if (!base) return
    const amount = req.amount ?? 100
    const jobs: ThumbJob<PreviewJob>[] = []
    for (const id of req.ids) {
      if (id === 'current') {
        jobs.push({ id, recipe: { key: req.key, recipe: base } })
        continue
      }
      const p = await this.h.look(id)
      if (!p) continue
      const wb = await this.h.wbContext(req.key)
      const smart = p.smart
        ? previewLayers(p.id, await smartLayers(this.h, req.key, p).catch(() => []))
        : []
      // A preview never looks a lens up: the preset's resolution stands in.
      const recipe = lookAt(base, p, { wb, lensResolved: 'keep' }, amount, smart)
      jobs.push({ id, recipe: { key: req.key, recipe } })
    }
    this.queue.request(req.token, jobs)
  }

  cancel(): void {
    this.queue.cancel()
  }

  private async make(job: PreviewJob, signal: AbortSignal): Promise<LookThumb> {
    const row = await this.s.library.photoRow(job.key)
    const sig = hash32(
      JSON.stringify([this.s.library.versionStamp(row), job.key, this.edge, job.recipe])
    ).toString(16)
    const known = this.made.get(sig)
    if (known) return known
    const dir = join(paths.photoCache(row.id), 'renders')
    await mkdir(dir, { recursive: true })
    const out = join(dir, `quick-${sig}.jpg`)
    const { report } = await this.s.library.render(job.key, job.recipe, out, {
      edge: this.edge,
      signal
    })
    const thumb = { url: cacheUrl(out, sig), width: report.width, height: report.height, file: out }
    this.made.set(sig, thumb)
    while (this.made.size > PREVIEW_KEEP) {
      const oldest = this.made.keys().next().value as string
      const f = this.made.get(oldest)?.file
      this.made.delete(oldest)
      if (f) void rm(f, { force: true }).catch(() => undefined)
    }
    return thumb
  }
}
