/**
 * AI jobs as the renderer sees them: every job the main process is running
 * or has queued, by id, and the ones just finished for a moment after (so
 * the scan can close on "done" rather than vanish). Fed by the job queue's
 * events; read by the scan over the loupe, the filmstrip's chips and the
 * identity bar.
 */
import { create } from 'zustand'
import type { AiCapabilities, AiJobEvent } from '../../../shared/ai'
import { api } from '../lib/api'

/** A finished job stays this long, so its end can be seen. */
const LINGER_MS = 2200

/** A mask a model just added, for the loupe to reveal with a wipe. */
export interface Reveal {
  layerId: string
  at: number
}

interface JobsState {
  jobs: Record<string, AiJobEvent>
  /** How the last jobs ended, by id, after they leave `jobs` (for the Enhance panel's list). */
  ended: Record<string, AiJobEvent>
  capabilities: AiCapabilities | null
  reveal: Reveal | null
  onEvent(e: AiJobEvent): void
  load(): Promise<void>
  /** Ask again what can run (a smart look about to plan). */
  refresh(): Promise<AiCapabilities>
  setReveal(layerId: string): void
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
/** How often, and how many times, capabilities are asked again while the engine starts. */
const ENGINE_WAIT_MS = 1000
const ENGINE_WAIT_TRIES = 60

export const useAiJobs = create<JobsState>((set, get) => ({
  jobs: {},
  ended: {},
  capabilities: null,
  reveal: null,
  onEvent(e) {
    set({ jobs: { ...get().jobs, [e.jobId]: e } })
    if (e.phase === 'done' || e.phase === 'error' || e.phase === 'cancelled') {
      const kept = Object.entries({ ...get().ended, [e.jobId]: e }).slice(-40)
      set({ ended: Object.fromEntries(kept) })
      clearTimeout(timers.get(e.jobId))
      timers.set(
        e.jobId,
        setTimeout(() => {
          timers.delete(e.jobId)
          const { [e.jobId]: _gone, ...rest } = get().jobs
          void _gone
          set({ jobs: rest })
        }, LINGER_MS)
      )
    }
  },
  async load() {
    const [list, capabilities] = await Promise.all([api.ai.list(), api.ai.capabilities()])
    set({ capabilities })
    for (const e of list) get().onEvent(e)
    // Asked at launch, the background engine may not have said yet whether it
    // runs models: asked again until it has (or a minute has gone by).
    void (async () => {
      for (let i = 0; i < ENGINE_WAIT_TRIES && !get().capabilities?.denoise; i++) {
        await new Promise((r) => setTimeout(r, ENGINE_WAIT_MS))
        await get()
          .refresh()
          .catch(() => undefined)
      }
    })()
    // A model downloaded or removed changes what can run.
    api.models.onEvent(() => {
      void api.ai.capabilities().then((c) => set({ capabilities: c }))
    })
  },
  async refresh() {
    const capabilities = await api.ai.capabilities()
    set({ capabilities })
    return capabilities
  },
  setReveal(layerId) {
    set({ reveal: { layerId, at: performance.now() } })
  }
}))

const live = (e: AiJobEvent): boolean => e.phase === 'running' || e.phase === 'queued'

/** The job to show for a photo: the running or queued one, else the one that just ended. */
export function jobFor(jobs: Record<string, AiJobEvent>, key: string | null): AiJobEvent | null {
  if (!key) return null
  const mine = Object.values(jobs).filter((j) => j.key === key)
  return mine.find((j) => j.phase === 'running') ?? mine.find(live) ?? mine.at(-1) ?? null
}

/** Jobs still to finish, in the order they run. */
export function liveJobs(jobs: Record<string, AiJobEvent>): AiJobEvent[] {
  return Object.values(jobs)
    .filter(live)
    .sort((a, b) =>
      a.phase !== b.phase
        ? a.phase === 'running'
          ? -1
          : 1
        : Number(a.jobId.slice(3)) - Number(b.jobId.slice(3))
    )
}
