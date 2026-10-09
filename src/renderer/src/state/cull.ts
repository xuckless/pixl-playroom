/**
 * The Library's suggested rejects (Pass 115, shared/cullsuggest.ts): the
 * reasons main gives for the photos shown, kept current as the source
 * changes, signals are measured or the user says Keep. A photo the user has
 * starred, picked or rejected since is never shown as suggested, whatever
 * main last said (`suggested`).
 */
import { create } from 'zustand'
import type { CullReason } from '../../../shared/cullsuggest'
import type { LibraryItem } from '../../../shared/ipc'
import { api, errorText } from '../lib/api'
import { useBusy } from './busy'
import { useLibrary } from './library'
import { useUi } from './ui'

interface CullState {
  reasons: Record<string, CullReason[]>
  /** A measure-now in flight: how far. */
  measuring: { done: number; total: number } | null
  refresh(): Promise<void>
  keep(keys: string[]): Promise<void>
  /** Measure now what the photos shown lack (Suggested rejects turned on). */
  measure(): Promise<void>
}

/** The photo's own items shown: its copies are the user's own. */
const photoKeys = (items: LibraryItem[]): string[] =>
  items.filter((i) => i.copyId === null).map((i) => i.key)

let seq = 0

/** The busy indicator's job while signals are measured. */
const CULL_JOB = 'cull-measure'

export const useCull = create<CullState>((set, get) => ({
  reasons: {},
  measuring: null,

  async refresh() {
    const n = ++seq
    if (!useUi.getState().cullSuggest) return set({ reasons: {} })
    const keys = photoKeys(useLibrary.getState().items)
    if (keys.length === 0) return set({ reasons: {} })
    try {
      const reasons = await api.cull.suggestions(keys)
      if (n === seq) set({ reasons })
    } catch {
      // The index stopping (a quit): the next change asks again.
    }
  },

  async keep(keys) {
    // Gone at once; main keeps it for good.
    const reasons = { ...get().reasons }
    for (const k of keys) delete reasons[k]
    set({ reasons })
    await api.cull
      .keep(keys, true)
      .catch((err) => useLibrary.getState().say(errorText(err), 'error'))
  },

  async measure() {
    const keys = photoKeys(useLibrary.getState().items)
    if (keys.length === 0) return
    try {
      await api.cull.measure(keys)
    } finally {
      set({ measuring: null })
    }
  }
}))

/** The item is a suggested reject now: main gave reasons and the user hasn't spoken for it. */
export function suggestedReasons(
  item: LibraryItem,
  reasons: Record<string, CullReason[]>
): CullReason[] | null {
  const r = reasons[item.key]
  if (!r || r.length === 0) return null
  if (item.rating > 0 || item.flag !== null) return null
  return r
}

/** Keep the suggestions current: a new source, measured signals, the switch. */
export function startCullUpkeep(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const soon = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => void useCull.getState().refresh(), 300)
  }
  const offs = [
    useLibrary.subscribe((s, prev) => {
      if (s.source !== prev.source || s.items.length !== prev.items.length) soon()
    }),
    useUi.subscribe((s, prev) => {
      if (s.cullSuggest !== prev.cullSuggest) soon()
    }),
    api.cull.onEvent(soon),
    api.cull.onProgress((p) => {
      const on = p.done < p.total
      useCull.setState({ measuring: on ? p : null })
      // The indicator atop the window while culling runs (asked for, or in the background).
      const busy = useBusy.getState()
      if (!on) return busy.end(CULL_JOB)
      const patch = { detail: `${p.done} of ${p.total} photos`, progress: p.done / p.total }
      if (busy.jobs.some((j) => j.id === CULL_JOB)) busy.update(CULL_JOB, patch)
      else busy.begin({ id: CULL_JOB, title: 'Culling', scope: 'global', ...patch })
    })
  ]
  soon()
  return () => {
    clearTimeout(timer)
    offs.forEach((off) => off())
    useBusy.getState().end(CULL_JOB)
  }
}
