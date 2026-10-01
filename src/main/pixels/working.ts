/**
 * The working pixels: the photo with its pixel steps laid on (see
 * shared/pixels.ts). Every view and export grades these instead of the plain
 * photo, the way they once graded AI denoise's set.
 *
 * - **The proxies** (the develop view's 2560 px and 1280 px frames) are the
 *   plain proxies with every step's image laid over, resampled to fit: one
 *   engine pass, a second or so.
 * - **The master** (a 1:1 view, an export) is the full-resolution frame with
 *   the same steps over it, made only when one is asked for.
 *
 * Each step is its image (decoded from the project's blob once, to a 16-bit
 * PNG in the photo's cache) laid at its opacity, through its frozen mask when
 * it has one (the two composed into one RGBA overlay, once). A set is kept
 * per photo version and per steps (`stackSignature`), so undo, redo and hide
 * find what they need already made; nothing ever runs a model again.
 */
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type { Overlay } from '../../shared/engine-types'
import { stackSignature, type PixelStep } from '../../shared/pixels'
import { hash32 } from '../../shared/recipe'
import type { EngineClient } from '../engine/client'
import { exists } from '../exists'
import type { Proxies, ProxyFile } from '../proxy'
import { BACKGROUND_THREADS, blankRequest } from '../source'
import type { PixelsJob } from '../workers/pool'

/** What the working pixels need from outside: the engine, the project's blobs, a worker. */
export interface PixelDeps {
  engine: EngineClient
  /** The photo's cache directory (`cache/photos/<id>`). */
  cacheDir: string
  /** A blob of the photo's project written out to a file (null when it has none). */
  blobFile(hash: string, ext: string): Promise<string | null>
  /** Per-pixel work, off the main thread. */
  work(job: PixelsJob): Promise<unknown>
}

export interface WorkingSet {
  key: string
  px: Proxies
  /** The full-resolution frame with the steps laid on; null until one is asked for. */
  master: ProxyFile | null
}

const TIFF = { Tiff: { compression: 'None' } } as const
const PNG = { Png: { compression: 'Fast', filter: 'Sub' } } as const
const ICC_ONLY = { exif: false, icc: true, xmp: false, iptc: false } as const

/** The key of a photo version's working set for these steps. */
export function workingKey(version: string, steps: PixelStep[]): string {
  return hash32(JSON.stringify([version, stackSignature(steps)])).toString(16)
}

const dirOf = (deps: PixelDeps, key: string): string => join(deps.cacheDir, `work-${key}`)

/** A step's image as a 16-bit PNG in the cache (decoded from its blob once). */
export async function stepImage(deps: PixelDeps, step: PixelStep): Promise<string> {
  const out = join(deps.cacheDir, 'blobs', `${step.blob}.png`)
  if (await exists(out)) return out
  const jxl = await deps.blobFile(step.blob, 'jxl')
  if (!jxl) throw new Error(`${step.label}: its image is missing from the project`)
  await mkdir(join(deps.cacheDir, 'blobs'), { recursive: true })
  const tmp = `${out}.part.png`
  await deps.engine.convert({
    ...blankRequest(jxl, tmp, 'Jxl'),
    pixel: { depth: 'Sixteen', channels: 3 },
    encode: PNG,
    metadata: ICC_ONLY,
    color: 'Preserve',
    threads: BACKGROUND_THREADS
  })
  await rename(tmp, out)
  return out
}

/** What a step lays over the frame: its image, or (masked) its image and mask as one RGBA PNG. */
async function overlaySource(deps: PixelDeps, step: PixelStep): Promise<string> {
  const image = await stepImage(deps, step)
  if (!step.alpha) return image
  const out = join(
    deps.cacheDir,
    'blobs',
    `${step.blob.slice(0, 24)}-${step.alpha.slice(0, 24)}.png`
  )
  if (await exists(out)) return out
  const mask = await deps.blobFile(step.alpha, 'png')
  if (!mask) throw new Error(`${step.label}: its mask is missing from the project`)
  await deps.work({ op: 'compose', image, mask, out })
  return out
}

