/**
 * A brush's strokes as the engine takes them (0.21.0, E36): vectors in
 * frame fractions, painted at the frame's own size, so a brush is as sharp
 * on the export as on the proxy it was painted on.
 *
 * A brush is a plane (an older brush's, a model's, an Auto Mask stroke's)
 * with strokes over it, painted and erased in order. The engine's eraser is
 * a `Subtract` component, which takes from everything before it in the
 * mask, so a brush goes as its own pieces (the plane, then each run of
 * paint or erase strokes) only where that is exactly the brush: alone in
 * its component when it is one piece, else where nothing before it in the
 * mask is touched (`brushRoute`). Anywhere else, and past the engine's
 * limits, the main process paints the whole brush into one plane
 * (main/brushes.ts), as it was before.
 */
import type { BrushStrokes, Dab, Orientation } from './engine-types'
import { effectiveMode } from './masks'
import { isPlainEdge } from './maskedge'
import { transformPoint } from './orientation'
import type { BrushComponent, BrushStrokeSetting, MaskComponentSetting, Recipe } from './recipe'
import { refining } from './refine'

/** The most dabs one component may hold (`BrushStrokes::MAX_DABS`). */
export const MAX_DABS = 100_000
/** The most frames a component's segment boxes may cover (`BrushStrokes::MAX_COVER`). */
export const MAX_COVER = 256

/** A brush component's id with `:base`: its plane's file, under strokes that go in place. */
export const basePlaneId = (id: string): string => `${id}:base`

const round5 = (v: number): number => Math.round(v * 1e5) / 1e5
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Strokes in runs of the same kind (painting or erasing), in order. */
export function strokeRuns(
  strokes: BrushStrokeSetting[]
): { erase: boolean; strokes: BrushStrokeSetting[] }[] {
  const runs: { erase: boolean; strokes: BrushStrokeSetting[] }[] = []
  for (const s of strokes) {
    const erase = s.erase === true
    const last = runs[runs.length - 1]
    if (last && last.erase === erase) last.strokes.push(s)
    else runs.push({ erase, strokes: [s] })
  }
  return runs
}

/** How many dabs. */
export function dabCount(strokes: BrushStrokeSetting[]): number {
  return strokes.reduce((n, s) => n + Math.floor(s.dabs.length / 4), 0)
}

/**
 * How many frames the strokes' segment boxes cover between them, as the
 * engine counts them (each grown by its larger radius): the same at any
 * size of one aspect, `w × h`.
 */
export function strokesCover(strokes: BrushStrokeSetting[], w: number, h: number): number {
  const short = Math.min(w, h)
  let cover = 0
  for (const s of strokes) {
    const n = Math.floor(s.dabs.length / 4)
    for (let k = 0; k < Math.max(1, n - 1); k++) {
      const j = n === 1 ? k : k + 1
      const dx = Math.abs(s.dabs[j * 4] - s.dabs[k * 4]) * w
      const dy = Math.abs(s.dabs[j * 4 + 1] - s.dabs[k * 4 + 1]) * h
      const g = Math.max(s.dabs[k * 4 + 2], s.dabs[j * 4 + 2]) * short
      cover += ((dx + 2 * g) * (dy + 2 * g)) / (w * h)
    }
  }
  return cover
}

/** Whether the engine paints these strokes as one component (its limits), in a `w × h` frame's aspect. */
export function paintable(strokes: BrushStrokeSetting[], w: number, h: number): boolean {
  return dabCount(strokes) <= MAX_DABS && strokesCover(strokes, w, h) <= MAX_COVER
}

/** A brush has strokes. */
export function hasStrokes(c: MaskComponentSetting): c is BrushComponent & {
  strokes: BrushStrokeSetting[]
} {
  return c.kind === 'brush' && (c.strokes?.length ?? 0) > 0
}

