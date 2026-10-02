/**
 * A smart look's run: the model work its plan (`smart.ts`) leaves after the
 * look is applied (the masks waiting on a model, the AI steps), done in the
 * main process one job at a time so it goes on while the user edits another
 * photo, and lands on the photo it was started for. The renderer hears each
 * part land (it records it in the look's history step, see
 * `lib/applyLook.ts`), and answers when the user is asked to point at
 * something. This is the contract between the two.
 */
import type { FramePoint, PlanOp, SmartRates } from './smart'
import { SMART_RATES } from './smart'
import { SKY_BY_CLICK } from '../ai'

export interface LookRunRequest {
  key: string
  runId: string
  /** The look's name, for what the user is asked ("Click the car for Rain City Noir"). */
  look: string
  ops: PlanOp[]
}

/** What the user did when asked to point at an object: a click, a box, or nothing (skip it). */
export type PickAnswer =
  | { kind: 'point'; point: FramePoint }
  | { kind: 'box'; from: FramePoint; to: FramePoint }
  | { kind: 'skip' }

export type LookRunEvent =
  | {
      kind: 'start'
      key: string
      runId: string
      look: string
      /** Each part's words and its expected share of the time. */
      parts: { label: string; ms: number }[]
    }
  /** Part `index` is under way. */
  | { kind: 'part'; key: string; runId: string; index: number; label: string }
  /** Part `index` changed the photo's recipe (a mask's part, a mask turned on, a step). */
  | { kind: 'landed'; key: string; runId: string; index: number; label: string }
  /** Waiting for the user to point at `label` on the loupe. */
  | { kind: 'pick'; key: string; runId: string; index: number; label: string; look: string }
  | {
      kind: 'end'
      key: string
      runId: string
      phase: 'done' | 'cancelled' | 'error'
      /** What could not be made, and why. */
      failed: { label: string; why: string }[]
    }

/** A part in words, for the progress bar. */
export function opLabel(op: PlanOp): string {
  switch (op.kind) {
    case 'component':
      return 'Shaping mask'
    case 'enable':
      return 'Mask ready'
    case 'segment':
      if (op.target !== 'sky') return 'Finding the subject'
      return SKY_BY_CLICK ? 'Pointing at the sky' : 'Finding the sky'
    case 'person':
      return `Finding ${op.part}`
    case 'object':
      return op.detect ? `Finding the ${op.label}` : `Pointing at the ${op.label}`
    case 'denoise':
      return op.model === 'nafnet' ? 'AI denoise (NAFNet)' : 'AI denoise (DRUNet)'
    case 'deblur':
      return 'AI deblur'
  }
}

/** How long a part is expected to take, ms (what is instant counts a little, so the bar moves). */
export function opMs(op: PlanOp, megapixels: number, rates: Partial<SmartRates> = {}): number {
  const r = { ...SMART_RATES, ...rates }
  switch (op.kind) {
    case 'component':
    case 'enable':
      return 50
    case 'segment':
      return r.segmentMs
    case 'person':
      return r.personMs
    case 'object':
      return (op.detect ? r.detectMs : 0) + r.sam2Ms
    case 'denoise':
      return megapixels * (op.model === 'nafnet' ? r.nafnetMsPerMp : r.drunetMsPerMp)
    case 'deblur':
      return megapixels * r.deblurMsPerMp
  }
}

/**
 * The whole run's progress, 0…1: the parts done by their expected time,
 * and the one under way at `p` (its own job's progress) of its share.
 */
export function runProgress(parts: { ms: number }[], index: number, p: number): number {
  const total = parts.reduce((s, x) => s + x.ms, 0)
  if (total <= 0) return 0
  const done = parts.slice(0, index).reduce((s, x) => s + x.ms, 0)
  const now = parts[index]?.ms ?? 0
  return Math.min(1, (done + now * Math.min(1, Math.max(0, p))) / total)
}

/** The run's time left, ms, from the same shares. */
export function runRemaining(parts: { ms: number }[], index: number, p: number): number {
  const rest = parts.slice(index + 1).reduce((s, x) => s + x.ms, 0)
  const now = parts[index]?.ms ?? 0
  return Math.max(0, rest + now * (1 - Math.min(1, Math.max(0, p))))
}

/** A time estimate in words: "~40 s", "~3 min". */
export function formatEta(ms: number): string {
  if (ms < 1500) return 'a moment'
  const s = Math.round(ms / 1000)
  if (s < 90) return `~${s} s`
  return `~${Math.round(s / 60)} min`
}
