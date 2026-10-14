/**
 * A DaVinci Resolve colour wheel: the disc moves the colour balance (R, G, B
 * against one another, luma held), the ring under it the master (Y), and the
 * YRGB numbers below can be typed (Enter sets them) or scrubbed by dragging
 * their letter. Double-click the name to put the wheel back.
 *
 * Its disc is painted from `discToRgb` itself, so where it is pushed is the
 * colour the picture moves toward, as the vectorscope draws it.
 */
import { useMemo, useRef, useState } from 'react'
import { discToRgb, rgbToDisc, type Yrgb } from '../../../../shared/resolve'
import { t } from '../../lib/i18n'

export interface WheelScale {
  /** The untouched value of every channel (0 for Lift, Gamma, Offset; 1 for Gain). */
  neutral: number
  /** The colour change at the disc's edge. */
  reach: number
  /** The master's change per pixel of a drag along the ring. */
  ringStep: number
  min: number
  max: number
  /** The number shown for a value (Offset's 25 + 100·o), and back. */
  show?: (v: number) => number
  read?: (n: number) => number
}

const disc = new Map<number, string>()

/** The disc's colours, once per size: mid grey moved by each point's balance. */
function discImage(size: number): string {
  const hit = disc.get(size)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) return ''
  const img = ctx.createImageData(size, size)
  const r = size / 2
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - r) / r
      const y = (r - j - 0.5) / r
      const d = Math.hypot(x, y)
      if (d > 1) continue
      const k = discToRgb(x * 0.45, y * 0.45)
      const o = (j * size + i) * 4
      img.data[o] = Math.max(0, Math.min(255, (0.42 + k.r) * 255))
      img.data[o + 1] = Math.max(0, Math.min(255, (0.42 + k.g) * 255))
      img.data[o + 2] = Math.max(0, Math.min(255, (0.42 + k.b) * 255))
      // Soft toward the edge, as Resolve's.
      img.data[o + 3] = Math.round(255 * Math.min(1, (1 - d) * 18))
    }
  ctx.putImageData(img, 0, 0)
  const url = c.toDataURL()
  disc.set(size, url)
  return url
}

const CH = ['y', 'r', 'g', 'b'] as const

function NumberField({
  ch,
  value,
  scale,
  onSet,
  onScrub,
  onCommit
}: {
  ch: (typeof CH)[number]
  value: number
  scale: WheelScale
  onSet: (v: number) => void
  onScrub: (v: number) => void
  onCommit: () => void
}): React.JSX.Element {
  const show = scale.show ?? ((v: number) => v)
  const read = scale.read ?? ((n: number) => n)
  const [text, setText] = useState<string | null>(null)
  const grab = useRef<{ x: number; v: number } | null>(null)
  const clamp = (v: number): number => Math.min(scale.max, Math.max(scale.min, v))
  const commitText = (): void => {
    if (text === null) return
    const n = Number(text.replace(',', '.'))
    setText(null)
    if (!Number.isFinite(n)) return
    onSet(clamp(read(n)))
    onCommit()
  }
  return (
    <label className={`gw-field gw-${ch}`}>
      <span
        className="gw-ch"
        title={t('Drag to change')}
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          grab.current = { x: e.clientX, v: value }
        }}
        onPointerMove={(e) => {
          const g = grab.current
          if (!g) return
          const step = scale.ringStep * (e.shiftKey ? 0.2 : 1)
          onScrub(clamp(g.v + (e.clientX - g.x) * step))
        }}
        onPointerUp={() => {
          if (grab.current) onCommit()
          grab.current = null
        }}
      >
        {ch.toUpperCase()}
      </span>
      <input
        inputMode="decimal"
        value={text ?? show(value).toFixed(2)}
        onFocus={(e) => {
          setText(show(value).toFixed(2))
          e.target.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(null)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
    </label>
  )
}

