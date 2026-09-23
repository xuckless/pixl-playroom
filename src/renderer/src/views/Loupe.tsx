import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cropFits, effectiveCrop, fitCrop } from '../../../shared/compile'
import type { CropRect } from '../../../shared/engine-types'
import type { RegionResult } from '../../../shared/ipc'
import {
  newId,
  type BrushComponent,
  type MaskComponentSetting,
  type Recipe
} from '../../../shared/recipe'
import {
  baseToDisplay,
  displayToBase,
  displayToOriented,
  viewGeometry,
  type P,
  type ViewGeometry
} from '../../../shared/view'
import { api, errorText } from '../lib/api'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { emptyRange } from '../lib/helpers'

/** The picture's rectangle: `x`/`y` inside the loupe, `x0`/`y0` on the page. */
interface Rect {
  x: number
  y: number
  w: number
  h: number
  x0: number
  y0: number
}

/** An element's size, observed; `ref` is a callback ref so the element may come and go. */
function useSize(): [
  (el: HTMLDivElement | null) => void,
  { w: number; h: number },
  HTMLDivElement | null
] {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    // The observer reports the first size itself, as soon as it observes.
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, size, el]
}

/** Load an image the renderer can read pixels from. */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`cannot load ${url}`))
    img.src = url
  })
}

// ── Clipping ─────────────────────────────────────────────────────────────────

function ClippingOverlay({ url, rect }: { url: string; rect: Rect }): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let live = true
    void loadImage(url).then((img) => {
      const c = ref.current
      if (!live || !c) return
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, c.width, c.height)
      const d = data.data
      for (let i = 0; i < d.length; i += 4) {
        const hi = Math.max(d[i], d[i + 1], d[i + 2])
        if (hi >= 254) {
          d[i] = 255
          d[i + 1] = 0
          d[i + 2] = 0
          d[i + 3] = 220
        } else if (hi <= 1) {
          d[i] = 40
          d[i + 1] = 110
          d[i + 2] = 255
          d[i + 3] = 220
        } else d[i + 3] = 0
      }
      ctx.putImageData(data, 0, 0)
    })
    return () => {
      live = false
    }
  }, [url])
  return (
    <canvas
      ref={ref}
      className="overlay-canvas"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    />
  )
}

// ── Crop tool ────────────────────────────────────────────────────────────────

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

function CropOverlay({ rect, g }: { rect: Rect; g: ViewGeometry }): React.JSX.Element | null {
  const recipe = useDevelop((s) => s.recipe) as Recipe
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const start = effectiveCrop(recipe, g.width, g.height) ?? { x: 0, y: 0, width: 1, height: 1 }
  const [crop, setCrop] = useState<CropRect>(start)
  const drag = useRef<{ handle: Handle; from: P; orig: CropRect } | null>(null)
  const aspect = recipe.geometry.aspect
  // Normalised width over height that holds the aspect in pixels.
  const nAspect = aspect ? aspect * (g.height / g.width) : null
  const toN = (e: React.PointerEvent): P => ({
    x: (e.clientX - rect.x0) / rect.w,
    y: (e.clientY - rect.y0) / rect.h
  })
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

// ── Brush ────────────────────────────────────────────────────────────────────

const BRUSH_EDGE = 1024

/** The painted plane of a brush component, as a canvas whose alpha is the coverage. */
async function planeCanvas(
  c: BrushComponent | undefined,
  w: number,
  h: number
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = c?.width ?? w
  canvas.height = c?.height ?? h
  if (c?.png) {
    const img = await loadImage(`data:image/png;base64,${c.png}`)
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    ctx.drawImage(img, 0, 0)
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i + 3] = data.data[i]
      data.data[i] = data.data[i + 1] = data.data[i + 2] = 255
    }
    ctx.putImageData(data, 0, 0)
  }
  return canvas
}

function dab(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  softness: number,
  alpha: number,
  erase: boolean
): void {
  const g = ctx.createRadialGradient(x, y, r * (1 - softness / 100) * 0.98, x, y, r)
  g.addColorStop(0, `rgba(255,255,255,${alpha})`)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}

