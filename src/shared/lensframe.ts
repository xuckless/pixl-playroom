/**
 * The lens a photo's masks were drawn under. Every mask coordinate is a
 * fraction of the lens-corrected frame (engine geometry.md: lens, then
 * masks, then framing), so a change of the correction's geometry (the
 * distortion slider, a profile switched on, off or resolved late, a fisheye
 * defished or its Field moved, Optics switched off) moves the picture under
 * masks that stay where they were: up to 15–85 px at the edges of a 6000 px
 * photo for a strong manual distortion.
 *
 * So the recipe records the frame its masks are on (`Recipe.masks.lensFrame`,
 * and a raster's own `lensFrame` where it differs), and when that is not the
 * frame rendered every mask is carried from one to the other:
 *
 * - a point (a lasso's, a gradient's ends or centre, a spot's) through the
 *   old correction's ST map back to the photo, then forward through the
 *   inverse of the new one (Newton's method on the new map, which is smooth
 *   and monotone);
 * - a radius by the scale an area keeps there (√|det J|); an ellipse stays
 *   an ellipse;
 * - a raster plane re-warped once, through the same map, into a file of
 *   its own (main/brushes.ts).
 *
 * Nothing is done when the frames agree: a photo with no correction that
 * moves pixels, and the usual case of masks drawn on the picture as it is.
 * A lens edit rewrites the recipe's points into the new frame when it
 * settles (main/maskframe.ts `rebaseMasks`), as reframe.ts carries a crop
 * across a turn; Optics switched off is mapped at compile time only, and the
 * loupe gets a coarse grid of the same map (`LensGrid`) so handles and new
 * strokes stay on what they were drawn on.
 *
 * ENGINE-REQUESTS E85 asks for masks on the source frame (`frame: 'Source'`
 * on a raster and on vector shapes) and `mapPoints`: with them the engine
 * places masks under any correction exactly, and this remapping goes.
 *
 * Pure, for tests.
 */
import type { Distortion, LensCorrection } from './engine-types'
import { lensCorrection } from './lens'
import type { MaskComponentSetting, Recipe } from './recipe'
import type { RetouchSpot } from './retouch'

/** A point, normalised to its frame. */
export interface P {
  x: number
  y: number
}

/** The lens geometry masks are drawn under: the correction's distortion, or null for none. */
export type LensFrame = Distortion | null

/** The geometry part of a correction: what moves pixels (lateral CA and vignetting do not). */
export function lensFrameOf(lens: LensCorrection | null | undefined): LensFrame {
  return lens?.distortion ?? null
}

/** The frame a recipe's own lens settings make (Optics switched on or off alike). */
export function ownLensFrame(r: Pick<Recipe, 'lens'>): LensFrame {
  return lensFrameOf(lensCorrection(r.lens))
}

/** JSON with its keys in order: one text for one value, however it was written. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  if (v !== null && typeof v === 'object')
    return `{${Object.keys(v)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  return JSON.stringify(v)
}

/** A frame as text: equal frames give equal keys. */
export function lensFrameKey(f: LensFrame | undefined): string {
  return f ? canonical(f) : 'none'
}

export function sameLensFrame(a: LensFrame | undefined, b: LensFrame | undefined): boolean {
  return lensFrameKey(a ?? null) === lensFrameKey(b ?? null)
}

/** A frame read from a sidecar: a distortion, null, or nothing usable (undefined). */
export function normaliseLensFrame(v: unknown): LensFrame | undefined {
  if (v === null) return null
  if (typeof v !== 'object' || Array.isArray(v)) return undefined
  const d = v as Record<string, unknown>
  const isObj = (x: unknown): boolean => typeof x === 'object' && x !== null
  if (!isObj(d.model) || !isObj(d.geometry)) return undefined
  if (typeof d.amount !== 'number' || typeof d.scale !== 'number') return undefined
  return v as Distortion
}

// ── ST maps ──────────────────────────────────────────────────────────────────

/**
 * A correction's ST map (main/pixels/lensmap.ts), decoded: for each pixel of
 * the corrected frame (`w × h`, centres at (i + 0.5) / w), where in the photo
 * it comes from, as fractions of the photo.
 */
export interface StMap {
  w: number
  h: number
  sx: Float32Array
  sy: Float32Array
}

/**
 * The map at a corrected point (normalised), bilinear; past the map's edge
 * carried on along its edge cells, so a point outside the frame (a
 * gradient's far end) still maps.
 */
