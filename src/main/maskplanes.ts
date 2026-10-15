/**
 * Raster masks' planes prepared once per frame size (0.21.0, E37). A brush
 * plane, a model's mask or a depth map is a PNG the engine would read,
 * decode and resample to the frame on every render; prepared, it is decoded
 * and resampled once, kept in the engine host (native memory: about 17 MB
 * at a 2560 px proxy), and named beside every render of that frame. A
 * render reads the file's bytes and checks its hash, so a repainted plane
 * (a new file anyway: planes are named by their content) is never stale.
 *
 * The engine refuses a render naming a plane no raster component of it
 * reads, two of one source and size, or one at another size than the frame
 * its mask is planned on: a render names exactly the planes its grade
 * reads, at its own frame's size, and one refused (or gone with its host)
 * renders again without them (`planeRefused`). Only the interactive
 * pictures prepare: the 1:1 view's full frame (180 MB a plane at 45 MP) and
 * an export (one render) decode as before.
 */
import type { Grade, GradeOp, Mask, PlaneOp, PlaneResult, Resampler } from '../shared/engine-types'

/** A raster component's source as a prepared plane is keyed by it. */
export interface RasterSource {
  path: string
  resampler: Exclude<Resampler, 'Ai'>
}

/** Every raster component's source a grade reads (a layer's mask, a masked group's), each once. */
export function rasterSources(grade: Grade | null): RasterSource[] {
  const out = new Map<string, RasterSource>()
  const fromMask = (m: Mask | null): void => {
    for (const c of m?.components ?? []) {
      if (!('Raster' in c.shape)) continue
      const { source, resampler } = c.shape.Raster
      if (!('Png' in source) || resampler === 'Ai') continue
      out.set(`${source.Png}|${resampler}`, { path: source.Png, resampler })
    }
  }
  const fromOps = (ops: GradeOp[]): void => {
    for (const op of ops)
      if ('Masked' in op) {
        fromMask(op.Masked.mask)
        fromOps(op.Masked.ops)
      }
  }
  for (const l of grade?.layers ?? []) {
    fromMask(l.mask)
    for (const st of l.stages) fromOps(st.ops)
  }
  return [...out.values()]
}

/** The name a plane is kept by: its source, its resampler and the frame's size. */
export function planeKey(s: RasterSource, width: number, height: number): string {
  return `${s.path}|${s.resampler}|${width}x${height}`
}

/** Whether a render failed for its prepared planes (refused, or gone with the host): render without. */
export function planeRefused(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; field?: unknown } | null
  if (!e || typeof e !== 'object') return false
  const field = typeof e.field === 'string' ? e.field : ''
  const message = typeof e.message === 'string' ? e.message : ''
  return (
    field.startsWith('mask_planes') ||
    /mask_planes\[/.test(message) ||
    (e.code === 'Stale' && /mask plane/.test(message))
  )
}

/** What the host is asked: its `planes` calls. */
export interface PlaneHost {
  planes(call: PlaneOp): Promise<PlaneResult>
}

interface Kept {
  id: string
  /** The photo's folder and the frame's size: where a refusal counts. */
  at: string
  bytes: number
  /** Resolves true once prepared, false if it could not be. */
  ready: Promise<boolean>
  used: number
}

/**
 * Refusals at one photo's frame size before its planes stop being prepared
 * there: one can be a file changed since it was prepared (prepared again,
 * it is used), a second means the engine plans its masks at another size,
 * and every render would be made twice.
 */
const STRIKES = 2

/**
 * The planes the interactive host keeps, least recently used going first
 * past `capBytes`. One host's: `clear` when a new one starts.
 */
export class MaskPlanes {
  private kept = new Map<string, Kept>()
  /** Renders refused for their planes, by photo folder and frame size (`Kept.at`). */
  private strikes = new Map<string, number>()
  private tick = 0
  private nextId = 0
  private readonly host: PlaneHost
  private readonly capBytes: number
  private readonly threads: () => number

