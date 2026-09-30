/**
 * The Heal tool on the photo, after Photoshop's healing brush and clone
 * stamp:
 *
 * - A click places a round spot and a drag paints a stroke (heal, clone,
 *   fill); red eye and pet eye take a drag over the pupil, or a click.
 * - A heal or clone starts with its source on the spot itself, which
 *   changes nothing: drag from the spot to where it should copy from, and
 *   the picture follows as you drag. Alt-click first sets the source, as
 *   Photoshop does; the next spots keep that offset (aligned) until the
 *   next Alt-click.
 * - Once a spot is set — its source let go, a fill or an eye placed — its
 *   outline goes. Hover shows a spot's outline again, a click selects it
 *   (drag it, or its source, to change it), Enter or Esc sets it, ⌫ deletes
 *   it, and H shows every spot.
 *
 * Points are kept in the base frame (`displayToBase`), radii as fractions of
 * the frame's shorter side, so spots stay put whatever the framing does.
 */
import { memo, useEffect, useRef, useState } from 'react'
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
  | { kind: 'dest'; id: string; start: P; orig: P[]; moved: boolean }
  | { kind: 'source'; id: string; start: P; orig: P; moved: boolean }

interface Screen {
  x: number
  y: number
}

/** Distance from a point to a segment, in screen pixels. */
function toSegment(p: Screen, a: Screen, b: Screen): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
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
  const spotId = useDevelop((s) => s.spotId)
  const setSpotId = useDevelop((s) => s.setSpotId)
  const heal = useUi((s) => s.heal)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [hover, setHover] = useState<{ at: Screen; alt: boolean } | null>(null)
  /** Alt-click's source, waiting for the next spot. */
  const [anchor, setAnchor] = useState<P | null>(null)
  /** The offset the last Alt-click set, kept for the spots after it (aligned). */
  const [aligned, setAligned] = useState<P | null>(null)
  /** A spot just set: hover leaves it hidden until the pointer has left it. */
  const [quiet, setQuiet] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // Enter or Esc sets the selected spot (its outline goes).
  useEffect(() => {
    if (!spotId) return
    const k = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      e.stopPropagation()
      setSpotId(null)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [spotId, setSpotId])

  // A new mode starts without a borrowed source.
  useEffect(() => {
    setAnchor(null)
    setAligned(null)
  }, [heal.mode])

  if (!recipe) return null
  // Mounted only while Heal shows: it takes the photo unless another tool has it.
  const active = tool === 'heal' || tool === 'none'

  const d = displaySize(g)
  // The frame's shorter side, in screen pixels.
  const shortPx = (Math.min(g.width, g.height) * rect.w) / d.width
  const toScreen = (p: P): Screen => {
    const q = baseToDisplay(g, p)
    return { x: q.x * rect.w, y: q.y * rect.h }
  }
  const at = (e: React.PointerEvent): P =>
    normalisedIn(e.clientX, e.clientY, box.current!.getBoundingClientRect())
  const screenOf = (p: P): Screen => ({ x: p.x * rect.w, y: p.y * rect.h })
  const copies = heal.mode === 'heal' || heal.mode === 'clone'
  const eyes = heal.mode === 'redeye' || heal.mode === 'peteye'

  const sourcePoints = (s: RetouchSpot): P[] | null => {
    if (!s.source || (s.kind !== 'heal' && s.kind !== 'clone')) return null
    const dx = s.source.x - s.points[0].x
    const dy = s.source.y - s.points[0].y
    return s.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  }
  /** Whether a screen point falls on a spot's shape (at least a finger's width). */
  const inside = (pts: P[], radius: number, p: Screen): boolean => {
    const r = Math.max(6, radius * shortPx)
    const s = pts.map(toScreen)
    if (s.length === 1) return Math.hypot(p.x - s[0].x, p.y - s[0].y) <= r
    return s.some((a, i) => i > 0 && toSegment(p, s[i - 1], a) <= r)
  }
  const hit = (p: Screen): { spot: RetouchSpot; part: 'dest' | 'source' } | null => {
    // The selected spot first, and its source before its body: a source
    // still on its spot is dragged away from it.
    const order = [...recipe.retouch]
      .reverse()
      .sort((a, b) => (a.id === spotId ? -1 : b.id === spotId ? 1 : 0))
    for (const s of order) {
      if (!s.enabled) continue
      const src = sourcePoints(s)
      if (src && inside(src, s.radius, p)) return { spot: s, part: 'source' }
      if (inside(s.points, Math.max(s.radius, s.radiusY || 0), p)) return { spot: s, part: 'dest' }
    }
    return null
  }

  const finish = (): void => {
    if (!drag) return
    setDrag(null)
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
      if (!copies) {
        setQuiet(addSpot(heal.mode, base))
        setSpotId(null)
        return
      }
      // Alt-click's source for this spot, and its offset for the ones after.
      const start = base[0]
      let source: P | undefined
      if (anchor) {
        source = anchor
        setAligned({ x: anchor.x - start.x, y: anchor.y - start.y })
        setAnchor(null)
      } else if (aligned) source = { x: start.x + aligned.x, y: start.y + aligned.y }
      const id = addSpot(heal.mode, base, { source })
      // A borrowed source is set at once; otherwise the spot waits, selected,
      // for its source to be dragged away.
      setSpotId(source ? null : id)
      if (source) setQuiet(id)
    } else if (drag.kind === 'eye') {
      const c = { x: (drag.from.x + drag.to.x) / 2, y: (drag.from.y + drag.to.y) / 2 }
      const rx = (Math.abs(drag.to.x - drag.from.x) * rect.w) / 2 / shortPx
      const ry = (Math.abs(drag.to.y - drag.from.y) * rect.h) / 2 / shortPx
      const click = Math.max(rx, ry) * shortPx < 3
      const id = addSpot(heal.mode, [displayToBase(g, c)], {
        shape: click
          ? { radius: heal.size / 2, radiusY: heal.size / 2, rotate: 0 }
          : { radius: Math.max(0.002, rx), radiusY: Math.max(0.002, ry), rotate: 0 }
      })
      setSpotId(null)
      setQuiet(id)
    } else if (drag.moved) {
      commitSpot(drag.id, drag.kind === 'source' ? 'source' : 'move')
      // Set in: the outline goes.
      setSpotId(null)
      setQuiet(drag.id)
    }
  }

  const outline = (s: RetouchSpot, faint: boolean): React.JSX.Element => {
    const sel = s.id === spotId
    const cls = `spot ${s.kind}${sel ? ' selected' : ''}${faint ? ' faint' : ''}${s.enabled ? '' : ' off'}`
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
        />
      )
    } else if (s.points.length > 1) {
      const pts = s.points.map(toScreen)
      dest = (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          className={`${cls} stroke`}
          style={{ strokeWidth: 2 * r }}
        />
      )
    } else {
      const c = toScreen(s.points[0])
      dest = <circle cx={c.x} cy={c.y} r={r} className={cls} />
    }
    const src = sourcePoints(s)?.map(toScreen)
    const a = toScreen(s.points[0])
    return (
      <g key={s.id}>
        {src && (
          <g className={`spot-source${sel ? ' selected' : ''}${faint ? ' faint' : ''}`}>
            <line x1={a.x} y1={a.y} x2={src[0].x} y2={src[0].y} className="spot-link" />
            {src.length > 1 ? (
              <polyline
                points={src.map((p) => `${p.x},${p.y}`).join(' ')}
                className="spot-src stroke"
                style={{ strokeWidth: 2 * r }}
              />
            ) : (
              <circle cx={src[0].x} cy={src[0].y} r={r} className="spot-src" />
            )}
            <path
              d={`M${src[0].x - 5} ${src[0].y}h10M${src[0].x} ${src[0].y - 5}v10`}
              className="spot-cross"
            />
          </g>
        )}
        {dest}
      </g>
    )
  }

  const under = hover && !drag ? hit(hover.at) : null
  const hovered = under && under.spot.id !== quiet ? under : null
  const shown = recipe.retouch.filter(
    (s) => heal.showAll || s.id === spotId || s.id === hovered?.spot.id
  )
  const selected = recipe.retouch.find((s) => s.id === spotId)
  const waiting =
    !!selected &&
    (selected.kind === 'heal' || selected.kind === 'clone') &&
    !!selected.source &&
    Math.hypot(selected.source.x - selected.points[0].x, selected.source.y - selected.points[0].y) <
      1e-6
  const live = drag?.kind === 'paint' ? drag.points : null
  const brushR = heal.size * shortPx
  const cross = (c: Screen, r: number): React.JSX.Element => (
    <g className="spot-anchor">
      <circle cx={c.x} cy={c.y} r={r} className="spot-src" />
      <path d={`M${c.x - 7} ${c.y}h14M${c.x} ${c.y - 7}v14`} className="spot-cross" />
    </g>
  )
  return (
    <div
      ref={box}
      className={`tool-layer heal-layer${active ? ' active' : ''}${hovered ? ' over-spot' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        if (!active || e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        const p = at(e)
        const sp = screenOf(p)
        // Alt-click: the source for the next heal or clone.
        if (e.altKey && copies) {
          setAnchor(displayToBase(g, p))
          setAligned(null)
          return
        }
        const h = hit(sp)
        if (h) {
          setSpotId(h.spot.id)
          const b = displayToBase(g, p)
          setDrag(
            h.part === 'source' && h.spot.source
              ? { kind: 'source', id: h.spot.id, start: b, orig: h.spot.source, moved: false }
              : { kind: 'dest', id: h.spot.id, start: b, orig: h.spot.points, moved: false }
          )
          return
        }
        // A click away from a selected spot sets it, and places nothing.
        if (spotId) {
          setSpotId(null)
          return
        }
        setDrag(eyes ? { kind: 'eye', from: p, to: p } : { kind: 'paint', points: [p] })
      }}
      onPointerMove={(e) => {
        const p = at(e)
        setHover({ at: screenOf(p), alt: e.altKey })
        if (quiet && !drag && hit(screenOf(p))?.spot.id !== quiet) setQuiet(null)
        if (!drag) return
        if (drag.kind === 'paint') setDrag({ ...drag, points: [...drag.points, p] })
        else if (drag.kind === 'eye') setDrag({ ...drag, to: p })
        else {
          const b = displayToBase(g, p)
          const dx = b.x - drag.start.x
          const dy = b.y - drag.start.y
          if (drag.kind === 'dest')
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
      onPointerLeave={() => setHover(null)}
    >
      <svg width={rect.w} height={rect.h}>
        {shown.map((s) => outline(s, !heal.showAll && s.id !== spotId))}
        {anchor && cross(toScreen(anchor), brushR)}
        {live && (
          <polyline
            points={live.map((p) => `${p.x * rect.w},${p.y * rect.h}`).join(' ')}
            className="spot painting stroke"
            style={{ strokeWidth: 2 * brushR }}
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
        {/* The brush, following the pointer (a target while Alt is held). */}
        {active &&
          hover &&
          !drag &&
          !under &&
          (hover.alt && copies ? (
            cross(hover.at, brushR)
          ) : (
            <circle cx={hover.at.x} cy={hover.at.y} r={eyes ? 6 : brushR} className="heal-brush" />
          ))}
      </svg>
      {waiting && !drag && (
        <div className="tool-hint">
          Drag from the spot to where it should copy from · Enter sets it
        </div>
      )}
      {anchor && !drag && <div className="tool-hint">Source set · paint where it should go</div>}
    </div>
  )
})
