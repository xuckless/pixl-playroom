/**
 * Enhance (the wheel's last tool): better pixels than the file holds, made
 * once into a new 16-bit TIFF beside the original — JPEG restore, deblur and
 * super-resolution, as the engine's enhance chain runs them, in its fixed
 * order: a JPEG rebuilt from its coefficients (it *is* the decoder, so
 * first), then the ×1 models (JPEG artefacts, then motion blur), then the
 * upscaler. What the steps are, which models they need, the size and time
 * they come to: the panel shows it, the main process builds the request
 * from it.
 */

/**
 * JPEG restore: off; rebuilt from the file's DCT coefficients (no model);
 * FBCNN judging the compression itself. (FBCNN told a quality left with
 * engine 0.17; a saved `fbcnn-qf` reads as `fbcnn`, see `normaliseEnhance`.)
 */
export type JpegRestore = 'off' | 'reconstruct' | 'fbcnn'

/** Super-resolution's scale: off, ×2 (a ×4 model brought down by half), ×4. */
export type UpscaleChoice = 'off' | 'x2' | 'x4'

/**
 * What the photo is like, which picks the ×4 model: `clean` (SPAN, closest
 * to the original), `damaged` (Real-ESRGAN general, restores compression and
 * noise as it enlarges), `texture` (its weak-denoise twin, keeps grain).
 */
export type UpscaleSource = 'clean' | 'damaged' | 'texture'

export interface EnhanceSettings {
  jpeg: JpegRestore
  /** Reconstruct: 0 holds the file's texture, 100 smooths as far as the file allows. */
  smoothing: number
  /** Reconstruct, a subsampled JPEG: colour follows the rebuilt luminance's edges. */
  guidedChroma: boolean
  /** FBCNN's blend with what it was shown, 1…100. */
  jpegStrength: number
  deblur: boolean
  /** NAFNet's blend, 1…100. */
  deblurStrength: number
  upscale: UpscaleChoice
  upscaleSource: UpscaleSource
}

export const DEFAULT_ENHANCE: EnhanceSettings = {
  jpeg: 'off',
  smoothing: 50,
  guidedChroma: false,
  jpegStrength: 100,
  deblur: false,
  deblurStrength: 100,
  upscale: 'x2',
  upscaleSource: 'clean'
}

/** The roster's model for each step that runs one. */
export const ENHANCE_MODEL = {
  fbcnn: 'fbcnn-color-blind',
  deblur: 'nafnet-gopro-w32',
  // Every upscaler is ×4; a ×2 request brings it down by half (main/enhance.ts).
  clean: 'span-x4-ch48',
  damaged: 'realesr-general-x4v3',
  texture: 'realesr-general-wdn-x4v3'
} as const

export type EnhanceStepKind = 'reconstruct' | 'fbcnn' | 'deblur' | UpscaleSource

/** One step of the chain as planned: what it is and the model it needs (none for Reconstruct). */
export interface PlannedStep {
  kind: EnhanceStepKind
  model: string | null
  label: string
  /** An upscaler's: the scale it delivers. */
  scale?: 2 | 4
}

const SOURCE_LABEL: Record<UpscaleSource, string> = {
  clean: 'clean',
  damaged: 'damaged',
  texture: 'keep texture'
}

/** The steps the settings ask for on a source, in the engine's order. */
export function planSteps(s: EnhanceSettings, isJpeg: boolean): PlannedStep[] {
  const steps: PlannedStep[] = []
  if (isJpeg && s.jpeg === 'reconstruct')
    steps.push({ kind: 'reconstruct', model: null, label: 'JPEG rebuild' })
  if (isJpeg && s.jpeg === 'fbcnn')
    steps.push({ kind: 'fbcnn', model: ENHANCE_MODEL.fbcnn, label: 'JPEG restore' })
  if (s.deblur) steps.push({ kind: 'deblur', model: ENHANCE_MODEL.deblur, label: 'Deblur' })
  if (s.upscale !== 'off') {
    const scale = s.upscale === 'x2' ? 2 : 4
    steps.push({
      kind: s.upscaleSource,
      model: ENHANCE_MODEL[s.upscaleSource],
      label: `Super Resolution ×${scale} (${SOURCE_LABEL[s.upscaleSource]})`,
      scale
    })
  }
  return steps
}

/** The models the settings need on a source, in chain order. */
export function neededModels(s: EnhanceSettings, isJpeg: boolean): string[] {
  return planSteps(s, isJpeg).flatMap((p) => (p.model ? [p.model] : []))
}

export function scaleOf(s: EnhanceSettings): 1 | 2 | 4 {
  return s.upscale === 'off' ? 1 : s.upscale === 'x2' ? 2 : 4
}

