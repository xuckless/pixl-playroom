import { useRef, useState } from 'react'
import { cropFits, effectiveCrop, fitCrop } from '../../../../shared/compile'
import type { CropRect } from '../../../../shared/engine-types'
import type { Recipe } from '../../../../shared/recipe'
import { normalisedIn, type P, type Rect, type ViewGeometry } from '../../../../shared/view'
import { useDevelop } from '../../state/develop'

// ── Crop tool ────────────────────────────────────────────────────────────────

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export function CropOverlay({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe) as Recipe
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const start = effectiveCrop(recipe, g.width, g.height) ?? { x: 0, y: 0, width: 1, height: 1 }
  const [crop, setCrop] = useState<CropRect>(start)
  const drag = useRef<{ handle: Handle; from: P; orig: CropRect } | null>(null)
  const aspect = recipe.geometry.aspect
  // Normalised width over height that holds the aspect in pixels.
  const nAspect = aspect ? aspect * (g.height / g.width) : null
  const layer = useRef<HTMLDivElement>(null)
  const toN = (e: React.PointerEvent): P => {
    const b = layer.current?.getBoundingClientRect()
    return b ? normalisedIn(e.clientX, e.clientY, b) : { x: 0, y: 0 }
  }
  const onMove = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = toN(e)
    const dx = p.x - d.from.x
    const dy = p.y - d.from.y
    let { x, y, width, height } = d.orig
    if (d.handle === 'move') {
      x = Math.min(1 - width, Math.max(0, x + dx))
      y = Math.min(1 - height, Math.max(0, y + dy))
    } else {
      if (d.handle.includes('w')) {
        x = Math.min(x + width - 0.02, Math.max(0, x + dx))
        width = d.orig.x + d.orig.width - x
      }
      if (d.handle.includes('e')) width = Math.min(1 - x, Math.max(0.02, width + dx))
      if (d.handle.includes('n')) {
        y = Math.min(y + height - 0.02, Math.max(0, y + dy))
        height = d.orig.y + d.orig.height - y
      }
      if (d.handle.includes('s')) height = Math.min(1 - y, Math.max(0.02, height + dy))
      if (nAspect) {
        if (d.handle === 'n' || d.handle === 's') width = height * nAspect
        else height = width / nAspect
        if (d.handle.includes('n')) y = d.orig.y + d.orig.height - height
        if (d.handle.includes('w')) x = d.orig.x + d.orig.width - width
        if (x + width > 1 || y + height > 1 || x < 0 || y < 0) return
      }
    }
    const next = { x, y, width, height }
    if (!cropFits(next, g.straighten, g.width, g.height)) return
    setCrop(next)
  }
  const end = (): void => {
    if (!drag.current) return
    drag.current = null
    const fitted = fitCrop(crop, g.straighten, g.width, g.height)
    edit((r) => (r.geometry.crop = fitted))
    commit('Crop')
  }
  const box = {
    left: crop.x * rect.w,
    top: crop.y * rect.h,
    width: crop.width * rect.w,
    height: crop.height * rect.h
  }
  const handles: Handle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
  return (
    <div
      ref={layer}
      className="crop-layer"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerMove={onMove}
      onPointerUp={end}
      onPointerLeave={end}
    >
      <div
        className="crop-shade"
        style={{
          clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${box.left}px ${box.top}px,${box.left}px ${box.top + box.height}px,${box.left + box.width}px ${box.top + box.height}px,${box.left + box.width}px ${box.top}px,${box.left}px ${box.top}px)`
        }}
      />
      <div
        className="crop-box"
        style={box}
        onPointerDown={(e) => {
          ;(e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { handle: 'move', from: toN(e), orig: crop }
        }}
      >
        <div className="thirds" />
        {handles.map((h) => (
          <div
            key={h}
            className={`crop-handle ${h}`}
            onPointerDown={(e) => {
              e.stopPropagation()
              ;(e.currentTarget.parentElement?.parentElement as HTMLElement).setPointerCapture(
                e.pointerId
              )
              drag.current = { handle: h, from: toN(e), orig: crop }
            }}
          />
        ))}
      </div>
    </div>
  )
}
