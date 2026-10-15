/**
 * ARCHITECTURE — the Library's larger pictures (pure; main/previews.ts makes
 * them, the Loupe, Compare and Survey show them).
 *
 * - **Screen** (`PREVIEW_EDGE` on the long side): an unedited RAW's embedded
 *   preview sized from the preview (shared/thumbsize.ts), any other unedited
 *   photo's own pixels, an edited one graded as its thumbnail is, from its
 *   proxies. Named by the thumbnail's stamp, so an edit, a new file or a
 *   newer engine names a new one.
 * - **Focus** (Z, 1:1): what shows every pixel without a Develop session.
 *   An unedited RAW whose embedded preview is at least `FOCUS_SHARE` of the
 *   sensor's size: that preview, whole. Any other unedited photo: its own
 *   pixels, whole. Otherwise (an edited photo, a RAW with a small preview)
 *   the part in view is rendered at 1:1 by the engine, once per view.
 * - The previews folder is a cache with a cap (Settings › Projects &
 *   interface › Storage, `DEFAULT_PREVIEW_CAP`): past it the least recently
 *   shown go first.
 */
import type { SourceInfo } from './engine-types'

/** The screen preview's long side, pixels. */
export const PREVIEW_EDGE = 2560

/** An embedded preview at least this share of the sensor's long side serves as 1:1. */
export const FOCUS_SHARE = 2 / 3

/** The previews folder's cap until one is chosen. */
export const DEFAULT_PREVIEW_CAP = 2 * 1024 ** 3

/** The caps Settings offers, bytes. */
export const PREVIEW_CAPS = [1, 2, 5, 10, 20].map((gb) => gb * 1024 ** 3)

/** How a photo's 1:1 is made (see the module's comment). */
export type FocusPlan = 'embedded' | 'whole' | 'region'

export function focusPlan(
  info: Pick<SourceInfo, 'width' | 'height' | 'raw_previews'>,
  raw: boolean,
  edited: boolean
): FocusPlan {
  if (edited) return 'region'
  if (!raw) return 'whole'
  const sensor = Math.max(info.width, info.height)
  // The one `raw: 'EmbeddedPreview'` makes: the first it can decode.
  const p = info.raw_previews?.find((x) => x.decodable)
  const long = p ? Math.max(p.width, p.height) : 0
  return sensor > 0 && long >= sensor * FOCUS_SHARE ? 'embedded' : 'region'
}

/** A cached preview: its size and when it was last shown (ms). */
export interface CachedPreview {
  name: string
  bytes: number
  used: number
}

/**
 * Which previews go so the folder holds no more than `cap` bytes: the least
 * recently shown first, never one named in `keep` (being shown now).
 */
export function evictions(
  files: readonly CachedPreview[],
  cap: number,
  keep: ReadonlySet<string> = new Set()
): string[] {
  let total = files.reduce((n, f) => n + f.bytes, 0)
  if (total <= cap) return []
  const out: string[] = []
  for (const f of [...files].sort((a, b) => a.used - b.used)) {
    if (total <= cap) break
    if (keep.has(f.name)) continue
    out.push(f.name)
    total -= f.bytes
  }
  return out
}

/**
 * A region of a `width × height` picture, asked for as fractions, in its
 * pixels: inside the picture, at least a pixel each way.
 */
export function regionPixels(
  r: { x: number; y: number; width: number; height: number },
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(width - 1, Math.floor(r.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(r.y * height)))
  return {
    x,
    y,
    width: Math.max(1, Math.min(width - x, Math.ceil(r.width * width))),
    height: Math.max(1, Math.min(height - y, Math.ceil(r.height * height)))
  }
}

/**
 * The size a Loupe or Compare pane zooms by: its 1:1's, else the last 1:1
 * it showed (the next shot of a burst is the same size), else its screen
 * preview's. None for a photo with no larger picture (offline, unreadable):
 * its thumbnail stays fitted and Z does nothing.
 */
export function zoomSize<T extends { width: number; height: number }>(
  previewable: boolean,
  ...sizes: (T | null | undefined)[]
): T | null {
  if (!previewable) return null
  return sizes.find((s): s is T => !!s) ?? null
}
