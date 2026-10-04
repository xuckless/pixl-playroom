/**
 * Pixel steps: what changes a photo's pixels rather than its settings (an AI
 * denoise, an Enhance; baked heal strokes later). Each is computed once,
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

export type PixelStepKind = 'denoise' | 'enhance' | 'retouch'

export interface PixelStep {
  id: string
  kind: PixelStepKind
  /** What History and the panels call it ("AI Denoise · SCUNet"). */
  label: string
  /**
   * SHA-256 of the image it made, in the project's blobs: the whole frame, or
   * (a baked heal, `rect` set) just the patch it changed, a 16-bit RGBA PNG
   * whose alpha is where it changed.
   */
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
  /** A patch's place on that frame, in its pixels; null for a whole-frame image. */
  rect: { x: number; y: number; w: number; h: number } | null
  /**
   * How it was made: the model, and anything else worth showing. `resizes`
   * true: it made the frame larger (an upscale): the frame is its size from it on.
   */
  params: Record<string, string | number | boolean | null>
}

export const PIXEL_LABEL: Record<PixelStepKind, string> = {
  denoise: 'AI Denoise',
  enhance: 'Enhance',
  retouch: 'Heal'
}

/**
 * Which RAW develop made a RAW's pixels: names its caches (`versionStamp`)
 * and, as `params.develop`, the steps laid on them. `l` is LibRaw's decode
 * under PIXL's own develop (engine 0.16); before it, rawler's (no mark).
 */
export const RAW_DEVELOP_REV = 'l'

/**
 * Which engine's grade made a graded render: it names the library thumbnails
 * of edited photos, so an engine that moves graded pixels makes them again.
 * 2 is engine 0.17: PixlRGB is the working space, and what acts on the
 * channels themselves (curves, per-channel gain, HSL bands, the channel
 * mixer) renders differently. (A RAW's develop is `Container`, 0.16.0's
 * pixels, so `RAW_DEVELOP_REV` and the steps laid on it stand.)
 */
export const ENGINE_RENDER_REV = 2

/**
 * A step on a RAW made from another develop than the photo's now (rawler's,
 * before engine 0.16; the file's own camera colour when the photo has since
 * moved to PIXL's, or back): its pixels are that develop's, so where it is
 * laid partly (a mask's edge, a Strength under 100, a heal's patch) the two
 * can show, and a camera whose frame the new develop crops differently puts
 * it out of place. Running it again makes it from today's. `mark` is the
 * photo's own (`developMark`); the file's own colour's is `RAW_DEVELOP_REV`.
 */
export function staleRawStep(
  step: PixelStep,
  isRaw: boolean,
  mark: string = RAW_DEVELOP_REV
): boolean {
  return isRaw && step.params.develop !== mark
}

const HEX64 = /^[0-9a-f]{64}$/

/** A step read from anywhere (a project, a sidecar, history), or null when it is not one. */
export function normalisePixelStep(v: unknown): PixelStep | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Record<string, unknown>
  if (typeof s.id !== 'string' || typeof s.blob !== 'string' || !HEX64.test(s.blob)) return null
  if (s.kind !== 'denoise' && s.kind !== 'enhance' && s.kind !== 'retouch') return null
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
    rect: rectOf(s.rect),
    params: s.params && typeof s.params === 'object' ? (s.params as PixelStep['params']) : {}
  }
}

function rectOf(v: unknown): PixelStep['rect'] {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  const n = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null
  const x = n(r.x)
  const y = n(r.y)
  const w = n(r.w)
  const h = n(r.h)
  return x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0
    ? { x, y, w, h }
    : null
}

/** What the steps lay on, in order: what names the working pixels they make (see working.ts). */
export function stackSignature(steps: PixelStep[]): string {
  return JSON.stringify(
    steps.map((s) => [s.blob, s.alpha, Math.round(s.opacity * 10) / 10, s.rect])
  )
}

/** Whether a step made the frame larger (an upscale). */
export function resizes(s: PixelStep): boolean {
  return s.params.resizes === true
}

/** Why a photo cannot take pixel steps, or null. */
export function pixelStepRefusal(info: { is_hdr: boolean }): string | null {
  return info.is_hdr ? 'HDR photos cannot take AI pixel steps yet' : null
}

/**
 * `steps` with `step` added where it was made: right after `basedOn` (the ids
 * of the steps it was computed on), so steps added while it ran stay on top
 * of it rather than under it. Without `basedOn`, or when the step it followed
 * is gone, it goes last.
 */
export function placeStep(steps: PixelStep[], step: PixelStep, basedOn?: string[]): PixelStep[] {
  if (!basedOn) return [...steps, step]
  const after = basedOn.at(-1)
  const i = after === undefined ? 0 : steps.findIndex((s) => s.id === after) + 1
  if (after !== undefined && i === 0) return [...steps, step]
  return [...steps.slice(0, i), step, ...steps.slice(i)]
}
