/**
 * The Heal tool on the photo. With the tool on, a click places a round spot
 * of the chosen mode, a drag paints a stroke (heal, clone, fill) or draws an
 * eye's ellipse (red eye, pet eye). Every spot shows as an outline, a heal's
 * or clone's source as a dashed one joined to it; drag a spot to move it,
 * drag a source to choose another, click to select, ⌫ to delete.
 *
 * Points are kept in the base frame (`displayToBase`), radii as fractions of
 * the frame's shorter side, so they stay put whatever the framing does.
 */
import { memo, useRef, useState } from 'react'
import type { P, RetouchSpot } from '../../../../shared/retouch'
import {
  baseToDisplay,
  displaySize,
  displayToBase,
  normalisedIn,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { addSpot, changeSpot, commitSpot } from '../../lib/heal'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'

type Drag =
  | { kind: 'paint'; points: P[] }
  | { kind: 'eye'; from: P; to: P }
  | { kind: 'move'; id: string; start: P; orig: P[]; moved: boolean }
  | { kind: 'source'; id: string; start: P; orig: P; moved: boolean }

export const HealTool = memo(function HealTool({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe)
  const tool = useDevelop((s) => s.tool)
  const spotId = useDevelop((s) => s.spotId)
  const setSpotId = useDevelop((s) => s.setSpotId)
  const heal = useUi((s) => s.heal)
  const [drag, setDrag] = useState<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)
  if (!recipe) return null
  // Mounted only while Heal shows: it takes the photo unless another tool has it.
  const active = tool === 'heal' || tool === 'none'
  if (!active && !heal.showSpots) return null

  // Frame pixels per screen pixel, and the frame's shorter side in screen pixels.
  const d = displaySize(g)
  const shortPx = (Math.min(g.width, g.height) * rect.w) / d.width
  const toScreen = (p: P): { x: number; y: number } => {
    const q = baseToDisplay(g, p)
    return { x: q.x * rect.w, y: q.y * rect.h }
  }
  const at = (e: React.PointerEvent): P =>
    normalisedIn(e.clientX, e.clientY, box.current!.getBoundingClientRect())
  const eyes = heal.mode === 'redeye' || heal.mode === 'peteye'

  const finish = (): void => {
    if (!drag) return
    if (drag.kind === 'paint') {
      const pts = drag.points
      const len = pts.reduce(
        (a, p, i) =>
          i === 0
            ? 0
            : a + Math.hypot((p.x - pts[i - 1].x) * rect.w, (p.y - pts[i - 1].y) * rect.h),
        0
      )
      // A click is a round spot; a drag is a stroke, its points thinned to a
      // quarter radius apart.
      const base =
        len < 4
          ? [displayToBase(g, pts[0])]
          : pts
              .filter((p, i) => {
                if (i === 0 || i === pts.length - 1) return true
                const q = pts[i - 1]
                return (
                  Math.hypot((p.x - q.x) * rect.w, (p.y - q.y) * rect.h) >=
                  heal.size * shortPx * 0.25
                )
              })
              .map((p) => displayToBase(g, p))
      void addSpot(heal.mode, base)
    } else if (drag.kind === 'eye') {
      const c = { x: (drag.from.x + drag.to.x) / 2, y: (drag.from.y + drag.to.y) / 2 }
      const rx = (Math.abs(drag.to.x - drag.from.x) * rect.w) / 2 / shortPx
      const ry = (Math.abs(drag.to.y - drag.from.y) * rect.h) / 2 / shortPx
      if (Math.max(rx, ry) * shortPx < 3) {
        // A click: an eye of the tool's size.
        void addSpot(heal.mode, [displayToBase(g, c)], {
          radius: heal.size / 2,
          radiusY: heal.size / 2,
          rotate: 0
        })
      } else {
        void addSpot(heal.mode, [displayToBase(g, c)], {
          radius: Math.max(0.002, rx),
          radiusY: Math.max(0.002, ry),
          rotate: 0
        })
      }
    } else if (drag.kind === 'move' && drag.moved) commitSpot(drag.id, 'move')
    else if (drag.kind === 'source' && drag.moved) commitSpot(drag.id, 'source')
    setDrag(null)
  }

  const shape = (s: RetouchSpot): React.JSX.Element => {
    const sel = s.id === spotId
    const cls = `spot ${s.kind}${sel ? ' selected' : ''}${s.enabled ? '' : ' off'}`
    const grab = (e: React.PointerEvent): void => {
      if (!active) return
      e.stopPropagation()
      setSpotId(s.id)
      box.current?.setPointerCapture(e.pointerId)
      setDrag({
        kind: 'move',
        id: s.id,
        start: displayToBase(g, at(e)),
        orig: s.points,
        moved: false
      })
    }
    const r = s.radius * shortPx
    let dest: React.JSX.Element
    if (s.kind === 'redeye' || s.kind === 'peteye') {
      const c = toScreen(s.points[0])
      dest = (
        <ellipse
          cx={c.x}
          cy={c.y}
          rx={r}
          ry={(s.radiusY || s.radius) * shortPx}
          transform={`rotate(${s.rotate} ${c.x} ${c.y})`}
          className={cls}
          onPointerDown={grab}
        />
      )
    } else if (s.points.length > 1) {
      const pts = s.points.map(toScreen)
      dest = (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          className={`${cls} stroke`}
          style={{ strokeWidth: 2 * r }}
          onPointerDown={grab}
        />
      )
    } else {
      const c = toScreen(s.points[0])
      dest = <circle cx={c.x} cy={c.y} r={r} className={cls} onPointerDown={grab} />
    }
    const src =
      s.source && (s.kind === 'heal' || s.kind === 'clone')
        ? (() => {
            const a = toScreen(s.points[0])
            const shift = { x: s.source.x - s.points[0].x, y: s.source.y - s.points[0].y }
            const b = toScreen(s.source)
            const srcPts = s.points.map((p) => toScreen({ x: p.x + shift.x, y: p.y + shift.y }))
            return (
              <g className={`spot-source${sel ? ' selected' : ''}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="spot-link" />
                {srcPts.length > 1 ? (
                  <polyline
                    points={srcPts.map((p) => `${p.x},${p.y}`).join(' ')}
                    className="spot-src stroke"
                    style={{ strokeWidth: 2 * r }}
                  />
                ) : (
                  <circle
                    cx={b.x}
                    cy={b.y}
                    r={r}
                    className="spot-src"
                    onPointerDown={(e) => {
                      if (!active) return
                      e.stopPropagation()
                      setSpotId(s.id)
                      box.current?.setPointerCapture(e.pointerId)
                      setDrag({
                        kind: 'source',
                        id: s.id,
                        start: displayToBase(g, at(e)),
                        orig: s.source!,
                        moved: false
                      })
                    }}
                  />
                )}
              </g>
            )
          })()
        : null
    return (
      <g key={s.id}>
        {src}
        {dest}
      </g>
    )
  }

  const live = drag?.kind === 'paint' ? drag.points : null
  return (
    <div
      ref={box}
      className={`tool-layer heal-layer${active ? ' active' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        if (!active || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setSpotId(null)
        const p = at(e)
        setDrag(eyes ? { kind: 'eye', from: p, to: p } : { kind: 'paint', points: [p] })
      }}
      onPointerMove={(e) => {
        if (!drag) return
        const p = at(e)
        if (drag.kind === 'paint') setDrag({ ...drag, points: [...drag.points, p] })
        else if (drag.kind === 'eye') setDrag({ ...drag, to: p })
        else {
          const b = displayToBase(g, p)
          const dx = b.x - drag.start.x
          const dy = b.y - drag.start.y
          if (drag.kind === 'move')
            changeSpot(
              drag.id,
              (s) => (s.points = drag.orig.map((q) => ({ x: q.x + dx, y: q.y + dy }))),
              true
            )
          else
            changeSpot(
              drag.id,
              (s) => (s.source = { x: drag.orig.x + dx, y: drag.orig.y + dy }),
              true
            )
          if (!drag.moved) setDrag({ ...drag, moved: true })
        }
      }}
      onPointerUp={finish}
    >
      <svg width={rect.w} height={rect.h}>
        {recipe.retouch.map(shape)}
        {live && (
          <polyline
            points={live.map((p) => `${p.x * rect.w},${p.y * rect.h}`).join(' ')}
            className="spot painting stroke"
            style={{ strokeWidth: 2 * heal.size * shortPx }}
          />
        )}
        {drag?.kind === 'eye' && (
          <ellipse
            cx={((drag.from.x + drag.to.x) / 2) * rect.w}
            cy={((drag.from.y + drag.to.y) / 2) * rect.h}
            rx={(Math.abs(drag.to.x - drag.from.x) * rect.w) / 2}
            ry={(Math.abs(drag.to.y - drag.from.y) * rect.h) / 2}
            className="spot painting"
          />
        )}
      </svg>
    </div>
  )
})
