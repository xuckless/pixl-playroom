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

/**
 * Write `out` through a temporary file of its own, renamed whole into place:
 * a render reading it never sees it half written.
 */
async function atomically<T>(out: string, build: (tmp: string) => Promise<T>): Promise<T> {
  const tmp = out.replace(
    /(\.[a-z]+)$/,
    `.${process.pid}-${Math.random().toString(36).slice(2)}.part$1`
  )
  try {
    const r = await build(tmp)
    await rename(tmp, out)
    return r
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined)
  }
}

/**
 * Make a cache file once: a second ask for the same file (the proxies, the
 * master and a bake can all want one patch at one size at once) waits for
 * the first.
 */
const making = new Map<string, Promise<void>>()
async function makeOnce(out: string, build: (tmp: string) => Promise<unknown>): Promise<void> {
  if (await exists(out)) return
  let p = making.get(out)
  if (!p) {
    p = atomically(out, build)
      .then(() => undefined)
      .finally(() => making.delete(out))
    making.set(out, p)
  }
  await p
}

/** A step's image as a 16-bit PNG in the cache (decoded from its blob once). */
export async function stepImage(deps: PixelDeps, step: PixelStep): Promise<string> {
  const out = join(deps.cacheDir, 'blobs', `${step.blob}.png`)
  if (await exists(out)) return out
  const jxl = await deps.blobFile(step.blob, 'jxl')
  if (!jxl) throw new Error(`${step.label}: its image is missing from the project`)
  await mkdir(join(deps.cacheDir, 'blobs'), { recursive: true })
  await makeOnce(out, (tmp) =>
    deps.engine.convert({
      ...blankRequest(jxl, tmp, 'Jxl'),
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: PNG,
      metadata: ICC_ONLY,
      color: 'Preserve',
      threads: BACKGROUND_THREADS
    })
  )
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

/**
 * A step's overlay at exactly `w × h`: the engine places an overlay by width
 * and keeps its shape, so one resampled to a frame of a slightly different
 * shape (a proxy rounds its size) would land a pixel past the edge. Made once
 * per size.
 */
async function sized(
  deps: PixelDeps,
  src: string,
  step: PixelStep,
  w: number,
  h: number
): Promise<string> {
  if (w === step.width && h === step.height) return src
  const out = src.replace(/\.png$/, `-${w}x${h}.png`)
  await makeOnce(out, (tmp) =>
    deps.engine.convert({
      ...blankRequest(src, tmp, 'Png'),
      resize: { Exact: { width: w, height: h } },
      resampler: 'Lanczos3',
      // Downscaled in linear light, as the proxies are; alpha (a mask) kept.
      linear_resample: true,
      pixel: { depth: 'Sixteen', channels: step.alpha ? 4 : 3 },
      encode: PNG,
      metadata: ICC_ONLY,
      color: 'Preserve',
      threads: BACKGROUND_THREADS
    })
  )
  return out
}

/**
 * A patch (a baked heal) over a `w × h` frame: its pixels resized to the
 * whole pixels it covers there, and placed on them. At the frame it was made
 * on it goes as it is.
 */
async function patchOverlay(
  deps: PixelDeps,
  step: PixelStep,
  w: number,
  h: number
): Promise<Overlay | null> {
  const r = step.rect!
  const kx = w / step.width
  const ky = h / step.height
  const x0 = Math.max(0, Math.floor(r.x * kx))
  const y0 = Math.max(0, Math.floor(r.y * ky))
  const x1 = Math.min(w, Math.ceil((r.x + r.w) * kx))
  const y1 = Math.min(h, Math.ceil((r.y + r.h) * ky))
  const pw = x1 - x0
  const ph = y1 - y0
  if (pw < 1 || ph < 1) return null
  const src = await deps.blobFile(step.blob, 'png')
  if (!src) throw new Error(`${step.label}: its pixels are missing from the project`)
  let path = src
  if (pw !== r.w || ph !== r.h) {
    path = src.replace(/\.png$/, `-${pw}x${ph}.png`)
    await makeOnce(path, (tmp) =>
      deps.engine.convert({
        ...blankRequest(src, tmp, 'Png'),
        resize: { Exact: { width: pw, height: ph } },
        resampler: 'Lanczos3',
        pixel: { depth: 'Sixteen', channels: 4 },
        encode: PNG,
        metadata: ICC_ONLY,
        color: 'Preserve'
      })
    )
  }
  return {
    source: { Png: path },
    rect: { x: x0 / w, y: y0 / h, width: pw / w },
    opacity: Math.min(1, step.opacity / 100),
    blend: { mode: 'Normal', space: 'LinearWorking' },
    resampler: 'Lanczos3'
  }
}

/** The engine overlays for a list of steps over a `w × h` frame, in order. */
export async function overlaysOf(
  deps: PixelDeps,
  steps: PixelStep[],
  w: number,
  h: number
): Promise<Overlay[]> {
  const out: Overlay[] = []
  for (const s of steps) {
    if (s.opacity <= 0) continue
    if (s.rect) {
      const o = await patchOverlay(deps, s, w, h)
      if (o) out.push(o)
      continue
    }
    out.push({
      source: { Png: await sized(deps, await overlaySource(deps, s), s, w, h) },
      rect: { x: 0, y: 0, width: 1 },
      opacity: Math.min(1, s.opacity / 100),
      // In linear light, as light mixes; a step at 100% replaces exactly.
      blend: { mode: 'Normal', space: 'LinearWorking' },
      resampler: 'Lanczos3'
    })
  }
  return out
}

/** `from` with the steps laid on (each sized to it), as a 16-bit TIFF at `out`. */
async function layOn(
  deps: PixelDeps,
  from: ProxyFile,
  out: string,
  steps: PixelStep[]
): Promise<ProxyFile> {
  const overlays = await overlaysOf(deps, steps, from.width, from.height)
  const r = await atomically(out, (tmp) =>
    deps.engine.convert({
      ...blankRequest(from.path, tmp, from.input),
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: TIFF,
      metadata: ICC_ONLY,
      color: 'Preserve',
      // Every step at 0%: nothing to lay on (the engine refuses an empty list).
      overlays: overlays.length > 0 ? overlays : null,
      threads: BACKGROUND_THREADS
    })
  )
  return { path: out, input: 'Tiff', width: r.width, height: r.height }
}

/**
 * The working frame's size: the photo's, or the last step's that changed it
 * (an upscale: `params.resizes`). Steps before it are laid on resampled to it.
 */
export function frameOf(
  steps: PixelStep[],
  width: number,
  height: number
): { width: number; height: number } {
  const last = steps.findLast((s) => s.params.resizes === true && s.opacity > 0)
  return last ? { width: last.width, height: last.height } : { width, height }
}

/** `from` resampled to exactly `w × h` (an upscale's frame, for the steps before it and its blend). */
async function resized(
  deps: PixelDeps,
  from: ProxyFile,
  out: string,
  w: number,
  h: number
): Promise<ProxyFile> {
  await atomically(out, (tmp) =>
    deps.engine.convert({
      ...blankRequest(from.path, tmp, from.input),
      resize: { Exact: { width: w, height: h } },
      resampler: 'Lanczos3',
      pixel: { depth: 'Sixteen', channels: 3 },
      encode: TIFF,
      metadata: ICC_ONLY,
      color: 'Preserve',
      threads: BACKGROUND_THREADS
    })
  )
  return { path: out, input: 'Tiff', width: w, height: h }
}

/**
 * Builds in flight, one per set and stage: the proxies, and the master
 * chained after them. Two asks for one set (a heal's bake and the session
 * catching up) share the build, so no two ever write its files at once.
 */
const buildingProxies = new Map<string, Promise<WorkingSet>>()
const buildingMaster = new Map<string, Promise<WorkingSet>>()

function once(
  map: Map<string, Promise<WorkingSet>>,
  flight: string,
  build: () => Promise<WorkingSet>
): Promise<WorkingSet> {
  let p = map.get(flight)
  if (!p) {
    p = build().finally(() => map.delete(flight))
    map.set(flight, p)
  }
  return p
}

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
  const flight = `${deps.cacheDir}:${key}`
  const proxies = once(buildingProxies, flight, () => makeProxies(deps, version, key, plain, steps))
  if (!base) return proxies
  return once(buildingMaster, flight, () =>
    proxies.then((set) => makeMaster(deps, version, key, plain, steps, base, set))
  )
}