/** Why the settings cannot run on a source, or null. */
export function enhanceRefusal(
  s: EnhanceSettings,
  src: { isJpeg: boolean; isHdr: boolean }
): string | null {
  if (src.isHdr) return 'Enhance needs an SDR photo; this one is HDR'
  if (planSteps(s, src.isJpeg).length === 0)
    return s.jpeg !== 'off' && !src.isJpeg
      ? 'JPEG restore is for JPEG files; choose another step'
      : 'Choose at least one step'
  return null
}

/** The solver's numbers for a Smoothing: 50 is the engine's measured all-round choice (fidelity 500). */
export function reconstructParams(smoothing: number): {
  iterations: number
  second_order: number
  fidelity: number
} {
  const t = Math.max(0, Math.min(100, smoothing))
  return {
    iterations: 40,
    second_order: 0.5,
    // Two decades each way: 50 000 (close to the plain float decode) to 5.
    fidelity: Math.round(500 * 10 ** ((50 - t) / 25) * 100) / 100
  }
}

/**
 * Saved settings brought up to date: a retired JPEG restore reads as its
 * successor; an upscale saved before the Source choice keeps the model it
 * ran (×4 general is Damaged, ×4 keep texture is Texture; ×2's own model is
 * retired, so it is Clean).
 */
export function normaliseEnhance(p: Partial<EnhanceSettings> | undefined): EnhanceSettings {
  const { jpeg, upscale, upscaleSource, ...rest } = { ...DEFAULT_ENHANCE, ...p }
  const was = upscale as string
  const source: UpscaleSource =
    p?.upscaleSource !== undefined && ['clean', 'damaged', 'texture'].includes(upscaleSource)
      ? upscaleSource
      : was === 'x4-wdn'
        ? 'texture'
        : was === 'x4'
          ? 'damaged'
          : 'clean'
  return {
    ...rest,
    jpeg: (jpeg as string) === 'fbcnn-qf' ? 'fbcnn' : jpeg,
    upscale: was === 'x4-wdn' ? 'x4' : ['off', 'x2', 'x4'].includes(was) ? upscale : 'x2',
    upscaleSource: source
  }
}

/**
 * How long each step takes per megapixel of its input, before any run has
 * been timed here: measured on an M-series Mac, the upscalers and NAFNet on
 * CoreML, FBCNN on the CPU (CoreML cannot load it), model loading included.
 */
export const FIRST_GUESS_MS_PER_MP: Record<EnhanceStepKind, number> = {
  reconstruct: 1000,
  fbcnn: 50000,
  deblur: 17000,
  // The upscalers run at the input's size whatever the scale: SPAN in about
  // half general-x4v3's time (engine 0.18's roster).
  clean: 6500,
  damaged: 13000,
  texture: 13000
}

/** Remembered per-step speeds (ms per input megapixel), by step kind. */
export type EnhanceRates = Partial<Record<EnhanceStepKind, number>>

/** The chain's expected time on a width × height frame, in ms. Every step here sees the input size. */
export function estimateMs(
  steps: PlannedStep[],
  w: number,
  h: number,
  rates: EnhanceRates
): number {
  const mp = (w * h) / 1e6
  return steps.reduce((t, p) => t + mp * (rates[p.kind] ?? FIRST_GUESS_MS_PER_MP[p.kind]), 0)
}

/**
 * The speeds after a run took `measuredMs` where `expectedMs` was expected:
 * every step's rate moves toward the measured ratio (the chain is timed as
 * one call, so its steps share the correction).
 */
export function learnRates(
  steps: PlannedStep[],
  rates: EnhanceRates,
  measuredMs: number,
  expectedMs: number
): EnhanceRates {
  if (!(expectedMs > 0) || !(measuredMs > 0)) return rates
  const k = measuredMs / expectedMs
  const next: EnhanceRates = { ...rates }
  for (const p of steps) {
    const r = rates[p.kind] ?? FIRST_GUESS_MS_PER_MP[p.kind]
    next[p.kind] = Math.round(r * (0.4 + 0.6 * k))
  }
  return next
}

/** Past this many output megapixels the panel warns: a 16-bit TIFF of it runs to gigabytes. */
export const LARGE_OUTPUT_MP = 200

/** A short description of the chain, for the job's title: "JPEG restore + Deblur + ×2". */
export function chainSubject(steps: PlannedStep[]): string {
  return steps.map((p) => (p.scale ? `×${p.scale}` : p.label)).join(' + ')
}

/**
 * JPEG restore reads the file's own compressed data, so it can only be a
 * photo's first pixel step: on pixels already changed there is nothing of
 * the file left to restore from.
 */
export function jpegRestoreRefusal(
  s: EnhanceSettings,
  isJpeg: boolean,
  stepsBefore: number
): string | null {
  const restores = planSteps(s, isJpeg).some((p) => p.kind === 'reconstruct' || p.kind === 'fbcnn')
  return restores && stepsBefore > 0
    ? 'JPEG restore reads the file itself, so it must come first: undo the other pixel steps, or leave it off'
    : null
}
