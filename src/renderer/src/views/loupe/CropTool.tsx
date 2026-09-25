import { memo, useRef, useState } from 'react'
import { fitCrop } from '../../../../shared/compile'
import { CROP_HANDLES, dragCrop, type CropHandle } from '../../../../shared/crop'
import type { CropRect } from '../../../../shared/engine-types'
import { normalisedIn, type P, type Rect, type ViewGeometry } from '../../../../shared/view'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'
import { Guides } from './Guides'

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 }
const MAX_ANGLE = 45

type Drag =
  | { kind: 'box'; handle: CropHandle; from: P; orig: CropRect }
  | { kind: 'rotate'; centre: { x: number; y: number }; a0: number; orig: number }

/**
 * The crop box. What it shows is always the recipe's crop, except while a
 * handle is being dragged, when it shows the drag. Nothing keys or remounts
 * it: a straighten, an undo, a reset or a paste simply moves the box, and a
 * render arriving mid-drag changes nothing under the pointer. The whole
 * loupe holds the pointer capture, so a drag survives leaving the picture.
 *
 * Dragging outside the box turns the picture under it (Lightroom's rotate),
 * with a fine grid to line things up against.
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
  const setGesture = useDevelop((s) => s.setGesture)
  const gesture = useDevelop((s) => s.gesture)
  const aspect = useDevelop((s) => s.recipe?.geometry.aspect ?? null)
  const guide = useUi((s) => s.cropGuide)
  const [draft, setDraft] = useState<CropRect | null>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const crop = draft ?? g.crop ?? FULL
  // Normalised width over height that holds the aspect in pixels.
  const nAspect = aspect ? aspect * (g.height / g.width) : null

  const toN = (e: React.PointerEvent): P => {
    const b = frame.current?.getBoundingClientRect()
    return b ? normalisedIn(e.clientX, e.clientY, b) : { x: 0, y: 0 }
  }
  const capture = (e: React.PointerEvent): void => {
    const stage = e.currentTarget.closest('.crop-stage') as HTMLElement | null
    stage?.setPointerCapture(e.pointerId)
  }
  const beginBox = (e: React.PointerEvent, handle: CropHandle): void => {
    e.stopPropagation()
    capture(e)
    drag.current = { kind: 'box', handle, from: toN(e), orig: crop }
    setDraft(crop)
    setGesture('crop')
  }
  const beginRotate = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    const b = frame.current?.getBoundingClientRect()
    if (!b) return
    capture(e)
    // The box's centre on screen: the picture turns about it.
    const centre = {
      x: b.left + (crop.x + crop.width / 2) * b.width,
      y: b.top + (crop.y + crop.height / 2) * b.height
    }
    drag.current = {
      kind: 'rotate',
      centre,
      a0: Math.atan2(e.clientY - centre.y, e.clientX - centre.x),
      orig: g.straighten
    }
    setGesture('rotate')
  }
  const move = (e: React.PointerEvent): void => {
    const d = drag.current
    if (!d) return
    if (d.kind === 'box') {
      const p = toN(e)
      const next = dragCrop(d.handle, d.orig, { x: p.x - d.from.x, y: p.y - d.from.y }, nAspect, g)
      if (next) setDraft(next)
      return
    }
    const a = Math.atan2(e.clientY - d.centre.y, e.clientX - d.centre.x)
    let delta = ((a - d.a0) * 180) / Math.PI
    delta = ((delta + 540) % 360) - 180
    const angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, d.orig + delta))
    const rounded = Math.round(angle * 20) / 20
    // Live: the picture turns in CSS and the box refits; the engine sees
    // nothing new until the drag ends (the crop tool's frame is unrotated).
    if (rounded !== g.straighten) edit((r) => (r.geometry.straighten = rounded), true)
  }
  const end = (): void => {
    const d = drag.current
    drag.current = null
    setGesture(null)
    if (!d) return setDraft(null)
    if (d.kind === 'rotate') {
      if (g.straighten !== d.orig) commit('Straighten')
      return
    }
    const same =
      draft &&
      draft.x === d.orig.x &&
      draft.y === d.orig.y &&
      draft.width === d.orig.width &&
      draft.height === d.orig.height
    // A click on the box without a drag changes nothing and records nothing.
    if (!draft || same) return setDraft(null)
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
  const turning = gesture === 'rotate' || gesture === 'straighten'
  return (
    <div
      className={`crop-stage${draft ? ' dragging' : ''}${turning ? ' turning' : ''}`}
      onPointerDown={beginRotate}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      title="Drag outside the crop to straighten"
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
        <div className="crop-box" style={box} onPointerDown={(e) => beginBox(e, 'move')}>
          <Guides
            kind={guide}
            w={box.width}
            h={box.height}
            fine={turning}
            strong={Boolean(draft) || turning}
          />
          {CROP_HANDLES.map((h) => (
            <div key={h} className={`crop-handle ${h}`} onPointerDown={(e) => beginBox(e, h)} />
          ))}
        </div>
      </div>
      {turning && <div className="crop-angle">{g.straighten.toFixed(2)}°</div>}
    </div>
  )
})
