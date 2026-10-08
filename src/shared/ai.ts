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
import type { AiDenoiseModel, BrushSource } from './recipe'
import type { SmartReadiness } from './looks/smart'
import type { Finders } from './concepts'
import type { PromptGeometry, PromptVia } from './prompt'

export type AiTask = 'enhance' | 'segment' | 'denoise' | 'prompt'

/**
 * Before engine 0.19's sky plane (DINOv2-S+ADE), the Sky tool and smart
 * looks' sky masks asked the user to click the sky, and SAM 2.1 selected
 * it. Now the model finds it: one click on the tool (ai/segment.ts). Kept
 * for a sky model that might be held back again.
 */
export const SKY_BY_CLICK = false
/**
 * The masks' People tools (body, face, hair, skin…), each found by a click
 * on the part (SAM 2.1). Off until they are ready to release: the tools say
 * "soon" in the picker.
 */
export const PEOPLE_BY_CLICK = false
/** What DINOv2-S+ADE finds in a scene (engine 0.19): each one plane. */
export type SceneTarget = 'sky' | 'vegetation' | 'water'
export const SCENE_TARGETS: SceneTarget[] = ['sky', 'vegetation', 'water']
/** A person's parts Selfie Multiclass finds (engine 0.19); the rest wait for face parts. */
export type PartTarget = 'face' | 'hair' | 'skin' | 'clothes'
export const PART_TARGETS: PartTarget[] = ['face', 'hair', 'skin', 'clothes']
/** `depth`: a depth map (Depth Anything V2), landing as a Depth range. */
export type SegmentTarget = 'subject' | 'background' | 'depth' | SceneTarget | PartTarget

/** The scene model (engine 0.19): sky, vegetation and water. */
export const SCENE_MODEL = 'dinov2-s-ade'
/** The people-parts model (engine 0.19): hair, face and body skin, clothes. */
export const PARTS_MODEL = 'selfie-multiclass'

export const isSceneTarget = (t: unknown): t is SceneTarget =>
  SCENE_TARGETS.includes(t as SceneTarget)
export const isPartTarget = (t: unknown): t is PartTarget => PART_TARGETS.includes(t as PartTarget)

/** The model a segment job runs. */
export function segmentModel(target: SegmentTarget, fine = false): string {
  if (target === 'depth') return DEPTH_MODEL
  if (isSceneTarget(target)) return SCENE_MODEL
  if (isPartTarget(target)) return PARTS_MODEL
  return fine ? FINE_SUBJECT_MODEL : 'u2netp'
}

/** The fine subject model (engine 0.18, on demand): BiRefNet lite. */
export const FINE_SUBJECT_MODEL = 'birefnet-lite'

/** The depth model (engine 0.18): disparity, per photo. */
export const DEPTH_MODEL = 'depth-anything-v2-small'

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
      /** What made it, kept on the mask (`BrushComponent.source`). */
      source?: BrushSource
      /** A depth map, not a selection: it lands as a Depth range (`DepthComponent`). */
      depth?: true
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
  /** The look run it belongs to (a smart look's masks and steps): that run records its history. */
  group?: string
}

export type AiStartRequest = (
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
      /** The subject or background with BiRefNet lite (fine edges, ~5 s), not U²-Netp. */
      fine?: boolean
    }
  | {
      /**
       * SAM 2.1 from a prompt (a smart look's object or sky, a photo not
       * open): its mask lands like a segment's.
       */
      task: 'prompt'
      key: string
      label?: string
      prompt: PromptGeometry
      via: PromptVia
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
      /**
       * Make this denoise step again, in its place: on the steps before it,
       * inside the mask it froze, at its strength (a RAW step from an older
       * develop, `staleRawStep`). `model`, `strength` and `layerId` are its own.
       */
      redo?: string
    }
) & {
  /** A look run's id (`AiJobEvent.group`). */
  group?: string
}

export interface AiCapabilities {
  enhance: boolean
  segment: boolean
  denoise: boolean
  /** Select by clicks, a box or strokes (SAM 2.1): the Objects and Sky tools. */
  prompt: boolean
  /** Why a task cannot run, when it cannot. */
  why: Partial<Record<AiTask, string>>
  /**
   * The model to download when only a model is missing for a task (the one
   * Playroom recommends): the renderer offers it there and then.
   */
  get: Partial<Record<AiTask, string>>
  /** What smart looks can ask for on this build (`looks/smart.ts`). */
  smart: SmartReadiness
  /**
   * How a class (shared/concepts.ts) can be found on this build: by a click
   * where SAM 2.1 runs (its model here or offered); by name once a finder
   * that knows names ships.
   */
  finders: Finders
}

export const SEGMENT_LABEL: Record<SegmentTarget, string> = {
  subject: 'Subject',
  sky: 'Sky',
  vegetation: 'Vegetation',
  water: 'Water',
  background: 'Background',
  depth: 'Depth range',
  face: 'Face',
  hair: 'Hair',
  skin: 'Skin',
  clothes: 'Clothes'
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

/**
 * Which queued jobs start now: in run order, the first of each lane that
 * has none running (a lane runs one job at a time).
 */
export function toStart<T extends { phase: AiPhase; at: number }>(
  jobs: T[],
  busy: ReadonlySet<string>,
  laneOf: (job: T) => string
): T[] {
  const taken = new Set(busy)
  const out: T[] = []
  for (const j of runOrder(jobs)) {
    if (j.phase !== 'queued') continue
    const lane = laneOf(j)
    if (taken.has(lane)) continue
    taken.add(lane)
    out.push(j)
  }
  return out
}

/** Jobs in the order they run: the one running, then the queued, oldest first. */
export function runOrder<T extends { phase: AiPhase; at: number }>(jobs: T[]): T[] {
  const live = jobs.filter((j) => j.phase === 'running' || j.phase === 'queued')
  return live.sort((a, b) => (a.phase !== b.phase ? (a.phase === 'running' ? -1 : 1) : a.at - b.at))
}
