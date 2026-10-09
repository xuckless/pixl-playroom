/**
 * The launch: what the splash says while the engine and the library come up.
 * Steps finish in any order (the engine and the index start side by side);
 * the splash names the first one still running.
 */
import { create } from 'zustand'
import { tk } from '../lib/i18n'

export type BootStep = 'engine' | 'index' | 'folder'

export const BOOT_STEPS: { id: BootStep; label: string }[] = [
  { id: 'engine', label: tk('Starting PIXL Engine') },
  { id: 'index', label: tk('Opening the library index') },
  { id: 'folder', label: tk('Opening your last folder') }
]

interface BootState {
  finished: BootStep[]
  /** Everything is up (or gave up): the splash may leave. */
  ended: boolean
  finish(step: BootStep): void
  end(): void
}

export const useBoot = create<BootState>((set) => ({
  finished: [],
  ended: false,
  finish: (step) =>
    set((s) => (s.finished.includes(step) ? s : { finished: [...s.finished, step] })),
  end: () => set({ ended: true })
}))
