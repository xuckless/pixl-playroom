/**
 * Pixel steps: what changes a photo's pixels rather than its settings (an AI
 * denoise now; Enhance and baked heal strokes later). Each is computed once,
 * its result stored in the photo's `.pixl` project by content hash, and the
 * step kept in the recipe like any setting, so it undoes, redoes and hides
 * in History without anything being computed again.
 *
 * Steps apply in order to the photo's own pixels, upright and before lens
 * correction (the "source frame"): a step is the image it made (`blob`),
 * laid over what came before through its frozen mask (`alpha`, or the whole
 * frame) at `opacity`. What the develop view, a 1:1 view and an export grade
 * is the photo with every step laid on (main/pixels/working.ts).
 */

export type PixelStepKind = 'denoise'

export interface PixelStep {
  id: string
  kind: PixelStepKind
  /** What History and the panels call it ("AI Denoise · SCUNet"). */
  label: string
  /** SHA-256 of the image it made, the whole frame, in the project's blobs. */
  blob: string
  /**
   * SHA-256 of its mask, frozen when it was made (8-bit grey PNG, the source
   * frame's size), or null for the whole photo.
   */
  alpha: string | null
  /** The mask it was made inside, by name, for showing (the mask may have changed or gone since). */
  scope: string | null
  /** 0…100: how much of it is laid over (a denoise's Strength). */
  opacity: number
  /** The frame it was made at, upright, before lens correction. */
  width: number
  height: number
  /** How it was made: the model, and anything else worth showing. */
  params: Record<string, string | number | boolean | null>
}

export const PIXEL_LABEL: Record<PixelStepKind, string> = {
  denoise: 'AI Denoise'
}

const HEX64 = /^[0-9a-f]{64}$/

/** A step read from anywhere (a project, a sidecar, history), or null when it is not one. */
export function normalisePixelStep(v: unknown): PixelStep | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  if (typeof s.id !== 'string' || typeof s.blob !== 'string' || !HEX64.test(s.blob)) return null
  if (s.kind !== 'denoise') return null
  const num = (x: unknown, d: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? x : d
  return {
    id: s.id,
    kind: s.kind,
    label: typeof s.label === 'string' ? s.label : PIXEL_LABEL[s.kind],
    blob: s.blob,
    alpha: typeof s.alpha === 'string' && HEX64.test(s.alpha) ? s.alpha : null,
    scope: typeof s.scope === 'string' ? s.scope : null,
    opacity: Math.max(0, Math.min(100, num(s.opacity, 100))),
    width: Math.max(1, Math.round(num(s.width, 1))),
    height: Math.max(1, Math.round(num(s.height, 1))),
    params: s.params && typeof s.params === 'object' ? (s.params as PixelStep['params']) : {}
  }
}

/** What the steps lay on, in order: what names the working pixels they make (see working.ts). */
export function stackSignature(steps: PixelStep[]): string {
  return JSON.stringify(steps.map((s) => [s.blob, s.alpha, Math.round(s.opacity * 10) / 10]))
}

/** Why a photo cannot take pixel steps, or null. */
export function pixelStepRefusal(info: { is_hdr: boolean }): string | null {
  return info.is_hdr ? 'HDR photos cannot take AI pixel steps yet' : null
}
