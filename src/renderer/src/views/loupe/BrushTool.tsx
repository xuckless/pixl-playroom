import { memo, useRef, useState } from 'react'
import { newId, type BrushComponent } from '../../../../shared/recipe'
import {
  displayToBase,
  normalisedIn,
  type P,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { api, errorText } from '../../lib/api'
import { loadImage } from '../../lib/image'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'

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

export const BrushLayer = memo(function BrushLayer({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element {
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
  const toDisplay = (e: React.PointerEvent): P =>
    normalisedIn(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
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
})