function BrushLayer({ rect, g }: { rect: Rect; g: ViewGeometry }): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const layerId = useDevelop((s) => s.layerId)
  const brush = useDevelop((s) => s.brush)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const screen = useRef<HTMLCanvasElement>(null)
  const stroke = useRef<{
    plane: HTMLCanvasElement
    compId: string
    isNew: boolean
    last: P | null
    erase: boolean
  } | null>(null)
  const [cursor, setCursor] = useState<P | null>(null)
  // The base frame's size in pixels (the file upright, before the user's turns).
  const baseW = session?.frameWidth ?? 1
  const baseH = session?.frameHeight ?? 1
  const planeW = baseW >= baseH ? BRUSH_EDGE : Math.round((BRUSH_EDGE * baseW) / baseH)
  const planeH = baseH > baseW ? BRUSH_EDGE : Math.round((BRUSH_EDGE * baseH) / baseW)
  const toDisplay = (e: React.PointerEvent): P => ({
    x: (e.clientX - rect.x0) / rect.w,
    y: (e.clientY - rect.y0) / rect.h
  })
  // Plane pixels per screen pixel, measured through the view mapping.
  const scaleAt = (p: P): number => {
    const a = displayToBase(g, p)
    const b = displayToBase(g, { x: p.x + 1 / rect.w, y: p.y })
    return Math.hypot((b.x - a.x) * planeW, (b.y - a.y) * planeH)
  }
  const paint = (p: P): void => {
    const s = stroke.current
    if (!s) return
    const ctx = s.plane.getContext('2d') as CanvasRenderingContext2D
    const k = scaleAt(p)
    const r = (brush.size / 2) * k
    const steps = s.last
      ? Math.max(
          1,
          Math.ceil(
            Math.hypot((p.x - s.last.x) * rect.w, (p.y - s.last.y) * rect.h) /
              Math.max(1, brush.size / 8)
          )
        )
      : 1
    const sctx = screen.current?.getContext('2d')
    for (let i = 1; i <= steps; i++) {
      const q = s.last
        ? {
            x: s.last.x + ((p.x - s.last.x) * i) / steps,
            y: s.last.y + ((p.y - s.last.y) * i) / steps
          }
        : p
      const b = displayToBase(g, q)
      dab(ctx, b.x * planeW, b.y * planeH, r, brush.softness, brush.flow / 100 / 2, s.erase)
      if (sctx) {
        sctx.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over'
        sctx.fillStyle = s.erase ? 'rgba(0,0,0,1)' : 'rgba(255,60,60,0.12)'
        sctx.beginPath()
        sctx.arc(q.x * rect.w, q.y * rect.h, brush.size / 2, 0, Math.PI * 2)
        sctx.fill()
      }
    }
    s.last = p
  }
  const begin = async (e: React.PointerEvent): Promise<void> => {
    const recipe = useDevelop.getState().recipe
    if (!recipe || !layerId) return
    const layer = recipe.layers.find((l) => l.id === layerId)
    if (!layer) return
    const erase = brush.erase || e.altKey
    // Paint into the layer's last brush component; erasing needs one to erase from.
    const existing = [...layer.components]
      .reverse()
      .find((c): c is BrushComponent => c.kind === 'brush')
    if (!existing && erase) return
    const plane = await planeCanvas(existing, planeW, planeH)
    stroke.current = { plane, compId: existing?.id ?? newId(), isNew: !existing, last: null, erase }
    const sc = screen.current
    if (sc) {
      sc.width = rect.w
      sc.height = rect.h
    }
    paint(toDisplay(e))
  }
  const end = async (): Promise<void> => {
    const s = stroke.current
    stroke.current = null
    const sc = screen.current
    if (sc) sc.getContext('2d')?.clearRect(0, 0, sc.width, sc.height)
    if (!s || !session) return
    const ctx = s.plane.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
    const data = ctx.getImageData(0, 0, s.plane.width, s.plane.height).data
    const grey = new Uint8Array(s.plane.width * s.plane.height)
    for (let i = 0; i < grey.length; i++) grey[i] = data[i * 4 + 3]
    try {
      const png = await api.develop.encodeMask(grey, s.plane.width, s.plane.height)
      edit((r) => {
        const l = r.layers.find((x) => x.id === layerId)
        if (!l) return
        const c = l.components.find((x) => x.id === s.compId)
        if (c && c.kind === 'brush') c.png = png
        else
          l.components.push({
            id: s.compId,
            kind: 'brush',
            mode: 'Add',
            opacity: 100,
            invert: false,
            feather: 0,
            width: s.plane.width,
            height: s.plane.height,
            png
          })
      })
      commit(s.erase ? 'Brush erase' : 'Brush stroke')
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
    }
  }
  return (
    <div
      className="tool-layer brush"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        void begin(e)
      }}
      onPointerMove={(e) => {
        const p = toDisplay(e)
        setCursor(p)
        if (stroke.current) paint(p)
      }}
      onPointerUp={() => void end()}
      onPointerLeave={() => setCursor(null)}
    >
      <canvas
        ref={screen}
        className="overlay-canvas"
        style={{ left: 0, top: 0, width: rect.w, height: rect.h }}
      />
      {cursor && (
        <div
          className={`brush-cursor ${brush.erase ? 'erase' : ''}`}
          style={{
            left: cursor.x * rect.w - brush.size / 2,
            top: cursor.y * rect.h - brush.size / 2,
            width: brush.size,
            height: brush.size
          }}
        />
      )}
      {!layerId && <div className="tool-hint">Select or create a mask to paint into.</div>}
    </div>
  )
}

