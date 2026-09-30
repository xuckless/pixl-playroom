import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  MAX_POINT_COLORS,
  newId,
  type MaskComponentSetting,
  type Recipe
} from '../../../../shared/recipe'
import {
  applyHslDelta,
  bandWeights,
  curveInput,
  mainBand,
  nudgeCurve
} from '../../../../shared/tat'
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
import { emptyRange, hsvOf } from '../../lib/helpers'
import { madeComponent, modeForNew } from '../../panels/masks/model'
import { samplePatch } from '../../lib/image'
import { pickAdd } from '../../lib/addpick'
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
import { AiScan } from '../../fx/AiScan'
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

/** A targeted-adjustment drag in progress. */
interface TatDrag {
  id: number
  startY: number
  /** The recipe the press started with: every move applies to it afresh. */
  base: Recipe
  /** Set once the sample is in; until then a drag waits. */
  apply: ((r: Recipe, delta: number) => void) | null
  label: string
  lastY: number
  moved: boolean
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
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
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

  // The targeted adjustment tool: press samples the pixel once; a vertical
  // drag moves what controls it from the recipe the press started with.
  const tat = useRef<TatDrag | null>(null)
  const startTat = async (e: React.PointerEvent<HTMLDivElement>): Promise<void> => {
    if (e.button !== 0 || !recipe || !picture || !vrect) return
    const box = e.currentTarget.getBoundingClientRect()
    const p = normalisedIn(e.clientX, e.clientY, {
      left: box.left + vrect.x,
      top: box.top + vrect.y,
      width: vrect.w,
      height: vrect.h
    })
    if (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const t: TatDrag = {
      id: e.pointerId,
      startY: e.clientY,
      base: recipe,
      apply: null,
      label: '',
      lastY: e.clientY,
      moved: false
    }
    tat.current = t
    const rgb = await samplePatch(picture.url, p.x, p.y)
    const dev = useDevelop.getState()
    const say = useLibrary.getState().say
    if (dev.tatTarget === 'hsl') {
      if (dev.hslTab === 'point') {
        tat.current = null
        return say('The targeted tool moves the H, S and L tabs, not Point')
      }
      const s = hsvOf(...rgb)
      if (s.saturation < 0.05) {
        tat.current = null
        return say('That pixel is grey: there is no colour to adjust')
      }
      const w = bandWeights(s.hue)
      const axis = dev.hslTab
      const band = mainBand(w)
      const name = axis === 'all' ? 'saturation' : axis
      t.label = `Targeted: ${band[0].toUpperCase()}${band.slice(1)} ${name}`
      t.apply = (r, delta) => (r.hsl = applyHslDelta(t.base.hsl, w, axis, delta))
    } else {
      const channel = dev.curveChannel
      const level =
        channel === 'master' ? hsvOf(...rgb).luma : rgb[{ red: 0, green: 1, blue: 2 }[channel]]
      // Where the pixel sat on the curve's input, before the curve moved it.
      const x = curveInput(t.base.toneCurve[channel], level)
      t.label = `Targeted: curve (${channel})`
      t.apply = (r, delta) =>
        (r.toneCurve[channel] = nudgeCurve(t.base.toneCurve[channel], x, delta / 300))
    }
    // A drag that went ahead of the sample catches up.
    if (tat.current === t && t.lastY !== t.startY) moveTat(t.lastY)
  }
  const moveTat = (y: number): void => {
    const t = tat.current
    if (!t) return
    t.lastY = y
    if (!t.apply || y === t.startY) return
    const delta = (t.startY - y) * 0.4
    const apply = t.apply
    t.moved = true
    edit((r) => apply(r, delta), true)
  }
  const endTat = (): void => {
    const t = tat.current
    tat.current = null
    if (t?.moved) commit(t.label)
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
        const { hue, saturation: sat, luma } = hsvOf(...(await samplePatch(picture.url, p.x, p.y)))
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
      } else if (tool === 'add-pick' && picture) {
        // The picture as shown, in its own Display P3: what the complement
        // has to turn white (or into the second colour).
        pickAdd(await samplePatch(picture.url, p.x, p.y, 5, 'display-p3'))
      } else if (tool === 'point-picker' && picture) {
        const s = hsvOf(...(await samplePatch(picture.url, p.x, p.y)))
        const sample = {
          hue: Math.round(s.hue),
          saturation: Math.round(s.saturation * 100) / 100,
          luminance: Math.round(s.luma * 100) / 100
        }
        const next = structuredClone(recipe)
        const dev = useDevelop.getState()
        const points = next.pointColors
        // A new swatch; once they are all used, the selected one is re-sampled.
        if (points.length < MAX_POINT_COLORS) {
          const id = newId()
          points.push({ id, ...sample, shiftHue: 0, shiftSat: 0, shiftLum: 0, range: 50 })
          dev.setPointId(id)
          replace(next, 'Point colour: add')
        } else {
          const sel = points.find((x) => x.id === dev.pointId) ?? points[points.length - 1]
          Object.assign(sel, sample)
          replace(next, 'Point colour: re-sample')
        }
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
      onPointerDown={(e) => {
        if (tool === 'tat' && !spaceHeld()) void startTat(e)
        else startPan(e)
      }}
      onPointerMove={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        setPointer({ x: e.clientX - box.left, y: e.clientY - box.top })
        if (tat.current?.id === e.pointerId) return moveTat(e.clientY)
        const p = pan.current
        if (!p || !viewport) return
        if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 3) p.moved = true
        preview(panBy(viewport, p.from, e.clientX - p.x, e.clientY - p.y))
      }}
      onPointerUp={() => {
        endTat()
        const p = pan.current
        pan.current = null
        if (p && live.current) preview(live.current, true)
      }}
      onPointerCancel={endTat}
      onPointerLeave={() => setPointer(null)}
      onClick={(e) => {
        if (
          tool === 'wb-picker' ||
          tool === 'range-picker' ||
          tool === 'point-picker' ||
          tool === 'add-pick'
        )
          void pick(e)
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
            <MaskOverlay g={g ?? null} w={vrect.w} h={vrect.h} />
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
        {vrect && <MaskPins rect={vrect} g={g ?? null} />}
        {vrect && <AiScan rect={vrect} />}
        {tool === 'brush' && vrect && g && <BrushLayer rect={vrect} box={size} g={g} />}
        {tool === 'polygon' && vrect && g && <PolygonLayer rect={vrect} g={g} />}
        {tool !== 'crop' && vrect && g && <GradientTools rect={vrect} g={g} />}
        {tool !== 'crop' && vrect && g && <LassoEditor rect={vrect} g={g} />}
      </div>
      <LoupeHud scale={scale} />
    </div>
  )
}
