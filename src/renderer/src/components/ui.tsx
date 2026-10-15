import { motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { DialogBackdrop } from '../fx/DialogBackdrop'
import { touchAdjusting } from '../lib/interacting'
import {
  dragValue,
  dragValueLog,
  isFine,
  isReset,
  keyStep,
  keyValue,
  keyValueLog,
  logFraction
} from '../lib/sliderDrag'
import { useEscapeWhile } from '../lib/escape'
import { rovingNext } from '../lib/roving'
import { LiquidGlass } from './glass/LiquidGlass'
import { Icon, type IconName } from './icons'
import { GlassSelect, type GlassOption } from './GlassSelect'
import { InfoTip, type Tip } from './InfoTip'
import { t, tp } from '../lib/i18n'

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
  const bodyId = useId()
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      {/* The whole header folds it to the pointer; its button is the stop for keys. */}
      <header onClick={toggle}>
        <button type="button" className="fold-btn" aria-expanded={open} aria-controls={bodyId}>
          <span className="title">{title}</span>
        </button>
        <span className="line" />
        <span className="right" onClick={(e) => e.stopPropagation()}>
          {right}
          {tip && <InfoTip tip={tip} label={title} />}
        </span>
        <Caret />
      </header>
      {open && (
        <div className="body" id={bodyId}>
          {children}
        </div>
      )}
    </section>
  )
}

function Caret(): React.JSX.Element {
  return (
    <svg className="caret" viewBox="0 0 10 10" aria-hidden>
      <path d="M2 3.5 5 6.5 8 3.5" />
    </svg>
  )
}

/**
 * A card's header, shared by the folding cards and the parts of Basic
 * corrections: its title (a button that folds it, when it folds), a dot once
 * anything in it moved, then `right`, an (i), an eye that turns the group
 * off and a reset. The eye's name stays put and aria-pressed says whether
 * the group shows; the eye and reset sit quiet until the header is hovered
 * or focused, never quite hidden.
 */
