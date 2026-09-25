import { memo, useRef, useState } from 'react'
import {
  autoMaskWeight,
  composeStroke,
  deltaE,
  srgbToLab,
  stampDab
} from '../../../../shared/brush'
import { newId, type BrushComponent } from '../../../../shared/recipe'
import {
  baseToDisplay,
  displayToBase,
  normalisedIn,
  type P,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { api, errorText } from '../../lib/api'
import { loadImage } from '../../lib/image'
import { madeComponent, modeForNew } from '../../panels/masks/model'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { useUi, type BrushSettings } from '../../state/ui'

/** Painted planes are this many pixels on their long edge, in the base frame. */
const BRUSH_EDGE = 1024
/** What one dab lays down at full flow (dabs overlap every eighth of a diameter). */
const FLOW_PER_DAB = 0.35

/** A painted plane as coverage 0…1 (a new plane is empty). */
async function planeOf(c: BrushComponent | undefined, w: number, h: number): Promise<Float32Array> {
  const out = new Float32Array(w * h)
  if (!c?.png) return out
  const img = await loadImage(`data:image/png;base64,${c.png}`)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.drawImage(img, 0, 0, w, h)
  const d = ctx.getImageData(0, 0, w, h).data
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255
  return out
}

interface Sampler {
  w: number
  h: number
  lab: Float32Array
}
const samplers = new Map<string, Promise<Sampler>>()

/** The picture on screen, small, in Lab: what Auto Mask compares colours in. */
function samplerFor(url: string): Promise<Sampler> {
  let s = samplers.get(url)
  if (!s) {
    s = (async () => {
      const img = await loadImage(url)
      const k = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight))
      const w = Math.max(1, Math.round(img.naturalWidth * k))
      const h = Math.max(1, Math.round(img.naturalHeight * k))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
      ctx.drawImage(img, 0, 0, w, h)
      const d = ctx.getImageData(0, 0, w, h).data
      const lab = new Float32Array(w * h * 3)
      for (let i = 0; i < w * h; i++) {
        const [L, a, b] = srgbToLab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])
        lab[i * 3] = L
        lab[i * 3 + 1] = a
        lab[i * 3 + 2] = b
      }
      return { w, h, lab }
    })()
    samplers.clear()
    samplers.set(url, s)
  }
  return s
}

function labAt(s: Sampler, p: P): [number, number, number] {
  const x = Math.min(s.w - 1, Math.max(0, Math.floor(p.x * s.w)))
  const y = Math.min(s.h - 1, Math.max(0, Math.floor(p.y * s.h)))
  const i = (y * s.w + x) * 3
  return [s.lab[i], s.lab[i + 1], s.lab[i + 2]]
}

interface Stroke {
  plane: Float32Array
  stroke: Float32Array
  compId: string
  isNew: boolean
  last: P | null
  erase: boolean
  set: BrushSettings
  sampler: Sampler | null
}

/**
 * Painting a mask, as in Lightroom: brushes A and B and an eraser (Alt), each
 * with its size, feather, flow and density; a pen's pressure; Auto Mask to
 * keep a stroke to similar colours. It paints the selected brush component,
 * or the mask's last, or a new one in the pending Add / Subtract /
 * Intersect mode.
 */
