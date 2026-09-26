import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { type MaskComponentSetting } from '../../../../shared/recipe'
import {
  displaySize,
  displayToOriented,
  fitRect,
  normalisedIn,
  panBy,
  scaleOf,
  viewGeometry,
  zoomAt,
  zoomedRect,
  type Rect,
  type Viewport,
  type ZoomView
} from '../../../../shared/view'
import { api, errorText } from '../../lib/api'
import { emptyRange } from '../../lib/helpers'
import { madeComponent, modeForNew } from '../../panels/masks/model'
import { samplePatch } from '../../lib/image'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { BrushLayer } from './BrushTool'
import { ClippingOverlay } from './ClippingOverlay'
import { CropTool } from './CropTool'
import { DecodedImage } from './DecodedImage'
import { Guides } from './Guides'
import { LassoEditor, PolygonLayer } from './LassoTool'
import { LoupeHud } from './LoupeHud'
import { GradientTools } from './GradientTools'
import { MaskPins } from './MaskPins'
import { MaskOverlay } from './MaskOverlay'
import { useGreyUnderOverlay } from './useGreyUnderOverlay'
import { SharpTile } from './SharpTile'
import { useSize } from './useSize'
import { loupeZoom, setLoupeElement, setPointer, setViewport, spaceHeld } from './zoom'
import { Ambient } from '../../fx'

/** How long the loupe must keep a size before the renderer is asked for that many pixels. */
const EDGE_SETTLE_MS = 250
/** How long a wheel or pinch gesture rests before its view is laid out for real. */
const GESTURE_SETTLE_MS = 120
/** One notch of a mouse wheel. */
const WHEEL_STEP = 1.2

/**
 * A mouse wheel, as opposed to a trackpad: whole notches (Chromium reports
 * 120 per notch) with no sideways part, or scrolling by lines. A stream of
 * events already seen to come from a trackpad stays a trackpad.
 */
let trackpadUntil = 0
function isMouseWheel(e: WheelEvent): boolean {
  const now = performance.now()
  const notch = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY ?? 0
  const mouse =
    e.deltaMode !== 0 ||
    (e.deltaX === 0 && notch !== 0 && notch % 120 === 0 && Math.abs(e.deltaY) >= 50)
  if (!mouse) trackpadUntil = now + 250
  return mouse && now > trackpadUntil
}

