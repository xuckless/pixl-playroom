import { memo, useEffect, useRef, useState } from 'react'
import { newId, type BrushComponent } from '../../../../shared/recipe'
import {
  baseToDisplay,
  displayToBase,
  normalisedIn,
  visiblePart,
  type P,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { api, errorText } from '../../lib/api'
import { planePng, rememberPlane } from '../../lib/planes'
import type { Affine, Dab } from '../../workers/brush.worker'
import { madeComponent, modeForNew } from '../../panels/masks/model'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { useUi, type BrushSettings } from '../../state/ui'
import { brushWorker } from './brushWorker'

/** Painted planes are this many pixels on their long edge, in the base frame. */
const BRUSH_EDGE = 1024
/** What one dab lays down at full flow (dabs overlap every eighth of a diameter). */
const FLOW_PER_DAB = 0.35

/** An affine map of normalised points, from where it takes three of them. */
function affine(f: (p: P) => P): Affine {
  const o = f({ x: 0, y: 0 })
  const x = f({ x: 1, y: 0 })
  const y = f({ x: 0, y: 1 })
  return [x.x - o.x, y.x - o.x, o.x, x.y - o.y, y.y - o.y, o.y]
}

interface Stroke {
  compId: string
  isNew: boolean
  last: P | null
  erase: boolean
  set: BrushSettings
  /** Dabs made since the last message to the worker. */
  pending: Dab[]
  /** The worker has the stroke (its plane is loaded): dabs may go. */
  started: boolean
}

/**
 * Painting a mask, as in Lightroom: brushes A and B and an eraser (Alt), each
 * with its size, feather, flow and density; a pen's pressure; Auto Mask to
 * keep a stroke to similar colours. It paints the selected brush component,
 * or the mask's last, or a new one in the pending Add / Subtract /
 * Intersect mode. The painting itself runs in the brush worker, on the GPU;
 * here the pointer becomes dabs.
 */
export const BrushLayer = memo(function BrushLayer({
  rect,
  box,
  g
}: {
  rect: Rect
  /** The loupe's size: the stroke's canvas covers only the part of the picture in view. */
  box: { w: number; h: number }
  g: ViewGeometry
}): React.JSX.Element {
  const session = useDevelop((s) => s.session)
  const layerId = useDevelop((s) => s.layerId)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const slot = useUi((s) => s.brushSlot)
  const brush = useUi((s) => s.brushes[s.brushSlot])
  const worker = brushWorker()
  const stroke = useRef<Stroke | null>(null)
  const [cursor, setCursor] = useState<P | null>(null)
  const [altDown, setAltDown] = useState(false)
  const vis = visiblePart(box, rect)
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

  // The worker's canvas covers the part of the picture in view; it learns
  // where that is whenever the view moves.
  useEffect(() => {
    worker.post({
      t: 'screen',
      screen: {
        w: vis.w,
        h: vis.h,
        dpr: window.devicePixelRatio || 1,
        ox: vis.x,
        oy: vis.y,
        rw: rect.w,
        rh: rect.h,
        toBase: affine((p) => displayToBase(g, p))
      }
    })
  }, [worker, vis.x, vis.y, vis.w, vis.h, rect.w, rect.h, g])

  const dab = (s: Stroke, q: P, pressure: number): void => {
    const set = s.set
    const pr = set.pressure ? pressure : 1
    const k = scaleAt(q)
    const r = (set.size / 2) * k * (set.pressure ? 0.25 + 0.75 * pr : 1)
    const flow = (set.flow / 100) * FLOW_PER_DAB * pr
    const b = displayToBase(g, q)
    s.pending.push({
      x: b.x * planeW,
      y: b.y * planeH,
      r,
      flow,
      dx: q.x,
      dy: q.y,
      sx: q.x * rect.w - vis.x,
      sy: q.y * rect.h - vis.y,
      sr: (r / k) * 0.9
    })
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

  /** Send what the pointer painted since the last event. */
  const flush = (): void => {
    const s = stroke.current
    if (!s || !s.started || s.pending.length === 0) return
    worker.post({ t: 'dabs', dabs: s.pending })
    s.pending = []
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
    stroke.current = {
      compId: existing?.id ?? newId(),
      isNew: !existing,
      last: null,
      erase,
      set,
      pending: [],
      started: false
    }
    paint(p, pressure)
    let png: string | null = null
    try {
      if (existing && (existing.png || existing.ref)) png = await planePng(existing)
    } catch (err) {
      stroke.current = null
      return useLibrary.getState().say(errorText(err), 'error')
    }
    worker.post({
      t: 'begin',
      w: planeW,
      h: planeH,
      png,
      softness: set.softness,
      erase,
      picture: set.autoMask ? (d.picture?.url ?? null) : null,
      toDisplay: affine((q) => baseToDisplay(g, q))
    })
    const s = stroke.current
    if (!s) return
    s.started = true
    flush()
  }

  const end = async (): Promise<void> => {
    const s = stroke.current
    if (!s) return
    // A stroke let go before the worker had it: it starts first, then ends.
    while (!s.started) {
      if (stroke.current !== s) return
      await new Promise((r) => setTimeout(r, 10))
    }
    flush()
    stroke.current = null
    if (!session) return worker.post({ t: 'cancel' })
    try {
      const png = await worker.finish(s.set.density / 100)
      if (!png) return
      const ref = await api.develop.putPlane(png)
      rememberPlane(ref, png)
      edit((r) => {
        const l = r.layers.find((x) => x.id === layerId)
        if (!l) return
        const c = l.components.find((x) => x.id === s.compId)
        // The recipe holds the plane by reference; the pixels stay in the plane stores.
        if (c && c.kind === 'brush') {
          c.png = ''
          c.ref = ref
        } else
          l.components.push({
            id: s.compId,
            kind: 'brush',
            mode: modeForNew(l),
            opacity: 100,
            invert: false,
            feather: 0,
            width: planeW,
            height: planeH,
            png: '',
            ref
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
        flush()
      }}
      onPointerUp={() => void end()}
      onPointerCancel={() => void end()}
      onPointerLeave={() => setCursor(null)}
    >
      <canvas
        ref={worker.attach}
        className="overlay-canvas"
        style={{ left: vis.x, top: vis.y, width: vis.w, height: vis.h }}
      />
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
