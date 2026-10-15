import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { FloatingTip, TIP_MS } from './Tooltip'

/**
 * What a toolbar control does, in the tips' glass note: its name and key,
 * a line on what it does, and (when it cannot be used, or says something of
 * this photo) why. One of the app's tooltips (components/Tooltip.tsx): it
 * opens when the pointer rests on the control or the keyboard reaches it,
 * closes on leaving, a press or Escape; the control keeps its click.
 * Already translated where passed.
 */
export interface Hint {
  title: string
  /** The key that toggles it, as shown elsewhere ("J"), if any. */
  keys?: string
  what: string
  /** Of this photo or this screen now: why it is greyed, or what it shows here. */
  now?: string
}

/**
 * Wraps one control (a box-less span, so the toolbar's layout is the
 * control's own). A control that can be unavailable says so with
 * `aria-disabled`, not `disabled`: a disabled button gets no pointer events
 * and no focus, and its note is the place that says why. The note is the
 * control's description (aria-describedby) whether it shows or not, so a
 * screen reader hears why too.
 */
export function HoverHint({
  hint,
  children
}: {
  hint: Hint
  children: ReactNode
}): React.JSX.Element {
  // The control the note is open beside (null: closed).
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const wrap = useRef<HTMLSpanElement>(null)
  const id = useId()
  useEffect(() => () => clearTimeout(timer.current), [])
  // The control is described by the note's words, shown or not.
  useEffect(() => {
    const control = wrap.current?.firstElementChild
    if (!control) return
    control.setAttribute('aria-describedby', `${id}-why`)
    return () => control.removeAttribute('aria-describedby')
  }, [id])
  const close = (): void => {
    clearTimeout(timer.current)
    setAnchor(null)
  }
  const control = (): HTMLElement | null =>
    (wrap.current?.firstElementChild as HTMLElement | null) ?? null
  return (
    <span
      ref={wrap}
      className="hover-hint"
      onPointerEnter={(e) => {
        if (e.pointerType === 'touch') return
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setAnchor(control()), TIP_MS)
      }}
      onPointerLeave={() => {
        if (anchor && anchor === document.activeElement && anchor.matches(':focus-visible')) return
        close()
      }}
      // A click is the control's: the note gets out of its way.
      onPointerDown={close}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) setAnchor(control())
      }}
      onBlur={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && anchor) {
          e.stopPropagation()
          close()
        }
      }}
    >
      {children}
      <span id={`${id}-why`} hidden>
        {[hint.what, hint.now].filter(Boolean).join(' ')}
      </span>
      {anchor && (
        <FloatingTip anchor={anchor} id={id} className="hint-pop" onGone={close}>
          <div className="tip-title">
            {hint.title}
            {hint.keys && <span className="kbd">{hint.keys}</span>}
          </div>
          <p>{hint.what}</p>
          {hint.now && <p className="hint-now">{hint.now}</p>}
        </FloatingTip>
      )}
    </span>
  )
}