/**
 * How a brush reaches the engine:
 * - `plane`: one plane file (main/brushes.ts): a brush with no strokes, or
 *   one whose strokes can't go as they are: kept to an object (SAM needs a
 *   plane), an edge drawn into its plane, past the engine's limits, or
 *   erased where a `Subtract` would take from more than the brush.
 * - `strokes`: its pieces in its place.
 * - `lead`: its pieces first in the mask: everything before it adds, and a
 *   union is the same in any order, so its eraser takes from the brush alone.
 */
export type BrushRoute = 'plane' | 'strokes' | 'lead'

export function brushRoute(components: MaskComponentSetting[], index: number): BrushRoute {
  const c = components[index]
  if (!c || !hasStrokes(c)) return 'plane'
  if (refining(c) || (c.edge && !isPlainEdge(c.edge))) return 'plane'
  const runs = strokeRuns(c.strokes)
  const w = Math.max(1, c.width)
  const h = Math.max(1, c.height)
  if (runs.some((r) => !paintable(r.strokes, w, h))) return 'plane'
  const erases = runs.some((r) => r.erase)
  const pieces = (c.png || c.ref ? 1 : 0) + runs.length
  // One run of paint: the brush itself. (Erasing alone, it is nothing: a
  // `Subtract` of its own would take from the mask before it.)
  if (pieces === 1 && !erases) return 'strokes'
  // Opacity, inversion, feather and the edge apply to each piece, not to
  // the brush: only a brush with none of them goes in pieces.
  const plain =
    c.opacity >= 100 && !c.invert && c.feather === 0 && !(c.smooth ?? 0) && !(c.contrast ?? 0)
  if (!plain) return 'plane'
  const mode = effectiveMode(index, c.mode)
  // Unions (and subtractions of them) in a row: the same as one of the whole.
  if (!erases && (mode === 'Add' || mode === 'Subtract')) return 'strokes'
  if (mode !== 'Add') return 'plane'
  // Its eraser takes from the brush alone only first in the mask, and one
  // brush can be first: an earlier one that erases in pieces already is.
  const before = components.slice(0, index)
  const taken = before.some(
    (d, i) =>
      hasStrokes(d) && d.strokes.some((s) => s.erase) && brushRoute(components, i) !== 'plane'
  )
  if (taken) return 'plane'
  if (index === 0) return 'strokes'
  return before.every((d, i) => effectiveMode(i, d.mode) === 'Add') ? 'lead' : 'plane'
}

/**
 * Strokes as the engine paints them in the user-turned frame: dabs turned
 * as a lasso's points are, the radius (of the shorter side) as it is.
 */
export function engineStrokes(strokes: BrushStrokeSetting[], user: Orientation): BrushStrokes {
  return {
    strokes: strokes
      .map((s) => {
        const dabs: Dab[] = []
        for (let k = 0; k + 3 < s.dabs.length; k += 4) {
          const q = transformPoint(user, { x: s.dabs[k], y: s.dabs[k + 1] })
          dabs.push({
            x: round5(clamp(q.x, -1, 2)),
            y: round5(clamp(q.y, -1, 2)),
            radius: clamp(round5(s.dabs[k + 2]), 1e-5, 1),
            pressure: clamp(Math.round(s.dabs[k + 3] * 1000) / 1000, 0, 1)
          })
        }
        return { dabs, softness: clamp(s.softness, 0, 1), flow: clamp(s.flow, 0, 1) }
      })
      .filter((s) => s.dabs.length > 0)
  }
}

/** A short, stable name for a list of strokes (a painted plane's file is named by it). */
export function strokesKey(strokes: BrushStrokeSetting[]): string {
  let h = 0x811c9dc5
  const mix = (n: number): void => {
    h ^= n
    h = Math.imul(h, 0x01000193)
  }
  for (const s of strokes) {
    for (let i = 0; i < s.id.length; i++) mix(s.id.charCodeAt(i))
    mix(s.dabs.length)
    for (const v of s.dabs) mix(Math.round(v * 1e5) | 0)
    mix(Math.round(s.softness * 1e4))
    mix(Math.round(s.flow * 1e4))
    mix(s.erase ? 1 : 0)
  }
  return (h >>> 0).toString(36)
}

