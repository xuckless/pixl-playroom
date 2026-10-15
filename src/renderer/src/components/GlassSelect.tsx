import { useEffect, useId, useRef, useState } from 'react'
import { listMove, typeAhead } from '../lib/roving'
import { Icon } from './icons'
import { Popover } from './Popover'

export interface GlassOption<T extends string> {
  value: T
  label: string
  /** Shown on the right of the item (a shortcut). */
  hint?: string
  /** A small accent dot after it (a section with changes). */
  dot?: boolean
  /** Shown, not chosen (a format that cannot carry it). */
  disabled?: boolean
  /** Why it is greyed, or more about it. */
  title?: string
}

/** How long typed letters keep adding to one search before it starts again. */
const TYPE_MS = 700

/**
 * The app's one dropdown: a button showing the current choice, and the
 * choices in a glass list under it (a native select's list is the system's
 * own and cannot be).
 *
 * A select-only combobox to the keyboard and a screen reader (WAI-ARIA):
 * focus stays on the button while the list is open, and the option the keys
 * are on is its active descendant. Closed, Down, Up, Enter, Space, Home and
 * End open it; letters open it at the first choice they spell. Open, the
 * arrows, Home, End, Page Up and Page Down move, letters jump (type-ahead),
 * Enter or Space chooses, Tab chooses and moves on, Escape closes and keeps
 * what was chosen.
 */
export function GlassSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  labelledBy,
  prefix,
  title,
  className,
  disabled,
  id
}: {
  value: T | null
  options: GlassOption<T>[]
  onChange: (v: T) => void
  /** The button's accessible name (a visible label can name it instead: `labelledBy`). */
  label?: string
  /** The id of a visible label that names it. */
  labelledBy?: string
  /** Shown before the current choice ("Jump to"). */
  prefix?: string
  title?: string
  className?: string
  disabled?: boolean
  id?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })
  const base = useId()
  const listId = `${base}-list`
  const optionId = (i: number): string => `${base}-o${i}`
  const chosen = options.findIndex((o) => o.value === value)
  const current = chosen >= 0 ? options[chosen] : undefined
  const enabled = options.map((o) => !o.disabled)

  const show = (at: number): void => {
    setActive(at >= 0 ? at : enabled.indexOf(true))
    setOpen(true)
  }
  const close = (): void => {
    setOpen(false)
    setActive(-1)
  }
  const choose = (i: number): void => {
    const o = options[i]
    close()
    if (o && !o.disabled && o.value !== value) onChange(o.value)
  }
  /** Letters typed: the next choice they spell, from `from`. */
  const seek = (key: string, from: number): number => {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > TYPE_MS ? key : t.text + key
    t.at = now
    return typeAhead(
      options.map((o) => o.label),
      enabled,
      from,
      t.text
    )
  }
  // The active choice kept in view as the keys move it.
  useEffect(() => {
    if (!open || active < 0) return
    list.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)
      ?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  return (
    <>
      <button
        ref={btn}
        id={id}
        type="button"
        role="combobox"
        className={`glass-select${open ? ' on' : ''}${className ? ` ${className}` : ''}`}
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        title={title}
        disabled={disabled}
        onClick={() => (open ? close() : show(chosen))}
        onKeyDown={(e) => {
          if (e.metaKey || e.ctrlKey) return
          const letter = e.key.length === 1 && e.key !== ' ' && !e.altKey
          if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')
              show(chosen)
            else if (e.key === 'Home' || e.key === 'End')
              show(e.key === 'Home' ? enabled.indexOf(true) : enabled.lastIndexOf(true))
            else if (letter) show(seek(e.key, chosen))
            else return
            e.preventDefault()
            e.stopPropagation()
            return
          }
          // A space while letters are being typed is part of the search ("Display P3").
          const searching = Date.now() - typed.current.at < TYPE_MS && typed.current.text !== ''
          if (e.key === 'Enter' || (e.key === ' ' && !searching)) choose(active)
          else if (e.key === 'Tab') {
            choose(active)
            return
          } else if (letter || e.key === ' ') setActive(seek(e.key, active))
          else {
            const next = listMove(e.key, active, enabled)
            if (next < 0) return
            setActive(next)
          }
          e.preventDefault()
          e.stopPropagation()
        }}
      >
        {prefix && <span className="gs-prefix">{prefix}</span>}
        <span className="gs-value">{current?.label ?? '—'}</span>
        {current?.dot && <span className="menu-dot" aria-hidden />}
        <Icon name="chevronDown" />
      </button>
      {open && (
        <Popover anchor={btn} className="menu gs-menu" onClose={close}>
          <div
            ref={list}
            id={listId}
            role="listbox"
            aria-label={label}
            aria-labelledby={labelledBy}
            // Pressed in the list: the button keeps focus (and so the keys).
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={i === chosen}
                aria-disabled={o.disabled || undefined}
                title={o.title}
                className={`menu-item${i === chosen ? ' checked' : ''}${i === active ? ' active' : ''}${o.disabled ? ' disabled' : ''}`}
                onPointerMove={() => !o.disabled && i !== active && setActive(i)}
                onClick={() => choose(i)}
              >
                <span className="mark" aria-hidden>
                  {i === chosen && <Icon name="check" />}
                </span>
                <span className="label">{o.label}</span>
                {o.dot && <span className="menu-dot" aria-hidden />}
                {o.hint && <span className="hint">{o.hint}</span>}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  )
}