/** The engine overlays for a list of steps, in order. */
export async function overlaysOf(deps: PixelDeps, steps: PixelStep[]): Promise<Overlay[]> {
  const out: Overlay[] = []
  for (const s of steps) {
    if (s.opacity <= 0) continue
    out.push({
      source: { Png: await overlaySource(deps, s) },
      rect: { x: 0, y: 0, width: 1 },
      opacity: Math.min(1, s.opacity / 100),
      // In linear light, as light mixes; a step at 100% replaces exactly.
      blend: { mode: 'Normal', space: 'LinearWorking' },
      resampler: 'Lanczos3'
    })
  }
  return out
}

/** `from` with the overlays laid on (each resampled to its size), as a 16-bit TIFF at `out`. */
async function layOn(
  deps: PixelDeps,
  from: ProxyFile,
  out: string,
  overlays: Overlay[]
): Promise<ProxyFile> {
  const r = await deps.engine.convert({
    ...blankRequest(from.path, out, from.input),
    pixel: { depth: 'Sixteen', channels: 3 },
    encode: TIFF,
    metadata: ICC_ONLY,
    color: 'Preserve',
    // Every step at 0%: nothing to lay on (the engine refuses an empty list).
    overlays: overlays.length > 0 ? overlays : null,
    threads: BACKGROUND_THREADS
  })
  return { path: out, input: 'Tiff', width: r.width, height: r.height }
}

const building = new Map<string, Promise<WorkingSet>>()

/**
 * The working set for these steps over the plain proxies (and, with
 * `master`, over the full-resolution `base` too). Kept on disk; a set made
 * before is found, not made again. No steps: the plain proxies themselves.
 */
export function ensureWorking(
  deps: PixelDeps,
  version: string,
  plain: Proxies,
  steps: PixelStep[],
  base: (() => Promise<ProxyFile>) | null
): Promise<WorkingSet> {
  const key = workingKey(version, steps)
  const flight = `${deps.cacheDir}:${key}:${base ? 'm' : 'p'}`
  let p = building.get(flight)
  if (!p) {
    p = make(deps, key, plain, steps, base).finally(() => building.delete(flight))
    building.set(flight, p)
  }
  return p
}

async function make(
  deps: PixelDeps,
  key: string,
  plain: Proxies,
  steps: PixelStep[],
  base: (() => Promise<ProxyFile>) | null
): Promise<WorkingSet> {
  if (steps.length === 0) {
    return { key, px: plain, master: base ? await base() : null }
  }
  const dir = dirOf(deps, key)
  const meta = join(dir, 'set.json')
  let set: WorkingSet | null = (await exists(meta))
    ? (JSON.parse(await readFile(meta, 'utf8')) as WorkingSet)
    : null
  if (set && !(await filesThere(set))) set = null
  if (set && (!base || set.master)) return set
  await mkdir(dir, { recursive: true })
  const overlays = await overlaysOf(deps, steps)
  if (!set) {
    const proxy = await layOn(deps, plain.proxy, join(dir, 'proxy.tiff'), overlays)
    const draft = await layOn(deps, plain.draft, join(dir, 'draft.tiff'), overlays)
    set = {
      key,
      px: { proxy, draft, frameWidth: plain.frameWidth, frameHeight: plain.frameHeight },
      master: null
    }
  }
  if (base)
    set = { ...set, master: await layOn(deps, await base(), join(dir, 'master.tiff'), overlays) }
  await writeFile(meta, JSON.stringify(set))
  await prune(deps, key)
  return set
}

async function filesThere(set: WorkingSet): Promise<boolean> {
  for (const f of [set.px.proxy.path, set.px.draft.path, ...(set.master ? [set.master.path] : [])])
    if (!(await exists(f))) return false
  return true
}

/** Sets kept per photo besides the newest: a 24 MP master is about 150 MB. */
const KEEP = 4

async function prune(deps: PixelDeps, keepKey: string): Promise<void> {
  const others = (await readdir(deps.cacheDir).catch(() => [] as string[])).filter(
    (d) => d.startsWith('work-') && d !== `work-${keepKey}`
  )
  const dated = await Promise.all(
    others.map(async (d) => ({
      d,
      t: (await stat(join(deps.cacheDir, d)).catch(() => null))?.mtimeMs ?? 0
    }))
  )
  dated.sort((a, b) => b.t - a.t)
  for (const { d } of dated.slice(KEEP))
    await rm(join(deps.cacheDir, d), { recursive: true, force: true })
}
