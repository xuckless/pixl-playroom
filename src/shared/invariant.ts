/**
 * Engine 0.18's `Invariant` (HR-0.18-9): a check between stages found pixels
 * that are not numbers and refused the render, naming the grade field that
 * made them (`grade.layers[L].stages[S].ops[O]`, a masked group's
 * `….ops[O].ops[G]`, a layer's composite `grade.layers[L]`, the SDR
 * rendition's `sdr.grade.…`). Those indices are the request's own, so they
 * map back to Playroom's layers and sliders. The edit is kept, the adjustment
 * named, and nothing is ever rendered again without it.
 */
import {
  opKind,
  type EngineErrorShape,
  type Grade,
  type GradeOp,
  type GradeOpKind
} from './engine-types'
import { t, tk } from './i18n'

/** Where an Invariant points, in Playroom's terms. */
export interface InvariantPlace {
  /** `'base'` (the photo's own settings), a mask layer's id, or null (black & white, a custom layer). */
  layer: string | null
  /** The layer's name as the request gave it. */
  layerName: string | null
  /** The op that made them; null for a layer's blend (its composite). */
  op: GradeOpKind | null
  /** In the SDR rendition an HDR export writes beside its master. */
  sdr: boolean
}

/** Each op in the user's words. */
const OP_LABEL: Partial<Record<GradeOpKind, string>> = {
  Primary: tk('Exposure, Contrast or Saturation'),
  Tone: tk('Highlights, Shadows, Whites or Blacks'),
  ChannelMixer: tk('Calibration'),
  WhiteBalance: tk('White balance'),
  Dehaze: tk('Dehaze'),
  HslBands: tk('Color mixer'),
  Qualifier: tk('Point color'),
  ColorGrade: tk('Color grading'),
  Curves: tk('Tone curve'),
  ParametricCurve: tk('Tone curve'),
  Lut: tk('Profile'),
  Denoise: tk('Noise reduction'),
  Sharpen: tk('Sharpening'),
  Vibrance: tk('Vibrance'),
  LocalContrast: tk('Texture or Clarity'),
  Vignette: tk('Vignette'),
  Grain: tk('Grain'),
  AddColor: tk('Add color'),
  Defringe: tk('Defringe')
}

/**
 * The recipe fields (dotted paths; one ending in `.` or `*` is a prefix)
 * whose sliders feed each op: the rows marked when it breaks.
 */
const OP_FIELDS: Partial<Record<GradeOpKind, string[]>> = {
  Primary: ['basic.exposure', 'basic.contrast', 'presence.saturation', 'presence.hue'],
  Tone: ['basic.highlights', 'basic.shadows', 'basic.whites', 'basic.blacks'],
  ChannelMixer: [
    'calibration.redHue',
    'calibration.redSaturation',
    'calibration.greenHue',
    'calibration.greenSaturation',
    'calibration.blueHue',
    'calibration.blueSaturation'
  ],
  Dehaze: ['presence.dehaze'],
  Vibrance: ['presence.vibrance'],
  HslBands: ['hsl.', 'bwMix.'],
  ColorGrade: ['colorGrade.'],
  ParametricCurve: ['toneCurve.'],
  Curves: ['toneCurve.'],
  Lut: ['profileAmount'],
  Denoise: [
    'detail.noiseLuminance',
    'detail.noiseLuminanceDetail',
    'detail.noiseColor',
    'detail.noiseColorDetail'
  ],
  Sharpen: [
    'detail.sharpenAmount',
    'detail.sharpenRadius',
    'detail.sharpenDetail',
    'detail.sharpenMasking'
  ],
  LocalContrast: ['presence.texture', 'presence.clarity'],
  Vignette: ['effects.vignette*'],
  Grain: ['effects.grain*']
}

const PATH =
  /^(sdr\.)?grade\.layers\[(\d+)\](?:\.stages\[(\d+)\]\.ops\[(\d+)\](?:\.ops\[(\d+)\])?)?/

/** The `Invariant` detail's text and stage, from an engine error's detail. */
export function invariantDetail(detail: EngineErrorShape['detail']): {
  stage: string
  text: string
} {
  const d = detail?.['Invariant']
  return {
    stage: d && typeof d['stage'] === 'string' ? (d['stage'] as string) : t('a stage'),
    text: d && typeof d['detail'] === 'string' ? (d['detail'] as string) : ''
  }
}

/**
 * The layer and op an Invariant names. `layerIndex` is the compile's (a mask
 * layer's id → its engine index); index 0 named `'base'` is the photo's own.
 * Null when the text names no grade field (a stage outside the grade).
 */
export function invariantPlace(
  text: string,
  grade: Grade | null,
  sdrGrade: Grade | null,
  layerIndex: Record<string, number>
): InvariantPlace | null {
  const at = PATH.exec(text)
  if (!at) return null
  const sdr = at[1] !== undefined
  const g = sdr ? sdrGrade : grade
  const index = Number(at[2])
  const layer = g?.layers[index]
  if (!layer) return null
  let id: string | null = null
  if (!sdr) {
    if (index === 0 && layer.name === 'base') id = 'base'
    else id = Object.keys(layerIndex).find((k) => layerIndex[k] === index) ?? null
  }
  let op: GradeOp | undefined
  if (at[3] !== undefined) {
    op = layer.stages[Number(at[3])]?.ops[Number(at[4])]
    if (op && at[5] !== undefined && 'Masked' in op) op = op.Masked.ops[Number(at[5])]
  }
  return { layer: id, layerName: layer.name, op: op ? opKind(op) : null, sdr }
}

/** What to tell the user. */
export function describeInvariant(place: InvariantPlace | null, stage: string): string {
  if (!place)
    return t('The picture could not be rendered after {{stage}}. Undo the last change.', { stage })
  const where =
    place.layer === 'base'
      ? t('the photo’s settings')
      : t('“{{name}}”', { name: place.layerName ?? t('a layer') })
  const label = place.op ? OP_LABEL[place.op] : undefined
  const what = place.op ? (label ? t(label) : place.op) : t('The layer’s blend')
  return t('{{what}} in {{where}} made pixels that are not numbers. Lower it, or undo.', {
    what,
    where
  })
}

/** Whether a slider reading `path` (a dotted recipe path) feeds the op an Invariant named. */
export function invariantTouches(place: InvariantPlace, path: string): boolean {
  if (!place.op) return false
  return (OP_FIELDS[place.op] ?? []).some((f) =>
    f.endsWith('.')
      ? path.startsWith(f)
      : f.endsWith('*')
        ? path.startsWith(f.slice(0, -1))
        : path === f
  )
}