/** The set made for the steps but the last, when the last can be laid on it alone. */
function previousSet(
  deps: PixelDeps,
  version: string,
  steps: PixelStep[]
): Promise<WorkingSet | null> {
  return steps.length > 1 && !steps[steps.length - 1].params.resizes
    ? findSet(deps, workingKey(version, steps.slice(0, -1)))
    : Promise.resolve(null)
}

async function makeProxies(
  deps: PixelDeps,
  version: string,
  key: string,
  plain: Proxies,
  steps: PixelStep[]
): Promise<WorkingSet> {
  if (steps.length === 0) return { key, px: plain, master: null }
  const made = await findSet(deps, key)
  if (made) return made
  const dir = dirOf(deps, key)
  await mkdir(dir, { recursive: true })
  const frame = frameOf(steps, plain.frameWidth, plain.frameHeight)
  // One step more than a set already made (a heal stroke after another): the
  // new step laid on that set, not every step on the photo again.
  const prev = await previousSet(deps, version, steps)
  const last = steps[steps.length - 1]
  let set: WorkingSet
  if (prev) {
    const proxy = await layOn(deps, prev.px.proxy, join(dir, 'proxy.tiff'), [last])
    const draft = await layOn(deps, prev.px.draft, join(dir, 'draft.tiff'), [last])
    set = { key, px: { ...prev.px, proxy, draft }, master: null }
  } else {
    // The proxies keep their size: an upscale shows as its picture, not its pixels.
    const proxy = await layOn(deps, plain.proxy, join(dir, 'proxy.tiff'), steps)
    const draft = await layOn(deps, plain.draft, join(dir, 'draft.tiff'), steps)
    set = {
      key,
      px: { proxy, draft, frameWidth: frame.width, frameHeight: frame.height },
      master: null
    }
  }
  await writeSet(deps, set)
  await prune(deps, key)
  return set
}