  constructor(host: PlaneHost, capBytes: number, threads: () => number) {
    this.host = host
    this.capBytes = capBytes
    this.threads = threads
  }

  /**
   * The planes a render of `grade` on a `width × height` frame names,
   * prepared now where they are not (each once, however many renders ask).
   * What the same photo's grade no longer reads at this size is let go: a
   * mask deleted or repainted, a plane snapped anew. A plane that could not
   * be prepared is left out (the render decodes its PNG as before).
   */
  async namesFor(
    grade: Grade | null,
    width: number,
    height: number,
    /** The photo's folder: its planes' files are under it. */
    dir: string
  ): Promise<string[]> {
    const sources = rasterSources(grade)
    const keys = new Set(sources.map((s) => planeKey(s, width, height)))
    const size = `|${width}x${height}`
    const gone = [...this.kept.keys()].filter(
      (k) => k.startsWith(dir) && k.endsWith(size) && !keys.has(k)
    )
    if (gone.length) this.release(gone)
    const at = `${dir}${size}`
    if ((this.strikes.get(at) ?? 0) >= STRIKES) return []
    const now = ++this.tick
    const wanted = sources.map((s) => {
      const key = planeKey(s, width, height)
      let k = this.kept.get(key)
      if (!k) {
        const id = `p${++this.nextId}`
        const made: Kept = {
          id,
          at,
          bytes: width * height * 4,
          ready: Promise.resolve(false),
          used: 0
        }
        made.ready = this.host
          .planes({
            op: 'prepare',
            id,
            request: {
              source: { Png: s.path },
              resampler: s.resampler,
              width,
              height,
              threads: this.threads(),
              limits: null
            }
          })
          .then(
            (r) => {
              if (r.op === 'prepare') made.bytes = r.bytes
              return true
            },
            () => {
              // Not prepared (no such engine, a file it can't read): decoded per render.
              if (this.kept.get(key) === made) this.kept.delete(key)
              return false
            }
          )
        k = made
        this.kept.set(key, k)
      }
      k.used = now
      return k
    })
    this.trim(now)
    const ready = await Promise.all(wanted.map((k) => k.ready))
    return wanted.filter((_, i) => ready[i]).map((k) => k.id)
  }

  /**
   * Planes a render was refused for (`refused`), or the host lost: made
   * again when next asked, unless that frame size was refused too often.
   */
  forget(ids: string[], refused = true): void {
    const gone = [...this.kept].filter(([, k]) => ids.includes(k.id))
    if (refused)
      for (const at of new Set(gone.map(([, k]) => k.at)))
        this.strikes.set(at, (this.strikes.get(at) ?? 0) + 1)
    this.release(gone.map(([key]) => key))
  }

  /** Every plane of a photo's (its folder), when it closes. */
  releaseUnder(dir: string): void {
    this.release([...this.kept.keys()].filter((k) => k.startsWith(dir)))
    for (const at of [...this.strikes.keys()]) if (at.startsWith(dir)) this.strikes.delete(at)
  }

  /** A new host holds none of them. */
  clear(): void {
    this.kept.clear()
  }

  /** The bytes kept now. */
  get bytes(): number {
    let n = 0
    for (const k of this.kept.values()) n += k.bytes
    return n
  }

  private release(keys: string[]): void {
    const ids: string[] = []
    for (const key of keys) {
      const k = this.kept.get(key)
      if (!k) continue
      this.kept.delete(key)
      ids.push(k.id)
    }
    if (ids.length) void this.host.planes({ op: 'release', ids }).catch(() => undefined)
  }

  /** Past the cap, the least recently used go (never one this render names). */
  private trim(now: number): void {
    let total = this.bytes
    if (total <= this.capBytes) return
    const old = [...this.kept].filter(([, k]) => k.used < now).sort((a, b) => a[1].used - b[1].used)
    const drop: string[] = []
    for (const [key, k] of old) {
      if (total <= this.capBytes) break
      drop.push(key)
      total -= k.bytes
    }
    this.release(drop)
  }
}
