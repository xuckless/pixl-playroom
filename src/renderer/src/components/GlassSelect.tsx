import { useRef, useState } from 'react'
import { Icon } from './icons'
import { Menu } from './Popover'

export interface GlassOption<T extends string> {
  value: T
  label: string
  /** Shown on the right of the item (a shortcut). */
  hint?: string
}

/**
 * A dropdown in glass: a button showing the current choice, and the choices
 * in a glass menu under it (a native select's list is the system's own and
 * cannot be). Arrow keys move through the list; Enter picks.
 */
export function GlassSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  prefix,
  title,
  className
}: {
  value: T | null
  options: GlassOption<T>[]
  onChange: (v: T) => void
  /** The button's accessible name. */
  label: string
  /** Shown before the current choice ("Jump to"). */
  prefix?: string
  title?: string
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const btn = useRef<HTMLButtonElement>(null)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`glass-select${open ? ' on' : ''}${className ? ` ${className}` : ''}`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {prefix && <span className="gs-prefix">{prefix}</span>}
        <span className="gs-value">{current?.label ?? '—'}</span>
        <Icon name="chevronDown" />
      </button>
      {open && (
        <Menu
          anchor={btn}
          onClose={() => setOpen(false)}
          items={options.map((o) => ({
            label: o.label,
            hint: o.hint,
            checked: o.value === value,
            onSelect: () => onChange(o.value)
          }))}
        />
      )}
    </>
  )
}
