import { useEffect, useRef, useState, type ReactNode } from 'react'

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
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="title">{title}</span>
        <span className="right" onClick={(e) => e.stopPropagation()}>
          {right}
        </span>
      </header>
      {open && <div className="body">{children}</div>}
    </section>
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

/** A slider that renders live while dragging and records history when released. */
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
  const dragging = useRef(false)
  const end = (): void => {
    if (dragging.current) {
      dragging.current = false
      onCommit()
    }
  }
  useEffect(() => {
    const up = (): void => end()
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  })
  const reset = (): void => {
    onChange(def, false)
    onCommit()
  }
  const commitText = (): void => {
    if (text === null) return
    const n = Number(text)
    setText(null)
    if (Number.isFinite(n)) {
      onChange(Math.min(max, Math.max(min, n)), false)
      onCommit()
    }
  }
  return (
    <div
      className={`slider ${disabled ? 'disabled' : ''} ${value !== def ? 'changed' : ''}`}
      title={title}
    >
      <label onDoubleClick={reset} title="Double-click to reset">
        {label}
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={track ? { background: track } : undefined}
        onPointerDown={() => (dragging.current = true)}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (!dragging.current) {
            // keyboard or a click without a drag
            onChange(v, false)
            onCommit()
          } else onChange(v, true)
        }}
        onDoubleClick={reset}
      />
      <input
        className="num"
        value={text ?? format(value)}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setText(null)
          e.stopPropagation()
        }}
      />
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
  wide
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}): React.JSX.Element {
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button className="icon" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
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
