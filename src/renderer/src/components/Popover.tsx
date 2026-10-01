import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { placePopover } from '../../../shared/placement'
import { LiquidGlass } from './glass/LiquidGlass'

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

export type PopoverAnchor = RefObject<HTMLElement | null> | HTMLElement | null

/**
 * A glass popover under (or over) whatever opened it. It lives at the end of
 * the document, fixed to the viewport, so no scrolling list clips it and no
 * row's stacking context buries it; it follows its anchor while open, flips
 * when its side is short of room, and closes if the anchor goes away. The
 * anchor is the element the popover is written inside, unless one is given.
 *
 * A click outside it (and outside the anchor, so the anchor's own button can
 * toggle it) or Escape closes it; it keeps Escape from reaching the app's own
 * shortcuts, and keys and clicks inside it from reaching whatever it is
 * written inside. Opening moves keyboard focus into it (unless something
 * inside already took it), Tab cycles within it, and closing hands focus back
 * to whatever had it before.
 */
export function Popover({
  onClose,
  children,
  className,
  align = 'left',
  side = 'bottom',
  anchor,
  solid = false
}: {
  onClose: () => void
  children: ReactNode
  className?: string
  align?: 'left' | 'right'
  side?: 'bottom' | 'top'
  anchor?: PopoverAnchor
  /** Opaque, for surfaces the glass cannot bend (the library sidebar). */
  solid?: boolean
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const marker = useRef<HTMLSpanElement>(null)
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  const anchorEl = (): HTMLElement | null =>
    anchor instanceof HTMLElement
      ? anchor
      : anchor
        ? anchor.current
        : (marker.current?.parentElement ?? null)

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

  // Placed before the first paint, then kept beside the anchor as it moves
  // (a list scrolling under it, a window resizing, a row sliding in).
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    let last = ''
    let frame = 0
    const place = (): void => {
      const a = anchorEl()
      if (!a?.isConnected) {
        closeRef.current()
        return
      }
      const r = a.getBoundingClientRect()
      const w = box.offsetWidth
      const h = box.scrollHeight
      const vw = window.innerWidth
      const vh = window.innerHeight
      const key = `${r.left} ${r.top} ${r.right} ${r.bottom} ${w} ${h} ${vw} ${vh}`
      if (key !== last) {
        last = key
        const p = placePopover(r, { w, h }, { w: vw, h: vh }, { align, side, gap: 6, margin: 8 })
        box.style.left = `${p.x}px`
        box.style.top = `${p.y}px`
        box.style.maxHeight = `${p.maxHeight}px`
        box.dataset.side = p.side
      }
    }
    // Placed again when something could have moved it (not measured every
    // frame, which forced a layout per frame while it was open): a scroll, a
    // resize, either box changing size, and a slow look for an anchor that
    // moves on its own (a row sliding in).
    const schedule = (): void => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          place()
        })
    }
    place()
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(box)
    const a = anchorEl()
    if (a) ro.observe(a)
    const slow = setInterval(schedule, 250)
    return () => {
      cancelAnimationFrame(frame)
      clearInterval(slow)
      ro.disconnect()
      window.removeEventListener('scroll', schedule, { capture: true })
      window.removeEventListener('resize', schedule)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [align, side, anchor])

  useEffect(() => {
    const down = (e: PointerEvent): void => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchorEl()?.contains(t)) return
      closeRef.current()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        closeRef.current()
      }
    }
    // Capture, so the app's own Escape handling never sees this one.
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor])

  // React passes events up the component tree, portal or not: a popover
  // written inside a selectable row must not also press that row.
  const keep = (e: React.SyntheticEvent): void => e.stopPropagation()

  return (
    <>
      <span ref={marker} hidden />
      {createPortal(
        <LiquidGlass
          ref={ref}
          className={`popover${solid ? ' solid' : ''}${className ? ` ${className}` : ''}`}
          radius={2}
          bezel={12}
          strength={0.8}
          frost={4}
          role="dialog"
          onClick={keep}
          onDoubleClick={keep}
          onPointerDown={keep}
          onContextMenu={keep}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key !== 'Tab') return
            const list = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)]
            if (list.length === 0) return
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
          {children}
        </LiquidGlass>,
        document.body
      )}
    </>
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
  align,
  anchor,
  solid
}: {
  items: (MenuItem | 'sep')[]
  onClose: () => void
  align?: 'left' | 'right'
  anchor?: PopoverAnchor
  solid?: boolean
}): React.JSX.Element {
  return (
    <Popover onClose={onClose} className="menu" align={align} anchor={anchor} solid={solid}>
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