// ── Lasso ────────────────────────────────────────────────────────────────────

function PolygonLayer({ rect, g }: { rect: Rect; g: ViewGeometry }): React.JSX.Element {
  const layerId = useDevelop((s) => s.layerId)
  const recipe = useDevelop((s) => s.recipe)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const [pts, setPts] = useState<P[]>([])
  const [hover, setHover] = useState<P | null>(null)
  const toDisplay = (e: React.MouseEvent): P => ({
    x: (e.clientX - rect.x0) / rect.w,
    y: (e.clientY - rect.y0) / rect.h
  })
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
}

// ── 1:1 region view ──────────────────────────────────────────────────────────

function RegionView({ size }: { size: { w: number; h: number } }): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const setZoom = useDevelop((s) => s.setZoom)
  const centre = useRegionCentre()
  const [region, setRegion] = useState<RegionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const drag = useRef<{ x: number; y: number; c: P; moved: boolean } | null>(null)
  const dpr = window.devicePixelRatio || 1
  const g =
    session && recipe ? viewGeometry(recipe, session.frameWidth, session.frameHeight, true) : null
  const vw = Math.round(size.w * dpr)
  const vh = Math.round(size.h * dpr)
  const [c, setC] = useState<P>(centre.get())
  const request = useRef(0)
  useEffect(() => {
    if (!session || !g) return
    const id = ++request.current
    const t = setTimeout(() => {
      setBusy(true)
      const x = Math.round(c.x * g.width - vw / 2)
      const y = Math.round(c.y * g.height - vh / 2)
      api.develop
        .region({
          key: session.key,
          x: Math.max(0, x),
          y: Math.max(0, y),
          width: vw,
          height: vh,
          zoom: 1
        })
        .then((r) => {
          if (id === request.current) {
            setRegion(r)
            setErr(null)
          }
        })
        .catch((e) => setErr(errorText(e)))
        .finally(() => id === request.current && setBusy(false))
    }, 120)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.x, c.y, vw, vh, recipe, session?.key])
  if (!g) return <div />
  const left = region ? (region.x - (c.x * g.width - vw / 2)) / dpr : 0
  const top = region ? (region.y - (c.y * g.height - vh / 2)) / dpr : 0
  return (
    <div
      className="region-view"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, y: e.clientY, c, moved: false }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = ((e.clientX - d.x) * dpr) / g.width
        const dy = ((e.clientY - d.y) * dpr) / g.height
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true
        const next = {
          x: Math.min(1, Math.max(0, d.c.x - dx)),
          y: Math.min(1, Math.max(0, d.c.y - dy))
        }
        setC(next)
        centre.set(next)
      }}
      onPointerUp={() => {
        const d = drag.current
        drag.current = null
        if (d && !d.moved) setZoom('fit')
      }}
    >
      {region && (
        <img
          className="region-img"
          src={region.url}
          style={{ left, top, width: region.width / dpr, height: region.height / dpr }}
          draggable={false}
        />
      )}
      <div className="region-badge">
        100% · {busy ? 'rendering…' : region ? `${region.ms} ms` : ''} · uncropped frame · drag to
        pan, click to fit
        {err && <span className="error"> {err}</span>}
      </div>
    </div>
  )
}

