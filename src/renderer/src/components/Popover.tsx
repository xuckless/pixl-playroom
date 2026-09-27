import { useEffect, useRef, type ReactNode } from 'react'
import { LiquidGlass } from './glass/LiquidGlass'

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * A glass popover under (or beside) whatever opened it. A click outside or
 * Escape closes it; it keeps Escape from reaching the app's own shortcuts.
 * Opening moves keyboard focus into it (unless something inside already took
 * it), and closing hands focus back to whatever had it before.
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
    const opener = document.activeElement as HTMLElement | null
    const box = ref.current
    if (box && !box.contains(document.activeElement)) {
      box.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true })
    }
    return () => {
      // Only when focus was inside (or nowhere): a click elsewhere keeps its focus.
      const now = document.activeElement
      if (opener?.isConnected && (!now || now === document.body || box?.contains(now))) {
        opener.focus({ preventScroll: true })
      }
    }
  }, [])
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

/**
 * A list of actions in a popover. Arrow keys, Home and End move between the
 * items (wrapping); Enter or Space runs the focused one.
 */
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
      <div
        role="menu"
        onKeyDown={(e) => {
          const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1, Home: 0, End: 0 }
          if (!(e.key in moves)) return
          e.preventDefault()
          e.stopPropagation()
          const list = [
            ...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
          ]
          if (list.length === 0) return
          const at = list.indexOf(document.activeElement as HTMLElement)
          const next =
            e.key === 'Home' || (at < 0 && e.key === 'ArrowDown')
              ? 0
              : e.key === 'End' || at < 0
                ? list.length - 1
                : (at + moves[e.key] + list.length) % list.length
          list[next].focus()
        }}
      >
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