// ── Painting (views/loupe/BrushTool.tsx) ─────────────────────────────────────

/**
 * A stroke keeps a dab every this much of the brush's diameter, and at a
 * step in pressure: the engine joins kept dabs with capsules (their radius
 * and pressure running linearly between), so the dabs drawn between them
 * while painting (every eighth) add nothing it would not paint.
 */
export const KEEP_EVERY = 1 / 4
export const KEEP_PRESSURE = 0.08
/** Past this long a picture, painting shows the tint alone, not the adjustment. */
export const LIVE_SLOW_MS = 500

/** A dab as painted: base-frame fractions, the radius of the shorter side. */
export interface PaintedDab {
  x: number
  y: number
  r: number
  p: number
}

/**
 * Whether a stroke keeps this dab: the first, then each a quarter of the
 * diameter on from the last kept (in a `planeW × planeH` frame of the
 * base's aspect), or a step in pressure.
 */
export function keepsDab(kept: number[], dab: PaintedDab, planeW: number, planeH: number): boolean {
  const n = kept.length
  if (n < 4) return true
  const [x, y, r, p] = kept.slice(n - 4)
  const short = Math.min(planeW, planeH)
  const apart = Math.hypot((dab.x - x) * planeW, (dab.y - y) * planeH)
  return (
    apart >= KEEP_EVERY * 2 * Math.max(r, dab.r) * short || Math.abs(dab.p - p) >= KEEP_PRESSURE
  )
}

/** A dab as a stroke keeps it: four numbers, rounded as the recipe holds them. */
export function keptDab(dab: PaintedDab): number[] {
  return [
    round5(dab.x),
    round5(dab.y),
    Math.max(1e-5, round5(dab.r)),
    Math.round(dab.p * 1000) / 1000
  ]
}

/**
 * Whether painting shows the adjustment under the brush as it goes: the
 * mask already does something, and pictures come quickly enough (the last
 * took `lastRenderMs`). Else the tint alone, as before.
 */
export function paintsLive(settingsNeutral: boolean, lastRenderMs: number | null): boolean {
  return !settingsNeutral && (lastRenderMs === null || lastRenderMs <= LIVE_SLOW_MS)
}

/** `r` with the stroke in its brush (the brush made when new): as painted so far, or whole. */
export function withStroke(
  r: Recipe,
  layerId: string,
  compId: string,
  stroke: BrushStrokeSetting,
  made: () => BrushComponent
): void {
  const l = r.layers.find((x) => x.id === layerId)
  if (!l) return
  let c = l.components.find((x): x is BrushComponent => x.id === compId && x.kind === 'brush')
  if (!c) {
    c = made()
    l.components.push(c)
  }
  const strokes = (c.strokes ??= [])
  const at = strokes.findIndex((x) => x.id === stroke.id)
  if (at >= 0) strokes[at] = stroke
  else strokes.push(stroke)
}

/** A brush carried onto the masks' lens frame (BrushTool): its plane re-warped and stored, its strokes mapped. */
export interface CarriedBrush {
  /** The re-warped plane's reference, when it has a plane a stroke leaves as it is. */
  ref?: string
  strokes?: BrushStrokeSetting[]
}

/**
 * The brush in `r` as `m` carried it onto the masks' frame, no frame of its
 * own: a stroke painted into it now lands where its earlier ones are. The
 * stroke being painted (a live draft's) stays after them.
 */
export function carryBrush(r: Recipe, layerId: string, compId: string, m: CarriedBrush): void {
  const c = r.layers
    .find((l) => l.id === layerId)
    ?.components.find((x): x is BrushComponent => x.id === compId && x.kind === 'brush')
  if (!c) return
  if (m.ref) {
    c.png = ''
    c.ref = m.ref
  }
  if (m.strokes) {
    const ids = new Set(m.strokes.map((x) => x.id))
    c.strokes = [...m.strokes, ...(c.strokes ?? []).filter((x) => !ids.has(x.id))]
  }
  delete c.lensFrame
}
