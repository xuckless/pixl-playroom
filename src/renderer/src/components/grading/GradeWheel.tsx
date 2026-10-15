/**
 * A DaVinci Resolve colour wheel: the disc moves the colour balance (R, G, B
 * against one another, luma held), the ring under it the master (Y), and the
 * YRGB numbers below can be typed (Enter sets them, Escape leaves them) or
 * scrubbed by dragging their letter. Double-click the name to put the wheel
 * back.
 *
 * Every part keeps the app's one rule (lib/sliderDrag.ts): Shift moves it
 * finely, Alt-click or a double-click puts that part back, Escape takes a
 * drag back. From the keys: the disc and the ring are sliders (arrows move
 * the puck or the master, Shift finely, Home resets), and Up and Down step a
 * number.
 *
 * Its disc is painted from `discToRgb` itself, so where it is pushed is the
 * colour the picture moves toward, as the vectorscope draws it.
 */
import { useMemo, useRef, useState } from 'react'
import { discToRgb, type Yrgb } from '../../../../shared/resolve'
import { t } from '../../lib/i18n'
import { useEscapeWhile } from '../../lib/escape'
import { FINE, isFine, isReset, keyStep } from '../../lib/sliderDrag'
import {
  atDisc,
  channelText,
  discPoint,
  neutralOf,
  nudgeChannel,
  nudgeDisc,
  typedChannel,
  type WheelScale
} from '../../lib/wheel'
import { InfoTip, type Tip } from '../InfoTip'

export type { WheelScale }

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

/** A drag under way: where it started, so Escape can take it back, and where speed last changed. */
interface Grab {
  id: number
  el: Element
  start: Yrgb
  /** The pointer and the value where the speed last changed (Shift pressed or let go). */
  x: number
  y: number
  from: Yrgb
  fine: boolean
}

