/**
 * How a photo's original is carried in its project (see embed.ts): the
 * choice per format, and the check that a conversion is the same picture.
 * Pure, so it is tested without the app.
 */
import { BACKGROUND_THREADS } from '../source'
import {
  PRESERVE_ALL,
  type Encode,
  type MetadataPolicy,
  type SourceInfo
} from '../../shared/engine-types'
import type { EmbeddedOriginal } from './pixlfile'

export const MB = 1024 * 1024

export interface Plan {
  kind: EmbeddedOriginal['kind']
  /** How the stored bytes are encoded (`BlobInfo.codec`). */
  codec: string
  /** The conversion, or null to keep the file's own bytes. */
  encode: Encode | null
  /** What metadata the conversion keeps: all of it, or what a DNG holds (the camera's EXIF). */
  metadata: MetadataPolicy
  ext: string
}

/** A DNG always carries the camera's EXIF, and no ICC, XMP or IPTC (the engine insists). */
export const DNG_METADATA: MetadataPolicy = { exif: true, icc: false, xmp: false, iptc: false }

export const verbatim = (ext: string, why?: string): Plan & { why?: string } => ({
  kind: 'verbatim',
  codec: ext,
  encode: null,
  metadata: PRESERVE_ALL,
  ext,
  why
})

/** How a photo is best carried, from what its probe says. */
export function planFor(ext: string, size: number, info: SourceInfo): Plan & { why?: string } {
  const e = ext.toLowerCase()
  if (info.input === 'Raw') {
    if (e === 'dng') return verbatim(e, 'already a DNG')
    return {
      kind: 'dng',
      codec: 'dng',
      ext: 'dng',
      metadata: DNG_METADATA,
      encode: {
        Dng: {
          compression: 'Lossless',
          embed_original: false,
          preview: true,
          thumbnail: true,
          crop: 'None',
          apply_scaling: false,
          predictor: 1,
          index: 0
        }
      }
    }
  }
  if (info.input === 'Jpeg') {
    if (info.gain_map) return verbatim(e, 'a JPEG with a gain map is kept whole')
    return {
      kind: 'jxl-jpeg',
      codec: 'jxl-jpeg',
      ext: 'jxl',
      metadata: PRESERVE_ALL,
      encode: { JxlJpegRepack: { effort: 7, threads: BACKGROUND_THREADS } }
    }
  }
  if (info.input === 'Png' || info.input === 'Tiff') {
    if (size < 5 * MB) return verbatim(e, 'small enough as it is')
    const effort = size < 20 * MB ? 9 : size < 50 * MB ? 6 : 3
    return {
      kind: 'jxl-lossless',
      codec: 'jxl',
      ext: 'jxl',
      metadata: PRESERVE_ALL,
      encode: { JxlLossless: { effort, threads: BACKGROUND_THREADS } }
    }
  }
  return verbatim(e, 'already compact')
}

/** Whether a converted file is the same picture: a quick look at what its probe says. */
export function sameShape(kind: Plan['kind'], a: SourceInfo, b: SourceInfo): string | null {
  if (kind === 'dng') {
    if (!b.is_raw_mosaic && a.is_raw_mosaic) return 'the DNG lost the sensor mosaic'
    if (a.as_shot_white && !b.as_shot_white) return 'the DNG lost the as-shot white'
    return null
  }
  // JPEG XL reports its size turned by the orientation; the pixels are the same.
  const same =
    (a.width === b.width && a.height === b.height) || (a.width === b.height && a.height === b.width)
  if (!same) return 'the size changed'
  if (a.channels !== b.channels) return 'the channels changed'
  if (a.bits !== b.bits) return 'the bit depth changed'
  if (a.orientation !== b.orientation) return 'the orientation changed'
  return null
}
