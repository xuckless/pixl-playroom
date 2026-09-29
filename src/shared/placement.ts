/**
 * Where a popover goes beside the thing that opened it: under it (or over
 * it) by `gap`, lined up with its left or right edge, kept `margin` inside
 * the viewport. It flips to the other side when its own side is too short,
 * and when neither side fits it takes the roomier one and scrolls.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface Placement {
  x: number
  y: number
  side: 'bottom' | 'top'
  /** The most height the popover may take before it scrolls. */
  maxHeight: number
}

export function placePopover(
  anchor: Rect,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
  o: { align: 'left' | 'right'; side: 'bottom' | 'top'; gap: number; margin: number }
): Placement {
  const below = viewport.h - o.margin - (anchor.bottom + o.gap)
  const above = anchor.top - o.gap - o.margin
  const room = (s: 'bottom' | 'top'): number => (s === 'bottom' ? below : above)
  const other = o.side === 'bottom' ? 'top' : 'bottom'
  const side =
    size.h <= room(o.side)
      ? o.side
      : size.h <= room(other)
        ? other
        : room(o.side) >= room(other)
          ? o.side
          : other
  const maxHeight = Math.max(0, room(side))
  const h = Math.min(size.h, maxHeight)
  const y = side === 'bottom' ? anchor.bottom + o.gap : anchor.top - o.gap - h
  const want = o.align === 'left' ? anchor.left : anchor.right - size.w
  const x = Math.max(o.margin, Math.min(want, viewport.w - o.margin - size.w))
  return { x, y, side, maxHeight }
}
