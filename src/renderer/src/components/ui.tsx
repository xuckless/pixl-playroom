import { motion } from 'motion/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { DialogBackdrop } from '../fx/DialogBackdrop'
import { LiquidGlass } from './glass/LiquidGlass'
import { Icon, type IconName } from './icons'

/** A panel section that remembers whether it was open. */
export function Section({
  id,
  title,
  children,
  right,
  defaultOpen = true
}: {
  id: string
  title: string
  children: ReactNode
  right?: ReactNode
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
        </span>
        <svg className="caret" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" />
        </svg>
      </header>
      {open && <div className="body">{children}</div>}
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
  /** Double-click the label to return here. */
  def?: number
  format?: (v: number) => string
  /** Called on every movement (`live` true) and on a typed value (`live` false). */
  onChange: (v: number, live: boolean) => void
  /** Called once when a movement ends. */
  onCommit: () => void
  /** A CSS background for the track (colour sliders). */
  track?: string
  disabled?: boolean
  title?: string
}

/** Where `v` sits along `min…max`, as a percentage. */
const pct = (v: number, min: number, max: number): number =>
  max > min ? ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * 100 : 0

/**
 * A slider that renders live while dragging and records history when
 * released. The label and the value sit above a hairline rail; the purple
 * fill runs from the slider's resting value to the current one, so a
 * bipolar slider fills out from its centre. The value is an input: type a
 * number and press Enter (Escape cancels). Double-click the label or the
 * rail to reset.
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
  title
}: SliderProps): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef(false)
  const end = (): void => {
    if (drag.current) {
      drag.current = false
      setDragging(false)
      onCommit()
    }
  }
  useEffect(() => {
    const up = (): void => end()
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  })
  const reset = (): void => {
    onChange(def, false)
    onCommit()
  }
  const commitText = (): void => {
    if (text === null) return
    // Units shown with the value ("5500 K", "3.00°") may be typed along with it.
    const cleaned = text.replace(/[^0-9eE+\-.]/g, '')
    const n = Number(cleaned)
    setText(null)
    if (cleaned !== '' && Number.isFinite(n)) {
      onChange(Math.min(max, Math.max(min, n)), false)
      onCommit()
    }
  }
  const at = pct(value, min, max)
  const rest = pct(def, min, max)
  const lo = Math.min(at, rest)
  const showZero = !track && def > min && def < max
  return (
    <div
      className={`slider${disabled ? ' disabled' : ''}${value !== def ? ' changed' : ''}${dragging ? ' dragging' : ''}`}
      title={title}
    >
      <div className="sl-head">
        <label onDoubleClick={reset} title="Double-click to reset">
          {label}
        </label>
        <input
          className="num"
          aria-label={`${label} value`}
          value={text ?? format(value)}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              setText(null)
              ;(e.target as HTMLInputElement).blur()
            }
            e.stopPropagation()
          }}
        />
      </div>
      <div className="sl-track" onDoubleClick={reset}>
        <div
          className={`sl-rail${track ? ' grad' : ''}`}
          style={track ? { background: track } : undefined}
        />
        {showZero && <div className="sl-zero" style={{ left: `${rest}%` }} />}
        {!track && (
          <div className="sl-fill" style={{ left: `${lo}%`, width: `${Math.abs(at - rest)}%` }} />
        )}
        <input
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onPointerDown={() => {
            drag.current = true
            setDragging(true)
          }}
          onChange={(e) => {
            const v = Number(e.target.value)
            if (!drag.current) {
              // keyboard or a click without a drag
              onChange(v, false)
              onCommit()
            } else onChange(v, true)
          }}
        />
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
  icon
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  icon?: IconName
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
          className={`modal${wide ? ' wide' : ''}`}
          radius={2}
          bezel={18}
          strength={0.7}
          frost={6}
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
