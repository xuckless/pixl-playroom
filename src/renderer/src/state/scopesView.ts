import { create } from 'zustand'
import { useLibrary } from './library'

export type ScopesTab = 'histogram' | 'colours' | 'cie' | 'metrics'

/** Which tab the expanded scopes open at. The dialog itself is `dialog === 'scopes'`. */
interface ScopesViewState {
  tab: ScopesTab
  open(tab: ScopesTab): void
}

export const useScopesView = create<ScopesViewState>((set) => ({
  tab: 'histogram',
  open(tab) {
    set({ tab })
    useLibrary.getState().setDialog('scopes')
  }
}))
