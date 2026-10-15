import { useRef, useState } from 'react'
import { monotone } from '../../../shared/curves'
import { vsPoints } from '../../../shared/resolve'
import type { CurvePointSetting, WheelSetting } from '../../../shared/recipe'
import { addPoint, isEnd, nudgePoint, placePoint, resetPoint } from '../lib/curveEdit'
import { useEscapeWhile } from '../lib/escape'
import { FINE, isFine, isReset, keyStep } from '../lib/sliderDrag'
import { t } from '../lib/i18n'
import { Slider } from './ui'

/** A drag under way: the points before it (Escape goes back to them) and where speed last changed. */
interface PointGrab {
  id: number
  el: Element
  i: number
  start: CurvePointSetting[]
  x: number
  y: number
  from: CurvePointSetting
  fine: boolean
}

/**
 * A point curve: click to add, drag to move, double-click or Alt-click a
 * point (or drag it off the side) to put it back: an inner point goes, an
 * end returns to its corner. The first and last points stay at the ends.
 * Shift drags finely; Escape takes a drag back.
 *
 * From the keys, each point is a stop of its own: arrows move it (Shift
 * finely, Page Up and Page Down further), Delete or Home puts it back, and
 * Enter (on a point or the curve) adds one in the widest gap, on the line.
 *
 * `vs`: one of Resolve's vs curves instead: flat at the middle untouched, a
 * click puts a point on the line where it is (drag it to bend), every point
 * moves and goes, and a hue curve (`periodic`) wraps across red. A
 * `background` (a CSS gradient) runs under it: the hues, or a ramp.
 * `colour` is a CSS colour, a token's var() as often as not.
 */