export function Loupe(): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const picture = useDevelop((s) => s.picture)
  const before = useDevelop((s) => s.before)
  const tool = useDevelop((s) => s.tool)
  const compare = useDevelop((s) => s.compare)
  const clipping = useDevelop((s) => s.clipping)
  const zoom = useDevelop((s) => s.zoom)
  const layerId = useDevelop((s) => s.layerId)
  const loading = useDevelop((s) => s.loading)
  const error = useDevelop((s) => s.error)
  const setTool = useDevelop((s) => s.setTool)
  const setZoom = useDevelop((s) => s.setZoom)
  const replace = useDevelop((s) => s.replace)
  const setTargetEdge = useDevelop((s) => s.setTargetEdge)
  const gesture = useDevelop((s) => s.gesture)
  const [boxRef, size, boxEl] = useSize()
  const layer = useRef<HTMLDivElement>(null)
  const [split, setSplit] = useState(0.5)
  const grey = useGreyUnderOverlay()

  // A loupe being resized (a panel sliding open, the window dragged) asks
  // for new pixels once it has settled, not on every frame of the change.
  useEffect(() => {
    if (size.w <= 0) return
    const t = setTimeout(
      () => setTargetEdge(Math.round(Math.max(size.w, size.h) * (window.devicePixelRatio || 1))),
      EDGE_SETTLE_MS
    )
    return () => clearTimeout(t)
  }, [size.w, size.h, setTargetEdge])

  const g = useMemo(
    () =>
      session && recipe
        ? viewGeometry(recipe, session.frameWidth, session.frameHeight, tool === 'crop')
        : null,
    [session, recipe, tool]
  )

  // Where the picture sits in the loupe. In the crop tool the frame comes
  // from the geometry, which a render cannot change, so the crop box and the
  // picture under it hold still while renders come and go. Elsewhere the
  // picture's own aspect is shown; the geometry is the fallback.
  const rect: Rect | null = useMemo(() => {
    if (size.w === 0) return null
    const fromGeometry = (): Rect | null => {
      if (!g) return null
      const d = displaySize(g)
      return fitRect(size, d.width, d.height)
    }
    if (tool === 'crop')
      return fromGeometry() ?? (picture ? fitRect(size, picture.width, picture.height, 4) : null)
    if (picture && !picture.cropMode) return fitRect(size, picture.width, picture.height, 4)
    return fromGeometry() ?? (picture ? fitRect(size, picture.width, picture.height, 4) : null)
  }, [picture, size, g, tool])

  // The picture at the loupe's zoom: the fitted rect, or the zoomed one.
  const viewport: Viewport | null = useMemo(() => {
    if (!g || size.w === 0) return null
    const d = displaySize(g)
    return { box: size, width: d.width, height: d.height, dpr: window.devicePixelRatio || 1 }
  }, [g, size])
  const vrect: Rect | null = useMemo(
    () => (zoom.scale === 'fit' || !viewport ? rect : (zoomedRect(viewport, zoom) ?? rect)),
    [zoom, viewport, rect]
  )
  useEffect(() => {
    setViewport(viewport)
    return () => setViewport(null)
  }, [viewport])
  useEffect(() => {
    setLoupeElement(boxEl)
    return () => setLoupeElement(null)
  }, [boxEl])

  // A gesture moves the layer on the compositor; its view is laid out (and
  // the tools follow) once it rests. `live` is the view mid-gesture.
  const live = useRef<ZoomView | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const laidOut = useRef<Rect | null>(null)
  const preview = useCallback(
    (next: ZoomView, commitNow = false) => {
      const el = layer.current
      const from = laidOut.current
      const to = viewport ? zoomedRect(viewport, next) : null
      live.current = next
      if (el && from && to) {
        const k = to.w / from.w
        el.style.willChange = 'transform'
        el.style.transform = `translate(${to.x - from.x * k}px, ${to.y - from.y * k}px) scale(${k})`
      }
      clearTimeout(settle.current)
      const commit = (): void => {
        const v = live.current
        live.current = null
        if (v) setZoom(v)
      }
      if (commitNow) commit()
      else settle.current = setTimeout(commit, GESTURE_SETTLE_MS)
    },
    [viewport, setZoom]
  )
  // The laid-out view replaces the gesture's transform before it paints.
  useLayoutEffect(() => {
    laidOut.current = vrect
    const el = layer.current
    if (!el || live.current) return
    el.style.transform = ''
    el.style.willChange = ''
  }, [vrect])

  // Pinch and the mouse wheel zoom at the pointer; a trackpad's two-finger
  // scroll pans. The listener is native: React's wheel events are passive.
  useEffect(() => {
    if (!boxEl || !viewport) return
    const onWheel = (e: WheelEvent): void => {
      if (useDevelop.getState().tool === 'crop') return
      const box = boxEl.getBoundingClientRect()
      const at = { x: e.clientX - box.left, y: e.clientY - box.top }
      const from = live.current ?? useDevelop.getState().zoom
      let next: ZoomView
      if (e.ctrlKey) next = zoomAt(viewport, from, Math.exp(-e.deltaY * 0.01), at)
      else if (isMouseWheel(e))
        next = zoomAt(viewport, from, e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP, at)
      else if (from.scale !== 'fit') next = panBy(viewport, from, -e.deltaX, -e.deltaY)
      else return
      e.preventDefault()
      preview(next)
    }
    boxEl.addEventListener('wheel', onWheel, { passive: false })
    return () => boxEl.removeEventListener('wheel', onWheel)
  }, [boxEl, viewport, preview])

  // Dragging pans a zoomed picture: with Space held over anything, or with
  // no tool on the picture itself.
  const pan = useRef<{ x: number; y: number; from: ZoomView; moved: boolean } | null>(null)
  const startPan = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || zoom.scale === 'fit' || tool === 'crop') return
    const t = e.target as HTMLElement
    const onPicture = t.closest('.picture') !== null || t === layer.current
    if (!spaceHeld() && !(tool === 'none' && onPicture)) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    pan.current = { x: e.clientX, y: e.clientY, from: zoom, moved: false }
  }

  const pick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!session || !recipe || !g || !vrect) return
      const box = e.currentTarget.getBoundingClientRect()
      const p = normalisedIn(e.clientX, e.clientY, {
        left: box.left + vrect.x,
        top: box.top + vrect.y,
        width: vrect.w,
        height: vrect.h
      })
      if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return
      if (tool === 'wb-picker') {
        const o = displayToOriented(g, p)
        try {
          const s = await api.develop.sample(session.key, o.x, o.y)
          if (!s.wb)
            return useLibrary
              .getState()
              .say('That pixel cannot be made neutral (a channel is black)', 'error')
          replace(
            {
              ...recipe,
              wb: { mode: 'custom', temperature: s.wb.temperature, tint: s.wb.tint, preset: null }
            },
            'White balance: picker'
          )
          if (s.wb.clamped)
            useLibrary.getState().say('The picked white reached the end of the range')
        } catch (err) {
          useLibrary.getState().say(errorText(err), 'error')
        }
        setTool('none')
      } else if (tool === 'range-picker' && picture) {
        const layer = recipe.layers.find((l) => l.id === layerId)
        if (!layer) return useLibrary.getState().say('Select a mask first', 'error')
        const [r, gg, b] = await samplePatch(picture.url, p.x, p.y)
        const max = Math.max(r, gg, b)
        const min = Math.min(r, gg, b)
        const chroma = max - min
        let hue = 0
        if (chroma > 0) {
          if (max === r) hue = 60 * (((gg - b) / chroma + 6) % 6)
          else if (max === gg) hue = 60 * ((b - r) / chroma + 2)
          else hue = 60 * ((r - gg) / chroma + 4)
        }
        const sat = max > 0 ? chroma / max : 0
        const luma = 0.2289 * r + 0.6917 * gg + 0.0793 * b // Display P3 luminance weights
        const next = structuredClone(recipe)
        const l = next.layers.find((x) => x.id === layerId)
        if (!l) return
        // The selected range, else the mask's last range, else a new one.
        const compId = useDevelop.getState().compId
        let comp: MaskComponentSetting | undefined =
          l.components.find((x) => x.id === compId && x.kind === 'range') ??
          [...l.components].reverse().find((x) => x.kind === 'range')
        if (!comp) {
          comp = emptyRange(sat > 0.15 ? 'color' : 'luminance')
          comp.mode = modeForNew(l)
          l.components.push(comp)
        }
        const madeId = comp.id
        if (comp.kind === 'range') {
          if (comp.hue || sat > 0.15)
            comp.hue = { centre: Math.round(hue), width: 30, softness: 20 }
          if (comp.saturation || sat > 0.15)
            comp.saturation = { centre: Math.round(sat * 100) / 100, width: 0.5, softness: 0.2 }
          if (comp.luma || sat <= 0.15)
            comp.luma = { centre: Math.round(luma * 100) / 100, width: 0.25, softness: 0.12 }
        }
        replace(next, 'Pick range')
        madeComponent(madeId)
        setTool('none')
      }
    },
    [session, recipe, g, vrect, tool, picture, layerId, replace, setTool]
  )

  // Opening: the processing sphere covers the stage; the loupe waits under it.
  if (loading) return <div className="loupe" />
  if (!session || !recipe)
    return (
      <div className="loupe-idle">
        <Ambient intensity={0.8} />
        <div className="idle-card">
          <span className="micro">Develop</span>
          <h2>{error ? 'The photo could not be opened' : 'Choose a photo'}</h2>
          <p>{error ?? 'Pick one in the library or the filmstrip.'}</p>
        </div>
      </div>
    )
  const shown = compare === 'before' && before ? before : picture
  const rotate =
    tool === 'crop' && recipe.geometry.straighten !== 0
      ? `rotate(${recipe.geometry.straighten}deg)`
      : undefined
  const scale = viewport && zoom.scale !== 'fit' ? scaleOf(viewport, zoom) : null
  return (
    <div
      ref={boxRef}
      className={`loupe tool-${tool}${scale ? ' zoomed' : ''}`}
      onPointerDownCapture={(e) => {
        if (spaceHeld()) startPan(e)
      }}
      onPointerDown={startPan}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        setPointer({ x: e.clientX - box.left, y: e.clientY - box.top })
        const p = pan.current
        if (!p || !viewport) return
        if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 3) p.moved = true
        preview(panBy(viewport, p.from, e.clientX - p.x, e.clientY - p.y))
      }}
      onPointerUp={() => {
        const p = pan.current
        pan.current = null
        if (p && live.current) preview(live.current, true)
      }}
      onPointerLeave={() => setPointer(null)}
      onClick={(e) => {
        if (tool === 'wb-picker' || tool === 'range-picker') void pick(e)
      }}
      onDoubleClick={(e) => {
        if (tool !== 'none') return
        const box = e.currentTarget.getBoundingClientRect()
        loupeZoom.toggle({ x: e.clientX - box.left, y: e.clientY - box.top })
      }}
    >
      <div ref={layer} className="zoom-layer">
        {shown && vrect && (
          <div
            className={`picture${grey ? ' ov-bw' : ''}`}
            style={{
              left: vrect.x,
              top: vrect.y,
              width: vrect.w,
              height: vrect.h,
              transform: rotate
            }}
          >
            <DecodedImage src={shown.url} />
            {scale && g && picture && compare === 'off' && (
              <SharpTile rect={vrect} box={size} g={g} scale={scale} previewWidth={picture.width} />
            )}
            {compare === 'split' && before && (
              <div
                className="split-before"
                style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
              >
                <DecodedImage src={before.url} />
              </div>
            )}
            <MaskOverlay />
            {clipping && picture && <ClippingOverlay url={picture.url} />}
          </div>
        )}
        {compare === 'split' && vrect && (
          <>
            <span className="split-tag" style={{ left: vrect.x + 14, top: vrect.y + 14 }}>
              Before
            </span>
            <span
              className="split-tag"
              style={{
                left: vrect.x + vrect.w - 14,
                top: vrect.y + 14,
                transform: 'translateX(-100%)'
              }}
            >
              After
            </span>
          </>
        )}
        {compare === 'split' && vrect && (
          <div
            className="split-handle"
            style={{ left: vrect.x + vrect.w * split, top: vrect.y, height: vrect.h }}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              if (e.buttons !== 1) return
              const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
              setSplit(Math.min(1, Math.max(0, (e.clientX - box.left - vrect.x) / vrect.w)))
            }}
          />
        )}
        {tool === 'crop' && rect && g && <CropTool rect={rect} g={g} />}
        {gesture === 'straighten' && tool !== 'crop' && vrect && (
          // Straightening from the panel: a fine grid over the picture to line a horizon up against.
          <div
            className="straighten-grid"
            style={{ left: vrect.x, top: vrect.y, width: vrect.w, height: vrect.h }}
          >
            <Guides kind="grid" w={vrect.w} h={vrect.h} fine strong />
          </div>
        )}
        {vrect && <MaskPins rect={vrect} />}
        {tool === 'brush' && vrect && g && <BrushLayer rect={vrect} box={size} g={g} />}
        {tool === 'polygon' && vrect && g && <PolygonLayer rect={vrect} g={g} />}
        {tool !== 'crop' && vrect && g && <GradientTools rect={vrect} g={g} />}
        {tool !== 'crop' && vrect && g && <LassoEditor rect={vrect} g={g} />}
      </div>
      <LoupeHud scale={scale} />
    </div>
  )
}
