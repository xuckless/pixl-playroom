import { motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DialogBackdrop } from '../fx/DialogBackdrop'
import { touchAdjusting } from '../lib/interacting'
import { dragValue, dragValueLog, keyValue, keyValueLog, logFraction } from '../lib/sliderDrag'
import { LiquidGlass } from './glass/LiquidGlass'
import { Icon, type IconName } from './icons'
import { InfoTip, type Tip } from './InfoTip'

/** A panel section that remembers whether it was open. */
export function Section({
  id,
  title,
  children,
  right,
  tip,
  defaultOpen = true
}: {
  id: string
  title: string
  children: ReactNode
  right?: ReactNode
  /** What the section is for, behind an (i) in its header. */
  tip?: Tip
  defaultOpen?: boolean
}): React.JSX.Element {
  const storageKey = `section:${id}`
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(storageKey)
      return v === null ? defaultOpen : v === '1'
    } catch {
      return defaultOpen
    }
  })
  const toggle = (): void => {
    setOpen((o) => {
      try {
        localStorage.setItem(storageKey, o ? '0' : '1')
      } catch {
        // storage unavailable: the state just isn't remembered
      }
      return !o
    })
  }
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <header onClick={toggle}>
        <span className="title">{title}</span>
        <span className="line" />
        <span className="right" onClick={(e) => e.stopPropagation()}>
          {right}
          {tip && <InfoTip tip={tip} label={title} />}
        </span>
        <svg className="caret" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" />
        </svg>
      </header>
      {open && <div className="body">{children}</div>}
    </section>
  )
}

/** Whether a card is unfolded, remembered per card (as sections are). */
function storedOpen(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`card:${id}`)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

function rememberCardOpen(id: string, open: boolean): void {
  try {
    localStorage.setItem(`card:${id}`, open ? '1' : '0')
  } catch {
    // storage unavailable: the state just isn't remembered
  }
}

/**
 * One group of the adjustments, as a folding card: its title (a dot once
 * anything in it moved), an (i) saying what the group is for, and on hover
 * an eye that turns the whole group off and a reset. A card that is off
 * dims, and can still be edited. Folding is remembered per card; `open` and
 * `onOpenChange` take it over (the stack's solo mode and Jump to).
 */
export function Card({
  id,
  title,
  tip,
  changed = false,
  off = false,
  onToggle,
  onReset,
  right,
  open: openProp,
  onOpenChange,
  defaultOpen = true,
  children
}: {
  id: string
  title: string
  tip?: Tip
  changed?: boolean
  off?: boolean
  /** Turns the card's group off (or back on); no eye without it. */
  onToggle?: () => void
  /** Puts the card's group back to its defaults; no reset without it. */
  onReset?: () => void
  right?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
  children: ReactNode
}): React.JSX.Element {
  const [own, setOwn] = useState(() => storedOpen(id, defaultOpen))
  const open = openProp ?? own
  const toggle = (): void => {
    if (openProp === undefined) {
      rememberCardOpen(id, !open)
      setOwn(!open)
    }
    onOpenChange?.(!open)
  }
  return (
    <section
      className={`card${open ? ' open' : ''}${off ? ' off' : ''}${changed ? ' changed' : ''}`}
      data-card={id}
    >
      <header onClick={toggle}>
        <svg className="caret" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" />
        </svg>
        <span className="title">{title}</span>
        {changed && <span className="card-dot" aria-label="Changed" />}
        <span className="card-acts" onClick={(e) => e.stopPropagation()}>
          {right}
          {tip && <InfoTip tip={tip} label={title} />}
          {onToggle && (
            <button
              type="button"
              className={`icon card-eye${off ? ' on' : ''}`}
              aria-pressed={off}
              aria-label={off ? `Turn ${title} on` : `Turn ${title} off`}
              title={off ? 'Turn on' : 'Turn off'}
              onClick={onToggle}
            >
              <Icon name={off ? 'eyeOff' : 'eye'} />
            </button>
          )}
          {onReset && (
            <button
              type="button"
              className="icon card-reset"
              aria-label={`Reset ${title}`}
              title="Reset"
              disabled={!changed}
              onClick={onReset}
            >
              <Icon name="reset" />
            </button>
          )}
        </span>
      </header>
      {open && <div className="card-body">{children}</div>}
    </section>
  )
}

/**
 * The body of the one tool the right column shows. Its name and glyph are on
 * the dial above; `actions` (tabs, a mode switch) sit on a row of their own.
 */
