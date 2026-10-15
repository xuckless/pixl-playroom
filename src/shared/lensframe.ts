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
 * - a point (a lasso's, a gradient's ends or centre, a spot's, a brush
 *   stroke's dab) through the old correction's ST map back to the photo,
 *   then forward through the inverse of the new one (Newton's method on the
 *   new map, which is smooth and monotone);
 * - a radius by the scale an area keeps there (√|det J|); an ellipse stays
 *   an ellipse, a dab a dab;
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
import type { BrushComponent, BrushStrokeSetting, MaskComponentSetting, Recipe } from './recipe'
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

/** A brush with a plane of pixels under its strokes (an older brush's, a model's, Auto Mask's). */
const hasPlane = (c: BrushComponent): boolean => !!(c.png || c.ref)

/**
 * Whether a component is placed by points (not a plane): carried by mapping
 * them. A brush of strokes alone (0.21.0, E36) is: its dabs are points.
 */
export function isVector(c: MaskComponentSetting): boolean {
  return (
    c.kind === 'polygon' ||
    c.kind === 'linear' ||
    c.kind === 'radial' ||
    c.kind === 'bidirectional' ||
    (c.kind === 'brush' && !hasPlane(c) && (c.strokes?.length ?? 0) > 0)
  )
}

/**
 * Whether a component is a plane of pixels (a brush, a model's mask, a
 * depth map). A brush's strokes over its plane stay on the plane's frame
 * (`lensFrame`), and are mapped with it only where it is rendered.
 */
export function isRaster(c: MaskComponentSetting): boolean {
  return (c.kind === 'brush' && !isVector(c)) || c.kind === 'depth'
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

const round5 = (v: number): number => Math.round(v * 1e5) / 1e5

/** One stroke carried by `f` (`remapStrokes`). */
function remapStroke(s: BrushStrokeSetting, f: (p: P) => P): BrushStrokeSetting {
  const dabs = s.dabs.slice()
  const h = 1e-3
  for (let k = 0; k + 3 < dabs.length; k += 4) {
    const x = dabs[k]
    const y = dabs[k + 1]
    // `areaScale`, with the centre's own image reused: three maps a dab, not four.
    const a = f({ x, y })
    const u = f({ x: x + h, y })
    const v = f({ x, y: y + h })
    const det = ((u.x - a.x) * (v.y - a.y) - (u.y - a.y) * (v.x - a.x)) / (h * h)
    // Rounded as the recipe holds a dab (shared/strokes.ts `keptDab`).
    dabs[k] = round5(a.x)
    dabs[k + 1] = round5(a.y)
    dabs[k + 2] = Math.max(1e-5, round5(dabs[k + 2] * Math.sqrt(Math.abs(det))))
  }
  return { ...s, dabs }
}

/**
 * Brush strokes carried by `f`: each dab's centre mapped, its radius (a
 * fraction of the shorter side) by the scale an area keeps there, as a
 * radial's radii are.
 */
export function remapStrokes(strokes: BrushStrokeSetting[], f: (p: P) => P): BrushStrokeSetting[] {
  return strokes.map((s) => remapStroke(s, f))
}

/**
 * Strokes carried between two frames, kept (`placeMasks` 'render'): a brush
 * under another lens than the one rendered is carried at every compile, and
 * a large one is a few hundred thousand map lookups. Keyed by the pair of
 * frames, the maps themselves, and the stroke's content; at most `KEEP_DABS`
 * dabs held.
 */
const carriedStrokes = new Map<string, BrushStrokeSetting>()
const KEEP_DABS = 200_000
let carriedDabs = 0
const mapIds = new WeakMap<StMap, number>()
let nextMapId = 0
function mapId(m: StMap | null | undefined): number {
  if (!m) return 0
  let id = mapIds.get(m)
  if (id === undefined) mapIds.set(m, (id = ++nextMapId))
  return id
}

/** A stroke's content, as a short name (its dabs hashed). */
function strokeSig(s: BrushStrokeSetting): string {
  let h = 0x811c9dc5
  for (const v of s.dabs) {
    h ^= Math.round(v * 1e5) | 0
    h = Math.imul(h, 0x01000193)
  }
  return `${s.id}:${s.dabs.length}:${(h >>> 0).toString(36)}`
}

function carryStrokesKept(
  strokes: BrushStrokeSetting[],
  f: (p: P) => P,
  pair: string
): BrushStrokeSetting[] {
  return strokes.map((s) => {
    const key = `${pair}|${strokeSig(s)}`
    const hit = carriedStrokes.get(key)
    if (hit) {
      // The newest last: the oldest goes first.
      carriedStrokes.delete(key)
      carriedStrokes.set(key, hit)
      return { ...s, dabs: hit.dabs }
    }
    const out = remapStroke(s, f)
    carriedStrokes.set(key, out)
    carriedDabs += out.dabs.length / 4
    while (carriedDabs > KEEP_DABS && carriedStrokes.size > 1) {
      const oldest = carriedStrokes.keys().next().value as string
      carriedDabs -= (carriedStrokes.get(oldest)?.dabs.length ?? 0) / 4
      carriedStrokes.delete(oldest)
    }
    return out
  })
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
    case 'brush':
      return c.strokes?.length ? { ...c, strokes: remapStrokes(c.strokes, f) } : c
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

/**
 * The spots of `r` on the frame `frames` carries them to (`r` itself when
 * null: all on the frame rendered). What the lens-corrected proxies bake in
 * (main/render.ts): a render from them leaves the spots out, so one baked
 * where it was drawn would stay off its content however the lens is now.
 */
export function spotsOn(
  r: Pick<Recipe, 'retouch' | 'masks'>,
  frames: MaskFrames | null
): RetouchSpot[] {
  if (!frames) return r.retouch
  const masks = r.masks?.lensFrame ?? null
  return r.retouch.map((s) => {
    const from = frameOf(s, masks)
    return sameLensFrame(from, frames.to) ? s : remapSpot(s, frameMap(frames.maps, from, frames.to))
  })
}

/**
 * What spots baked on frame `to` hold beyond their own points: the frames
 * they are carried from ('' when every one is on `to`), so a bake of the
 * same points drawn under another lens is another bake.
 */
export function spotFramesKey(r: Pick<Recipe, 'retouch' | 'masks'>, to: LensFrame): string {
  const masks = r.masks?.lensFrame ?? null
  const from = r.retouch.map((s) => frameOf(s, masks))
  return from.every((f) => sameLensFrame(f, to))
    ? ''
    : `${from.map(lensFrameKey).join('|')}>${lensFrameKey(to)}`
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
 *   hands the engine the plane re-warped (main/brushes.ts), and the strokes
 *   over it are mapped as points are; `r` itself when nothing is on another
 *   frame.
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
  // A render's strokes come from those kept, when carried by these maps before.
  const toMap = `${lensFrameKey(to)}#${mapId(frames.maps[lensFrameKey(to)])}`
  const carry = <T extends MaskComponentSetting>(c: T, from: LensFrame): T => {
    if (how !== 'render' || c.kind !== 'brush' || !c.strokes?.length)
      return remapComponent(c, mapFrom(from))
    const key = lensFrameKey(from)
    const pair = `${key}#${mapId(frames.maps[key])}>${toMap}`
    return { ...c, strokes: carryStrokesKept(c.strokes, mapFrom(from), pair) }
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
        const placed = carry(c, from)
        return how === 'rebase' ? unframed(placed) : placed
      }
      if (how === 'render') {
        // A plane's strokes, where they go to the engine as they are.
        if (c.kind !== 'brush' || !c.strokes?.length || !moved(from)) return c
        any = true
        return carry(c, from)
      }
      if (!isRaster(c)) return c
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
  /** The frame rendered it maps to and from (main/maskframe.ts `maskGrid` says). */
  rendered?: LensFrame
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
