import { useEffect, useLayoutEffect, useRef } from 'react'

/**
 * While `active` (a drag under way), Escape calls `cancel` and goes no
 * further: the app's own Escape (leaving a tool, closing a view) waits for
 * the next one.
 */
export function useEscapeWhile(active: boolean, cancel: () => void): void {
  const ref = useRef(cancel)
  useLayoutEffect(() => {
    ref.current = cancel
  })
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      ref.current()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [active])
}