export function ToolPanel({
  actions,
  children
}: {
  actions?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="tool-panel">
      {actions && <div className="tool-actions">{actions}</div>}
      {children}
    </div>
  )
}

export interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  /** Double-click the slider to return here. */
  def?: number
  format?: (v: number) => string
  /** Called on every movement (`live` true) and on a typed value or a key (`live` false). */
  onChange: (v: number, live: boolean) => void
  /** Called once when a movement ends. */
  onCommit: () => void
  /** A CSS background for the track (colour sliders). */
  track?: string
  disabled?: boolean
  title?: string
  /** What the slider does, behind an (i) that shows on hover. */
  tip?: Tip
  /** 'log': the bar runs on a log scale (finer at the small end); values stay as they are. */
  scale?: 'linear' | 'log'
  /**
   * Whether moving it changes the picture (the default), so the mask overlay
   * steps aside while it moves; false for a slider that shapes a mask.
   */
  adjusts?: boolean
}

/** Where `v` sits along `min…max`, as a fraction. */
const frac = (v: number, min: number, max: number): number =>
  max > min ? (Math.min(max, Math.max(min, v)) - min) / (max - min) : 0

/** How far the pointer moves before a press becomes a drag, in pixels. */
const DRAG_SLOP = 3

interface Grab {
  id: number
  x: number
  from: number
  last: number
  width: number
  fine: boolean
  moved: boolean
  onValue: boolean
}

