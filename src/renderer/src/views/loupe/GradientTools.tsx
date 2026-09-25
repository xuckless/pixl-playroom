import { memo, useRef } from 'react'
import {
  gradientPlaneSize,
  linearLines,
  radialGeometry,
  radialHandles,
  radialOutline,
  type Pt
} from '../../../../shared/gradients'
import {
  newId,
  type LinearComponent,
  type MaskComponentSetting,
  type RadialComponent
} from '../../../../shared/recipe'
import {
  baseToDisplay,
  displayToBase,
  normalisedIn,
  type Rect,
  type ViewGeometry
} from '../../../../shared/view'
import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { createMask, madeComponent, modeForNew } from '../../panels/masks/model'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'

type Gradient = LinearComponent | RadialComponent
type Handle = 'create' | 'move' | 'start' | 'end' | 'rx' | 'ry' | 'rotate'

interface Drag {
  handle: Handle
  id: string
  from: Pt
  orig: Gradient
}

const isGradient = (c: MaskComponentSetting | undefined): c is Gradient =>
  c?.kind === 'linear' || c?.kind === 'radial'

/** Put a changed gradient back into the recipe, wherever it lives. */
function write(next: Gradient, live: boolean): void {
  useDevelop.getState().edit((r) => {
    for (const l of r.layers) {
      const i = l.components.findIndex((c) => c.id === next.id)
      if (i >= 0) l.components[i] = next
    }
  }, live)
}

/**
 * Linear and radial gradients on the picture. With the tool active, a drag
 * draws a new one into the selected mask (Shift: 45° steps for a linear,
 * a circle for a radial). A selected gradient shows Lightroom's handles:
 * the three lines or the ellipse with its softness ring, a glass pin to
 * move it, end points or axis handles to shape it, and a knob to turn it.
 */
