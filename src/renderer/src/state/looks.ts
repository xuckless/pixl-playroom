/**
 * The looks the rail and the browser show: My Looks (catalog ids, in the
 * user's order) and the user's own saved presets. The catalog itself is
 * code (`shared/looks/catalog.ts`); only the user's presets come from the
 * main process.
 */
import { create } from 'zustand'
import type { Preset } from '../../../shared/ipc'
import type { Recipe } from '../../../shared/recipe'
import type { LookRunEvent } from '../../../shared/looks/run'
import {
  addMine,
  MINE_KEY,
  moveMine,
  readMine,
  removeMine,
  writeMine
} from '../../../shared/looks/mine'
import { api } from '../lib/api'

/** The look applied last, for its Amount and to be swapped (see `lib/applyLook.ts`). */
export interface AppliedLook {
  /** The photo it was applied to. */
  key: string
  lookId: string
  name: string
  /** Its history label at full strength. */
  label: string
  /** The photo before the look, and with it at full strength. */
  before: Recipe
  after: Recipe
  /** What the look moved: what its Amount scales. */
  fields: string[][]
  /** 0…100 */
  amount: number
  /** Its history step. */
  seq: number
  /** A smart look's model work, while it runs. */
  runId?: string
  /** The masks it made, and their Amount at full strength: the look's Amount scales them. */
  layers: Record<string, number>
  /** The pixel steps it made (an AI denoise), and their strength at full. */
  pixels: Record<string, number>
}

/** A smart look's run as the rail and the browser show it. */
export interface LookRunState {
  runId: string
  key: string
  look: string
  parts: { label: string; ms: number }[]
  /** The part under way. */
  index: number
  label: string
  phase: 'running' | 'pick' | 'done' | 'cancelled' | 'error'
  failed: { label: string; why: string }[]
}

/** The object a run waits for the user to point at. */
export interface LookPickAsk {
  runId: string
  key: string
  label: string
  look: string
}

interface LooksState {
  /** My Looks, catalog ids in order; null until read. */
  mine: string[] | null
  /** The user's saved presets. */
  user: Preset[]
  /** What the Looks browser opens searching for (the rail's search, Enter). */
  browseQuery: string
  applied: AppliedLook | null
  runs: Record<string, LookRunState>
  pick: LookPickAsk | null
  /** The browser shows only looks this build can do all of. */
  worksNow: boolean
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
    applied: null,
    runs: {},
    pick: null,
    worksNow: false,
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

/** A run's event laid on the runs as shown. */
export function runOnEvent(
  runs: Record<string, LookRunState>,
  e: LookRunEvent
): Record<string, LookRunState> {
  const cur = runs[e.runId]
  switch (e.kind) {
    case 'start':
      return {
        ...runs,
        [e.runId]: {
          runId: e.runId,
          key: e.key,
          look: e.look,
          parts: e.parts,
          index: 0,
          label: e.parts[0]?.label ?? '',
          phase: 'running',
          failed: []
        }
      }
    case 'part':
      return cur
        ? { ...runs, [e.runId]: { ...cur, index: e.index, label: e.label, phase: 'running' } }
        : runs
    case 'pick':
      return cur
        ? { ...runs, [e.runId]: { ...cur, index: e.index, label: e.label, phase: 'pick' } }
        : runs
    case 'landed':
      return runs
    case 'end': {
      if (!cur) return runs
      return { ...runs, [e.runId]: { ...cur, phase: e.phase, failed: e.failed } }
    }
  }
}
