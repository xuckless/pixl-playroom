/**
 * How long a toast (components/Toasts.tsx) stays. Pure, so it runs under
 * `node --test`.
 */

/** How long a message stays: a note a moment, a failure long enough to read twice. */
export const INFO_MS = 4000
export const ERROR_MS = 20000

/**
 * How long `toast` stays up, or null while it stays: one with an action
 * waits to be used or replaced, and one the pointer or focus is on (`heldId`,
 * by id, so a hold never outlives the toast it was on) waits to be let go.
 */
export function toastLife(
  toast: { id: number; tone: 'info' | 'error'; action?: unknown } | null,
  heldId: number | null
): number | null {
  if (!toast || toast.action || heldId === toast.id) return null
  return toast.tone === 'error' ? ERROR_MS : INFO_MS
}