export const GradientTools = memo(function GradientTools({
  rect,
  g
}: {
  rect: Rect
  g: ViewGeometry
}): React.JSX.Element | null {
  const tool = useDevelop((s) => s.tool)
  const compId = useDevelop((s) => s.compId)
  const recipe = useDevelop((s) => s.recipe)
  const session = useDevelop((s) => s.session)
  const pins = useUi((s) => s.maskOverlay.pins)
  const panel = useUi((s) => s.panel)
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  const drawing = tool === 'linear' || tool === 'radial'
  const selected = recipe?.layers.flatMap((l) => l.components).find((c) => c.id === compId)
  const shown = isGradient(selected) ? selected : null
  if (!recipe || !session) return null
  if (!drawing && (!shown || panel !== 'masks' || pins === 'never')) return null

  // plane pixels of a component ↔ display pixels of the loupe
  const toScreen = (c: Gradient, p: Pt): Pt => {
    const d = baseToDisplay(g, { x: p.x / c.width, y: p.y / c.height })
    return { x: d.x * rect.w, y: d.y * rect.h }
  }
  const toPlane = (c: { width: number; height: number }, e: React.PointerEvent): Pt => {
    const b = layer.current?.getBoundingClientRect()
    const d = b ? normalisedIn(e.clientX, e.clientY, b) : { x: 0, y: 0 }
    const base = displayToBase(g, d)
    return { x: base.x * c.width, y: base.y * c.height }
  }
  const capture = (e: React.PointerEvent): void => {
    e.stopPropagation()
    layer.current?.setPointerCapture(e.pointerId)
  }

  const begin = (e: React.PointerEvent, handle: Handle, c: Gradient): void => {
    if (e.button !== 0) return
    capture(e)
    drag.current = { handle, id: c.id, from: toPlane(c, e), orig: c }
  }

  const create = (e: React.PointerEvent): void => {
    if (!drawing || e.button !== 0) return
    let d = useDevelop.getState()
    if (!d.layerId) {
      createMask()
      d = useDevelop.getState()
    }
    const l = d.recipe?.layers.find((x) => x.id === d.layerId)
    if (!l) return
    const size = gradientPlaneSize(session.frameWidth, session.frameHeight)
    const at = toPlane(size, e)
    const n = { x: at.x / size.width, y: at.y / size.height }
    const base = {
      id: newId(),
      mode: modeForNew(l),
      opacity: 100,
      invert: false,
      feather: 0,
      ...size
    }
    const c: Gradient =
      tool === 'linear'
        ? { ...base, kind: 'linear', start: n, end: n }
        : {
            ...base,
            kind: 'radial',
            centre: n,
            radiusX: 0.001,
            radiusY: 0.001,
            angle: 0,
            softness: 50
          }
    d.edit((r) => r.layers.find((x) => x.id === d.layerId)?.components.push(c), true)
    capture(e)
    drag.current = { handle: 'create', id: c.id, from: at, orig: c }
  }

  const move = (e: React.PointerEvent): void => {
    const dr = drag.current
    if (!dr) return
    const o = dr.orig
    const p = toPlane(o, e)
    const dx = p.x - dr.from.x
    const dy = p.y - dr.from.y
    const norm = (q: Pt): Pt => ({ x: q.x / o.width, y: q.y / o.height })
    if (o.kind === 'linear') {
      const s = { x: o.start.x * o.width, y: o.start.y * o.height }
      const en = { x: o.end.x * o.width, y: o.end.y * o.height }
      if (dr.handle === 'create' || dr.handle === 'end') {
        let q = dr.handle === 'create' ? p : { x: en.x + dx, y: en.y + dy }
        const from = s
        if (e.shiftKey) {
          // 45° steps, measured on screen.
          const a = toScreen(o, from)
          const b = toScreen(o, q)
          const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4)
          const len = Math.hypot(b.x - a.x, b.y - a.y)
          const snapped = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len }
          const base = displayToBase(g, { x: snapped.x / rect.w, y: snapped.y / rect.h })
          q = { x: base.x * o.width, y: base.y * o.height }
        }
        write({ ...o, end: norm(q) }, true)
      } else if (dr.handle === 'start') {
        write({ ...o, start: norm({ x: s.x + dx, y: s.y + dy }) }, true)
      } else if (dr.handle === 'move') {
        write(
          {
            ...o,
            start: norm({ x: s.x + dx, y: s.y + dy }),
            end: norm({ x: en.x + dx, y: en.y + dy })
          },
          true
        )
      } else if (dr.handle === 'rotate') {
        const m = { x: (s.x + en.x) / 2, y: (s.y + en.y) / 2 }
        const a0 = Math.atan2(dr.from.y - m.y, dr.from.x - m.x)
        const a1 = Math.atan2(p.y - m.y, p.x - m.x)
        const t = a1 - a0
        const rot = (q: Pt): Pt => ({
          x: m.x + (q.x - m.x) * Math.cos(t) - (q.y - m.y) * Math.sin(t),
          y: m.y + (q.x - m.x) * Math.sin(t) + (q.y - m.y) * Math.cos(t)
        })
        write({ ...o, start: norm(rot(s)), end: norm(rot(en)) }, true)
      }
      return
    }
    const geo = radialGeometry(o)
    const short = Math.min(o.width, o.height)
    const local = (q: Pt): Pt => {
      const x = q.x - geo.cx
      const y = q.y - geo.cy
      return {
        x: x * Math.cos(-geo.angle) - y * Math.sin(-geo.angle),
        y: x * Math.sin(-geo.angle) + y * Math.cos(-geo.angle)
      }
    }
    if (dr.handle === 'create') {
      const q = local(p)
      let rx = Math.abs(q.x) / short
      let ry = Math.abs(q.y) / short
      if (e.shiftKey) rx = ry = Math.max(rx, ry, Math.hypot(q.x, q.y) / short)
      write({ ...o, radiusX: Math.max(0.002, rx), radiusY: Math.max(0.002, ry) }, true)
    } else if (dr.handle === 'move') {
      write({ ...o, centre: norm({ x: geo.cx + dx, y: geo.cy + dy }) }, true)
    } else if (dr.handle === 'rx' || dr.handle === 'ry') {
      const q = local(p)
      const r = Math.max(0.005, Math.abs(dr.handle === 'rx' ? q.x : q.y) / short)
      if (e.shiftKey) write({ ...o, radiusX: r, radiusY: r }, true)
      else write(dr.handle === 'rx' ? { ...o, radiusX: r } : { ...o, radiusY: r }, true)
    } else if (dr.handle === 'rotate') {
      // The knob sits above the ellipse (−90° in its own frame).
      const a = Math.atan2(p.y - geo.cy, p.x - geo.cx) + Math.PI / 2
      let deg = (a * 180) / Math.PI
      if (e.shiftKey) deg = Math.round(deg / 15) * 15
      write({ ...o, angle: Math.round(deg * 10) / 10 }, true)
    }
  }

  const end = (e: React.PointerEvent): void => {
    const dr = drag.current
    drag.current = null
    if (!dr) return
    const d = useDevelop.getState()
    if (dr.handle === 'create') {
      const now = d.recipe?.layers.flatMap((l) => l.components).find((c) => c.id === dr.id)
      if (isGradient(now)) {
        const a = toScreen(now, dr.from)
        const b = toScreen(now, toPlane(now, e))
        // A click without a drag gets a sensible default rather than nothing.
        if (Math.hypot(b.x - a.x, b.y - a.y) < 6) {
          if (now.kind === 'linear') {
            const s = now.start
            write({ ...now, end: { x: s.x, y: Math.min(1.2, s.y + 0.25) } }, false)
          } else write({ ...now, radiusX: 0.2, radiusY: 0.2 }, false)
        }
      }
      d.commit(dr.orig.kind === 'linear' ? 'Linear gradient' : 'Radial gradient')
      madeComponent(dr.id)
      return
    }
    d.commit(dr.orig.kind === 'linear' ? 'Move linear gradient' : 'Move radial gradient')
  }

  const reach = 4 * Math.max(shown?.width ?? 1, shown?.height ?? 1)
  const path = (pts: Pt[], c: Gradient): string =>
    pts
      .map((q) => toScreen(c, q))
      .map((q, i) => `${i ? 'L' : 'M'}${q.x.toFixed(1)},${q.y.toFixed(1)}`)
      .join(' ') + ' Z'

  let body: React.JSX.Element | null = null
  if (shown?.kind === 'linear') {
    const [a, mid, b] = linearLines(shown, reach).map(
      ([p, q]) => [toScreen(shown, p), toScreen(shown, q)] as const
    )
    const s = toScreen(shown, { x: shown.start.x * shown.width, y: shown.start.y * shown.height })
    const en = toScreen(shown, { x: shown.end.x * shown.width, y: shown.end.y * shown.height })
    const m = { x: (s.x + en.x) / 2, y: (s.y + en.y) / 2 }
    const dir = Math.atan2(mid[1].y - mid[0].y, mid[1].x - mid[0].x)
    const knob = { x: m.x + Math.cos(dir) * 64, y: m.y + Math.sin(dir) * 64 }
    body = (
      <>
        <svg className="grad-lines" width={rect.w} height={rect.h}>
          <line className="gl solid" x1={a[0].x} y1={a[0].y} x2={a[1].x} y2={a[1].y} />
          <line className="gl dashed" x1={mid[0].x} y1={mid[0].y} x2={mid[1].x} y2={mid[1].y} />
          <line className="gl faint" x1={b[0].x} y1={b[0].y} x2={b[1].x} y2={b[1].y} />
          <line className="gl axis" x1={s.x} y1={s.y} x2={en.x} y2={en.y} />
        </svg>
        <span
          className="grad-handle"
          style={{ left: s.x, top: s.y }}
          title="Full effect from here"
          onPointerDown={(e) => begin(e, 'start', shown)}
        />
        <span
          className="grad-handle"
          style={{ left: en.x, top: en.y }}
          title="No effect past here"
          onPointerDown={(e) => begin(e, 'end', shown)}
        />
        <span
          className="grad-knob"
          style={{ left: knob.x, top: knob.y }}
          title="Turn"
          onPointerDown={(e) => begin(e, 'rotate', shown)}
        />
        <LiquidGlass
          className="grad-pin"
          radius={10}
          bezel={6}
          strength={1.2}
          frost={0.5}
          magnify
          style={{ left: m.x, top: m.y }}
          title="Move"
          onPointerDown={(e) => begin(e, 'move', shown)}
        >
          <i />
        </LiquidGlass>
      </>
    )
  } else if (shown?.kind === 'radial') {
    const geo = radialGeometry(shown)
    const c = toScreen(shown, { x: geo.cx, y: geo.cy })
    const hs = radialHandles(shown).map((p) => toScreen(shown, p))
    const top = hs[3]
    const up = Math.atan2(top.y - c.y, top.x - c.x)
    const knob = { x: top.x + Math.cos(up) * 22, y: top.y + Math.sin(up) * 22 }
    body = (
      <>
        <svg className="grad-lines" width={rect.w} height={rect.h}>
          <path className="gl solid" d={path(radialOutline(shown, 1), shown)} />
          {shown.softness > 0 && (
            <path
              className="gl dashed"
              d={path(radialOutline(shown, Math.max(0.01, 1 - shown.softness / 100)), shown)}
            />
          )}
          <line className="gl faint" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} />
        </svg>
        {hs.map((h, i) => (
          <span
            key={i}
            className="grad-handle"
            style={{ left: h.x, top: h.y }}
            title="Shape (Shift: circle)"
            onPointerDown={(e) => begin(e, i % 2 === 0 ? 'rx' : 'ry', shown)}
          />
        ))}
        <span
          className="grad-knob"
          style={{ left: knob.x, top: knob.y }}
          title="Turn (Shift: 15° steps)"
          onPointerDown={(e) => begin(e, 'rotate', shown)}
        />
        <LiquidGlass
          className="grad-pin"
          radius={10}
          bezel={6}
          strength={1.2}
          frost={0.5}
          magnify
          style={{ left: c.x, top: c.y }}
          title="Move"
          onPointerDown={(e) => begin(e, 'move', shown)}
        >
          <i />
        </LiquidGlass>
      </>
    )
  }

  return (
    <div
      ref={layer}
      className={`tool-layer gradients${drawing ? ' drawing' : ''}${shown ? ` pins-${pins}` : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={create}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {body}
    </div>
  )
})
