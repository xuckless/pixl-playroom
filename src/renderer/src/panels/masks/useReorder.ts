import { useRef, useState } from 'react'
import { dropIndex } from '../../../../shared/masks'

export interface ReorderDrag {
  from: number
  to: number
  /** How far the dragged row has followed the pointer, px. */
  dy: number
  /** How far the rows it passes step aside, px (its height and the gap). */
  step: number
}

/**
 * A list reordered by dragging a row's grip: past 4px the row follows the
 * pointer and the rows it passes step aside; letting go moves it. The rows
 * are the container's children marked `data-reorder`, in list order.
 */
export function useReorder(onMove: (from: number, to: number) => void): {
  drag: ReorderDrag | null
  start: (e: React.PointerEvent<HTMLElement>, from: number) => void
  /** The offset for row `i` while a drag is on (its own, or stepping aside). */
  offset: (i: number) => number
} {
  const [drag, setDrag] = useState<ReorderDrag | null>(null)
  const live = useRef<ReorderDrag | null>(null)

  const start = (e: React.PointerEvent<HTMLElement>, from: number): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const grip = e.currentTarget
    const row = grip.closest<HTMLElement>('[data-reorder]')
    const list = row?.parentElement
    if (!row || !list) return
    const rows = [...list.querySelectorAll<HTMLElement>(':scope > [data-reorder]')]
    const box = row.getBoundingClientRect()
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0
    // The other rows' middles, measured once: they move only by our offsets.
    const middles = rows
      .filter((r) => r !== row)
      .map((r) => {
        const b = r.getBoundingClientRect()
        return b.top + b.height / 2
      })
    const y0 = e.clientY
    grip.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      const dy = ev.clientY - y0
      if (!live.current && Math.abs(dy) < 4) return
      const to = dropIndex(middles, box.top + box.height / 2 + dy)
      live.current = { from, to, dy, step: box.height + gap }
      setDrag(live.current)
    }
    const end = (): void => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
      const d = live.current
      live.current = null
      setDrag(null)
      if (d && d.to !== d.from) onMove(d.from, d.to)
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  }

  const offset = (i: number): number => {
    if (!drag) return 0
    if (i === drag.from) return drag.dy
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -drag.step
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return drag.step
    return 0
  }

  return { drag, start, offset }
}