export function CardHeader({
  title,
  tip,
  changed = false,
  off = false,
  onToggle,
  onReset,
  right,
  fold,
  line = false
}: {
  title: string
  tip?: Tip
  changed?: boolean
  off?: boolean
  onToggle?: () => void
  onReset?: () => void
  right?: ReactNode
  /** A card that folds: whether it is open, what folds it, and the body it shows. */
  fold?: { open: boolean; toggle: () => void; body: string }
  /** A rule after the title (a part's header). */
  line?: boolean
}): React.JSX.Element {
  return (
    <header onClick={fold?.toggle}>
      {fold ? (
        <button
          type="button"
          className="fold-btn"
          aria-expanded={fold.open}
          aria-controls={fold.body}
        >
          <Caret />
          <span className="title">{title}</span>
        </button>
      ) : (
        <span className="title">{title}</span>
      )}
      {changed && <span className="card-dot" role="img" aria-label={t('Changed')} />}
      {line && <span className="line" />}
      <span className="card-acts" onClick={(e) => e.stopPropagation()}>
        {right}
        {tip && <InfoTip tip={tip} label={title} />}
        {onToggle && (
          <button
            type="button"
            className={`icon card-eye${off ? ' on' : ''}`}
            aria-pressed={!off}
            aria-label={t('Show {{name}}', { name: title })}
            title={off ? t('Turn on') : t('Turn off')}
            onClick={onToggle}
          >
            <Icon name={off ? 'eyeOff' : 'eye'} />
          </button>
        )}
        {onReset && (
          <button
            type="button"
            className="icon card-reset"
            aria-label={t('Reset {{name}}', { name: title })}
            title={t('Reset')}
            disabled={!changed}
            onClick={onReset}
          >
            <Icon name="reset" />
          </button>
        )}
      </span>
    </header>
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
 * One group of the adjustments, as a folding card: its header (CardHeader:
 * the title folds it, from the keys too; a dot once anything in it moved; an
 * (i); an eye that turns the whole group off and a reset). A card that is
 * off dims, and can still be edited. Folding is remembered per card; `open`
 * and `onOpenChange` take it over (the stack's solo mode and Jump to).
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
  fixed = false,
  children
}: {
  id: string
  /** Always open, no fold: the one section the column shows. */
  fixed?: boolean
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
  const bodyId = useId()
  const open = fixed || (openProp ?? own)
  const toggle = (): void => {
    if (fixed) return
    if (openProp === undefined) {
      rememberCardOpen(id, !open)
      setOwn(!open)
    }
    onOpenChange?.(!open)
  }
  return (
    <section
      className={`card${open ? ' open' : ''}${fixed ? ' fixed' : ''}${off ? ' off' : ''}${changed ? ' changed' : ''}`}
      data-card={id}
    >
      <CardHeader
        title={title}
        tip={tip}
        changed={changed}
        off={off}
        onToggle={onToggle}
        onReset={onReset}
        right={right}
        fold={fixed ? undefined : { open, toggle, body: bodyId }}
      />
      {open && (
        <div className="card-body" id={bodyId}>
          {children}
        </div>
      )}
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
  /** False: no reset (a choice whose first stop is no default); `def` only anchors the fill. */
  resettable?: boolean
  format?: (v: number) => string
  /** Called on every movement (`live` true) and on a typed value or a key (`live` false). */
  onChange: (v: number, live: boolean) => void
  /** Called once when a movement ends. */
  onCommit: () => void
  /** Called when Escape takes a drag back (the value is already back where it started). */
  onCancel?: () => void
  /** A CSS background for the track (colour sliders). */
  track?: string
  disabled?: boolean
  title?: string
  /** What the slider does, behind an (i) that shows on hover. */
  tip?: Tip
  /** 'log': the bar runs on a log scale (finer at the small end); values stay as they are. */
  scale?: 'linear' | 'log'
  /** Marks along the rail at this many evenly spaced stops (a stepped slider: 2 or more). */
  ticks?: number
  /**
   * Whether moving it changes the picture (the default), so the mask overlay
   * steps aside while it moves; false for a slider that shapes a mask.
   */
  adjusts?: boolean
  /** What is wrong with the picture this slider feeds: the row shows it in red, the text below. */
  problem?: string
}

/** Where `v` sits along `min…max`, as a fraction. */
const frac = (v: number, min: number, max: number): number =>
  max > min ? (Math.min(max, Math.max(min, v)) - min) / (max - min) : 0

/** How far the pointer moves before a press becomes a drag, in pixels. */
const DRAG_SLOP = 3

interface Grab {
  id: number
  x: number
  /** The value when the press came (Escape goes back to it). */
  start: number
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
 * value by how far the pointer goes, never to where it was pressed; it
 * renders live and records history on release, and Escape takes it back.
 * A click on the value types one (Enter sets it, Escape cancels). The app's
 * one rule (lib/sliderDrag.ts): Shift is fine, Alt-click, a double-click or
 * Home resets; arrows step, Page Up and Page Down ten steps.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  def = 0,
  resettable = true,
  format = (v) => (Number.isInteger(step) ? String(Math.round(v)) : v.toFixed(2)),
  onChange,
  onCommit,
  onCancel,
  track,
  disabled,
  title,
  tip,
  scale = 'linear',
  ticks,
  adjusts = true,
  problem
}: SliderProps): React.JSX.Element {
  const log = scale === 'log'
  const [text, setText] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const grab = useRef<Grab | null>(null)
  // Escape leaves the field: the blur that follows must not set what was typed.
  const cancelled = useRef(false)
  const reset = (): void => {
    if (!resettable) return
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
  // Escape mid-drag: back where the press found it, and nothing recorded.
  const barRef = useRef<HTMLDivElement>(null)
  useEscapeWhile(dragging, () => {
    const g = grab.current
    if (!g) return
    grab.current = null
    setDragging(false)
    const el = barRef.current
    if (el?.hasPointerCapture(g.id)) el.releasePointerCapture(g.id)
    if (g.last !== g.start) onChange(g.start, false)
    onCancel?.()
  })
  const place = (v: number): number => (log ? logFraction(v, min, max) : frac(v, min, max))
  const at = place(value)
  const rest = place(def)
  const showZero = !track && def > min && def < max
  const bar = (
    <div
      ref={barRef}
      className={`slider${disabled ? ' disabled' : ''}${value !== def ? ' changed' : ''}${dragging ? ' dragging' : ''}${track ? ' graded' : ''}${problem ? ' problem' : ''}`}
      title={title}
      aria-invalid={problem ? true : undefined}
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
        if (isReset(e) && !(e.target as Element).closest('.num, .info-tip')) {
          reset()
          return
        }
        // The pointer is captured once a drag starts, not on the press: a
        // captured press loses its click, and so the double-click that resets.
        grab.current = {
          id: e.pointerId,
          x: e.clientX,
          start: value,
          from: value,
          last: value,
          width: e.currentTarget.getBoundingClientRect().width,
          fine: isFine(e),
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
        // Shift pressed or let go mid-drag: carry on from here, at the new speed.
        if (isFine(e) !== g.fine) {
          g.fine = isFine(e)
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
        const k = keyStep(e)
        if (k) {
          onChange((log ? keyValueLog : keyValue)(value, k.dir, min, max, step, k.mod), false)
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
      {ticks !== undefined && ticks > 1 && (
        <div className="sl-ticks" aria-hidden>
          {Array.from({ length: ticks }, (_, i) => (
            <i key={i} style={{ '--i': i / (ticks - 1) } as React.CSSProperties} />
          ))}
        </div>
      )}
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
            aria-label={t('{{name}} value', { name: label })}
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
  if (!problem) return bar
  return (
    <>
      {bar}
      <p className="sl-problem" role="alert">
        {problem}
      </p>
    </>
  )
}

/**
 * A slider over a few named stops (a format, a chroma): the editor's slider,
 * with a tick for each stop and the stop's name where the number would be.
 * It snaps to the stops; the bar fills from the first. It has no reset: its
 * first stop is no default, and a double-click must not jump to it.
 */
export function StepSlider<T extends string | number>({
  label,
  value,
  options,
  onChange,
  tip,
  title,
  disabled
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  tip?: Tip
  title?: string
  disabled?: boolean
}): React.JSX.Element {
  const at = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )
  const last = options.length - 1
  const pick = (i: number): void => {
    const next = options[Math.min(last, Math.max(0, Math.round(i)))]
    if (next.value !== value) onChange(next.value)
  }
  return (
    <div className={`step-slider${disabled ? ' disabled' : ''}`} title={title}>
      <div className="ss-head">
        <span className="ss-label">{label}</span>
        {tip && <InfoTip tip={tip} label={label} />}
        <span className="ss-value">{options[at].label}</span>
      </div>
      <Slider
        label={label}
        value={at}
        min={0}
        max={last}
        step={1}
        def={0}
        resettable={false}
        ticks={options.length}
        format={(i) => options[Math.min(last, Math.max(0, Math.round(i)))].label}
        onChange={pick}
        onCommit={() => undefined}
        adjusts={false}
        disabled={disabled}
      />
      <div className="ss-stops" aria-hidden>
        {options.map((o, i) => (
          <button
            key={String(o.value)}
            type="button"
            tabIndex={-1}
            disabled={disabled}
            className={i === at ? 'on' : ''}
            style={{ '--i': last > 0 ? i / last : 0 } as React.CSSProperties}
            onClick={() => pick(i)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * A labelled choice in a row: its name, the app's dropdown (GlassSelect),
 * and an (i) after it when there is one.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  title,
  tip,
  className
}: {
  value: T
  options: GlassOption<T>[]
  onChange: (v: T) => void
  label?: string
  title?: string
  /** What the choice does, behind an (i) beside it. */
  tip?: Tip
  /** On the dropdown itself. */
  className?: string
}): React.JSX.Element {
  const id = useId()
  return (
    <div className={`select${tip ? ' with-tip' : ''}`} title={title}>
      {label && <span id={id}>{label}</span>}
      <GlassSelect
        value={value}
        options={options}
        onChange={onChange}
        labelledBy={label ? id : undefined}
        label={label ? undefined : title}
        className={className}
      />
      {tip && <InfoTip tip={tip} label={label ?? title ?? ''} />}
    </div>
  )
}

/** Arrow keys, Home and End choosing among the buttons of role `role` (focus follows). */
function roveKeys(
  e: React.KeyboardEvent<HTMLElement>,
  role: string,
  pick: (i: number) => void,
  vertical = false
): void {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(`[role="${role}"]`)]
  const at = items.indexOf(document.activeElement as HTMLButtonElement)
  const next = rovingNext(
    e.key,
    at,
    items.map((b) => !b.disabled && b.getAttribute('aria-disabled') !== 'true'),
    vertical
  )
  if (next < 0) return
  e.preventDefault()
  e.stopPropagation()
  pick(next)
  items[next].focus()
}

export interface SegOption<T> {
  value: T
  label: ReactNode
  title?: string
  /** Its name, when the label is a glyph. */
  ariaLabel?: string
  disabled?: boolean
}

/**
 * A segmented control: a few choices side by side, one of them chosen. A
 * radio group to the keyboard: one Tab stop (the choice), arrows move the
 * choice, Home and End go to the ends.
 */
export function Segmented<T extends string | number | null>({
  value,
  options,
  onChange,
  label,
  className,
  title
}: {
  value: T
  options: SegOption<T>[]
  onChange: (v: T) => void
  /** The group's name, for a screen reader. */
  label: string
  className?: string
  title?: string
}): React.JSX.Element {
  const chosen = options.findIndex((o) => o.value === value)
  const stop = chosen >= 0 ? chosen : options.findIndex((o) => !o.disabled)
  return (
    <div
      className={className ? `seg ${className}` : 'seg'}
      role="radiogroup"
      aria-label={label}
      title={title}
      onKeyDown={(e) => roveKeys(e, 'radio', (i) => onChange(options[i].value))}
    >
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={i === chosen}
          aria-label={o.ariaLabel}
          tabIndex={i === stop ? 0 : -1}
          className={i === chosen ? 'on' : ''}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A button that stays in or out (an eyedropper, a view): aria-pressed says which. */
export function Toggle({
  on,
  onChange,
  children,
  title,
  label
}: {
  on: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  title?: string
  /** Its name, when the content is a glyph alone. */
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`toggle ${on ? 'on' : ''}`}
      aria-pressed={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      title={title}
    >
      {children}
    </button>
  )
}

/**
 * Tabs over one area: a tab list to the keyboard (one Tab stop, the chosen
 * tab; arrows choose the next, Home and End the ends).
 */
export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
  className,
  label
}: {
  value: T
  /** `disabled` greys a tab out, `title` says why. */
  tabs: { value: T; label: string; disabled?: boolean; title?: string }[]
  onChange: (v: T) => void
  className?: string
  /** The tab list's name, for a screen reader. */
  label?: string
}): React.JSX.Element {
  const chosen = tabs.findIndex((tab) => tab.value === value)
  const stop = chosen >= 0 ? chosen : tabs.findIndex((tab) => !tab.disabled)
  return (
    <div
      className={className ? `tabs ${className}` : 'tabs'}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => roveKeys(e, 'tab', (i) => onChange(tabs[i].value))}
    >
      {tabs.map((tab, i) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={i === chosen}
          tabIndex={i === stop ? 0 : -1}
          className={i === chosen ? 'on' : ''}
          disabled={tab.disabled}
          title={tab.title}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

/**
 * How far along something is (a download, a benchmark): the app's thin bar,
 * a progressbar to a screen reader with its name and the percent.
 */
export function Progress({
  value,
  label,
  className
}: {
  /** 0…1. */
  value: number
  label: string
  className?: string
}): React.JSX.Element {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <span
      className={`model-bar${className ? ` ${className}` : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${pct}%`}
    >
      <span style={{ width: `${pct}%` }} />
    </span>
  )
}

/** What Tab stops at inside a dialog. */
const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])'

/** The stops in `box` that can take focus now (shown, not inert). */
function tabStops(box: HTMLElement): HTMLElement[] {
  return [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]')
  )
}

/**
 * A dialog over the app (aria-modal): it takes keyboard focus when it opens
 * (whatever inside asks for it with autoFocus, else the dialog itself, so
 * Return never presses a button the user did not choose), keeps Tab inside
 * it, closes on Escape, and hands focus back to whatever had it.
 */
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
  const box = useRef<HTMLElement>(null)
  const titleId = useId()
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const el = box.current
    // A control inside that asked for focus (autoFocus) has it already.
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    return () => {
      const now = document.activeElement
      if (opener?.isConnected && (!now || now === document.body || el?.contains(now)))
        opener.focus({ preventScroll: true })
    }
  }, [])
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
          ref={box}
          className={`modal${wide ? ' wide' : ''}${className ? ` ${className}` : ''}`}
          radius={2}
          bezel={18}
          strength={0.7}
          frost={6}
          // Frosted, not refracting: a dialog's glass is large, and a refraction
          // filter that size costs every frame it animates or scrolls.
          flat
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return
            // Tab goes round the dialog, never out to the app behind it.
            const list = tabStops(e.currentTarget)
            if (list.length === 0) return e.preventDefault()
            const at = list.indexOf(document.activeElement as HTMLElement)
            const next = e.shiftKey
              ? at <= 0
                ? list.length - 1
                : at - 1
              : at < 0 || at === list.length - 1
                ? 0
                : at + 1
            e.preventDefault()
            list[next].focus()
          }}
        >
          <header>
            <h2 id={titleId}>
              {icon && (
                <span className="dlg-glyph">
                  <Icon name={icon} />
                </span>
              )}
              {title}
            </h2>
            <button
              className="icon"
              onClick={onClose}
              aria-label={t('Close')}
              title={t('Close (Esc)')}
            >
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

/**
 * A photo's rating as five stars: a radio group (Rating), one star a stop
 * of its own. A click on a star sets that many, a click on the rating it
 * has clears it; from the keys, arrows move it a star either way (to none
 * below one), Home clears it, End gives five, and 0 to 5 set it. Each star's
 * target is 24 px tall and a star's width apart; `compact` (a library tile)
 * keeps them narrower, where the rating keys do the same.
 */
export function Stars({
  value,
  onChange,
  compact = false
}: {
  value: number
  onChange?: (v: number) => void
  compact?: boolean
}): React.JSX.Element {
  // The ratings the keys asked for in a run of presses, the last one last:
  // keys can outrun a rating's round trip, and the next press counts on from
  // the last asked while what shows is still one of the run's.
  const asked = useRef<number[]>([])
  const label = value > 0 ? tp('{{count}} star', '{{count}} stars', value) : t('Not rated')
  if (!onChange)
    return (
      <span className="stars" role="img" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={n <= value ? 'on' : ''} aria-hidden>
            ★
          </span>
        ))}
      </span>
    )
  const now = (): number => {
    const run = asked.current
    return run.includes(value) ? run[run.length - 1] : value
  }
  const set = (v: number, group: HTMLElement | null): void => {
    const next = Math.max(0, Math.min(5, v))
    const run = asked.current.includes(value) ? asked.current : [value]
    asked.current = [...run, next]
    onChange(next)
    group?.querySelectorAll<HTMLElement>('button')[Math.max(0, next - 1)]?.focus()
  }
  return (
    <span
      className={`stars${compact ? ' compact' : ''}`}
      role="radiogroup"
      aria-label={t('Rating')}
      onKeyDown={(e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return
        const g = e.currentTarget
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(now() + 1, g)
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(now() - 1, g)
        else if (e.key === 'Home') set(0, g)
        else if (e.key === 'End') set(5, g)
        else if (/^[0-5]$/.test(e.key)) set(Number(e.key), g)
        else return
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={tp('{{count}} star', '{{count}} stars', n)}
          // One stop for the group: the rating it has (the first star when none).
          tabIndex={n === Math.max(1, value) ? 0 : -1}
          className={n <= value ? 'on' : ''}
          onClick={(e) => {
            e.stopPropagation()
            onChange(n === value ? 0 : n)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <span aria-hidden>★</span>
        </button>
      ))}
    </span>
  )
}
