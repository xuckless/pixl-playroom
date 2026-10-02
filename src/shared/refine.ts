/**
 * Snap to edges: a mask component's edge pulled onto the picture's own by
 * the engine's refine (0.16, `MaskComponent.refine`), a guided filter of its
 * plane by the luminance, after its feather. A model's coarse plane or a
 * rough brush stroke takes the photo's outline at whatever resolution the
 * engine renders, so a 1024 px plane stays crisp on a 45 MP export. It is a
 * smoothing that follows edges, not a segmentation: the radius should be
 * about three times how far off the plane is.
 *
 * Offered on a brush, a lasso and a model's mask (`refinable`), and on by
 * default for a model's (`MODEL_REFINE`). On a model's mask the panel's Shift
 * edge moves the snapped edge (the refine's `contract`, resolution-free)
 * rather than the plane, which is then drawn without it (`planeEdge`).
 *
 * A painted stroke snaps further (`snapsToObject`): a luminance filter
 * cannot tell which side of an edge a stroke meant (skin against skin, or
 * against a wall as bright, barely is an edge to it), so the stroke is first
 * kept to the object SAM finds under it (main/brushes.ts), and the refine
 * then only smooths that object's last pixels.
 */
import type { Refine } from './engine-types'
import { EDGE_SHIFT_SPAN, isPlainEdge, type MaskEdge } from './maskedge'
import type { MaskComponentSetting, MaskRefine } from './recipe'

/** The Edge radius slider's ends, % of the frame's shorter side (the engine's 0.0005…0.05). */
export const EDGE_RADIUS_MIN = 0.05
export const EDGE_RADIUS_MAX = 5
/**
 * An older model mask's plane (before its edge was made crisp): 1024 px on
 * its long side and soft, a texel or so off on a 24 MP frame (0.15% of the
 * shorter side).
 */
export const AI_EDGE_RADIUS = 0.4
/**
 * A model's plane now (SAM's, and the subject model's hardened one) is
 * already crisp and on the photo's edges at the proxy's size: only its last
 * pixel or two is snapped. Where the ground beside an edge is flat the
 * refine blurs it over its radius, so a wider one would put a halo back
 * around the subject (measured: 0.2% starts tracing noise as well).
 */
export const MODEL_EDGE_RADIUS = 0.1
/** A hand-drawn edge is further off than a model's. */
export const DRAWN_EDGE_RADIUS = 0.6
/** How strong a luminance step must be to hold the selection (steps from about 0.1 do). */
export const REFINE_EPSILON = 1e-3

/** A model's new mask (Subject, Background, Objects, Sky, Find object, a look's pick). */
export const MODEL_REFINE: MaskRefine = { on: true, radius: MODEL_EDGE_RADIUS }

/** The snap a model's new mask starts with. */
export function modelRefine(): MaskRefine {
  return { ...MODEL_REFINE }
}

/**
 * A soft model plane made crisp, in place: its values about `at` (0…1)
 * stretched `times` times, what is well inside and outside kept.
 */
export function hardenPlane(grey: Uint8Array, at: number, times: number): void {
  const mid = at * 255
  for (let i = 0; i < grey.length; i++)
    grey[i] = Math.max(0, Math.min(255, Math.round((grey[i] - mid) * times + 127.5)))
}

/** The Edge radius a component's snap starts at, and resets to. */
export function defaultEdgeRadius(c: MaskComponentSetting): number {
  if (c.kind !== 'brush') return DRAWN_EDGE_RADIUS
  // A model's plane, or a stroke kept to its object: both already on the photo's edges.
  if (c.source || !(c.edge?.harden ?? 0)) return MODEL_EDGE_RADIUS
  // An older recipe's model mask: no source, a hardened soft plane.
  return AI_EDGE_RADIUS
}

/** A painted stroke snapped: kept to the object SAM finds under it, then refined. */
export function snapsToObject(c: MaskComponentSetting): boolean {
  return c.kind === 'brush' && !c.source && c.refine?.on === true
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

/** Whether a component can be snapped: its edge is drawn or found, not computed. */
export function refinable(c: MaskComponentSetting): boolean {
  return c.kind === 'brush' || c.kind === 'polygon'
}

/** Whether it is snapped. */
export function refining(c: MaskComponentSetting): boolean {
  return refinable(c) && c.refine?.on === true
}

/** The engine's refine for a component, or null when it is not snapped. */
export function engineRefine(c: MaskComponentSetting): Refine | null {
  if (!refining(c) || !c.refine) return null
  const radius = clamp(c.refine.radius, EDGE_RADIUS_MIN, EDGE_RADIUS_MAX) / 100
  // A painted plane's Shift edge moves the snapped edge: + grows it, and
  // the engine's contract shrinks for +.
  const shift = c.kind === 'brush' ? clamp(c.edge?.shift ?? 0, -100, 100) : 0
  const contract = (-shift / 100) * EDGE_SHIFT_SPAN
  return { radius: round6(radius), epsilon: REFINE_EPSILON, contract: round6(contract) || 0 }
}

/**
 * The edge a painted plane is drawn with before it reaches the engine: a
 * snapped one's shift is the refine's (`engineRefine`), so not the plane's.
 */
export function planeEdge(c: MaskComponentSetting): MaskEdge | undefined {
  if (!c.edge || c.kind !== 'brush' || !refining(c)) return c.edge
  const e = { ...c.edge, shift: 0 }
  return isPlainEdge(e) ? undefined : e
}
