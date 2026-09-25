import { memo, useEffect, useRef, useState } from 'react'
import { newId } from '../../../../shared/recipe'
import {
  baseToDisplay,
  displayToBase,
  normalisedIn,
  type P,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'
import { madeComponent, modeForNew } from '../../panels/masks/model'

// ── Lasso ────────────────────────────────────────────────────────────────────

export const PolygonLayer = memo(function PolygonLayer({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element {
  const layerId = useDevelop((s) => s.layerId)
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const [pts, setPts] = useState<P[]>([])
  const [hover, setHover] = useState<P | null>(null)
  const toDisplay = (e: React.MouseEvent): P =>
    normalisedIn(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
  const close = (subtract: boolean): void => {
    if (pts.length < 3 || !layerId) return setPts([])
    const points = pts.map((p) => {
      const b = displayToBase(g, p)
      return { x: Math.min(1, Math.max(0, b.x)), y: Math.min(1, Math.max(0, b.y)) }
    })
    const id = newId()
    edit((r) => {
      const l = r.layers.find((x) => x.id === layerId)
      if (!l) return
      l.components.push({
        id,
        kind: 'polygon',
        mode: subtract && l.components.length > 0 ? 'Subtract' : modeForNew(l),
        opacity: 100,
        invert: false,
        feather: 3,
        points
      })
    })
    commit(subtract ? 'Lasso subtract' : 'Lasso')
    madeComponent(id)
    setPts([])
  }
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPts([])
      if (e.key === 'Enter') close(e.altKey)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  // Existing polygons of the selected layer, drawn in display coordinates.
  const layer = recipe?.layers.find((l) => l.id === layerId)
  const existing = (layer?.components ?? []).filter((c) => c.kind === 'polygon')
  const path = (list: P[]): string => list.map((p) => `${p.x * rect.w},${p.y * rect.h}`).join(' ')
  return (
    <div
      className="tool-layer polygon"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onClick={(e) => {
        const p = toDisplay(e)
        if (
          pts.length >= 3 &&
          Math.hypot((p.x - pts[0].x) * rect.w, (p.y - pts[0].y) * rect.h) < 10
        )
          close(e.altKey)
        else {
          // The clicks of a closing double-click land on the last point: once is enough.
          const last = pts[pts.length - 1]
          if (last && Math.hypot((p.x - last.x) * rect.w, (p.y - last.y) * rect.h) < 4) return
          setPts([...pts, p])
        }
      }}
      onDoubleClick={(e) => close(e.altKey)}
      onMouseMove={(e) => setHover(toDisplay(e))}
    >
      <svg width={rect.w} height={rect.h}>
        {existing.map((c) =>
          c.kind === 'polygon' ? (
            <polygon
              key={c.id}
              points={path(c.points.map((p) => baseToDisplay(g, p)))}
              className={c.mode === 'Subtract' ? 'poly subtract' : 'poly'}
            />
          ) : null
        )}
        {pts.length > 0 && (
          <polyline points={path(hover ? [...pts, hover] : pts)} className="poly drawing" />
        )}
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x * rect.w}
            cy={p.y * rect.h}
            r={i === 0 ? 5 : 3}
            className="poly-point"
          />
        ))}
      </svg>
      {!layerId && <div className="tool-hint">Select or create a mask to draw into.</div>}
      {layerId && (
        <div className="tool-hint">
          Click points · click the first or double-click to close · Alt subtracts · Esc cancels
        </div>
      )}
    </div>
  )
})

/**
 * The selected lasso's points, editable after it was drawn: drag a point to
 * move it, Alt-click to remove it (three stay), double-click an edge to add
 * one there.
 */
export const LassoEditor = memo(function LassoEditor({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const compId = useDevelop((s) => s.compId)
  const comp = useDevelop((s) =>
    s.recipe?.layers.flatMap((l) => l.components).find((c) => c.id === s.compId)
  )
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const panel = useUi((s) => s.panel)
  const pins = useUi((s) => s.maskOverlay.pins)
  const drag = useRef<{ i: number; moved: boolean } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  if (!comp || comp.kind !== 'polygon' || panel !== 'masks' || pins === 'never') return null
  const pts = comp.points.map((p) => baseToDisplay(g, p))
  const toBase = (e: React.PointerEvent | React.MouseEvent): P => {
    const b = svg.current?.getBoundingClientRect()
    const d = b ? normalisedIn(e.clientX, e.clientY, b) : { x: 0, y: 0 }
    const q = displayToBase(g, d)
    return { x: Math.min(1, Math.max(0, q.x)), y: Math.min(1, Math.max(0, q.y)) }
  }
  const setPoints = (fn: (points: P[]) => P[], live: boolean): void =>
    edit((r) => {
      for (const l of r.layers) {
        const c = l.components.find((x) => x.id === compId)
        if (c?.kind === 'polygon') c.points = fn(c.points)
      }
    }, live)
  return (
    <svg
      ref={svg}
      className={`lasso-editor pins-${pins}`}
      width={rect.w}
      height={rect.h}
      style={{ left: rect.x, top: rect.y }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        d.moved = true
        const q = toBase(e)
        setPoints((p) => p.map((x, i) => (i === d.i ? q : x)), true)
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d?.moved) commit('Move lasso point')
      }}
    >
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length]
        return (
          <line
            key={`e${i}`}
            className="lasso-edge"
            x1={p.x * rect.w}
            y1={p.y * rect.h}
            x2={q.x * rect.w}
            y2={q.y * rect.h}
            onDoubleClick={(e) => {
              e.stopPropagation()
              const at = toBase(e)
              setPoints((list) => [...list.slice(0, i + 1), at, ...list.slice(i + 1)], false)
              commit('Add lasso point')
            }}
          >
            <title>Double-click to add a point</title>
          </line>
        )
      })}
      {pts.map((p, i) => (
        <circle
          key={`v${i}`}
          className="lasso-vertex"
          cx={p.x * rect.w}
          cy={p.y * rect.h}
          r={5}
          onPointerDown={(e) => {
            e.stopPropagation()
            if (e.altKey) {
              if (pts.length > 3) {
                setPoints((list) => list.filter((_, j) => j !== i), false)
                commit('Remove lasso point')
              }
              return
            }
            ;(e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId)
            drag.current = { i, moved: false }
          }}
        >
          <title>Drag to move · Alt-click to remove</title>
        </circle>
      ))}
    </svg>
  )
})
