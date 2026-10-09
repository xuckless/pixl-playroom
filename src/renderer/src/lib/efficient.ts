/**
 * The efficient UI (engine 0.19's safe-shutdown advisory, the page's half):
 * while Playroom isn't the active app, or always with Settings → Interface →
 * "Always flat", glass is flat colour without its lens or frost, animations
 * hold still, and the shader scenes stop drawing. Focused again, it all
 * returns. `:root[data-efficient]` carries the flat look to the CSS
 * (primitives.css); `:root[data-still]`, only while Playroom isn't the
 * active app, stops what moves. "Always flat" is a look: in front, its
 * loaders still turn and its transitions still play.
 */
import { useSyncExternalStore } from 'react'

/** A blur shorter than this (a native dialog's hand-off) doesn't flatten anything. */
const SETTLE_MS = 400

let focused = typeof document === 'undefined' ? true : document.hasFocus()
let alwaysFlat = false
let efficient = !focused
let still = !focused
let pending: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function publish(force = false): void {
  const next = alwaysFlat || !focused
  if (next === efficient && !focused === still && !force) return
  efficient = next
  still = !focused
  const root = document.documentElement.dataset
  if (next) root.efficient = ''
  else delete root.efficient
  if (still) root.still = ''
  else delete root.still
  listeners.forEach((l) => l())
}

/** Follow the window's focus. Returns the unsubscribe. */
export function startEfficientUpkeep(): () => void {
  const onFocus = (): void => {
    clearTimeout(pending)
    focused = true
    publish()
  }
  const onBlur = (): void => {
    clearTimeout(pending)
    pending = setTimeout(() => {
      focused = document.hasFocus()
      publish()
    }, SETTLE_MS)
  }
  window.addEventListener('focus', onFocus)
  window.addEventListener('blur', onBlur)
  // Start from where the window is now.
  focused = document.hasFocus()
  publish(true)
  return () => {
    clearTimeout(pending)
    window.removeEventListener('focus', onFocus)
    window.removeEventListener('blur', onBlur)
  }
}

/** The "Always flat" setting (the ui store's `alwaysFlat`). */
export function setAlwaysFlat(on: boolean): void {
  alwaysFlat = on
  publish()
}

export function efficientNow(): boolean {
  return efficient
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Whether the UI is efficient now (unfocused, or "Always flat"). */
export function useEfficient(): boolean {
  return useSyncExternalStore(subscribe, efficientNow, () => false)
}

/** Whether Playroom is behind another app: nothing moves then. */
export function stillNow(): boolean {
  return still
}

export function useStill(): boolean {
  return useSyncExternalStore(subscribe, stillNow, () => false)
}