export const BrushLayer = memo(function BrushLayer({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const layerId = useDevelop((s) => s.layerId)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const slot = useUi((s) => s.brushSlot)
  const brush = useUi((s) => s.brushes[s.brushSlot])
  const screen = useRef<HTMLCanvasElement>(null)
  const stroke = useRef<Stroke | null>(null)
  const [cursor, setCursor] = useState<P | null>(null)
  const [altDown, setAltDown] = useState(false)
  // The base frame's size in pixels (the file upright, before the user's turns).
  const baseW = session?.frameWidth ?? 1
  const baseH = session?.frameHeight ?? 1
  const planeW = baseW >= baseH ? BRUSH_EDGE : Math.round((BRUSH_EDGE * baseW) / baseH)
  const planeH = baseH > baseW ? BRUSH_EDGE : Math.round((BRUSH_EDGE * baseH) / baseW)
  const toDisplay = (e: { clientX: number; clientY: number }, el: Element): P =>
    normalisedIn(e.clientX, e.clientY, el.getBoundingClientRect())
  // Plane pixels per screen pixel, measured through the view mapping.
  const scaleAt = (p: P): number => {
    const a = displayToBase(g, p)
    const b = displayToBase(g, { x: p.x + 1 / rect.w, y: p.y })
    return Math.hypot((b.x - a.x) * planeW, (b.y - a.y) * planeH)
  }

  const dab = (s: Stroke, q: P, pressure: number): void => {
    const set = s.set
    const pr = set.pressure ? pressure : 1
    const k = scaleAt(q)
    const r = (set.size / 2) * k * (set.pressure ? 0.25 + 0.75 * pr : 1)
    const flow = (set.flow / 100) * FLOW_PER_DAB * pr
    const b = displayToBase(g, q)
    let weight: ((x: number, y: number) => number) | undefined
    if (set.autoMask && s.sampler) {
      const sm = s.sampler
      const centre = labAt(sm, q)
      weight = (x, y) => {
        const d = baseToDisplay(g, { x: (x + 0.5) / planeW, y: (y + 0.5) / planeH })
        return autoMaskWeight(deltaE(centre, labAt(sm, d)))
      }
    }
    stampDab(s.stroke, planeW, planeH, b.x * planeW, b.y * planeH, r, set.softness, flow, weight)
    const sctx = screen.current?.getContext('2d')
    if (sctx) {
      sctx.globalCompositeOperation = 'source-over'
      sctx.fillStyle = s.erase ? 'rgba(10,10,14,0.22)' : 'rgba(157,139,234,0.16)'
      sctx.beginPath()
      sctx.arc(q.x * rect.w, q.y * rect.h, (r / k) * 0.9, 0, Math.PI * 2)
      sctx.fill()
    }
  }

  const paint = (p: P, pressure: number): void => {
    const s = stroke.current
    if (!s) return
    const spacing = Math.max(1, s.set.size / 8)
    const steps = s.last
      ? Math.max(
          1,
          Math.ceil(Math.hypot((p.x - s.last.x) * rect.w, (p.y - s.last.y) * rect.h) / spacing)
        )
      : 1
    for (let i = 1; i <= steps; i++) {
      const q = s.last
        ? {
            x: s.last.x + ((p.x - s.last.x) * i) / steps,
            y: s.last.y + ((p.y - s.last.y) * i) / steps
          }
        : p
      dab(s, q, pressure)
    }
    s.last = p
  }

  const begin = async (e: React.PointerEvent<HTMLDivElement>): Promise<void> => {
    const d = useDevelop.getState()
    const recipe = d.recipe
    if (!recipe || !layerId) return
    const layer = recipe.layers.find((l) => l.id === layerId)
    if (!layer) return
    const ui = useUi.getState()
    const erase = ui.brushSlot === 'erase' || e.altKey
    const set = erase ? ui.brushes.erase : ui.brushes[ui.brushSlot]
    // The selected brush, else the mask's last — unless Add / Subtract /
    // Intersect asked for a new one. Erasing needs a brush to erase from.
    const selected = layer.components.find(
      (c): c is BrushComponent => c.id === d.compId && c.kind === 'brush'
    )
    const existing =
      d.addMode !== null
        ? undefined
        : (selected ??
          [...layer.components].reverse().find((c): c is BrushComponent => c.kind === 'brush'))
    if (!existing && erase) return
    const p = toDisplay(e, e.currentTarget)
    const pressure = e.pointerType === 'pen' ? e.pressure || 0.5 : 1
    const picture = d.picture?.url
    const [plane, sampler] = await Promise.all([
      planeOf(existing, planeW, planeH),
      set.autoMask && picture ? samplerFor(picture).catch(() => null) : Promise.resolve(null)
    ])
    stroke.current = {
      plane,
      stroke: new Float32Array(planeW * planeH),
      compId: existing?.id ?? newId(),
      isNew: !existing,
      last: null,
      erase,
      set,
      sampler
    }
    const sc = screen.current
    if (sc) {
      sc.width = rect.w
      sc.height = rect.h
    }
    paint(p, pressure)
  }

  const end = async (): Promise<void> => {
    const s = stroke.current
    stroke.current = null
    const sc = screen.current
    if (sc) sc.getContext('2d')?.clearRect(0, 0, sc.width, sc.height)
    if (!s || !session) return
    const out = composeStroke(s.plane, s.stroke, s.set.density / 100, s.erase)
    const grey = new Uint8Array(out.length)
    for (let i = 0; i < out.length; i++) grey[i] = Math.round(out[i] * 255)
    try {
      const png = await api.develop.encodeMask(grey, planeW, planeH)
      edit((r) => {
        const l = r.layers.find((x) => x.id === layerId)
        if (!l) return
        const c = l.components.find((x) => x.id === s.compId)
        if (c && c.kind === 'brush') c.png = png
        else
          l.components.push({
            id: s.compId,
            kind: 'brush',
            mode: modeForNew(l),
            opacity: 100,
            invert: false,
            feather: 0,
            width: planeW,
            height: planeH,
            png
          })
      })
      commit(s.erase ? 'Brush erase' : 'Brush stroke')
      madeComponent(s.compId)
    } catch (err) {
      useLibrary.getState().say(errorText(err), 'error')
    }
  }

  const erasing = slot === 'erase' || altDown
  return (
    <div
      className="tool-layer brush"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        void begin(e)
      }}
      onPointerMove={(e) => {
        const el = e.currentTarget
        setAltDown(e.altKey)
        setCursor(toDisplay(e, el))
        if (!stroke.current) return
        // Every sample the pointer made since the last frame, for smooth strokes.
        const samples = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]
        for (const ev of samples.length ? samples : [e.nativeEvent])
          paint(toDisplay(ev, el), ev.pointerType === 'pen' ? ev.pressure || 0.5 : 1)
      }}
      onPointerUp={() => void end()}
      onPointerCancel={() => void end()}
      onPointerLeave={() => setCursor(null)}
    >
      <canvas ref={screen} className="overlay-canvas fill" />
      {cursor && (
        <div
          className={`brush-cursor${erasing ? ' erase' : ''}`}
          style={{
            left: cursor.x * rect.w - brush.size / 2,
            top: cursor.y * rect.h - brush.size / 2,
            width: brush.size,
            height: brush.size
          }}
        >
          <span
            className="brush-core"
            style={{ inset: `${(brush.size / 2) * (brush.softness / 100)}px` }}
          />
          <span className="brush-slot">{erasing ? '−' : slot}</span>
        </div>
      )}
      {!layerId && <div className="tool-hint">Select or create a mask to paint into.</div>}
    </div>
  )
})
