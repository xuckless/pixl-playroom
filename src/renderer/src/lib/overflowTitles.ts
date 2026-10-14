/**
 * The whole of a text the interface cut with an ellipsis (styles/fit.css),
 * as a tooltip: as the pointer comes over an element whose text does not
 * fit and that has no tooltip of its own, it gets its text as one. One
 * listener for the whole window; nothing is measured until hovered.
 */
const GIVEN = 'data-overflow-title'

function onOver(e: PointerEvent): void {
  let el = e.target instanceof HTMLElement ? e.target : null
  // The element itself or the nearest one up that cuts its text (a label in a row).
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    if (el.scrollWidth <= el.clientWidth + 1) continue
    if (getComputedStyle(el).textOverflow !== 'ellipsis') continue
    if (el.title && !el.hasAttribute(GIVEN)) return
    const text = el.textContent?.trim()
    if (text) {
      el.title = text
      el.setAttribute(GIVEN, '')
    }
    return
  }
}

/** Start giving cut texts their tooltip. Returns the stop. */
export function startOverflowTitles(): () => void {
  document.addEventListener('pointerover', onOver, { passive: true })
  return () => document.removeEventListener('pointerover', onOver)
}