/** The set's master, laid on after its proxies are made. */
async function makeMaster(
  deps: PixelDeps,
  version: string,
  key: string,
  plain: Proxies,
  steps: PixelStep[],
  base: () => Promise<ProxyFile>,
  set: WorkingSet
): Promise<WorkingSet> {
  if (set.master) return set
  if (steps.length === 0) return { ...set, master: await base() }
  const dir = dirOf(deps, key)
  await mkdir(dir, { recursive: true })
  const prev = await previousSet(deps, version, steps)
  const last = steps[steps.length - 1]
  let master: ProxyFile
  if (prev?.master) {
    master = await layOn(deps, prev.master, join(dir, 'master.tiff'), [last])
  } else {
    // At full size the frame is the steps' own: an upscale's, when one made it larger.
    const frame = frameOf(steps, plain.frameWidth, plain.frameHeight)
    const from = await base()
    const start =
      from.width === frame.width && from.height === frame.height
        ? from
        : await resized(deps, from, join(dir, 'base.tiff'), frame.width, frame.height)
    master = await layOn(deps, start, join(dir, 'master.tiff'), steps)
  }
  const next = { ...set, master }
  await writeSet(deps, next)
  return next
}

async function writeSet(deps: PixelDeps, set: WorkingSet): Promise<void> {
  await atomically(join(dirOf(deps, set.key), 'set.json'), (tmp) =>
    writeFile(tmp, JSON.stringify(set))
  )
}

/** A set made before, by its key, if its files are all still there. */
async function findSet(deps: PixelDeps, key: string): Promise<WorkingSet | null> {
  const meta = join(dirOf(deps, key), 'set.json')
  if (!(await exists(meta))) return null
  const set = JSON.parse(await readFile(meta, 'utf8')) as WorkingSet
  return (await filesThere(set)) ? set : null
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
