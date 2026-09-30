import { create } from 'zustand'

/** A word the loupe's badge shows for a moment (the overlay mode Shift+O chose). */
export const useHudNote = create<{ note: string | null; n: number }>(() => ({ note: null, n: 0 }))
let timer: ReturnType<typeof setTimeout> | undefined

export function flashHud(note: string): void {
  clearTimeout(timer)
  useHudNote.setState((s) => ({ note, n: s.n + 1 }))
  timer = setTimeout(() => useHudNote.setState({ note: null }), 1400)
}
