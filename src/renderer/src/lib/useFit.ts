import { useCallback } from 'react'

/**
 * A bar that fits its width whatever its contents (names, counts, a longer
 * language): the ref it returns keeps the bar's `data-fit` at the lowest
 * level, 0 to `levels`, at which nothing overflows, and the stylesheet says
 * what each level gives up (key hints, then the words beside icons, …).
 * Measured again when the bar is resized or its contents change.
 */
export function useFit(levels: number): (el: HTMLElement | null) => (() => void) | void {
  return useCallback(
    (el: HTMLElement | null) => {
      if (!el) return
      let frame = 0
      const fit = (): void => {
        let level = 0
        el.dataset.fit = '0'
        while (level < levels && el.scrollWidth > el.clientWidth + 1) {
          level++
          el.dataset.fit = String(level)
        }
      }
      const soon = (): void => {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(fit)
      }
      fit()
      const resized = new ResizeObserver(soon)
      resized.observe(el)
      const changed = new MutationObserver(soon)
      changed.observe(el, { childList: true, subtree: true, characterData: true })
      return () => {
        resized.disconnect()
        changed.disconnect()
        cancelAnimationFrame(frame)
      }
    },
    [levels]
  )
}
