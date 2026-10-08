/**
 * Everything working in the background, as one list for the top bar's
 * indicator: AI jobs on any photo (naming, denoise, enhance, masks, a look's
 * batch), the app's global jobs (an export), and model downloads. Work the
 * user waits on in place (a click-to-select, a loupe job) keeps its own
 * feedback and isn't here.
 */
import type { AiJobEvent } from '../../../shared/ai'
import type { ModelInfo } from '../../../shared/ipc'
import type { Job } from '../state/busy'

export interface Activity {
  id: string
  /** What runs: "Enhancing ×2", "Downloading NAFNet". */
  title: string
  /** Which photo, for an AI job. */
  name?: string
  /** 0…1 when known. */
  progress: number | null
  /** Waiting its turn behind another. */
  queued: boolean
  /** An AI job's photo, to go to it. */
  key?: string
  /** How to stop it, when it can be. */
  stop?: { ai: string } | { job: () => void } | null
}

/** The list, running first, in the order each source gives. */
export function activities(ai: AiJobEvent[], jobs: Job[], models: ModelInfo[]): Activity[] {
  const list: Activity[] = [
    ...ai.map((e): Activity => ({
      id: e.jobId,
      title: e.subject ? `${e.title} ${e.subject}` : e.title,
      name: e.name,
      progress: e.progress,
      queued: e.phase === 'queued',
      key: e.key,
      stop: { ai: e.jobId }
    })),
    ...jobs.map((j): Activity => ({
      id: j.id,
      title: j.title,
      name: j.detail,
      progress: j.progress,
      queued: false,
      stop: j.cancel ? { job: j.cancel } : null
    })),
    ...models
      .filter((m) => m.progress !== null)
      .map((m): Activity => ({
        id: `model:${m.id}`,
        title: `Downloading ${m.title}`,
        progress: m.progress,
        queued: false,
        stop: null
      }))
  ]
  return [...list.filter((a) => !a.queued), ...list.filter((a) => a.queued)]
}

/**
 * How far the running work is, together: the mean of what runs, when every
 * one of them can say; null (a spinner) when any can't, or nothing runs.
 */
export function overall(list: Activity[]): number | null {
  const running = list.filter((a) => !a.queued)
  if (running.length === 0 || running.some((a) => a.progress === null)) return null
  return running.reduce((n, a) => n + (a.progress ?? 0), 0) / running.length
}

/** The hover text: one line for each piece of work. */
export function activitySummary(list: Activity[]): string {
  return list
    .map((a) => {
      const how = a.queued
        ? 'queued'
        : a.progress === null
          ? 'working'
          : `${Math.round(a.progress * 100)}%`
      return `${a.title}${a.name ? ` · ${a.name}` : ''}: ${how}`
    })
    .join('\n')
}
