/**
 * A `title` set aside while the app's own tooltip shows it
 * (components/Tooltip.tsx), and put back after. Only the attributes an
 * element has are touched, so it runs under `node --test` on a stand-in.
 */

/** What of an element the titles touch. */
export interface Titled {
  tagName: string
  textContent: string | null
  dataset: DOMStringMap
  getAttribute(name: string): string | null
  setAttribute(name: string, value: string): void
  removeAttribute(name: string): void
  hasAttribute(name: string): boolean
}

/** Whether an element has a name of its own (not counting its title). */
export function named(el: Titled): boolean {
  return (
    el.hasAttribute('aria-label') ||
    el.hasAttribute('aria-labelledby') ||
    !!el.textContent?.trim() ||
    (el.tagName === 'IMG' && !!el.getAttribute('alt'))
  )
}

/**
 * The title set aside (in `data-tip`, so the system's own tooltip never
 * doubles the app's), and what the note says; null when it has none. An
 * element named by its title alone takes it as its aria-label meanwhile
 * (`data-tip-name` marks the loan), a new title as it changes.
 */
export function takeTitle(el: Titled): string | null {
  const title = el.getAttribute('title')
  if (title !== null) {
    el.removeAttribute('title')
    if (title) {
      el.dataset.tip = title
      if (el.dataset.tipName !== undefined) el.setAttribute('aria-label', title)
      else if (!named(el)) {
        el.setAttribute('aria-label', title)
        el.dataset.tipName = ''
      }
    }
  }
  return el.dataset.tip ?? null
}

/**
 * The title back where it was (unless the element has a new one by now), and
 * the aria-label it lent taken back: the title names it again.
 */
export function giveTitle(el: Titled): void {
  const tip = el.dataset.tip
  delete el.dataset.tip
  if (el.dataset.tipName !== undefined) {
    el.removeAttribute('aria-label')
    delete el.dataset.tipName
  }
  if (tip && !el.hasAttribute('title')) el.setAttribute('title', tip)
}