export function stForward(m: StMap, p: P): P {
  const u = p.x * m.w - 0.5
  const v = p.y * m.h - 0.5
  const i = Math.min(m.w - 2, Math.max(0, Math.floor(u)))
  const j = Math.min(m.h - 2, Math.max(0, Math.floor(v)))
  const fx = u - i
  const fy = v - j
  const k = j * m.w + i
  const lerp = (a: Float32Array): number =>
    (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fy) +
    (a[k + m.w] * (1 - fx) + a[k + m.w + 1] * fx) * fy
  return { x: lerp(m.sx), y: lerp(m.sy) }
}

/**
 * The corrected point a photo point lands at: the map inverted by Newton's
 * method from `guess` (the map is smooth and monotone; a few steps).
 */
export function stInverse(m: StMap, s: P, guess: P = s): P {
  let q = { ...guess }
  const hx = 0.5 / m.w
  const hy = 0.5 / m.h
  for (let it = 0; it < 30; it++) {
    const f = stForward(m, q)
    const ex = f.x - s.x
    const ey = f.y - s.y
    if (Math.abs(ex) < 1e-9 && Math.abs(ey) < 1e-9) break
    const fxp = stForward(m, { x: q.x + hx, y: q.y })
    const fyp = stForward(m, { x: q.x, y: q.y + hy })
    const a = (fxp.x - f.x) / hx
    const b = (fyp.x - f.x) / hy
    const c = (fxp.y - f.y) / hx
    const d = (fyp.y - f.y) / hy
    const det = a * d - b * c
    if (!(Math.abs(det) > 1e-12)) break
    q = { x: q.x - (d * ex - b * ey) / det, y: q.y - (-c * ex + a * ey) / det }
  }
  return q
}

/** Each frame's ST map, by `lensFrameKey`; null for no correction (the identity). */
export type FrameMaps = Record<string, StMap | null>

/** What carries masks to the frame rendered: that frame, and the maps of every frame met. */
export interface MaskFrames {
  to: LensFrame
  maps: FrameMaps
}

/** A point of frame `from` where it lands in frame `to` (normalised both). */
export function frameMap(maps: FrameMaps, from: LensFrame, to: LensFrame): (p: P) => P {
  if (sameLensFrame(from, to)) return (p) => p
  const a = maps[lensFrameKey(from)] ?? null
  const b = maps[lensFrameKey(to)] ?? null
  return (p) => {
    const s = a ? stForward(a, p) : p
    return b ? stInverse(b, s, p) : s
  }
}

/** How much `f` scales an area about `p`, as a length: √|det J|. */
export function areaScale(f: (p: P) => P, p: P): number {
  const h = 1e-3
  const a = f(p)
  const x = f({ x: p.x + h, y: p.y })
  const y = f({ x: p.x, y: p.y + h })
  const det = ((x.x - a.x) * (y.y - a.y) - (x.y - a.y) * (y.x - a.x)) / (h * h)
  return Math.sqrt(Math.abs(det))
}

// ── The masks a recipe places ────────────────────────────────────────────────

/** A component's own frame, if it has one (a raster made under another lens, a pasted mask). */
type Framed = { lensFrame?: LensFrame }

/** Whether a component is placed by points (not a plane): carried by mapping them. */
export function isVector(c: MaskComponentSetting): boolean {
  return (
    c.kind === 'polygon' || c.kind === 'linear' || c.kind === 'radial' || c.kind === 'bidirectional'
  )
}

/** Whether a component is a plane of pixels (a brush, a model's mask, a depth map). */
export function isRaster(c: MaskComponentSetting): boolean {
  return c.kind === 'brush' || c.kind === 'depth'
}

/** The frame a component (or a spot) is on: its own, else the masks'. */
export function frameOf(item: Framed, masks: LensFrame): LensFrame {
  return item.lensFrame !== undefined ? item.lensFrame : masks
}

/** Every frame a placed mask or spot of `r` is on (none when it has nothing placed). */
export function framesIn(r: Recipe): LensFrame[] {
  const out = new Map<string, LensFrame>()
  const masks = r.masks?.lensFrame ?? null
  const add = (f: LensFrame): void => void out.set(lensFrameKey(f), f)
  for (const l of r.layers)
    for (const c of l.components) if (isVector(c) || isRaster(c)) add(frameOf(c, masks))
  for (const s of r.retouch) add(frameOf(s, masks))
  return [...out.values()]
}

