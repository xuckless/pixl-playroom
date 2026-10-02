/**
 * Whether a live edit (a slider, pin, brush or straighten drag) is re-rendering
 * the photo right now: `data-interacting` on the root while it does, gone a
 * moment after the last change. Kept on the DOM, not in a store, so turning it
 * on and off re-renders nothing; CSS and the loupe read it.
 */
const IDLE_MS = 250

let timer: ReturnType<typeof setTimeout> | undefined

export function touchInteracting(): void {
  const root = document.documentElement
  if (!root.hasAttribute('data-interacting')) root.setAttribute('data-interacting', '')
  clearTimeout(timer)
  timer = setTimeout(() => root.removeAttribute('data-interacting'), IDLE_MS)
}

export function isInteracting(): boolean {
  return document.documentElement.hasAttribute('data-interacting')
}

let adjustTimer: ReturnType<typeof setTimeout> | undefined

/**
 * A slider that changes the picture (not a mask's shape) is moving:
 * `data-adjusting` on the root while it does, so the mask overlay can step
 * aside and show the edit itself (Lightroom's auto toggle). Kept apart from
 * `data-interacting`, which a gradient's or a brush's drag sets too, and
 * those want the overlay.
 */
export function touchAdjusting(): void {
  const root = document.documentElement
  if (!root.hasAttribute('data-adjusting')) root.setAttribute('data-adjusting', '')
  clearTimeout(adjustTimer)
  adjustTimer = setTimeout(() => root.removeAttribute('data-adjusting'), IDLE_MS)
}
