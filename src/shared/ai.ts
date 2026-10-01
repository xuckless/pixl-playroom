/**
 * AI work (segmenting a subject, denoising, enhancing) takes seconds, runs
 * one job at a time in the main process, and belongs to a photo: it goes on
 * while the user edits another one, and its result lands on the photo it was
 * started for. This is the contract between the job queue and the renderer
 * (the scan over the loupe, the filmstrip's chips), and the arithmetic of
 * its progress.
 */
import type { EnhanceSettings } from './enhance'
import type { MaskMode } from './engine-types'
import type { AiDenoiseModel } from './recipe'

export type AiTask = 'enhance' | 'segment' | 'denoise'
export type SegmentTarget = 'subject' | 'sky' | 'background'

/** One step a job goes through, in order (Model → Analyse → Refine). */
export interface AiStage {
  id: string
  label: string
  /** Its share of the whole job's time (the stages' weights need not sum to 1). */
  weight: number
}

export type AiResult =
  /** The photo itself changed: its renders pick it up. */
  | { kind: 'applied'; label: string }
  /** A pixel step was added to the photo's recipe (an AI denoise): History records it. */
  | { kind: 'step'; label: string }
  | {
      kind: 'mask'
      /** The plane, grey, in the photo's base frame, held by the plane store. */
      ref: string
      width: number
      height: number
      label: string
      /** Into this mask, joined this way; else a new mask. */
      into?: { layerId: string; mode: MaskMode }
    }

export type AiPhase = 'queued' | 'running' | 'done' | 'error' | 'cancelled'

export interface AiJobEvent {
  jobId: string
  task: AiTask
  /** The photo it belongs to. */
  key: string
  name: string
  /** "Segmenting", "Enhancing"… and what: "Subject", "×2". */
  title: string
  subject?: string
  stages: AiStage[]
  stage: string
  /** 0…1 over the whole job; null while it cannot say. */
  progress: number | null
  /** The progress is a guess from how long such jobs have taken. */
  estimated?: boolean
  phase: AiPhase
  message?: string
  result?: AiResult
}

export type AiStartRequest =
  | {
      task: 'enhance'
      key: string
      settings: EnhanceSettings
      /** Deblur and JPEG restore inside this mask (frozen as it is now); an upscale is the whole photo. */
      layerId?: string | null
    }
  | {
      task: 'segment'
      key: string
      target: SegmentTarget
      into?: { layerId: string; mode: MaskMode }
    }
  | {
      task: 'denoise'
      key: string
      model: AiDenoiseModel
      /** 1…100: the step's opacity (it can be changed after, without running the model). */
      strength: number
      /** Inside this mask (frozen as it is now); else the whole photo. */
      layerId?: string | null
      /**
       * A photo from before AI denoise was a step: the full-resolution result
       * the old setting made, if still kept, is taken as is (no model runs).
       */
      legacy?: boolean
    }

export interface AiCapabilities {
  enhance: boolean
  segment: boolean
  denoise: boolean
  /** Why a task cannot run, when it cannot. */
  why: Partial<Record<AiTask, string>>
}

export const SEGMENT_LABEL: Record<SegmentTarget, string> = {
  subject: 'Subject',
  sky: 'Sky',
  background: 'Background'
}

/** The whole job's progress with `stage` at `p` (0…1) of its own way. */
export function overallProgress(stages: AiStage[], stage: string, p: number): number {
  const total = stages.reduce((s, x) => s + x.weight, 0)
  if (total <= 0) return 0
  let done = 0
  for (const s of stages) {
    if (s.id === stage) return Math.min(1, (done + s.weight * Math.min(1, Math.max(0, p))) / total)
    done += s.weight
  }
  return Math.min(1, done / total)
}

/**
 * A guess at a step's progress from its time so far and the time such steps
 * take: it moves steadily, slows as it nears the expected end, and stops
 * short of done (the step says when it is).
 */
export function estimate(elapsedMs: number, expectedMs: number): number {
  if (expectedMs <= 0) return 0
  const t = Math.max(0, elapsedMs) / expectedMs
  return 0.95 * (1 - Math.exp(-2.2 * t))
}

/** Where each stage stands, for the dots under the title. */
export function stageStates(
  stages: AiStage[],
  stage: string,
  phase: AiPhase
): ('done' | 'now' | 'todo')[] {
  const at = stages.findIndex((s) => s.id === stage)
  return stages.map((_, i) =>
    phase === 'done' || i < at ? 'done' : i === at && phase === 'running' ? 'now' : 'todo'
  )
}

/** Jobs in the order they run: the one running, then the queued, oldest first. */
export function runOrder<T extends { phase: AiPhase; at: number }>(jobs: T[]): T[] {
  const live = jobs.filter((j) => j.phase === 'running' || j.phase === 'queued')
  return live.sort((a, b) => (a.phase !== b.phase ? (a.phase === 'running' ? -1 : 1) : a.at - b.at))
}
