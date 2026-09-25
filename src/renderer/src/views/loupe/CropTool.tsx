import { memo, useRef, useState } from 'react'
import { fitCrop } from '../../../../shared/compile'
import { CROP_HANDLES, dragCrop, type CropHandle } from '../../../../shared/crop'
import type { CropRect } from '../../../../shared/engine-types'
import { normalisedIn, type P, type Rect, type ViewGeometry } from '../../../../shared/view'
import { useDevelop } from '../../state/develop'

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 }

/**
 * The crop box. What it shows is always the recipe's crop, except while a
 * handle is being dragged, when it shows the drag. Nothing keys or remounts
 * it: a straighten, an undo, a reset or a paste simply moves the box, and a
 * render arriving mid-drag changes nothing under the pointer. The whole
 * loupe holds the pointer capture, so a drag survives leaving the picture.
 */
export const CropTool = memo(function CropTool({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element {
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const aspect = useDevelop((s) => s.recipe?.geometry.aspect ?? null)
  const [draft, setDraft] = useState<CropRect | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ handle: CropHandle; from: P; orig: CropRect } | null>(null)
  const crop = draft ?? g.crop ?? FULL
  // Normalised width over height that holds the aspect in pixels.
  const nAspect = aspect ? aspect * (g.height / g.width) : null

  const toN = (e: React.PointerEvent): P => {
    const b = frame.current?.getBoundingClientRect()
    return b ? normalisedIn(e.clientX, e.clientY, b) : { x: 0, y: 0 }
  }
  const begin = (e: React.PointerEvent, handle: CropHandle): void => {
    e.stopPropagation()
    const stage = e.currentTarget.closest('.crop-stage') as HTMLElement | null
    stage?.setPointerCapture(e.pointerId)
    drag.current = { handle, from: toN(e), orig: crop }
    setDraft(crop)
  }
  const move = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    const p = toN(e)
    const next = dragCrop(d.handle, d.orig, { x: p.x - d.from.x, y: p.y - d.from.y }, nAspect, g)
    if (next) setDraft(next)
  }
  const end = (): void => {
    const d = drag.current
    drag.current = null
    if (!d || !draft) return setDraft(null)
    const fitted = fitCrop(draft, g.straighten, g.width, g.height)
    edit((r) => (r.geometry.crop = fitted))
    commit('Crop')
    setDraft(null)
  }

  const box = {
    left: crop.x * rect.w,
    top: crop.y * rect.h,
    width: crop.width * rect.w,
    height: crop.height * rect.h
  }
  return (
    <div
      className={`crop-stage${draft ? ' dragging' : ''}`}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
    >
      <div
        ref={frame}
        className="crop-layer"
        style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      >
        <div
          className="crop-shade"
          style={{
            clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${box.left}px ${box.top}px,${box.left}px ${box.top + box.height}px,${box.left + box.width}px ${box.top + box.height}px,${box.left + box.width}px ${box.top}px,${box.left}px ${box.top}px)`
          }}
        />
        <div className="crop-box" style={box} onPointerDown={(e) => begin(e, 'move')}>
          <div className="thirds" />
          {CROP_HANDLES.map((h) => (
            <div key={h} className={`crop-handle ${h}`} onPointerDown={(e) => begin(e, h)} />
          ))}
        </div>
      </div>
    </div>
  )
})
