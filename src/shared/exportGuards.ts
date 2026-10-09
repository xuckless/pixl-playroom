/**
 * Export guards: what an export's settings ask that the engine would refuse,
 * lose, or do beside what the person meant, said before anything is written.
 * Pure, so the dialog shows them as settings change and tests pin them.
 *
 * A guard never fixes anything: a `block` stops the export (the dialog names
 * the setting and its step), a `warn` is shown and the export may go ahead.
 * The checks that need the disk or a photo's pixel size (a folder that
 * cannot be written, space, files that would be replaced, a size past the
 * engine's limits) are the main process's (`Exporter.preflight`) and come
 * back as the same `Guard`s.
 */
import {
  FORMAT_EXT,
  buildResize,
  masterPolicy,
  supportsGainMap,
  supportsHdr,
  type ExportFormat,
  type ExportSettings
} from './export'
import { t, tk } from './i18n'

/** The wizard's steps; a guard says which one holds the setting to change. */
export type ExportStep = 'format' | 'size' | 'delivery' | 'review'

export interface Guard {
  id: string
  /** `minor`: worth saying, not worth a warning's weight. */
  severity: 'block' | 'warn' | 'minor'
  step: ExportStep
  message: string
}

/** What the guards need to know of the photos being exported (a library item has all of it). */
export interface ExportSource {
  ext: string
  isRaw: boolean
  /** PQ or HLG. */
  isHdr: boolean
  hasGainMap: boolean
}

/** A format's name as the person knows it. */
export const FORMAT_NAME: Record<ExportFormat, string> = {
  jpeg: 'JPEG',
  png: 'PNG',
  tiff: 'TIFF',
  webp: 'WebP',
  avif: 'AVIF',
  jxl: 'JPEG XL'
}

const NO_IPTC: ExportFormat[] = ['png', 'webp', 'jxl']

/** Whether a source is wider than sRGB (a RAW, HDR, a wide-gamut gain map photo). */
const wide = (p: ExportSource): boolean => p.isRaw || p.isHdr || p.hasGainMap

/** Every guard these settings raise for these photos, blocks first. */
export function exportGuards(s: ExportSettings, sources: ExportSource[]): Guard[] {
  const out: Guard[] = []
  const add = (g: Guard): void => void out.push(g)
  const name = FORMAT_NAME[s.format]
  const any = (f: (p: ExportSource) => boolean): boolean => sources.some(f)
  const mode = s.hdr.mode

  // ── What the engine would refuse, or a delivery the format cannot make ──
  if (s.format === 'avif' && s.avifSpeed > 9)
    add({
      id: 'avif-speed',
      severity: 'block',
      step: 'format',
      message: t('AVIF speed 10 is not available: use 9 or lower.')
    })
  if ((mode === 'keep' || mode === 'expand') && !supportsHdr(s.format))
    add({
      id: 'hdr-format',
      severity: 'block',
      step: 'delivery',
      message: t('{{format}} cannot hold HDR. Choose AVIF, JPEG XL or PNG, or set HDR to SDR.', {
        format: name
      })
    })
  if (mode === 'gainmap' && !supportsGainMap(s.format))
    add({
      id: 'gainmap-format',
      severity: 'block',
      step: 'delivery',
      message: t(
        '{{format}} has no place for a gain map. Choose JPEG or AVIF, or set HDR to SDR.',
        { format: name }
      )
    })
  if (s.format === 'avif' && s.lossless && s.chroma !== 'Full')
    add({
      id: 'avif-lossless-chroma',
      severity: 'block',
      step: 'format',
      message: t('Lossless AVIF keeps full colour: set Chroma to 4:4:4 or turn Lossless off.')
    })
  // The engine's HDR path and a gain map's base reach the linear light through the profile.
  const needsIcc =
    (mode === 'gainmap' && supportsGainMap(s.format)) ||
    any(
      (p) =>
        masterPolicy(s, { isHdr: p.isHdr, hasGainMap: p.hasGainMap, editsBase: false }) !== null
    )
  if (needsIcc && s.metaMode === 'all' && !s.metadata.icc)
    add({
      id: 'icc-needed',
      severity: 'block',
      step: 'delivery',
      message: t('This HDR output describes its colour with the ICC profile: turn ICC on.')
    })
  const r = s.resize
  if (r.mode !== 'none') {
    if (!(r.value > 0) || (r.mode === 'box' && !(r.valueH > 0)))
      add({
        id: 'size-empty',
        severity: 'block',
        step: 'size',
        message: t('Enter a size above zero.')
      })
    else if (r.mode === 'percent' && r.value > 1000)
      add({
        id: 'size-percent',
        severity: 'block',
        step: 'size',
        message: t('A scale past 1000% is not allowed.')
      })
  }
  if (s.folder === '')
    add({
      id: 'folder-empty',
      severity: 'block',
      step: 'review',
      message: t('Choose a folder, or export beside each original.')
    })
  if (!s.template.trim())
    add({
      id: 'name-empty',
      severity: 'block',
      step: 'review',
      message: t('The file name is empty.')
    })
  // The same name beside the original would write over it.
  const ext = FORMAT_EXT[s.format]
  const sameKind = (p: ExportSource): boolean => {
    const e = p.ext.toLowerCase()
    return e === ext || (ext === 'jpg' && e === 'jpeg')
  }
  if (
    s.folder === null &&
    !s.subfolder.trim() &&
    s.template.replace(/\s/g, '') === '{name}' &&
    any(sameKind)
  )
    add({
      id: 'overwrite-original',
      severity: 'block',
      step: 'review',
      message: t(
        'This name, beside the original and in its format, would write over the original: change the name or the folder.'
      )
    })

  // ── What is lost, said once ──
  if (mode === 'sdr' && any((p) => p.isHdr || p.hasGainMap))
    add({
      id: 'hdr-to-sdr',
      severity: 'warn',
      step: 'delivery',
      message: t('HDR photos are tone mapped to SDR: the highlights above white are compressed.')
    })
  if (s.colorSpace === 'Srgb' && any(wide))
    add({
      id: 'gamut-narrow',
      severity: 'warn',
      step: 'size',
      message: t(
        'Colours beyond sRGB (RAW files and HDR photos have them) are compressed into sRGB. Display P3 or Adobe RGB keep more.'
      )
    })
  if (s.bitDepth === 8 && !s.dither && any((p) => p.isRaw || p.isHdr))
    add({
      id: 'banding',
      severity: 'warn',
      step: 'format',
      message: t('8-bit output of a RAW or HDR photo can band in smooth skies: turn Dither on.')
    })
  if (s.metadata.iptc && NO_IPTC.includes(s.format) && s.metaMode === 'all')
    add({
      id: 'iptc',
      severity: 'warn',
      step: 'delivery',
      message: t('{{format}} has no place for IPTC: it will not be written.', { format: name })
    })
  if (s.format === 'jpeg' || s.format === 'webp' || s.format === 'avif')
    add({
      id: 'alpha',
      severity: 'minor',
      step: 'format',
      message: t(
        '{{format}} is written without transparency; a photo that has some is flattened.',
        { format: name }
      )
    })
  if (s.format === 'jpeg' && s.jpegSubsampling !== 'None')
    add({
      id: 'chroma-jpeg',
      severity: 'minor',
      step: 'format',
      message:
        s.jpegSubsampling === 'Half'
          ? t('Colour is stored at half resolution (4:2:2). 4:4:4 keeps it whole.')
          : t('Colour is stored at quarter resolution (4:2:0). 4:4:4 keeps it whole.')
    })
  if (s.format === 'avif' && !s.lossless && s.chroma !== 'Full')
    add({
      id: 'chroma-avif',
      severity: 'minor',
      step: 'format',
      message:
        s.chroma === 'Wide'
          ? t('Colour is stored at half width resolution. 4:4:4 keeps it whole.')
          : t('Colour is stored at quarter resolution. 4:4:4 keeps it whole.')
    })
  if (r.mode !== 'none' && r.enlarge)
    add({
      id: 'enlarge',
      severity: 'minor',
      step: 'size',
      message: t('Enlarging makes a bigger picture, not a sharper one.')
    })
  if (s.colorSpace === 'Rec2020' && (s.format === 'jpeg' || s.format === 'webp'))
    add({
      id: 'rec2020-8bit',
      severity: 'warn',
      step: 'size',
      message: t(
        'Rec.2020 in an 8-bit {{format}} is a very wide space for 256 steps: many viewers will show it dull.',
        { format: name }
      )
    })

  const rank = { block: 0, warn: 1, minor: 2 }
  return out.sort((a, b) => rank[a.severity] - rank[b.severity])
}

