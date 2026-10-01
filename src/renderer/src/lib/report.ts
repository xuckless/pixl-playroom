import { useLibrary } from '../state/library'

/** Set by Help → Report a Problem: Settings opens scrolled to that section. */
let pending = false

/** Settings, at Report a problem. */
export function openReport(): void {
  pending = true
  useLibrary.getState().setDialog('preferences')
}

/** Whether Settings was opened to report a problem (once). */
export function takeReportFocus(): boolean {
  const was = pending
  pending = false
  return was
}
