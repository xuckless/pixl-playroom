import { memo, useEffect, useState } from 'react'
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
    edit((r) => {
      const l = r.layers.find((x) => x.id === layerId)
      if (!l) return
      l.components.push({
        id: newId(),
        kind: 'polygon',
        mode: subtract && l.components.length > 0 ? 'Subtract' : 'Add',
        opacity: 100,
        invert: false,
        feather: 3,
        points
      })
    })
    commit(subtract ? 'Lasso subtract' : 'Lasso')
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
        else setPts([...pts, p])
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
