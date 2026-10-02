import { useEffect, useState } from 'react'
import { useLooks } from '../state/looks'

/** Say the saved presets changed (one saved or removed): the lists showing them reload. */
export function presetsChanged(): void {
  void useLooks.getState().reloadUser()
}

/** How long after something opens its tiles still fly in (later ones, scrolled to, just appear). */
const ENTER_MS = 900

/** True for a moment after `dep` changes (and at first): what has just opened. */
export function useEntering(dep: unknown): boolean {
  const [seen, setSeen] = useState(dep)
  const [on, setOn] = useState(true)
  if (seen !== dep) {
    setSeen(dep)
    setOn(true)
  }
  useEffect(() => {
    const t = setTimeout(() => setOn(false), ENTER_MS)
    return () => clearTimeout(t)
  }, [dep])
  return on
}
