import { useEffect, useRef, useState } from 'react'
import { Popover } from './Popover'
import { t } from '../lib/i18n'

/**
 * What a control does, what the picture does when it moves, and a habit worth
 * having. English, marked with tk() where it is written: the note translates it.
 */
export interface Tip {
  what: string
  expect?: string
  tip?: string
}

/** How long a pointer rests on the (i) before its note opens. */
const HOVER_MS = 350
/** How long a note opened by hover waits for the pointer to come into it. */
const LEAVE_MS = 180

/**
 * An (i) that opens a short glass note: on hover (after a moment), on focus,
 * or on a click, which pins it until a click elsewhere or Escape.
 */
export function InfoTip({ tip, label }: { tip: Tip; label: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const pinned = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const later = (fn: () => void, ms: number): void => {
    clearTimeout(timer.current)
    timer.current = setTimeout(fn, ms)
  }
  const close = (): void => {
    clearTimeout(timer.current)
    pinned.current = false
    setOpen(false)
  }
  const leave = (): void => {
    if (!pinned.current) later(close, LEAVE_MS)
  }
  // Pressed inside a slider or a card's header: the press is the note's alone.
  const keep = (e: React.SyntheticEvent): void => e.stopPropagation()
  // Tips (and labels) are written in English and marked with tk(); a label
  // already translated where it was passed comes back from t() as it is.
  const name = t(label)

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`info-tip${open ? ' on' : ''}`}
        aria-label={t('About {{name}}', { name })}
        aria-expanded={open}
        onPointerEnter={() => later(() => setOpen(true), HOVER_MS)}
        onPointerLeave={leave}
        onPointerDown={keep}
        onDoubleClick={keep}
        onKeyDown={keep}
        onClick={(e) => {
          e.stopPropagation()
          clearTimeout(timer.current)
          if (open && pinned.current) return close()
          pinned.current = true
          setOpen(true)
        }}
      >
        <svg viewBox="0 0 12 12" aria-hidden>
          <circle cx="6" cy="6" r="5" />
          <path d="M6 5.4v3M6 3.6v.01" />
        </svg>
      </button>
      {open && (
        <Popover anchor={btn} onClose={close} className="tip-pop">
          <div
            onPointerEnter={() => clearTimeout(timer.current)}
            onPointerLeave={leave}
            role="note"
          >
            <div className="tip-title">{name}</div>
            <p>{t(tip.what)}</p>
            {tip.expect && (
              <p>
                <span className="tip-k">{t('Expect')}</span>
                {t(tip.expect)}
              </p>
            )}
            {tip.tip && (
              <p>
                <span className="tip-k">{t('Try')}</span>
                {t(tip.tip)}
              </p>
            )}
          </div>
        </Popover>
      )}
    </>
  )
}
