/**
 * The Heal tool on the photo: press on a flaw, hold and drag to where it
 * should copy from, let go — healed (or cloned), and the circles are gone.
 * A press that does not move heals from where the engine finds best. Fill,
 * red eye and pet eye are a click; Remove is painted over what should go (or,
 * with Find object, a click on it). Each spot is baked into the photo's pixels
 * (lib/heal.ts); Undo takes it away, and the next one works on what it healed.
 * With a mask selected, spots keep inside it.
 *
 * Points are kept in the base frame (`displayToBase`), radii as fractions of
 * the frame's shorter side.
 */
import { memo, useRef, useState } from 'react'
import type { P } from '../../../../shared/retouch'
import {
  displayToBase,
  normalisedIn,
  spotOutline,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import {
  beginSpot,
  cancelSpot,
  dragSource,
  endSpot,
  extendSpot,
  removeObjectAt
} from '../../lib/heal'
import { ensureModelId } from '../../lib/ensureModel'
import { useModels } from '../../lib/models'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'
import { t } from '../../lib/i18n'

/** A press that moves less than this (screen px) picks its own source. */
const STILL_PX = 5

interface Screen {
  x: number
  y: number
}

/** The object remover (engine 0.18). */
const INPAINTER = 'migan-512'

/** A Remove being painted: its spot, and the pointer's path on screen. */
interface Painting {
  id: string
  path: P[]
  pointer: number
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
  const [painting, setPainting] = useState<Painting | null>(null)
  const models = useModels()
  const removerHere = models.find((m) => m.id === INPAINTER)?.installed === true
  const [hover, setHover] = useState<Screen | null>(null)
  const box = useRef<HTMLDivElement>(null)

  if (!recipe) return null
  // Mounted only while Heal shows: it takes the photo unless another tool has it.
  const active = tool === 'heal' || tool === 'none'

  const at = (e: React.PointerEvent): P =>
    normalisedIn(e.clientX, e.clientY, box.current!.getBoundingClientRect())
  const screenOf = (p: P): Screen => ({ x: p.x * rect.w, y: p.y * rect.h })
  const copies = heal.mode === 'heal' || heal.mode === 'clone'
  const eyes = heal.mode === 'redeye' || heal.mode === 'peteye'
  /**
   * The brush's outline about a display point: round on the base frame,
   * where the spot is made, so under an Upright warp it shows the shape that
   * will be healed (a circle without one).
   */
  /** The brush's radius on screen about a display point (round on the base frame). */
  const radiusPx = (p: P): number => {
    const c = screenOf(p)
    const pts = spotOutline(g, displayToBase(g, p), heal.size, 8)
    return Math.max(...pts.map((q) => Math.hypot(q.x * rect.w - c.x, q.y * rect.h - c.y)))
  }
  const brushPx = painting ? radiusPx(painting.path[0]) : 0
  const outline = (p: P): string => {
    const pts = spotOutline(g, displayToBase(g, p), eyes ? heal.size / 2 : heal.size)
    return `M${pts.map((q) => `${q.x * rect.w} ${q.y * rect.h}`).join('L')}Z`
  }

  const release = (): void => {
    if (painting) {
      const p = painting
      setPainting(null)
      const a = screenOf(p.path[0])
      const moved = p.path.some((q) => {
        const b = screenOf(q)
        return Math.hypot(a.x - b.x, a.y - b.y) >= STILL_PX
      })
      // A click with Find object: the object there, not a disc.
      if (!moved && heal.findObject) {
        cancelSpot(p.id)
        removeObjectAt(displayToBase(g, p.path[0]))
      } else void endSpot(p.id, null)
      return
    }
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
        if (heal.mode === 'remove') {
          // Baked or nothing: an HDR photo keeps live spots, and a live Remove draws nothing.
          if (useDevelop.getState().session?.isHdr) return
          // MI-GAN first, offered there and then when it is not downloaded.
          if (!removerHere) {
            void ensureModelId(INPAINTER, false, t('Remove'))
            return
          }
          const id = beginSpot('remove', base)
          if (!id) return
          e.currentTarget.setPointerCapture(e.pointerId)
          setPainting({ id, path: [p], pointer: e.pointerId })
          return
        }
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
        if (painting && e.pointerId === painting.pointer) {
          setPainting({ ...painting, path: [...painting.path, p] })
          extendSpot(painting.id, displayToBase(g, p))
          return
        }
        if (!placing || e.pointerId !== placing.pointer) return
        setPlacing({ ...placing, source: p })
        dragSource(placing.id, displayToBase(g, p))
      }}
      onPointerUp={release}
      onPointerCancel={() => {
        if (placing) cancelSpot(placing.id)
        if (painting) cancelSpot(painting.id)
        setPlacing(null)
        setPainting(null)
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
                      <path d={outline(placing.source)} className="spot-src" />
                      <path
                        d={`M${b.x - 7} ${b.y}h14M${b.x} ${b.y - 7}v14`}
                        className="spot-cross"
                      />
                    </g>
                  </>
                )}
                <path d={outline(placing.at)} className="spot selected" />
              </g>
            )
          })()}
        {/* A Remove being painted: what will be filled. */}
        {painting && (
          <path
            d={`M${painting.path.map((q) => `${q.x * rect.w} ${q.y * rect.h}`).join('L')}`}
            className="remove-stroke"
            style={{ strokeWidth: brushPx * 2 }}
          />
        )}
        {/* The brush, following the pointer. */}
        {active && hover && !placing && (
          <path d={outline({ x: hover.x / rect.w, y: hover.y / rect.h })} className="heal-brush" />
        )}
      </svg>
      {placing && (
        <div className="tool-hint">
          {heal.mode === 'clone'
            ? t('Drag to where it copies from · let go to clone')
            : t('Drag to where it copies from, or let go to heal')}
        </div>
      )}
    </div>
  )
})