export function CurveEditor({
  points,
  colour,
  histogram,
  onChange,
  onCommit,
  vs = false,
  periodic = false,
  background,
  label
}: {
  points: CurvePointSetting[]
  colour: string
  histogram?: number[]
  onChange: (p: CurvePointSetting[], live: boolean) => void
  onCommit: () => void
  vs?: boolean
  periodic?: boolean
  background?: string
  /** The curve's name, for a screen reader. */
  label?: string
}): React.JSX.Element {
  const size = 240
  const ref = useRef<SVGSVGElement>(null)
  const grab = useRef<PointGrab | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  // The point a key moves: the one last pressed or tabbed to.
  const [focus, setFocus] = useState<number | null>(null)
  const f = monotone(vs ? vsPoints(points, periodic) : points)
  const path: string[] = []
  for (let i = 0; i <= 96; i++) {
    const x = i / 96
    const y = Math.min(1, Math.max(0, f(x)))
    path.push(`${(x * size).toFixed(1)},${((1 - y) * size).toFixed(1)}`)
  }
  const at = (e: { clientX: number; clientY: number }): CurvePointSetting => {
    const r = (ref.current as SVGSVGElement).getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    }
  }
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const hmax = histogram ? Math.max(1, ...histogram.slice(1, -1)) : 1
  const hitOf = (p: CurvePointSetting): number =>
    sorted.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.04)
  const settle = (next: CurvePointSetting[]): void => {
    onChange(next, false)
    onCommit()
  }
  const putBack = (i: number): void => {
    const next = resetPoint(sorted, i, vs)
    settle(next)
    setFocus(next.length === sorted.length ? i : null)
  }
  const end = (commit: boolean): void => {
    const g = grab.current
    grab.current = null
    setDrag(null)
    if (g?.el.hasPointerCapture(g.id)) g.el.releasePointerCapture(g.id)
    if (g && commit) onCommit()
  }
  // Escape mid-drag: the points as they were, nothing recorded.
  useEscapeWhile(drag !== null, () => {
    const g = grab.current
    end(false)
    if (g) onChange(g.start, false)
  })
  const focusPoint = (i: number): void => {
    setFocus(i)
    // After React draws the point (an added one is new).
    requestAnimationFrame(() =>
      ref.current?.querySelectorAll<SVGCircleElement>('circle.pt')[i]?.focus()
    )
  }
  const add = (): void => {
    const { points: next, index } = addPoint(sorted, (x) => f(x))
    settle(next)
    focusPoint(index)
  }
  const name = label ?? t('Curve')
  const pct = (v: number): string => `${Math.round(v * 100)}%`
  return (
    <svg
      ref={ref}
      className="curve"
      viewBox={`0 0 ${size} ${size}`}
      role="group"
      tabIndex={sorted.length === 0 ? 0 : -1}
      aria-label={t('{{name}}: Enter adds a point', { name })}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' || e.metaKey || e.ctrlKey) return
        e.preventDefault()
        e.stopPropagation()
        add()
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        const p = at(e)
        const hit = hitOf(p)
        if (hit >= 0 && isReset(e)) return putBack(hit)
        let start = sorted
        let i = hit
        if (hit < 0) {
          if (isReset(e)) return
          // A vs curve's new point lands on the line, so the click alone bends nothing.
          if (vs) p.y = Math.min(1, Math.max(0, f(p.x)))
          start = [...sorted, p].sort((a, b) => a.x - b.x)
          i = start.indexOf(p)
          onChange(start, true)
        }
        e.currentTarget.setPointerCapture(e.pointerId)
        grab.current = {
          id: e.pointerId,
          el: e.currentTarget,
          i,
          start: sorted,
          x: e.clientX,
          y: e.clientY,
          from: start[i],
          fine: isFine(e)
        }
        setDrag(i)
        setFocus(i)
      }}
      onPointerMove={(e) => {
        const g = grab.current
        if (!g || g.id !== e.pointerId) return
        const r = (ref.current as SVGSVGElement).getBoundingClientRect()
        // Shift pressed or let go: carry on from here, at the new speed.
        if (isFine(e) !== g.fine) {
          g.fine = isFine(e)
          g.x = e.clientX
          g.y = e.clientY
          g.from = sorted[g.i]
        }
        const k = g.fine ? FINE : 1
        const x = g.from.x + ((e.clientX - g.x) / r.width) * k
        const y = g.from.y - ((e.clientY - g.y) / r.height) * k
        onChange(placePoint(sorted, g.i, x, y, vs), true)
      }}
      onPointerUp={() => drag !== null && end(true)}
      onPointerCancel={() => drag !== null && end(true)}
      onDoubleClick={(e) => {
        const hit = hitOf(at(e))
        if (hit >= 0) putBack(hit)
      }}
    >
      {histogram &&
        histogram.map((c, i) => {
          const hgt = (Math.log1p(c) / Math.log1p(hmax)) * size * 0.9
          return (
            <rect
              key={i}
              className="curve-hist"
              x={(i / histogram.length) * size}
              y={size - hgt}
              width={size / histogram.length + 0.5}
              height={hgt}
            />
          )
        })}
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} className="curve-grid">
          <line x1={g * size} x2={g * size} y1={0} y2={size} />
          <line y1={g * size} y2={g * size} x1={0} x2={size} />
        </g>
      ))}
      {background && (
        <foreignObject x={0} y={size - 10} width={size} height={10}>
          <div className="curve-strip" style={{ background }} />
        </foreignObject>
      )}
      <line
        className="curve-rest"
        x1={0}
        y1={vs ? size / 2 : size}
        x2={size}
        y2={vs ? size / 2 : 0}
        strokeDasharray="3 3"
      />
      <polyline points={path.join(' ')} fill="none" style={{ stroke: colour }} strokeWidth={1.8} />
      {sorted.map((p, i) => (
        <circle
          key={i}
          className={`pt${focus === i ? ' focused' : ''}`}
          cx={p.x * size}
          cy={(1 - p.y) * size}
          r={4.5}
          style={{ stroke: colour, fill: drag === i ? colour : undefined }}
          strokeWidth={1.5}
          tabIndex={0}
          role="slider"
          aria-roledescription={t('curve point')}
          aria-label={t('Point {{n}} of {{count}}', { n: i + 1, count: sorted.length })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(p.y * 100)}
          aria-valuetext={t('In {{x}}, out {{y}}', { x: pct(p.x), y: pct(p.y) })}
          onFocus={() => setFocus(i)}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return
            const k = keyStep(e)
            if (k) {
              const axis =
                e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 'x' : ('y' as 'x' | 'y')
              if (axis === 'x' && isEnd(sorted, i, vs)) return
              settle(nudgePoint(sorted, i, axis, k.dir, k.mod, vs))
            } else if (e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Home') {
              putBack(i)
              if (!isEnd(sorted, i, vs)) {
                if (sorted.length > 1) focusPoint(Math.max(0, i - 1))
                else ref.current?.focus()
              }
            } else if (e.key === 'Enter') add()
            else return
            e.preventDefault()
            e.stopPropagation()
          }}
        />
      ))}
    </svg>
  )
}

/**
 * A colour wheel: angle is hue, distance from the centre is saturation, and
 * a luminance slider under it. The app's one rule: Shift drags finely,
 * Alt-click or a double-click puts the disc back (a double-click on the name
 * the whole wheel), Escape takes a drag back; arrows turn the hue (←→) and
 * move the saturation (↑↓), Home resets.
 */