/** A component's points carried by `f` (its radii by the scale an area keeps). */
export function remapComponent<T extends MaskComponentSetting>(c: T, f: (p: P) => P): T {
  switch (c.kind) {
    case 'polygon': {
      const found = c.found && {
        ...c.found,
        faces: c.found.faces.map((face) => {
          const [x, y, w, h] = face.bounds
          const a = f({ x, y })
          const b = f({ x: x + w, y: y + h })
          return {
            bounds: [a.x, a.y, b.x - a.x, b.y - a.y] as typeof face.bounds,
            rings: face.rings.map((ring) => ring.map(f))
          }
        })
      }
      return {
        ...c,
        points: c.points.map(f),
        ...(c.rings ? { rings: c.rings.map((ring) => ring.map(f)) } : {}),
        ...(found ? { found } : {})
      }
    }
    case 'linear':
    case 'bidirectional':
      return { ...c, start: f(c.start), end: f(c.end) }
    case 'radial': {
      const k = areaScale(f, c.centre)
      return { ...c, centre: f(c.centre), radiusX: c.radiusX * k, radiusY: c.radiusY * k }
    }
    default:
      return c
  }
}

/** A spot's points and source carried by `f`, its radii by the scale an area keeps. */
export function remapSpot(s: RetouchSpot, f: (p: P) => P): RetouchSpot {
  const k = s.points.length ? areaScale(f, s.points[0]) : 1
  return {
    ...s,
    points: s.points.map(f),
    source: s.source && f(s.source),
    radius: s.radius * k,
    radiusY: s.radiusY * k
  }
}

/** `c` without its own frame. */
function unframed<T extends Framed>(c: T): T {
  if (c.lensFrame === undefined) return c
  const { lensFrame: _, ...rest } = c
  void _
  return rest as T
}

/**
 * The recipe with every mask and spot on frame `frames.to`.
 *
 * - `render` (compile): points mapped; a raster plane is left to main, which
 *   hands the engine the plane re-warped (main/brushes.ts); `r` itself when
 *   nothing is on another frame.
 * - `rebase` (a lens edit settling): the same, written into the recipe:
 *   `masks.lensFrame` becomes `to`, the points move, and a raster keeps
 *   its pixels and says which frame they are on (re-warping it each time
 *   would blur it), until it is painted again.
 */
export function placeMasks(r: Recipe, frames: MaskFrames, how: 'render' | 'rebase'): Recipe {
  const masks = r.masks?.lensFrame ?? null
  const to = frames.to
  const moved = (f: LensFrame): boolean => !sameLensFrame(f, to)
  const maps = new Map<string, (p: P) => P>()
  const mapFrom = (from: LensFrame): ((p: P) => P) => {
    const key = lensFrameKey(from)
    let m = maps.get(key)
    if (!m) maps.set(key, (m = frameMap(frames.maps, from, to)))
    return m
  }
  let changed = how === 'rebase' && moved(masks)
  const layers = r.layers.map((l) => {
    let any = false
    const components = l.components.map((c) => {
      const from = frameOf(c, masks)
      // A gradient an older version gave an edge is drawn into a plane by
      // main, from its points: it moves as the others do.
      if (isVector(c)) {
        if (!moved(from)) {
          if (how === 'rebase' && c.lensFrame !== undefined) {
            any = true
            return unframed(c)
          }
          return c
        }
        any = true
        const placed = remapComponent(c, mapFrom(from))
        return how === 'rebase' ? unframed(placed) : placed
      }
      if (how === 'render' || !isRaster(c)) return c
      // A plane in a rebase: it says which frame it is on, if not the new one.
      const own = c.lensFrame
      if (!moved(from)) {
        if (own === undefined) return c
        any = true
        return unframed(c)
      }
      if (own !== undefined) return c
      any = true
      return { ...c, lensFrame: from }
    })
    if (!any) return l
    changed = true
    return { ...l, components }
  })
  const retouch = r.retouch.map((s) => {
    const from = frameOf(s, masks)
    if (!moved(from)) {
      if (how === 'rebase' && s.lensFrame !== undefined) {
        changed = true
        return unframed(s)
      }
      return s
    }
    changed = true
    const placed = remapSpot(s, mapFrom(from))
    return how === 'rebase' ? unframed(placed) : placed
  })
  if (!changed) return r
  return {
    ...r,
    layers,
    retouch,
    ...(how === 'rebase' ? { masks: { ...r.masks, lensFrame: to } } : {})
  }
}

/**
 * What a settling edit must do for the masks to be on the recipe's own
 * lens: nothing; `retag` (no point to move, only the record, and a raster's
 * own frame written down); or `remap` (points to carry, which takes the
 * correction's maps: main/maskframe.ts `rebaseMasks`).
 */