/**
 * A slider as one glass bar: the label and the value inside it, a frosted
 * knob riding over a fill that runs from the resting value to the current
 * one (so a bipolar slider fills out from its centre). A drag moves the
 * value by how far the pointer goes, never to where it was pressed (Alt
 * moves it a tenth as fast); it renders live and records history on
 * release. A click on the value types one (Enter sets it, Escape cancels).
 * Arrow keys step it (Shift ten steps, Alt a tenth); a double-click or Home
 * resets it.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  def = 0,
  format = (v) => (Number.isInteger(step) ? String(Math.round(v)) : v.toFixed(2)),
  onChange,
  onCommit,
  track,
  disabled,
  title,
  tip,
  scale = 'linear',
  adjusts = true
}: SliderProps): React.JSX.Element {
  const log = scale === 'log'
  const [text, setText] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const grab = useRef<Grab | null>(null)
  // Escape leaves the field: the blur that follows must not set what was typed.
  const cancelled = useRef(false)
  const reset = (): void => {
    onChange(def, false)
    onCommit()
  }
  const commitText = (): void => {
    if (text === null) return
    if (cancelled.current) {
      cancelled.current = false
      setText(null)
      return
    }
    // Units shown with the value ("5500 K", "3.00°") may be typed along with it.
    const cleaned = text.replace(/[^0-9eE+\-.]/g, '')
    const n = Number(cleaned)
    setText(null)
    if (cleaned !== '' && Number.isFinite(n)) {
      onChange(Math.min(max, Math.max(min, n)), false)
      onCommit()
    }
  }
  const release = (el: HTMLElement): void => {
    const g = grab.current
    if (!g) return
    grab.current = null
    setDragging(false)
    if (el.hasPointerCapture(g.id)) el.releasePointerCapture(g.id)
    if (g.moved) onCommit()
    else if (g.onValue) setText(format(value))
  }
  const place = (v: number): number => (log ? logFraction(v, min, max) : frac(v, min, max))
  const at = place(value)
  const rest = place(def)
  const showZero = !track && def > min && def < max
  return (
    <div
      className={`slider${disabled ? ' disabled' : ''}${value !== def ? ' changed' : ''}${dragging ? ' dragging' : ''}${track ? ' graded' : ''}`}
      title={title}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={format(value)}
      aria-disabled={disabled || undefined}
      style={
        {
          '--at': at,
          '--rest': rest,
          '--lo': Math.min(at, rest),
          '--span': Math.abs(at - rest)
        } as React.CSSProperties
      }
      onPointerDown={(e) => {
        if (disabled || e.button !== 0 || text !== null) return
        // The pointer is captured once a drag starts, not on the press: a
        // captured press loses its click, and so the double-click that resets.
        grab.current = {
          id: e.pointerId,
          x: e.clientX,
          from: value,
          last: value,
          width: e.currentTarget.getBoundingClientRect().width,
          fine: e.altKey,
          moved: false,
          onValue: !!(e.target as Element).closest('.num')
        }
      }}
      onPointerMove={(e) => {
        const g = grab.current
        if (!g || g.id !== e.pointerId) return
        if (!g.moved) {
          if (Math.abs(e.clientX - g.x) < DRAG_SLOP) return
          g.moved = true
          g.x = e.clientX
          e.currentTarget.setPointerCapture(e.pointerId)
          setDragging(true)
        }
        // Alt pressed or let go mid-drag: carry on from here, at the new speed.
        if (e.altKey !== g.fine) {
          g.fine = e.altKey
          g.x = e.clientX
          g.from = g.last
        }
        const v = (log ? dragValueLog : dragValue)(
          g.from,
          e.clientX - g.x,
          g.width,
          min,
          max,
          step,
          g.fine
        )
        if (v === g.last) return
        g.last = v
        if (adjusts) touchAdjusting()
        onChange(v, true)
      }}
      onPointerUp={(e) => release(e.currentTarget)}
      onPointerCancel={(e) => release(e.currentTarget)}
      onDoubleClick={(e) => {
        if (disabled || (e.target as Element).closest('.num, .info-tip')) return
        reset()
      }}
      onKeyDown={(e) => {
        if (disabled || e.target !== e.currentTarget || e.metaKey || e.ctrlKey) return
        const mod = e.shiftKey ? 'coarse' : e.altKey ? 'fine' : 'none'
        const dir =
          e.key === 'ArrowRight' || e.key === 'ArrowUp'
            ? 1
            : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
              ? -1
              : 0
        if (dir !== 0) {
          onChange((log ? keyValueLog : keyValue)(value, dir, min, max, step, mod), false)
          onCommit()
        } else if (e.key === 'Home') reset()
        else if (e.key === 'Enter') setText(format(value))
        else if (e.key !== 'Backspace' && e.key !== 'Delete') return
        // A focused slider owns these keys (Backspace must not delete a mask).
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div
        className={`sl-rail${track ? ' grad' : ''}`}
        style={track ? { background: track } : undefined}
      />
      {showZero && <div className="sl-zero" />}
      {!track && <div className="sl-fill" />}
      <div className="sl-knob" />
      <div className="sl-text">
        <span className="sl-label">{label}</span>
        {tip && <InfoTip tip={tip} label={label} />}
        {text === null ? (
          <span className="num">{format(value)}</span>
        ) : (
          <input
            className="num"
            aria-label={`${label} value`}
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitText}
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                cancelled.current = true
                ;(e.target as HTMLInputElement).closest<HTMLElement>('.slider')?.focus()
              }
              e.stopPropagation()
            }}
          />
        )}
      </div>
    </div>
  )
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  title
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label?: string
  title?: string
}): React.JSX.Element {
  return (
    <label className="select" title={title}>
      {label && <span>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export function Toggle({
  on,
  onChange,
  children,
  title
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  title?: string
}): React.JSX.Element {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} title={title}>
      {children}
    </button>
  )
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange
}: {
  value: T
  tabs: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.value}
          className={t.value === value ? 'on' : ''}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  icon,
  className
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  icon?: IconName
  className?: string
}): React.JSX.Element {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <motion.div
      className="modal-backdrop"
      onMouseDown={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
    >
      <DialogBackdrop />
      <motion.div
        className="modal-wrap"
        initial={{ opacity: 0, y: 22, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.97, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 360, damping: 30, mass: 0.9 }}
      >
        <LiquidGlass
          className={`modal${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
          radius={2}
          bezel={18}
          strength={0.7}
          frost={6}
          // Frosted, not refracting: a dialog's glass is large, and a refraction
          // filter that size costs every frame it animates or scrolls.
          flat
          role="dialog"
          aria-label={title}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <header>
            <h2>
              {icon && (
                <span className="dlg-glyph">
                  <Icon name={icon} />
                </span>
              )}
              {title}
            </h2>
            <button className="icon" onClick={onClose} aria-label="Close" title="Close (Esc)">
              <Icon name="close" />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer>{footer}</footer>}
        </LiquidGlass>
      </motion.div>
    </motion.div>
  )
}

export function Stars({
  value,
  onChange
}: {
  value: number
  onChange?: (v: number) => void
}): React.JSX.Element {
  return (
    <span className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={n <= value ? 'on' : ''}
          onClick={(e) => {
            e.stopPropagation()
            onChange?.(n === value ? 0 : n)
          }}
        >
          ★
        </span>
      ))}
    </span>
  )
}