/** Where the 1:1 view is centred, in normalised oriented-frame coordinates. */
const regionCentre = { value: { x: 0.5, y: 0.5 } as P }
function useRegionCentre(): { get: () => P; set: (p: P) => void } {
  return {
    get: () => regionCentre.value,
    set: (p) => (regionCentre.value = p)
  }
}

// ── The loupe ────────────────────────────────────────────────────────────────

export function Loupe(): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const recipe = useDevelop((s) => s.recipe)
  const picture = useDevelop((s) => s.picture)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const tool = useDevelop((s) => s.tool)
  const compare = useDevelop((s) => s.compare)
  const clipping = useDevelop((s) => s.clipping)
  const zoom = useDevelop((s) => s.zoom)
  const overlay = useDevelop((s) => s.overlay)
  const layerId = useDevelop((s) => s.layerId)
  const loading = useDevelop((s) => s.loading)
  const error = useDevelop((s) => s.error)
  const rendering = useDevelop((s) => s.rendering)
  const setTool = useDevelop((s) => s.setTool)
  const setZoom = useDevelop((s) => s.setZoom)
  const replace = useDevelop((s) => s.replace)
  const setTargetEdge = useDevelop((s) => s.setTargetEdge)
  const [boxRef, size, boxEl] = useSize()
  const [split, setSplit] = useState(0.5)

  useEffect(() => {
    if (size.w > 0)
      setTargetEdge(Math.round(Math.max(size.w, size.h) * (window.devicePixelRatio || 1)))
  }, [size.w, size.h, setTargetEdge])

  const g = useMemo(
    () =>
      session && recipe
        ? viewGeometry(recipe, session.frameWidth, session.frameHeight, tool === 'crop')
        : null,
    [session, recipe, tool]
  )

  // The picture's rectangle inside the box, fitted and centred.
  const rect = useMemo(() => {
    if (!picture || size.w === 0) return null
    const k = Math.min(size.w / picture.width, size.h / picture.height, 4)
    const w = picture.width * k
    const h = picture.height * k
    const x = (size.w - w) / 2
    const y = (size.h - h) / 2
    const b = boxEl?.getBoundingClientRect()
    return { x, y, w, h, x0: (b?.left ?? 0) + x, y0: (b?.top ?? 0) + y }
  }, [picture, size, boxEl])

  const pick = useCallback(
    async (e: React.MouseEvent) => {
      if (!session || !recipe || !g || !rect) return
      const p = { x: (e.clientX - rect.x0) / rect.w, y: (e.clientY - rect.y0) / rect.h }
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
        const img = await loadImage(picture.url)
        const c = document.createElement('canvas')
        c.width = img.naturalWidth
        c.height = img.naturalHeight
        const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
        ctx.drawImage(img, 0, 0)
        const px = Math.floor(p.x * c.width)
        const py = Math.floor(p.y * c.height)
        const d = ctx.getImageData(Math.max(0, px - 2), Math.max(0, py - 2), 5, 5).data
        let r = 0
        let gg = 0
        let b = 0
        for (let i = 0; i < d.length; i += 4) {
          r += d[i]
          gg += d[i + 1]
          b += d[i + 2]
        }
        const n = d.length / 4
        r /= n * 255
        gg /= n * 255
        b /= n * 255
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
        let comp: MaskComponentSetting | undefined = [...l.components]
          .reverse()
          .find((x) => x.kind === 'range')
        if (!comp) {
          comp = emptyRange(sat > 0.15 ? 'color' : 'luminance')
          l.components.push(comp)
        }
        if (comp.kind === 'range') {
          if (comp.hue || sat > 0.15)
            comp.hue = { centre: Math.round(hue), width: 30, softness: 20 }
          if (comp.saturation || sat > 0.15)
            comp.saturation = { centre: Math.round(sat * 100) / 100, width: 0.5, softness: 0.2 }
          if (comp.luma || sat <= 0.15)
            comp.luma = { centre: Math.round(luma * 100) / 100, width: 0.25, softness: 0.12 }
        }
        replace(next, 'Pick range')
        setTool('none')
      }
    },
    [session, recipe, g, rect, tool, picture, layerId, replace, setTool]
  )

  if (loading) return <div className="loupe empty">Developing…</div>
  if (!session || !recipe) return <div className="loupe empty">{error ?? 'Choose a photo'}</div>
  if (zoom === 1) {
    return (
      <div ref={boxRef} className="loupe">
        {size.w > 0 && <RegionView size={size} />}
      </div>
    )
  }
  const shown = compare === 'before' && before ? before : picture
  const rotate =
    tool === 'crop' && recipe.geometry.straighten !== 0
      ? `rotate(${recipe.geometry.straighten}deg)`
      : undefined
  return (
    <div
      ref={boxRef}
      className={`loupe tool-${tool}`}
      onClick={(e) => {
        if (tool === 'wb-picker' || tool === 'range-picker') void pick(e)
      }}
      onDoubleClick={(e) => {
        if (tool !== 'none' || !g || !rect) return
        const p = { x: (e.clientX - rect.x0) / rect.w, y: (e.clientY - rect.y0) / rect.h }
        const o = displayToOriented(g, p)
        regionCentre.value = o
        setZoom(1)
      }}
    >
      {shown && rect && (
        <div
          className="picture"
          style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, transform: rotate }}
        >
          <img src={shown.url} draggable={false} />
          {compare === 'split' && before && (
            <div
              className="split-before"
              style={{ clipPath: `inset(0 ${(1 - split) * 100}% 0 0)` }}
            >
              <img src={before.url} draggable={false} />
            </div>
          )}
          {mask && overlay && layerId && tool !== 'crop' && (
            <div
              className="mask-overlay"
              style={{ maskImage: `url("${mask.url}")`, WebkitMaskImage: `url("${mask.url}")` }}
            />
          )}
        </div>
      )}
      {compare === 'split' && rect && (
        <div
          className="split-handle"
          style={{ left: rect.x + rect.w * split, top: rect.y, height: rect.h }}
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => {
            if (e.buttons !== 1) return
            setSplit(Math.min(1, Math.max(0, (e.clientX - rect.x0) / rect.w)))
          }}
        />
      )}
      {clipping && picture && rect && <ClippingOverlay url={picture.url} rect={rect} />}
      {tool === 'crop' && rect && g && (
        // Keyed on the framing, so a new straighten or aspect starts a fresh crop box.
        <CropOverlay
          key={`${recipe.geometry.straighten}:${recipe.geometry.aspect}:${recipe.geometry.quarterTurns}:${recipe.geometry.flipHorizontal}`}
          rect={rect}
          g={g}
        />
      )}
      {tool === 'brush' && rect && g && <BrushLayer rect={rect} g={g} />}
      {tool === 'polygon' && rect && g && <PolygonLayer rect={rect} g={g} />}
      <div className="loupe-status">
        {rendering ? '● rendering' : ''}
        {compare === 'before' ? ' · BEFORE' : ''}
        {error ? <span className="error"> {error}</span> : ''}
      </div>
    </div>
  )
}
