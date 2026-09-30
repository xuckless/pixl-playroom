/**
 * Guided Upright: lines drawn along edges that should be vertical or level,
 * on the whole frame as it is before any warp (the display *is* the frame,
 * so a point on screen is already a fraction of it). Drag to draw a line —
 * up to four — drag an end to move it, Alt-click a line to remove it. The
 * floating bar applies them.
 */
import { memo, useRef, useState } from 'react'
import type { GuideLine } from '../../../../shared/upright'
import { normalisedIn, type P, type Rect } from '../../../../shared/view'
import { useDevelop } from '../../state/develop'

export const MAX_GUIDES = 4

type Drag = { kind: 'new'; from: P; to: P } | { kind: 'end'; line: number; end: 'from' | 'to' }

export const UprightGuides = memo(function UprightGuides({
  rect
}: {
  rect: Rect
}): React.JSX.Element {
  const guides = useDevelop((s) => s.guides)
  const setGuides = useDevelop((s) => s.setGuides)
  const [drag, setDrag] = useState<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const at = (e: React.PointerEvent): P => {
    const p = normalisedIn(e.clientX, e.clientY, box.current!.getBoundingClientRect())
    return { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) }
  }
  const px = (p: P): { x: number; y: number } => ({ x: p.x * rect.w, y: p.y * rect.h })
  const lines: GuideLine[] =
    drag?.kind === 'new' ? [...guides, { from: drag.from, to: drag.to }] : guides
  return (
    <div
      ref={box}
      className="tool-layer upright-guides"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = at(e)
        setDrag({ kind: 'new', from: p, to: p })
      }}
      onPointerMove={(e) => {
        if (!drag) return
        const p = at(e)
        if (drag.kind === 'new') setDrag({ ...drag, to: p })
        else setGuides(guides.map((g, i) => (i === drag.line ? { ...g, [drag.end]: p } : g)))
      }}
      onPointerUp={() => {
        if (drag?.kind === 'new') {
          const len = Math.hypot(
            (drag.to.x - drag.from.x) * rect.w,
            (drag.to.y - drag.from.y) * rect.h
          )
          // A click is not a line; a fifth line replaces the oldest.
          if (len > 12) setGuides([...guides, { from: drag.from, to: drag.to }].slice(-MAX_GUIDES))
        }
        setDrag(null)
      }}
    >
      <svg width={rect.w} height={rect.h}>
        {lines.map((l, i) => {
          const a = px(l.from)
          const b = px(l.to)
          const upright = Math.abs(b.x - a.x) < Math.abs(b.y - a.y)
          return (
            <g key={i} className={upright ? 'guide vertical' : 'guide level'}>
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className="guide-hit"
                onPointerDown={(e) => {
                  if (!e.altKey) return
                  e.stopPropagation()
                  setGuides(guides.filter((_, j) => j !== i))
                }}
              />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="guide-line" />
              {i < guides.length &&
                (['from', 'to'] as const).map((end) => {
                  const p = end === 'from' ? a : b
                  return (
                    <circle
                      key={end}
                      cx={p.x}
                      cy={p.y}
                      r={5}
                      className="guide-end"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        box.current?.setPointerCapture(e.pointerId)
                        setDrag({ kind: 'end', line: i, end })
                      }}
                    />
                  )
                })}
            </g>
          )
        })}
      </svg>
    </div>
  )
})
