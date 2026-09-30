/**
 * The export watermark: a PNG (a logo, a signature, a rendered caption)
 * composited onto every exported picture by the engine's `overlays`, after
 * the crop and the resize, so it is sharp at any size and never graded.
 *
 * Placement is Playroom's arithmetic: an anchor (a corner, an edge's middle
 * or the centre), an inset from the edges and a size, both as percentages
 * of the output's shorter edge — so a portrait and a landscape export carry
 * the same mark — turned here into the engine's rectangle, in fractions of
 * the output. The height follows the picture's own aspect, as the engine
 * computes it.
 */
import type { Blend, BlendMode, GradeSpace, Overlay } from './engine-types'

export type WatermarkAnchor = 'tl' | 't' | 'tr' | 'l' | 'c' | 'r' | 'bl' | 'b' | 'br'

export const WATERMARK_ANCHORS: WatermarkAnchor[] = [
  'tl',
  't',
  'tr',
  'l',
  'c',
  'r',
  'bl',
  'b',
  'br'
]

export type WatermarkBlend = Extract<BlendMode, 'Normal' | 'Multiply' | 'Screen'>

export interface WatermarkSettings {
  enabled: boolean
  /** The PNG; null until one is chosen. */
  path: string | null
  anchor: WatermarkAnchor
  /** From the nearest edges, % of the output's shorter edge. */
  inset: number
  /** The mark's width, % of the output's shorter edge. */
  size: number
  /** 0…100, over the picture's own transparency. */
  opacity: number
  blend: WatermarkBlend
}

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  path: null,
  anchor: 'br',
  inset: 3,
  size: 20,
  opacity: 80,
  blend: 'Normal'
}

/** A placed rectangle, in output pixels. */
export interface PlacedMark {
  x: number
  y: number
  width: number
  height: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * Where the mark lands on a `W × H` output for a `pw × ph` picture, in
 * whole pixels, as the engine will place it: the width is rounded first and
 * the height follows it. Never larger than the output (less a pixel each
 * side, so the engine's own rounding cannot push it off the edge).
 */
export function placeMark(
  s: Pick<WatermarkSettings, 'anchor' | 'inset' | 'size'>,
  W: number,
  H: number,
  pw: number,
  ph: number
): PlacedMark {
  const short = Math.min(W, H)
  const aspect = ph / pw
  // Wide enough to see, and within the output both ways.
  let w = Math.max(1, Math.round((clamp(s.size, 1, 100) / 100) * short))
  w = Math.min(w, W - 2, Math.floor((H - 2) / aspect))
  w = Math.max(1, w)
  const h = Math.max(1, Math.round((w * ph) / pw))
  const inset = Math.max(1, Math.round((clamp(s.inset, 0, 50) / 100) * short))
  const col = s.anchor.endsWith('l') ? 0 : s.anchor.endsWith('r') ? 2 : 1
  const row = s.anchor.startsWith('t') ? 0 : s.anchor.startsWith('b') ? 2 : 1
  const at = (n: 0 | 1 | 2 | number, total: number, size: number): number =>
    n === 0 ? inset : n === 2 ? total - inset - size : Math.round((total - size) / 2)
  return {
    x: clamp(at(col, W, w), 1, Math.max(1, W - w - 1)),
    y: clamp(at(row, H, h), 1, Math.max(1, H - h - 1)),
    width: w,
    height: h
  }
}

/**
 * Where the blend is computed: the display-referred sRGB encoding an SDR
 * file holds (as an image editor composites a logo), or on an HDR output the
 * PQ signal, where the engine allows the display-range modes above white.
 */
function blendSpace(hdr: boolean): GradeSpace {
  return {
    Encoded: {
      space: hdr ? 'Rec2100Pq' : 'Srgb',
      intent: 'RelativeColorimetric',
      black_point_compensation: false
    }
  }
}

/** The engine's overlay for a mark placed on a `W × H` output. */
export function watermarkOverlay(
  s: WatermarkSettings,
  path: string,
  W: number,
  H: number,
  pw: number,
  ph: number,
  hdr: boolean
): Overlay {
  const m = placeMark(s, W, H, pw, ph)
  const blend: Blend = { mode: s.blend, space: blendSpace(hdr) }
  return {
    source: { Png: path },
    rect: { x: m.x / W, y: m.y / H, width: m.width / W },
    opacity: clamp(s.opacity / 100, 0, 1),
    blend,
    resampler: 'Lanczos3'
  }
}

/** A PNG's size from its header, or null when the bytes are not a PNG. */
export function pngSize(head: Uint8Array): { width: number; height: number } | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return null
  const u32 = (o: number): number =>
    ((head[o] << 24) | (head[o + 1] << 16) | (head[o + 2] << 8) | head[o + 3]) >>> 0
  const width = u32(16)
  const height = u32(20)
  return width > 0 && height > 0 ? { width, height } : null
}
