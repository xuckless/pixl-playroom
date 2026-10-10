import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Popover } from './Popover'

/**
 * What a toolbar control does, in the tips' glass note: its name and key,
 * a line on what it does, and (when it cannot be used, or says something of
 * this photo) why. Opens when the pointer rests on the control, closes when
 * it leaves; the control keeps its click. Already translated where passed.
 */
export interface Hint {
  title: string
  /** The key that toggles it, as shown elsewhere ("J"), if any. */
  keys?: string
  what: string
  /** Of this photo or this screen now: why it is greyed, or what it shows here. */
  now?: string
}

/** How long the pointer rests on a control before its note opens. */
const HOVER_MS = 450

/**
 * Wraps one control (a box-less span, so the toolbar's layout is the
 * control's own). A control that can be unavailable says so with
 * `aria-disabled`, not `disabled`: a disabled button gets no pointer events,
 * and its note is the place that says why.
 */
export function HoverHint({
  hint,
  children
}: {
  hint: Hint
  children: ReactNode
}): React.JSX.Element {
  // The control the note is open beside (null: closed), taken as the pointer comes in.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const close = (): void => {
    clearTimeout(timer.current)
    setAnchor(null)
  }
  return (
    <span
      className="hover-hint"
      onPointerEnter={(e) => {
        const control = e.currentTarget.firstElementChild as HTMLElement | null
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setAnchor(control), HOVER_MS)
      }}
      onPointerLeave={close}
      // A click is the control's: the note gets out of its way.
      onPointerDown={close}
    >
      {children}
      {anchor && (
        <Popover anchor={anchor} onClose={close} className="tip-pop hint-pop">
          <div role="note">
            <div className="tip-title">
              {hint.title}
              {hint.keys && <span className="kbd">{hint.keys}</span>}
            </div>
            <p>{hint.what}</p>
            {hint.now && <p className="hint-now">{hint.now}</p>}
          </div>
        </Popover>
      )}
    </span>
  )
}