export function GradeWheel({
  label,
  value,
  scale,
  onChange,
  onCommit,
  size = 104
}: {
  label: string
  value: Yrgb
  scale: WheelScale
  onChange: (v: Yrgb, live: boolean) => void
  onCommit: () => void
  size?: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<'disc' | 'ring' | null>(null)
  const ring = useRef<{ x: number; y: number } | null>(null)
  const bg = useMemo(() => discImage(size), [size])
  const n = scale.neutral
  const r = size / 2
  const at = rgbToDisc(value.r - n, value.g - n, value.b - n)
  const px = Math.max(-1, Math.min(1, at.x / scale.reach))
  const py = Math.max(-1, Math.min(1, at.y / scale.reach))
  const len = Math.hypot(px, py)
  const dot = len > 1 ? { x: px / len, y: py / len } : { x: px, y: py }

  const setDisc = (e: React.PointerEvent): void => {
    const b = (ref.current as HTMLDivElement).getBoundingClientRect()
    let x = (e.clientX - b.left - r) / r
    let y = (r - (e.clientY - b.top)) / r
    const d = Math.hypot(x, y)
    if (d > 1) {
      x /= d
      y /= d
    }
    // Fine control near the middle, where most corrections live.
    const k = e.shiftKey ? 0.25 : 1
    const c = discToRgb(x * scale.reach * k, y * scale.reach * k)
    onChange({ ...value, r: n + c.r, g: n + c.g, b: n + c.b }, true)
  }
  const reset = (): void => {
    onChange({ y: n, r: n, g: n, b: n }, false)
    onCommit()
  }
  const ringPos = Math.max(0, Math.min(1, (value.y - scale.min) / (scale.max - scale.min)))
  return (
    <div className="gwheel">
      <div className="gw-label" title={t('Double-click to reset')} onDoubleClick={reset}>
        {label}
      </div>
      <div
        ref={ref}
        className={`gw-disc${drag === 'disc' ? ' dragging' : ''}`}
        style={{ width: size, height: size, backgroundImage: bg ? `url(${bg})` : undefined }}
        onPointerDown={(e) => {
          setDrag('disc')
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          setDisc(e)
        }}
        onPointerMove={(e) => drag === 'disc' && setDisc(e)}
        onPointerUp={() => {
          if (drag === 'disc') onCommit()
          setDrag(null)
        }}
        onDoubleClick={() => {
          onChange({ ...value, r: n, g: n, b: n }, false)
          onCommit()
        }}
      >
        <span className="gw-cross" aria-hidden />
        <span className="gw-dot" style={{ left: r + dot.x * r - 5, top: r - dot.y * r - 5 }} />
      </div>
      <div
        className={`gw-ring${drag === 'ring' ? ' dragging' : ''}`}
        style={{ width: size }}
        title={t('Drag for the master (Y)')}
        onPointerDown={(e) => {
          setDrag('ring')
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          ring.current = { x: e.clientX, y: value.y }
        }}
        onPointerMove={(e) => {
          const g = ring.current
          if (drag !== 'ring' || !g) return
          const step = scale.ringStep * (e.shiftKey ? 0.2 : 1)
          const y = Math.min(scale.max, Math.max(scale.min, g.y + (e.clientX - g.x) * step))
          onChange({ ...value, y }, true)
        }}
        onPointerUp={() => {
          if (drag === 'ring') onCommit()
          setDrag(null)
          ring.current = null
        }}
        onDoubleClick={() => {
          onChange({ ...value, y: n }, false)
          onCommit()
        }}
      >
        <span className="gw-ring-knob" style={{ left: `${ringPos * 100}%` }} />
      </div>
      <div className="gw-fields">
        {CH.map((ch) => (
          <NumberField
            key={ch}
            ch={ch}
            value={value[ch]}
            scale={scale}
            onSet={(v) => onChange({ ...value, [ch]: v }, false)}
            onScrub={(v) => onChange({ ...value, [ch]: v }, true)}
            onCommit={onCommit}
          />
        ))}
      </div>
    </div>
  )
}
