import { create } from 'zustand'
import { useLibrary } from './library'

/**
 * The expanded scopes (`dialog === 'scopes'`): what it shows is the ui
 * store's `scopes` (layout and the scope in each place), so it opens as it
 * was left.
 */
interface ScopesViewState {
  open(): void
}

export const useScopesView = create<ScopesViewState>(() => ({
  open() {
    useLibrary.getState().setDialog('scopes')
  }
}))
