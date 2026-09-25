/**
 * Long operations the user is waiting on — auto tone, auto white balance, a
 * noise measurement, an export, an enhance — so the UI can show them with
 * the processing sphere instead of freezing or saying nothing.
 */
import { create } from 'zustand'

export interface Job {
  id: string
  title: string
  detail?: string
  /** 0…1 when known; null for an operation that cannot say how far along it is. */
  progress: number | null
  /** Over the loupe, or only in the app's identity bar. */
  scope: 'loupe' | 'global'
  startedAt: number
}

interface BusyState {
  jobs: Job[]
  begin(job: Omit<Job, 'startedAt' | 'progress'> & { progress?: number | null }): void
  update(id: string, patch: Partial<Omit<Job, 'id'>>): void
  end(id: string): void
}

export const useBusy = create<BusyState>((set) => ({
  jobs: [],
  begin: (job) =>
    set((s) => ({
      jobs: [
        ...s.jobs.filter((j) => j.id !== job.id),
        { progress: null, ...job, startedAt: performance.now() }
      ]
    })),
  update: (id, patch) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  end: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
}))

let seq = 0

/** Run `fn` as a job over the loupe (or elsewhere), ending it however `fn` ends. */
export async function runJob<T>(
  title: string,
  fn: () => Promise<T>,
  opts: { detail?: string; scope?: Job['scope'] } = {}
): Promise<T> {
  const id = `job-${++seq}`
  useBusy.getState().begin({ id, title, detail: opts.detail, scope: opts.scope ?? 'loupe' })
  try {
    return await fn()
  } finally {
    useBusy.getState().end(id)
  }
}