/** Whether any guard stops the export. */
export const blocked = (guards: Guard[]): boolean => guards.some((g) => g.severity === 'block')

/** The size a picture of `w × h` is written at under these settings. */
export function outputSize(s: ExportSettings, w: number, h: number): { w: number; h: number } {
  const r = buildResize(s, w, h)
  return r === 'None' ? { w, h } : 'Exact' in r ? { w: r.Exact.width, h: r.Exact.height } : { w, h }
}

/** What each rendering intent does, for the (i) beside Intent. */
export const INTENT_INFO: { value: ExportSettings['intent']; name: string; what: string }[] = [
  {
    value: 'RelativeColorimetric',
    name: tk('Relative colorimetric'),
    what: tk(
      'Colours inside the new space stay exact; those outside are moved to its nearest edge. White maps to white. The usual choice for photographs.'
    )
  },
  {
    value: 'Perceptual',
    name: tk('Perceptual'),
    what: tk(
      'Squeezes all the colours together so their relationships look natural, which shifts colours that would have fitted. Best when much of the picture is outside the new space.'
    )
  },
  {
    value: 'Saturation',
    name: tk('Saturation'),
    what: tk(
      'Keeps colours vivid rather than accurate. For graphics and charts, rarely for photographs.'
    )
  },
  {
    value: 'AbsoluteColorimetric',
    name: tk('Absolute colorimetric'),
    what: tk(
      'Keeps colours exact, white included, with no adaptation to the new white. For soft-proofing a print on screen.'
    )
  }
]

/**
 * The receipt of one written file: what the engine's report says landed
 * beside what the settings asked, and every choice the engine's own colour
 * path made or left out, in its words. Empty when it all went as asked.
 */
export function receiptNotes(
  asked: { exif: boolean; icc: boolean; xmp: boolean; iptc: boolean },
  written: { exif: boolean; icc: boolean; xmp: boolean; iptc: boolean },
  masterNotes: string[]
): string[] {
  const out: string[] = []
  for (const k of ['exif', 'icc', 'xmp', 'iptc'] as const)
    if (asked[k] && !written[k])
      out.push(
        t('{{name}} was not written (the original has none, or the format has no place for it)', {
          name: k.toUpperCase()
        })
      )
  out.push(...masterNotes)
  return out
}
