import { useRef, useState } from 'react'
import type { CurvePointSetting, WheelSetting } from '../../../shared/recipe'

/** Monotone cubic (Fritsch–Carlson), the interpolation the engine uses — so the drawn curve is the applied curve. */
function monotone(points: CurvePointSetting[]): (x: number) => number {
  const p = [...points].sort((a, b) => a.x - b.x)
  const n = p.length
  if (n < 2) return (x) => x
  const d: number[] = []
  for (let i = 0; i < n - 1; i++)
    d.push((p[i + 1].y - p[i].y) / Math.max(1e-9, p[i + 1].x - p[i].x))
  const m: number[] = [d[0]]
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2)
  m.push(d[n - 2])
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0
      m[i + 1] = 0
      continue
    }
    const a = m[i] / d[i]
    const b = m[i + 1] / d[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * d[i]
      m[i + 1] = t * b * d[i]
    }
  }
  return (x) => {
    if (x <= p[0].x) return p[0].y
    if (x >= p[n - 1].x) return p[n - 1].y
    let i = 0
    while (i < n - 2 && x > p[i + 1].x) i++
    const h = p[i + 1].x - p[i].x
    const t = (x - p[i].x) / h
    const t2 = t * t
    const t3 = t2 * t
    return (
      (2 * t3 - 3 * t2 + 1) * p[i].y +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * p[i + 1].y +
      (t3 - t2) * h * m[i + 1]
    )
  }
}

/**
 * A point curve: click to add, drag to move, double-click a point (or drag it
 * off the side) to remove it. The first and last points stay at the ends.
 */
export function CurveEditor({
  points,
  colour,
  histogram,
  onChange,
  onCommit
}: {
  points: CurvePointSetting[]
  colour: string
  histogram?: number[]
  onChange: (p: CurvePointSetting[], live: boolean) => void
  onCommit: () => void
}): React.JSX.Element {
  const size = 240
  const ref = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const f = monotone(points)
  const path: string[] = []
  for (let i = 0; i <= 96; i++) {
    const x = i / 96
    const y = Math.min(1, Math.max(0, f(x)))
    path.push(`${(x * size).toFixed(1)},${((1 - y) * size).toFixed(1)}`)
  }
  const at = (e: React.PointerEvent): CurvePointSetting => {
    const r = (ref.current as SVGSVGElement).getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))
    }
  }
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const hmax = histogram ? Math.max(1, ...histogram.slice(1, -1)) : 1
  return (
    <svg
      ref={ref}
      className="curve"
      viewBox={`0 0 ${size} ${size}`}
      onPointerDown={(e) => {
        const p = at(e)
        const hit = sorted.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.04)
        if (hit >= 0) setDrag(hit)
        else {
          const next = [...sorted, p].sort((a, b) => a.x - b.x)
          setDrag(next.indexOf(p))
          onChange(next, true)
        }
        ;(e.target as Element).setPointerCapture?.(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (drag === null) return
        const p = at(e)
        const next = [...sorted]
        const lo = drag === 0 ? 0 : next[drag - 1].x + 0.01
        const hi = drag === next.length - 1 ? 1 : next[drag + 1].x - 0.01
        const x = drag === 0 ? 0 : drag === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, p.x))
        next[drag] = { x, y: p.y }
        onChange(next, true)
      }}
      onPointerUp={() => {
        if (drag !== null) {
          setDrag(null)
          onCommit()
        }
      }}
      onDoubleClick={(e) => {
        const p = at(e as unknown as React.PointerEvent)
        const hit = sorted.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.04)
        if (hit > 0 && hit < sorted.length - 1) {
          onChange(
            sorted.filter((_, i) => i !== hit),
            false
          )
          onCommit()
        }
      }}
    >
      <rect width={size} height={size} fill="#141414" />
      {histogram &&
        histogram.map((c, i) => {
          const hgt = (Math.log1p(c) / Math.log1p(hmax)) * size * 0.9
          return (
            <rect
              key={i}
              x={(i / histogram.length) * size}
              y={size - hgt}
              width={size / histogram.length + 0.5}
              height={hgt}
              fill="#333"
            />
          )
        })}
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} stroke="#2c2c2c">
          <line x1={g * size} x2={g * size} y1={0} y2={size} />
          <line y1={g * size} y2={g * size} x1={0} x2={size} />
        </g>
      ))}
      <line x1={0} y1={size} x2={size} y2={0} stroke="#444" strokeDasharray="3 3" />
      <polyline points={path.join(' ')} fill="none" stroke={colour} strokeWidth={1.8} />
      {sorted.map((p, i) => (
        <circle
          key={i}
          cx={p.x * size}
          cy={(1 - p.y) * size}
          r={4.5}
          fill={drag === i ? colour : '#111'}
          stroke={colour}
          strokeWidth={1.5}
        />
      ))}
    </svg>
  )
}

/** A colour wheel: angle is hue, distance from the centre is saturation. */
export function ColorWheel({
  value,
  label,
  onChange,
  onCommit,
  size = 110
}: {
  value: WheelSetting
  label: string
  onChange: (w: WheelSetting, live: boolean) => void
  onCommit: () => void
  size?: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  const r = size / 2
  const set = (e: React.PointerEvent): void => {
    const b = (ref.current as HTMLDivElement).getBoundingClientRect()
    const dx = e.clientX - b.left - r
    const dy = e.clientY - b.top - r
    const hue = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360
    const sat = Math.min(100, (Math.hypot(dx, dy) / r) * 100)
    onChange({ ...value, hue: Math.round(hue), saturation: Math.round(sat) }, true)
  }
  const a = (value.hue * Math.PI) / 180
  const d = (value.saturation / 100) * r
  return (
    <div className="wheel">
      <div
        className="wheel-label"
        onDoubleClick={() => {
          onChange({ hue: 0, saturation: 0, luminance: 0 }, false)
          onCommit()
        }}
      >
        {label}
      </div>
      <div
        ref={ref}
        className="wheel-disc"
        style={{ width: size, height: size }}
        onPointerDown={(e) => {
          setDrag(true)
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          set(e)
        }}
        onPointerMove={(e) => drag && set(e)}
        onPointerUp={() => {
          if (drag) {
            setDrag(false)
            onCommit()
          }
        }}
        onDoubleClick={() => {
          onChange({ ...value, hue: 0, saturation: 0 }, false)
          onCommit()
        }}
      >
        <div
          className="wheel-dot"
          style={{ left: r + d * Math.cos(a) - 5, top: r - d * Math.sin(a) - 5 }}
        />
      </div>
      <div className="wheel-values">
        H {value.hue}° · S {value.saturation}
      </div>
      <input
        type="range"
        min={-100}
        max={100}
        value={value.luminance}
        title="Luminance"
        onChange={(e) => onChange({ ...value, luminance: Number(e.target.value) }, true)}
        onPointerUp={onCommit}
        onDoubleClick={() => {
          onChange({ ...value, luminance: 0 }, false)
          onCommit()
        }}
      />
    </div>
  )
}
