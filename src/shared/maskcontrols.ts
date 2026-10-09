/**
 * Which of a mask component's settings the panel shows, and what the hidden
 * ones should be. Each kind shows only what it needs (Lightroom's set):
 *
 * - a lasso: Feather, Shift edge (its feather kept inside the line) and
 *   Snap to edges;
 * - a model's mask (Subject, an object, the sky…): Snap to edges and Shift
 *   edge;
 * - a painted brush: Snap to edges, and Shift edge while it snaps; its own
 *   size and feather shape it;
 * - a radial: one Feather, which is its `softness`;
 * - a range: Smoothness and its bands;
 * - a linear or bidirectional gradient: nothing; their handles shape them.
 *
 * Snap to edges is the engine's refine with its Edge radius
 * (shared/refine.ts). Older recipes may hold other values (a feather on a
 * brush, a component's opacity, a hardened edge). They still compile as
 * they are; the panel only offers to put them back to these defaults, so
 * nothing it can't show changes the picture unnoticed.
 */
import { isPlainEdge, type MaskEdge } from './maskedge'
import { refinable, refining } from './refine'
import type { MaskComponentSetting } from './recipe'

/**
 * An AI mask's edge before Snap to edges (engine 0.16): a little in,
 * somewhat harder (its plane is soft and blooms). Masks made since snap to
 * the picture instead (`MODEL_REFINE`); this stays an older recipe's.
 */
export const AI_MASK_EDGE: MaskEdge = { shift: -15, harden: 35 }

/** A range's feather, under its Smoothness (`emptyRange`). */
export const RANGE_FEATHER = 5

export interface ComponentControls {
  feather: boolean
  shift: boolean
  /** Radial: Feather drives `softness`. */
  softness: boolean
  range: boolean
  /** A depth range's Near, Far, Softness and its picker. */
  depth: boolean
  /** Snap to edges and its Edge radius. */
  snap: boolean
}

export function componentControls(c: MaskComponentSetting): ComponentControls {
  return {
    feather: c.kind === 'polygon',
    shift: c.kind === 'polygon' || fromModel(c) || (c.kind === 'brush' && refining(c)),
    softness: c.kind === 'radial',
    range: c.kind === 'range',
    depth: c.kind === 'depth',
    snap: refinable(c)
  }
}

/** Whether the card has anything to show (else only its row does). */
export function hasControls(c: MaskComponentSetting): boolean {
  const k = componentControls(c)
  return k.feather || k.shift || k.softness || k.range || k.depth || k.snap
}

const sameEdge = (a: MaskEdge | undefined, b: MaskEdge): boolean =>
  !!a && Math.round(a.shift) === b.shift && Math.round(a.harden) === b.harden && !a.inside

/**
 * A model's mask: a brush plane a model says it made, or (an older recipe's,
 * from before it said) one whose edge was hardened, as only a model's was.
 */
export function fromModel(c: MaskComponentSetting): boolean {
  return c.kind === 'brush' && (c.source !== undefined || (c.edge?.harden ?? 0) > 0)
}

/** The edge this kind keeps where the panel can't show it (what it shows, as it is). */
function hiddenEdge(c: MaskComponentSetting): MaskEdge | undefined {
  if (c.kind === 'polygon')
    return { shift: Math.round(c.edge?.shift ?? 0), harden: 0, inside: true }
  const shift = Math.round(c.edge?.shift ?? 0)
  // Snapped: the snap firms the edge up, so no harden.
  if (c.kind === 'brush' && refining(c)) return { shift, harden: 0 }
  if (c.kind === 'brush' && fromModel(c)) {
    // One made before Snap to edges: firmed up by its harden. One that says a
    // model made it may also have none (snapped, then not).
    const none = c.source !== undefined && Math.round(c.edge?.harden ?? 0) !== AI_MASK_EDGE.harden
    return { shift, harden: none ? 0 : AI_MASK_EDGE.harden }
  }
  return undefined
}

function edgeMatches(c: MaskComponentSetting): boolean {
  if (c.kind === 'polygon') return Math.round(c.edge?.harden ?? 0) === 0 && !!c.edge?.inside
  const want = hiddenEdge(c)
  if (!want || isPlainEdge(want)) return isPlainEdge(c.edge)
  return sameEdge(c.edge, want)
}

function hiddenFeather(c: MaskComponentSetting): number | null {
  if (c.kind === 'polygon') return null
  return c.kind === 'range' ? RANGE_FEATHER : 0
}

/**
 * Whether a setting the panel doesn't show is off its default: an older
 * recipe's feather on a brush, a component opacity, a harden, a lasso's
 * feather moved out of its line.
 */
export function hiddenAdjusted(c: MaskComponentSetting): boolean {
  if (Math.round(c.opacity) !== 100) return true
  const f = hiddenFeather(c)
  if (f !== null && Math.round(c.feather) !== f) return true
  return !edgeMatches(c)
}

/** The component with its hidden settings at their defaults (what it shows stays). */
export function resetHidden<T extends MaskComponentSetting>(c: T): T {
  const next: T = { ...c, opacity: 100 }
  const f = hiddenFeather(c)
  if (f !== null) next.feather = f
  const e = hiddenEdge(c)
  if (e && !isPlainEdge(e)) next.edge = e
  else delete next.edge
  return next
}
