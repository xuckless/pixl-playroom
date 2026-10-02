/**
 * Which of a mask component's settings the panel shows, and what the hidden
 * ones should be. Each kind shows only what it needs (Lightroom's set):
 *
 * - a lasso: Feather and Shift edge (its feather kept inside the line);
 * - a radial: one Feather, which is its `softness`;
 * - a range: Smoothness and its bands;
 * - a brush (an AI mask is one), a linear gradient: nothing; the brush's own
 *   size and feather, a gradient's handles shape them.
 *
 * Older recipes may hold other values (a feather on a brush, a component's
 * opacity, a hardened edge). They still compile as they are; the panel only
 * offers to put them back to these defaults, so nothing it can't show
 * changes the picture unnoticed.
 */
import { isPlainEdge, type MaskEdge } from './maskedge'
import type { MaskComponentSetting } from './recipe'

/** A new AI mask's edge: a little in, somewhat harder (its plane is soft and blooms). */
export const AI_MASK_EDGE: MaskEdge = { shift: -15, harden: 35 }

/** A range's feather, under its Smoothness (`emptyRange`). */
export const RANGE_FEATHER = 5

export interface ComponentControls {
  feather: boolean
  shift: boolean
  /** Radial: Feather drives `softness`. */
  softness: boolean
  range: boolean
}

export function componentControls(c: MaskComponentSetting): ComponentControls {
  return {
    feather: c.kind === 'polygon',
    shift: c.kind === 'polygon',
    softness: c.kind === 'radial',
    range: c.kind === 'range'
  }
}

/** Whether the card has anything to show (else only its row does). */
export function hasControls(c: MaskComponentSetting): boolean {
  const k = componentControls(c)
  return k.feather || k.shift || k.softness || k.range
}

const sameEdge = (a: MaskEdge | undefined, b: MaskEdge): boolean =>
  !!a && Math.round(a.shift) === b.shift && Math.round(a.harden) === b.harden && !a.inside

/** An AI mask's plane: a brush whose edge was hardened (only the model's default does). */
function fromModel(c: MaskComponentSetting): boolean {
  return c.kind === 'brush' && (c.edge?.harden ?? 0) > 0
}

/** The edge this kind keeps where the panel can't show it. */
function hiddenEdge(c: MaskComponentSetting): MaskEdge | undefined {
  if (c.kind === 'polygon')
    return { shift: Math.round(c.edge?.shift ?? 0), harden: 0, inside: true }
  if (fromModel(c)) return AI_MASK_EDGE
  return undefined
}

function edgeMatches(c: MaskComponentSetting): boolean {
  const want = hiddenEdge(c)
  if (c.kind === 'polygon') return Math.round(c.edge?.harden ?? 0) === 0 && !!c.edge?.inside
  if (!want) return isPlainEdge(c.edge)
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