export function rebaseNeed(r: Recipe): 'none' | 'retag' | 'remap' {
  const own = ownLensFrame(r)
  const masks = r.masks?.lensFrame ?? null
  const onOther = (item: Framed): boolean => !sameLensFrame(frameOf(item, masks), own)
  for (const l of r.layers)
    for (const c of l.components) if (isVector(c) && onOther(c)) return 'remap'
  for (const s of r.retouch) if (onOther(s)) return 'remap'
  return sameLensFrame(masks, own) ? 'none' : 'retag'
}

/** A `retag`: the masks' record moved to the recipe's own lens, nothing to map. */
export function retagMasks(r: Recipe): Recipe {
  return placeMasks(r, { to: ownLensFrame(r), maps: {} }, 'rebase')
}

/**
 * Masks pasted or synced from another photo, put on the target's frame: a
 * component or spot that does not say its own frame is marked with the
 * source's, and the target maps it (at compile time, and into its own
 * frame when its next edit settles).
 */
export function carryFrame<T extends Framed>(items: T[], from: LensFrame, to: LensFrame): T[] {
  if (sameLensFrame(from, to)) return items
  return items.map((i) => (i.lensFrame !== undefined ? i : { ...i, lensFrame: from }))
}

// ── The loupe's grid ─────────────────────────────────────────────────────────

/** The grid's nodes on each side: coarse, the map is smooth. */
export const GRID_N = 33

/**
 * The map between the frame rendered and the masks' frame, sampled on an
 * `n × n` grid of the base frame (normalised): `toMasks` at each node of the
 * rendered frame, `toRendered` at each node of the masks' frame. The loupe
 * puts a pointer through it after the display → base map, and a handle
 * through it before base → display (view.ts).
 */
export interface LensGrid {
  n: number
  toMasks: number[]
  toRendered: number[]
}

export function makeGrid(toMasks: (p: P) => P, toRendered: (p: P) => P, n = GRID_N): LensGrid {
  const sample = (f: (p: P) => P): number[] => {
    const out: number[] = []
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const q = f({ x: i / (n - 1), y: j / (n - 1) })
        out.push(q.x, q.y)
      }
    return out
  }
  return { n, toMasks: sample(toMasks), toRendered: sample(toRendered) }
}

/** A point through one of a grid's maps: bilinear, carried on past its edge. */
export function gridPoint(values: number[], n: number, p: P): P {
  const u = p.x * (n - 1)
  const v = p.y * (n - 1)
  const i = Math.min(n - 2, Math.max(0, Math.floor(u)))
  const j = Math.min(n - 2, Math.max(0, Math.floor(v)))
  const fx = u - i
  const fy = v - j
  const at = (a: number, b: number, c: 0 | 1): number => values[((b * n + a) << 1) + c]
  const lerp = (c: 0 | 1): number =>
    (at(i, j, c) * (1 - fx) + at(i + 1, j, c) * fx) * (1 - fy) +
    (at(i, j + 1, c) * (1 - fx) + at(i + 1, j + 1, c) * fx) * fy
  return { x: lerp(0), y: lerp(1) }
}

// ── A raster plane re-warped ─────────────────────────────────────────────────

/** Where each node of an `n × n` grid over the new plane reads from in the old one. */
export interface PlaneWarp {
  n: number
  xy: number[]
}

/** The nodes of `f`, which takes a point of the new frame to the old (normalised both). */
export function planeWarp(f: (p: P) => P, n = 65): PlaneWarp {
  const xy: number[] = []
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const q = f({ x: i / (n - 1), y: j / (n - 1) })
      xy.push(q.x, q.y)
    }
  return { n, xy }
}

/**
 * A grey plane (`w × h`, 8 bits) resampled through `warp`: each pixel read,
 * bilinearly, where the warp says it was; outside the old plane, nothing.
 */
export function warpPlane(data: Uint8Array, w: number, h: number, warp: PlaneWarp): Uint8Array {
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = gridPoint(warp.xy, warp.n, { x: (x + 0.5) / w, y: (y + 0.5) / h })
      const sx = q.x * w - 0.5
      const sy = q.y * h - 0.5
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > h - 0.5) continue
      const x0 = Math.min(w - 1, Math.max(0, Math.floor(sx)))
      const y0 = Math.min(h - 1, Math.max(0, Math.floor(sy)))
      const x1 = Math.min(w - 1, x0 + 1)
      const y1 = Math.min(h - 1, y0 + 1)
      const fx = Math.min(1, Math.max(0, sx - x0))
      const fy = Math.min(1, Math.max(0, sy - y0))
      const top = data[y0 * w + x0] * (1 - fx) + data[y0 * w + x1] * fx
      const bottom = data[y1 * w + x0] * (1 - fx) + data[y1 * w + x1] * fx
      out[y * w + x] = Math.round(top * (1 - fy) + bottom * fy)
    }
  return out
}
