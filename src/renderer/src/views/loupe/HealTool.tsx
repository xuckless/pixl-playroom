/**
 * The Heal tool on the photo: press on a flaw, hold and drag to where it
 * should copy from, let go — healed (or cloned), and the circles are gone.
 * A press that does not move heals from where the engine finds best. Fill,
 * red eye and pet eye are a click. Each spot is baked into the photo's pixels
 * (lib/heal.ts); Undo takes it away, and the next one works on what it healed.
 * With a mask selected, spots keep inside it.
 *
 * Points are kept in the base frame (`displayToBase`), radii as fractions of
 * the frame's shorter side.
 */
import { memo, useRef, useState } from 'react'
import type { P } from '../../../../shared/retouch'
import {
  displaySize,
  displayToBase,
  normalisedIn,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { beginSpot, cancelSpot, dragSource, endSpot } from '../../lib/heal'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'

/** A press that moves less than this (screen px) picks its own source. */
const STILL_PX = 5

interface Screen {
  x: number
  y: number
}

/** A spot being placed: where it is, and where its source is being dragged. */
interface Placing {
  id: string
  at: P
  source: P
  pointer: number
}

export const HealTool = memo(function HealTool({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const tool = useDevelop((s) => s.tool)
  const heal = useUi((s) => s.heal)
  const [placing, setPlacing] = useState<Placing | null>(null)
  const [hover, setHover] = useState<Screen | null>(null)
  const box = useRef<HTMLDivElement>(null)

  if (!recipe) return null
  // Mounted only while Heal shows: it takes the photo unless another tool has it.
  const active = tool === 'heal' || tool === 'none'

  const d = displaySize(g)
  // The frame's shorter side, in screen pixels.
  const shortPx = (Math.min(g.width, g.height) * rect.w) / d.width
  const at = (e: React.PointerEvent): P =>
    normalisedIn(e.clientX, e.clientY, box.current!.getBoundingClientRect())
  const screenOf = (p: P): Screen => ({ x: p.x * rect.w, y: p.y * rect.h })
  const copies = heal.mode === 'heal' || heal.mode === 'clone'
  const eyes = heal.mode === 'redeye' || heal.mode === 'peteye'
  const brushR = (eyes ? heal.size / 2 : heal.size) * shortPx

  const release = (): void => {
    if (!placing) return
    setPlacing(null)
    const a = screenOf(placing.at)
    const b = screenOf(placing.source)
    const moved = Math.hypot(a.x - b.x, a.y - b.y) >= STILL_PX
    void endSpot(placing.id, moved ? displayToBase(g, placing.source) : null)
  }

  return (
    <div
      ref={box}
      className={`tool-layer heal-layer${active ? ' active' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        if (!active || e.button !== 0 || placing) return
        const p = at(e)
        if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return
        const base = displayToBase(g, p)
        if (!copies) {
          // Fill and the eyes: a click.
          const r = heal.size / (eyes ? 2 : 1)
          const id = beginSpot(
            heal.mode,
            base,
            eyes ? { radius: r, radiusY: r, rotate: 0 } : undefined
          )
          if (id) void endSpot(id, null)
          return
        }
        const id = beginSpot(heal.mode, base)
        if (!id) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setPlacing({ id, at: p, source: p, pointer: e.pointerId })
      }}
      onPointerMove={(e) => {
        const p = at(e)
        setHover(screenOf(p))
        if (!placing || e.pointerId !== placing.pointer) return
        setPlacing({ ...placing, source: p })
        dragSource(placing.id, displayToBase(g, p))
      }}
      onPointerUp={release}
      onPointerCancel={() => {
        if (placing) cancelSpot(placing.id)
        setPlacing(null)
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg width={rect.w} height={rect.h}>
        {placing &&
          (() => {
            const a = screenOf(placing.at)
            const b = screenOf(placing.source)
            const moved = Math.hypot(a.x - b.x, a.y - b.y) >= STILL_PX
            return (
              <g>
                {moved && (
                  <>
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="spot-link" />
                    <g className="spot-anchor">
                      <circle cx={b.x} cy={b.y} r={brushR} className="spot-src" />
                      <path
                        d={`M${b.x - 7} ${b.y}h14M${b.x} ${b.y - 7}v14`}
                        className="spot-cross"
                      />
                    </g>
                  </>
                )}
                <circle cx={a.x} cy={a.y} r={brushR} className="spot selected" />
              </g>
            )
          })()}
        {/* The brush, following the pointer. */}
        {active && hover && !placing && (
          <circle cx={hover.x} cy={hover.y} r={brushR} className="heal-brush" />
        )}
      </svg>
      {placing && (
        <div className="tool-hint">
          {heal.mode === 'clone'
            ? 'Drag to where it copies from · let go to clone'
            : 'Drag to where it copies from, or let go to heal'}
        </div>
      )}
    </div>
  )
})