function NumberField({
  ch,
  value,
  scale,
  onSet,
  onScrub,
  onCommit,
  onCancel
}: {
  ch: (typeof CH)[number]
  value: number
  scale: WheelScale
  onSet: (v: number) => void
  onScrub: (v: number) => void
  onCommit: () => void
  /** Escape took a scrub back to this. */
  onCancel: (v: number) => void
}): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const grab = useRef<{
    id: number
    el: Element
    x: number
    v: number
    start: number
    fine: boolean
  } | null>(null)
  // Escape leaves the field: the blur that follows must not set what was typed.
  const cancelled = useRef(false)
  const clamp = (v: number): number => Math.min(scale.max, Math.max(scale.min, v))
  const commitText = (): void => {
    if (text === null) return
    if (cancelled.current) {
      cancelled.current = false
      setText(null)
      return
    }
    const v = typedChannel(text, value, scale)
    setText(null)
    if (v === null) return
    onSet(v)
    onCommit()
  }
  const resetChannel = (): void => {
    onSet(scale.neutral)
    onCommit()
  }
  const end = (): void => {
    const g = grab.current
    grab.current = null
    setScrubbing(false)
    if (g?.el.hasPointerCapture(g.id)) g.el.releasePointerCapture(g.id)
  }
  useEscapeWhile(scrubbing, () => {
    const g = grab.current
    end()
    if (g) onCancel(g.start)
  })
  return (
    <label className={`gw-field gw-${ch}`}>
      <span
        className="gw-ch"
        title={t('Drag to change')}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (isReset(e)) return resetChannel()
          e.currentTarget.setPointerCapture(e.pointerId)
          grab.current = {
            id: e.pointerId,
            el: e.currentTarget,
            x: e.clientX,
            v: value,
            start: value,
            fine: isFine(e)
          }
          setScrubbing(true)
        }}
        onPointerMove={(e) => {
          const g = grab.current
          if (!g || g.id !== e.pointerId) return
          // Shift pressed or let go: carry on from here, at the new speed.
          if (isFine(e) !== g.fine) {
            g.fine = isFine(e)
            g.x = e.clientX
            g.v = value
          }
          const step = scale.ringStep * (g.fine ? FINE : 1)
          onScrub(clamp(g.v + (e.clientX - g.x) * step))
        }}
        onPointerUp={() => {
          if (grab.current) onCommit()
          end()
        }}
        onPointerCancel={() => {
          if (grab.current) onCommit()
          end()
        }}
        onDoubleClick={resetChannel}
      >
        {ch.toUpperCase()}
      </span>
      <input
        inputMode="decimal"
        value={text ?? channelText(value, scale)}
        onFocus={(e) => {
          setText(channelText(value, scale))
          e.target.select()
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          e.stopPropagation()
          const k =
            e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key.startsWith('Page')
              ? keyStep(e)
              : null
          if (k) {
            e.preventDefault()
            const next = nudgeChannel(value, scale, k.dir, k.mod)
            onSet(next)
            onCommit()
            setText(channelText(next, scale))
            return
          }
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            cancelled.current = true
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
  size = 104,
  tip
}: {
  label: string
  /** What the wheel does, behind an (i) beside its name. */
  tip?: Tip
  value: Yrgb
  scale: WheelScale
  onChange: (v: Yrgb, live: boolean) => void
  onCommit: () => void
  size?: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<'disc' | 'ring' | null>(null)
  const grab = useRef<Grab | null>(null)
  const bg = useMemo(() => discImage(size), [size])
  const n = scale.neutral
  const r = size / 2
  const dot = discPoint(value, scale)

  /** The pointer's place on the disc, −1…1 each way. */
  const pointer = (e: React.PointerEvent): { x: number; y: number } => {
    const b = (ref.current as HTMLDivElement).getBoundingClientRect()
    return { x: (e.clientX - b.left - r) / r, y: (r - (e.clientY - b.top)) / r }
  }
  const set = (v: Yrgb, live: boolean): void => {
    onChange(v, live)
    if (!live) onCommit()
  }
  const reset = (): void => set(neutralOf(scale), false)
  const resetDisc = (): void => set({ ...value, r: n, g: n, b: n }, false)
  const resetRing = (): void => set({ ...value, y: n }, false)

  const start = (e: React.PointerEvent, part: 'disc' | 'ring', from: Yrgb): void => {
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
    setDrag(part)
  }
  const end = (commit: boolean): void => {
    const g = grab.current
    grab.current = null
    setDrag(null)
    if (g?.el.hasPointerCapture(g.id)) g.el.releasePointerCapture(g.id)
    if (g && commit) onCommit()
  }
  // Escape mid-drag: back where the press found it, and nothing recorded.
  useEscapeWhile(drag !== null, () => {
    const g = grab.current
    end(false)
    if (g) onChange(g.start, false)
  })
  /** Shift pressed or let go mid-drag: carry on from here, at the new speed. */
  const respeed = (g: Grab, e: React.PointerEvent): void => {
    if (isFine(e) === g.fine) return
    g.fine = isFine(e)
    g.x = e.clientX
    g.y = e.clientY
    g.from = value
  }

  const ringPos = Math.max(0, Math.min(1, (value.y - scale.min) / (scale.max - scale.min)))
  const shown = scale.show ?? ((v: number) => v)
  const balance = CH.slice(1)
    .map((ch) => `${ch.toUpperCase()} ${shown(value[ch]).toFixed(2)}`)
    .join(', ')
  return (
    <div className="gwheel">
      <div className="gw-head">
        <span className="gw-label" title={t('Double-click to reset')} onDoubleClick={reset}>
          {label}
        </span>
        {tip && <InfoTip tip={tip} label={label} />}
      </div>
      <div
        ref={ref}
        className={`gw-disc${drag === 'disc' ? ' dragging' : ''}`}
        style={{ width: size, height: size, backgroundImage: bg ? `url(${bg})` : undefined }}
        role="slider"
        tabIndex={0}
        aria-roledescription={t('colour wheel')}
        aria-label={t('{{name}} balance', { name: label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.hypot(dot.x, dot.y) * 100)}
        aria-valuetext={balance}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (isReset(e)) return resetDisc()
          // A press puts the puck where it lands; with Shift it stays, to be nudged finely.
          const p = pointer(e)
          const from = isFine(e) ? value : atDisc(value, scale, p.x, p.y)
          start(e, 'disc', from)
          if (from !== value) onChange(from, true)
        }}
        onPointerMove={(e) => {
          const g = grab.current
          if (drag !== 'disc' || !g || g.id !== e.pointerId) return
          respeed(g, e)
          const k = (g.fine ? FINE : 1) / r
          const p = discPoint(g.from, scale)
          onChange(
            atDisc(value, scale, p.x + (e.clientX - g.x) * k, p.y - (e.clientY - g.y) * k),
            true
          )
        }}
        onPointerUp={() => drag === 'disc' && end(true)}
        onPointerCancel={() => drag === 'disc' && end(true)}
        onDoubleClick={resetDisc}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return
          const k = keyStep(e)
          if (k && !e.key.startsWith('Page')) {
            const axis = e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 'x' : 'y'
            set(nudgeDisc(value, scale, axis, k.dir, k.mod), false)
          } else if (e.key === 'Home') resetDisc()
          else return
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        <span className="gw-cross" aria-hidden />
        <span className="gw-dot" style={{ left: r + dot.x * r - 5, top: r - dot.y * r - 5 }} />
      </div>
      <div
        className={`gw-ring${drag === 'ring' ? ' dragging' : ''}`}
        style={{ width: size }}
        title={t('Drag for the master (Y)')}
        role="slider"
        tabIndex={0}
        aria-label={t('{{name}} master', { name: label })}
        aria-valuemin={shown(scale.min)}
        aria-valuemax={shown(scale.max)}
        aria-valuenow={shown(value.y)}
        aria-valuetext={shown(value.y).toFixed(2)}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          if (isReset(e)) return resetRing()
          start(e, 'ring', value)
        }}
        onPointerMove={(e) => {
          const g = grab.current
          if (drag !== 'ring' || !g || g.id !== e.pointerId) return
          respeed(g, e)
          const step = scale.ringStep * (g.fine ? FINE : 1)
          const y = Math.min(scale.max, Math.max(scale.min, g.from.y + (e.clientX - g.x) * step))
          onChange({ ...value, y }, true)
        }}
        onPointerUp={() => drag === 'ring' && end(true)}
        onPointerCancel={() => drag === 'ring' && end(true)}
        onDoubleClick={resetRing}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey || e.altKey) return
          const k = keyStep(e)
          if (k) set({ ...value, y: nudgeChannel(value.y, scale, k.dir, k.mod) }, false)
          else if (e.key === 'Home') resetRing()
          else return
          e.preventDefault()
          e.stopPropagation()
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
            onCancel={(v) => onChange({ ...value, [ch]: v }, false)}
          />
        ))}
      </div>
    </div>
  )
}
