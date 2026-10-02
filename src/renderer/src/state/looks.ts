/**
 * The looks the rail and the browser show: My Looks (catalog ids, in the
 * user's order) and the user's own saved presets. The catalog itself is
 * code (`shared/looks/catalog.ts`); only the user's presets come from the
 * main process.
 */
import { create } from 'zustand'
import type { Preset } from '../../../shared/ipc'
import {
  addMine,
  MINE_KEY,
  moveMine,
  readMine,
  removeMine,
  writeMine
} from '../../../shared/looks/mine'
import { api } from '../lib/api'

interface LooksState {
  /** My Looks, catalog ids in order; null until read. */
  mine: string[] | null
  /** The user's saved presets. */
  user: Preset[]
  /** What the Looks browser opens searching for (the rail's search, Enter). */
  browseQuery: string
  load(): Promise<void>
  reloadUser(): Promise<void>
  add(id: string): void
  remove(id: string): void
  move(id: string, to: number): void
}

export const useLooks = create<LooksState>((set, get) => {
  const store = (ids: string[]): void => {
    set({ mine: ids })
    void api.app.setSetting(MINE_KEY, writeMine(ids))
  }
  return {
    mine: null,
    user: [],
    browseQuery: '',
    async load() {
      const [raw] = await Promise.all([api.app.getSetting<unknown>(MINE_KEY), get().reloadUser()])
      set({ mine: readMine(raw) })
    },
    async reloadUser() {
      set({ user: await api.presets.list() })
    },
    add(id) {
      store(addMine(get().mine ?? readMine(undefined), id))
    },
    remove(id) {
      store(removeMine(get().mine ?? readMine(undefined), id))
    },
    move(id, to) {
      store(moveMine(get().mine ?? readMine(undefined), id, to))
    }
  }
})
