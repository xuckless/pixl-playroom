import { memo, useRef } from 'react'
import {
  bidirectionalLines,
  CENTRE_MAX,
  CENTRE_MIN,
  gradientPlaneSize,
  linearLines,
  radialGeometry,
  radialHandles,
  radialOutline,
  type Pt
} from '../../../../shared/gradients'
import {
  newId,
  type GradientComponent,
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

type Gradient = GradientComponent
type Handle = 'create' | 'move' | 'start' | 'end' | 'centre' | 'rx' | 'ry' | 'rotate' | 'feather'

interface Drag {
  handle: Handle
  id: string
  from: Pt
  orig: Gradient
}

/** Two presses on a pin this close together (ms) are a double-click. */
const DOUBLE_MS = 400

const isGradient = (c: MaskComponentSetting | undefined): c is Gradient =>
  c?.kind === 'linear' || c?.kind === 'radial' || c?.kind === 'bidirectional'

const KIND_WORD: Record<Gradient['kind'], string> = {
  linear: 'linear',
  radial: 'radial',
  bidirectional: 'bidirectional'
}

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
 * Linear, radial and bidirectional gradients on the picture. With the tool
 * active, a drag draws a new one into the selected mask (Shift: 45° steps
 * for a linear or bidirectional, a circle for a radial; a bidirectional is
 * drawn out from its full line, the same either side). A selected gradient
 * shows Lightroom's handles: the three lines or the ellipse with its feather
 * ring, a glass pin to move it, end points or axis handles to shape it, a
 * knob to turn it, on a radial a handle on the feather ring to soften it
 * (double-click the pin to fill the frame), and on a bidirectional a handle
 * that slides its full line between the two. The mask's other gradients
 * show a small pin each, which selects it.
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
  const masksUp = useUi((s) => s.masksWin.open)
  const layer = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag | null>(null)
  // The pin's last press: a second soon after is a double-click (the drag's
  // pointer capture keeps the browser's own dblclick from reaching the pin).
  const lastPin = useRef<{ id: string; at: number } | null>(null)
  const drawing = tool === 'linear' || tool === 'radial' || tool === 'bidirectional'
  const layerId = useDevelop((s) => s.layerId)
  const setComp = useDevelop((s) => s.setComp)
  const selected = recipe?.layers.flatMap((l) => l.components).find((c) => c.id === compId)
  const shown = isGradient(selected) ? selected : null
  // The selected mask's other gradients: a pin each, to pick one.
  const others = (recipe?.layers.find((l) => l.id === layerId)?.components ?? []).filter(
    (c): c is Gradient => isGradient(c) && c.id !== compId
  )
  if (!recipe || !session) return null
  const handlesUp = masksUp && tool !== 'heal'
  if (!drawing && (!handlesUp || (!shown && others.length === 0))) return null

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
        : tool === 'bidirectional'
          ? { ...base, kind: 'bidirectional', start: n, end: n, centre: 0.5 }
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
    if (o.kind === 'bidirectional') {
      const s = { x: o.start.x * o.width, y: o.start.y * o.height }
      const en = { x: o.end.x * o.width, y: o.end.y * o.height }
      const k = Math.min(CENTRE_MAX, Math.max(CENTRE_MIN, o.centre))
      const c = { x: s.x + (en.x - s.x) * k, y: s.y + (en.y - s.y) * k }
      const len = Math.hypot(en.x - s.x, en.y - s.y) || 1
      const u = { x: (en.x - s.x) / len, y: (en.y - s.y) / len }
      // A drag along the gradient's own direction (its lines stay parallel).
      const along = dx * u.x + dy * u.y
      if (dr.handle === 'create') {
        // From the full line out, the same either side.
        let q = p
        if (e.shiftKey) {
          const a = toScreen(o, dr.from)
          const b = toScreen(o, q)
          const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / (Math.PI / 4)) * (Math.PI / 4)
          const l = Math.hypot(b.x - a.x, b.y - a.y)
          const snapped = { x: a.x + Math.cos(ang) * l, y: a.y + Math.sin(ang) * l }
          const base = displayToBase(g, { x: snapped.x / rect.w, y: snapped.y / rect.h })
          q = { x: base.x * o.width, y: base.y * o.height }
        }
        const from = dr.from
        write(
          {
            ...o,
            start: norm({ x: 2 * from.x - q.x, y: 2 * from.y - q.y }),
            end: norm(q),
            centre: 0.5
          },
          true
        )
      } else if (dr.handle === 'start' || dr.handle === 'end') {
        // One side wider or narrower; the full line stays where it is.
        const ns = dr.handle === 'start' ? { x: s.x + u.x * along, y: s.y + u.y * along } : s
        const ne = dr.handle === 'end' ? { x: en.x + u.x * along, y: en.y + u.y * along } : en
        const total = (ne.x - ns.x) * u.x + (ne.y - ns.y) * u.y
        const part = (c.x - ns.x) * u.x + (c.y - ns.y) * u.y
        if (total <= 1e-6 || part <= 0 || part >= total) return
        write({ ...o, start: norm(ns), end: norm(ne), centre: part / total }, true)
      } else if (dr.handle === 'centre') {
        const part = k * len + along
        write({ ...o, centre: Math.min(CENTRE_MAX, Math.max(CENTRE_MIN, part / len)) }, true)
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
        const a0 = Math.atan2(dr.from.y - c.y, dr.from.x - c.x)
        const a1 = Math.atan2(p.y - c.y, p.x - c.x)
        const t = a1 - a0
        const rot = (q: Pt): Pt => ({
          x: c.x + (q.x - c.x) * Math.cos(t) - (q.y - c.y) * Math.sin(t),
          y: c.y + (q.x - c.x) * Math.sin(t) + (q.y - c.y) * Math.cos(t)
        })
        write({ ...o, start: norm(rot(s)), end: norm(rot(en)) }, true)
      }
      return
    }
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
    } else if (dr.handle === 'feather') {
      // Where the full effect ends, as a fraction of the radius: the ring.
      const q = local(p)
      const d = Math.hypot(q.x / Math.max(1e-6, geo.rx), q.y / Math.max(1e-6, geo.ry))
      write({ ...o, softness: Math.round((1 - Math.min(1, Math.max(0, d))) * 100) }, true)
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
          } else if (now.kind === 'bidirectional') {
            const s = now.start
            write(
              {
                ...now,
                start: { x: s.x, y: s.y - 0.15 },
                end: { x: s.x, y: s.y + 0.15 },
                centre: 0.5
              },
              false
            )
          } else write({ ...now, radiusX: 0.2, radiusY: 0.2 }, false)
        }
      }
      const name = KIND_WORD[dr.orig.kind]
      d.commit(`${name[0].toUpperCase()}${name.slice(1)} gradient`)
      madeComponent(dr.id)
      return
    }
    d.commit(
      dr.handle === 'feather'
        ? 'Radial feather'
        : dr.handle === 'centre'
          ? 'Bidirectional gradient: full line'
          : `Move ${KIND_WORD[dr.orig.kind]} gradient`
    )
  }

  /** A radial filling the frame: centred, upright, its ellipse touching every side. */
  const fill = (c: RadialComponent): void => {
    const short = Math.min(c.width, c.height)
    write(
      {
        ...c,
        centre: { x: 0.5, y: 0.5 },
        angle: 0,
        radiusX: c.width / 2 / short,
        radiusY: c.height / 2 / short
      },
      false
    )
    useDevelop.getState().commit('Radial gradient: fill the frame')
  }

  /** Where a gradient's pin sits on screen: a radial's centre, a linear's middle, a bidirectional's full line. */
  const pinAt = (c: Gradient): Pt => {
    if (c.kind === 'radial') {
      const geo = radialGeometry(c)
      return toScreen(c, { x: geo.cx, y: geo.cy })
    }
    if (c.kind === 'bidirectional') {
      const k = Math.min(CENTRE_MAX, Math.max(CENTRE_MIN, c.centre))
      return toScreen(c, {
        x: (c.start.x + (c.end.x - c.start.x) * k) * c.width,
        y: (c.start.y + (c.end.y - c.start.y) * k) * c.height
      })
    }
    return toScreen(c, {
      x: ((c.start.x + c.end.x) / 2) * c.width,
      y: ((c.start.y + c.end.y) / 2) * c.height
    })
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
  } else if (shown?.kind === 'bidirectional') {
    const [a, mid, b] = bidirectionalLines(shown, reach).map(
      ([p, q]) => [toScreen(shown, p), toScreen(shown, q)] as const
    )
    const s = toScreen(shown, { x: shown.start.x * shown.width, y: shown.start.y * shown.height })
    const en = toScreen(shown, { x: shown.end.x * shown.width, y: shown.end.y * shown.height })
    const c = pinAt(shown)
    const dir = Math.atan2(mid[1].y - mid[0].y, mid[1].x - mid[0].x)
    const knob = { x: c.x + Math.cos(dir) * 64, y: c.y + Math.sin(dir) * 64 }
    const slide = { x: c.x - Math.cos(dir) * 40, y: c.y - Math.sin(dir) * 40 }
    body = (
      <>
        <svg className="grad-lines" width={rect.w} height={rect.h}>
          <line className="gl faint" x1={a[0].x} y1={a[0].y} x2={a[1].x} y2={a[1].y} />
          <line className="gl solid" x1={mid[0].x} y1={mid[0].y} x2={mid[1].x} y2={mid[1].y} />
          <line className="gl faint" x1={b[0].x} y1={b[0].y} x2={b[1].x} y2={b[1].y} />
          <line className="gl axis" x1={s.x} y1={s.y} x2={en.x} y2={en.y} />
        </svg>
        <span
          className="grad-handle"
          style={{ left: s.x, top: s.y }}
          title="No effect past here (this side)"
          onPointerDown={(e) => begin(e, 'start', shown)}
        />
        <span
          className="grad-handle"
          style={{ left: en.x, top: en.y }}
          title="No effect past here (this side)"
          onPointerDown={(e) => begin(e, 'end', shown)}
        />
        <span
          className="grad-feather"
          style={{ left: slide.x, top: slide.y }}
          title="Slide the full line between the two"
          onPointerDown={(e) => begin(e, 'centre', shown)}
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
          style={{ left: c.x, top: c.y }}
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
    // The feather handle: on the ring, up and to the right (−45° in the ellipse's frame).
    const inner = Math.max(0.01, 1 - shown.softness / 100)
    const t = -Math.PI / 4
    const fx = Math.cos(t) * geo.rx * inner
    const fy = Math.sin(t) * geo.ry * inner
    const feather = toScreen(shown, {
      x: geo.cx + fx * Math.cos(geo.angle) - fy * Math.sin(geo.angle),
      y: geo.cy + fx * Math.sin(geo.angle) + fy * Math.cos(geo.angle)
    })
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
        <span
          className="grad-feather"
          style={{ left: feather.x, top: feather.y }}
          title={`Feather ${Math.round(shown.softness)} · drag in to soften, out to harden`}
          onPointerDown={(e) => begin(e, 'feather', shown)}
        />
        <LiquidGlass
          className="grad-pin"
          radius={10}
          bezel={6}
          strength={1.2}
          frost={0.5}
          magnify
          style={{ left: c.x, top: c.y }}
          title="Move · double-click to fill the frame"
          onPointerDown={(e) => {
            const was = lastPin.current
            const now = performance.now()
            lastPin.current = { id: shown.id, at: now }
            if (e.button === 0 && was?.id === shown.id && now - was.at < DOUBLE_MS) {
              e.stopPropagation()
              lastPin.current = null
              fill(shown)
              return
            }
            begin(e, 'move', shown)
          }}
        >
          <i />
        </LiquidGlass>
      </>
    )
  }

  return (
    <div
      ref={layer}
      className={`tool-layer gradients${drawing ? ' drawing' : ''}${shown || others.length ? ' on-hover' : ''}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onPointerDown={create}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {handlesUp &&
        others.map((c) => {
          const at = pinAt(c)
          return (
            <button
              key={c.id}
              className="grad-other"
              style={{ left: at.x, top: at.y }}
              title={`Select this ${KIND_WORD[c.kind]} gradient`}
              aria-label="Select gradient"
              onPointerDown={(e) => {
                e.stopPropagation()
                setComp(c.id)
              }}
            />
          )
        })}
      {body}
    </div>
  )
})