export function ColorWheel({
  value,
  label,
  onChange,
  onCommit,
  size = 110,
  luminance = true
}: {
  value: WheelSetting
  label: string
  onChange: (w: WheelSetting, live: boolean) => void
  onCommit: () => void
  size?: number
  /** Show the luminance slider under the disc (a grading wheel's third control). */
  luminance?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const grab = useRef<{
    id: number
    el: Element
    start: WheelSetting
    x: number
    y: number
    from: { dx: number; dy: number }
    fine: boolean
  } | null>(null)
  const [drag, setDrag] = useState(false)
  const r = size / 2
  const a = (value.hue * Math.PI) / 180
  const d = (value.saturation / 100) * r
  /** The value at an offset from the centre, in pixels. */
  const atOffset = (dx: number, dy: number): WheelSetting => ({
    ...value,
    hue: Math.round(((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360),
    saturation: Math.round(Math.min(100, (Math.hypot(dx, dy) / r) * 100))
  })
  const settle = (w: WheelSetting): void => {
    onChange(w, false)
    onCommit()
  }
  const resetDisc = (): void => settle({ ...value, hue: 0, saturation: 0 })
  const end = (commit: boolean): void => {
    const g = grab.current
    grab.current = null
    setDrag(false)
    if (g?.el.hasPointerCapture(g.id)) g.el.releasePointerCapture(g.id)
    if (g && commit) onCommit()
  }
  useEscapeWhile(drag, () => {
    const g = grab.current
    end(false)
    if (g) onChange(g.start, false)
  })
  return (
    <div className="wheel">
      <div
        className="wheel-label"
        title={t('Double-click to reset')}
        onDoubleClick={() => settle({ hue: 0, saturation: 0, luminance: 0 })}
      >
        {label}
      </div>
      <div
        ref={ref}
        className="wheel-disc"
        style={{ width: size, height: size }}
        role="slider"
        tabIndex={0}
        aria-roledescription={t('colour wheel')}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value.saturation}
        aria-valuetext={t('Hue {{hue}}°, saturation {{sat}}', {
          hue: value.hue,
          sat: value.saturation
        })}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (isReset(e)) return resetDisc()
          const b = e.currentTarget.getBoundingClientRect()
          // A press puts the dot where it lands; with Shift it stays, to be nudged finely.
          const from = isFine(e)
            ? { dx: d * Math.cos(a), dy: -d * Math.sin(a) }
            : { dx: e.clientX - b.left - r, dy: e.clientY - b.top - r }
          e.currentTarget.setPointerCapture(e.pointerId)
          grab.current = {
            id: e.pointerId,
            el: e.currentTarget,
            start: value,
            x: e.clientX,
            y: e.clientY,
            from,
            fine: isFine(e)
          }
          setDrag(true)
          if (!isFine(e)) onChange(atOffset(from.dx, from.dy), true)
        }}
        onPointerMove={(e) => {
          const g = grab.current
          if (!g || g.id !== e.pointerId) return
          if (isFine(e) !== g.fine) {
            g.fine = isFine(e)
            g.x = e.clientX
            g.y = e.clientY
            g.from = { dx: d * Math.cos(a), dy: -d * Math.sin(a) }
          }
          const k = g.fine ? FINE : 1
          onChange(
            atOffset(g.from.dx + (e.clientX - g.x) * k, g.from.dy + (e.clientY - g.y) * k),
            true
          )
        }}
        onPointerUp={() => drag && end(true)}
        onPointerCancel={() => drag && end(true)}
        onDoubleClick={resetDisc}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return
          const k = keyStep(e)
          const by = k ? k.dir * (k.mod === 'fine' ? 0.1 : k.mod === 'coarse' ? 10 : 1) : 0
          if (k && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))
            settle({
              ...value,
              hue: Math.round(((((value.hue + by) % 360) + 360) % 360) * 10) / 10
            })
          else if (k)
            settle({
              ...value,
              saturation: Math.round(Math.min(100, Math.max(0, value.saturation + by)) * 10) / 10
            })
          else if (e.key === 'Home') resetDisc()
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <div
          className="wheel-dot"
          style={{ left: r + d * Math.cos(a) - 5, top: r - d * Math.sin(a) - 5 }}
        />
      </div>
      <div className="wheel-values">
        {t('H {{hue}}° · S {{sat}}', { hue: value.hue, sat: value.saturation })}
      </div>
      {luminance && (
        <Slider
          label={t('Luminance')}
          value={value.luminance}
          min={-100}
          max={100}
          onChange={(v, live) => onChange({ ...value, luminance: v }, live)}
          onCommit={onCommit}
        />
      )}
    </div>
  )
}
