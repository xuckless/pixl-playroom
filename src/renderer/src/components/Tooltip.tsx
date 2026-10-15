/**
 * The app's one tooltip: a glass note beside a control, the same look and
 * timing wherever it comes from. Three ways in:
 *
 * - a plain `title` on any element: TooltipHost (mounted once) shows it in
 *   the glass instead of the system's own, on hover and on keyboard focus;
 * - HoverHint, a toolbar control's richer note (its key, what it does, why
 *   it is greyed);
 * - InfoTip, the (i) beside a control, which a click pins open.
 *
 * Every one opens on hover after TIP_MS and at once on keyboard focus,
 * closes on leaving, a press, a scroll or Escape (the note goes, nothing
 * else does), and is the described-by of what it describes.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { placePopover } from '../../../shared/placement'
import { LiquidGlass } from './glass/LiquidGlass'

/** How long the pointer rests on something before its note opens. */
export const TIP_MS = 450

/**
 * A note floating beside `anchor` (under it, or over it when there is no room
 * below), out of the pointer's way. It follows the anchor as the page scrolls
 * and goes when the anchor does.
 */
export function FloatingTip({
  anchor,
  id,
  className,
  children,
  onGone
}: {
  anchor: HTMLElement
  id?: string
  className?: string
  children: ReactNode
  /** The anchor left the page. */
  onGone?: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLElement>(null)
  const gone = useRef(onGone)
  useLayoutEffect(() => {
    gone.current = onGone
  })
  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    let frame = 0
    const place = (): void => {
      if (!anchor.isConnected) return gone.current?.()
      const r = anchor.getBoundingClientRect()
      const p = placePopover(
        r,
        { w: box.offsetWidth, h: box.scrollHeight },
        { w: window.innerWidth, h: window.innerHeight },
        { align: 'left', side: 'bottom', gap: 6, margin: 8 }
      )
      // Centred on the anchor where it fits.
      const x = Math.min(
        window.innerWidth - 8 - box.offsetWidth,
        Math.max(8, r.left + r.width / 2 - box.offsetWidth / 2)
      )
      box.style.left = `${Number.isFinite(x) ? x : p.x}px`
      box.style.top = `${p.y}px`
      box.style.maxHeight = `${p.maxHeight}px`
      box.dataset.side = p.side
    }
    const schedule = (): void => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0
          place()
        })
    }
    place()
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(box)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [anchor])
  return createPortal(
    <LiquidGlass
      ref={ref}
      id={id}
      role="tooltip"
      className={`popover tip-pop tooltip${className ? ` ${className}` : ''}`}
      radius={2}
      bezel={12}
      strength={0.8}
      frost={4}
    >
      {children}
    </LiquidGlass>,
    document.body
  )
}

/** Whether an element has a name of its own (not counting its title). */
function named(el: HTMLElement): boolean {
  return (
    el.hasAttribute('aria-label') ||
    el.hasAttribute('aria-labelledby') ||
    !!el.textContent?.trim() ||
    (el instanceof HTMLImageElement && !!el.alt)
  )
}

const TIP_ID = 'app-tooltip'

/**
 * The tooltips of every `title` in the app, in the glass. The title moves
 * aside while its note can show (a `data-tip` holds it, so the system's own
 * tooltip never doubles it) and comes back as the pointer or focus leaves;
 * an element named by its title alone keeps the name as its aria-label.
 */
export function TooltipHost(): React.JSX.Element | null {
  const [shown, setShown] = useState<{ el: HTMLElement; text: string } | null>(null)
  useEffect(() => {
    let held: HTMLElement | null = null
    // Whether held's note is up (not only waiting on the pointer to rest).
    let visible = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let described: { el: HTMLElement; was: string | null } | null = null

    const titled = (node: EventTarget | null): HTMLElement | null =>
      node instanceof Element ? (node.closest<HTMLElement>('[title], [data-tip]') ?? null) : null
    /** The title set aside while its note can show. */
    const take = (el: HTMLElement): string | null => {
      const title = el.getAttribute('title')
      if (title !== null) {
        el.removeAttribute('title')
        if (title) {
          el.dataset.tip = title
          if (!named(el)) el.setAttribute('aria-label', title)
        }
      }
      return el.dataset.tip ?? null
    }
    /** The title back where it was (unless the element has a new one by now). */
    const give = (el: HTMLElement): void => {
      const tip = el.dataset.tip
      delete el.dataset.tip
      if (tip && !el.hasAttribute('title')) el.setAttribute('title', tip)
    }
    const hide = (): void => {
      clearTimeout(timer)
      if (described) {
        if (described.was === null) described.el.removeAttribute('aria-describedby')
        else described.el.setAttribute('aria-describedby', described.was)
        described = null
      }
      if (held) give(held)
      held = null
      visible = false
      setShown(null)
    }
    const show = (el: HTMLElement, text: string): void => {
      // Said aloud already when it is the element's name.
      if (el.getAttribute('aria-label') !== text) {
        const was = el.getAttribute('aria-describedby')
        described = { el, was }
        el.setAttribute('aria-describedby', was ? `${was} ${TIP_ID}` : TIP_ID)
      }
      visible = true
      setShown({ el, text })
    }
    const begin = (el: HTMLElement, wait: number): void => {
      if (el === held) return
      hide()
      const text = take(el)
      if (!text) return
      held = el
      if (wait === 0) show(el, text)
      else timer = setTimeout(() => held === el && show(el, text), wait)
    }

    const over = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') return
      const el = titled(e.target)
      if (el) begin(el, TIP_MS)
      else if (held && !(e.target instanceof Node && held.contains(e.target))) hide()
    }
    const out = (e: PointerEvent): void => {
      if (!held) return
      const to = e.relatedTarget
      if (to instanceof Node && held.contains(to)) return
      if (document.activeElement === held && held.matches(':focus-visible')) return
      hide()
    }
    const focusIn = (e: FocusEvent): void => {
      const el = e.target instanceof HTMLElement ? e.target : null
      if (!el || !el.matches(':focus-visible')) return
      if (el.hasAttribute('title') || el.dataset.tip) begin(el, 0)
    }
    const focusOut = (e: FocusEvent): void => {
      if (held && e.target === held) hide()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !held) return
      const open = visible
      hide()
      // A note that was showing is what this Escape closed.
      if (open) {
        e.stopImmediatePropagation()
        e.preventDefault()
      }
    }
    const press = (): void => hide()
    window.addEventListener('pointerover', over, { passive: true })
    window.addEventListener('pointerout', out, { passive: true })
    window.addEventListener('focusin', focusIn)
    window.addEventListener('focusout', focusOut)
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('wheel', press, { passive: true })
    window.addEventListener('scroll', press, { capture: true, passive: true })
    window.addEventListener('blur', press)
    return () => {
      hide()
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointerout', out)
      window.removeEventListener('focusin', focusIn)
      window.removeEventListener('focusout', focusOut)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('wheel', press)
      window.removeEventListener('scroll', press, { capture: true })
      window.removeEventListener('blur', press)
    }
  }, [])
  if (!shown) return null
  return (
    <FloatingTip anchor={shown.el} id={TIP_ID} className="title-tip" onGone={() => setShown(null)}>
      {shown.text}
    </FloatingTip>
  )
}
