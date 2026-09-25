import { useEffect, useRef, type ReactNode } from 'react'
import { LiquidGlass } from './glass/LiquidGlass'

/**
 * A glass popover under (or beside) whatever opened it. A click outside or
 * Escape closes it; it keeps Escape from reaching the app's own shortcuts.
 */
export function Popover({
  onClose,
  children,
  className,
  align = 'left'
}: {
  onClose: () => void
  children: ReactNode
  className?: string
  align?: 'left' | 'right'
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const down = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    // Capture, so the app's own Escape handling never sees this one.
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])
  return (
    <LiquidGlass
      ref={ref}
      className={`popover align-${align}${className ? ` ${className}` : ''}`}
      radius={2}
      bezel={12}
      strength={0.8}
      frost={4}
      role="dialog"
    >
      {children}
    </LiquidGlass>
  )
}

export interface MenuItem {
  label: string
  onSelect: () => void
  danger?: boolean
  checked?: boolean
  disabled?: boolean
  hint?: string
}

/** A list of actions in a popover. */
export function Menu({
  items,
  onClose,
  align
}: {
  items: (MenuItem | 'sep')[]
  onClose: () => void
  align?: 'left' | 'right'
}): React.JSX.Element {
  return (
    <Popover onClose={onClose} className="menu" align={align}>
      <div role="menu">
        {items.map((it, i) =>
          it === 'sep' ? (
            <div key={i} className="menu-sep" />
          ) : (
            <button
              key={i}
              role="menuitem"
              className={`menu-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`}
              disabled={it.disabled}
              onClick={() => {
                onClose()
                it.onSelect()
              }}
            >
              <span className="mark">{it.checked ? '●' : ''}</span>
              <span>{it.label}</span>
              {it.hint && <span className="hint">{it.hint}</span>}
            </button>
          )
        )}
      </div>
    </Popover>
  )
}
