import { chartBounds } from './cie'
import type { ScopeReport, ScopeSpec } from './engine-types'

/**
 * Scope maths shared by the renderer's charts and the tests.
 *
 * An HDR measurement comes back as linear-light bins over `0…range_max`
 * (1.0 is reference white). Drawn as is, everything below mid grey crowds
 * into the first few percent of the axis; drawn in stops, shadows, midtones
 * and the headroom above white each get room.
 */

/** The darkest stop the HDR histogram shows, relative to reference white. */
export const HDR_FLOOR_STOPS = -8

/** Where `v` (linear, 1.0 = reference white) sits on a stops axis, 0…1. */
export function stopsX(v: number, rangeMax: number, floor = HDR_FLOOR_STOPS): number {
  const top = Math.log2(Math.max(rangeMax, 1))
  if (v <= 0 || top <= floor) return 0
  return Math.min(1, Math.max(0, (Math.log2(v) - floor) / (top - floor)))
}

/**
 * Re-bin linear counts over `0…rangeMax` onto `out` bins spaced in stops from
 * `floor` up to `log2(rangeMax)`. Each source bin's count is spread over the
 * display bins its range covers, so the total is kept; everything at or
 * below the floor lands in the first bin.
 */
export function stopsBins(
  counts: number[],
  rangeMax: number,
  out = 256,
  floor = HDR_FLOOR_STOPS
): number[] {
  const bins = new Array<number>(out).fill(0)
  const n = counts.length
  if (n === 0) return bins
  for (let i = 0; i < n; i++) {
    const c = counts[i]
    if (c === 0) continue
    const lo = stopsX((i / n) * rangeMax, rangeMax, floor) * out
    const hi = stopsX(((i + 1) / n) * rangeMax, rangeMax, floor) * out
    if (hi - lo < 1e-9) {
      bins[Math.min(out - 1, Math.floor(lo))] += c
      continue
    }
    // Spread evenly over [lo, hi), in proportion to the overlap with each bin.
    const per = c / (hi - lo)
    for (let b = Math.floor(lo); b < Math.min(out, Math.ceil(hi)); b++) {
      const overlap = Math.min(hi, b + 1) - Math.max(lo, b)
      if (overlap > 0) bins[b] += per * overlap
    }
  }
  return bins
}

/** The closed SVG path of a histogram's counts across `w × h`, scaled to `max` (log or linear). */
export function areaPath(
  counts: number[],
  w: number,
  h: number,
  max: number,
  log: boolean
): string {
  const n = counts.length
  if (n === 0) return ''
  const scale = (c: number): number => (log ? Math.log1p(c) / Math.log1p(max) : c / max)
  const pts = counts.map(
    (c, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - scale(c) * (h - 2)).toFixed(1)}`
  )
  return `M0,${h} L${pts.join(' L')} L${w},${h} Z`
}

// ── Resolve's scopes ────────────────────────────────────────────────────────
//
// The waveform, parade, vectorscope and the CIE chart's density are binned
// from the picture on screen while it moves (the worker in
// renderer/workers/scopes.worker.ts runs these): preview resolution, Display
// P3. Once an SDR picture settles, the engine measures the waveform, parade
// and vectorscope of the settled picture itself (E76, `engineBins` below)
// on the same grids, so the two agree and the settled scopes are exact.
// Both read luma and Cb/Cr through BT.709's weights, as the engine's
// histogram and vectorscope do (Resolve's convention on a Rec.709
// timeline). The histogram and the hue chart stay the engine's own
// measurements.

/** The scopes the right column and the expanded viewer cycle through. */
// The colour chart is Playroom's own highlight: next to the histogram, one
// click from the default (the owner, 2026-10-14), before Resolve's scopes.
export const SCOPE_KINDS = ['histogram', 'hue', 'parade', 'waveform', 'vectorscope', 'cie'] as const
export type ScopeKind = (typeof SCOPE_KINDS)[number]
/** The scopes binned here from pixels (the others are the engine's stats). */
export const BINNED_SCOPES: readonly ScopeKind[] = ['parade', 'waveform', 'vectorscope', 'cie']

/** The scope after (`+1`) or before (`-1`) `kind`, round the list. */
export function cycleScope(kind: ScopeKind, step: 1 | -1): ScopeKind {
  const i = SCOPE_KINDS.indexOf(kind)
  return SCOPE_KINDS[(i + step + SCOPE_KINDS.length) % SCOPE_KINDS.length]
}

/**
 * BT.709's luma weights, Kr, Kg, Kb: what the engine's luma histogram, its
 * waveform and its vectorscope (`matrix: 'Bt709'`) weigh encoded values by.
 * The values are Display P3's, so a primary sits a little off where a
 * Rec.709 picture's would: one convention for every scope, as Resolve's.
 */
export const LUMA_709 = [0.2126, 0.7152, 0.0722] as const

/** The sRGB transfer, sign kept (what an extended Display P3 value is encoded with). */
export function oetf(v: number): number {
  const a = Math.abs(v)
  const e = a <= 0.0031308 ? 12.92 * a : 1.055 * Math.pow(a, 1 / 2.4) - 0.055
  return v < 0 ? -e : e
}
export function eotf(e: number): number {
  const a = Math.abs(e)
  const v = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4)
  return e < 0 ? -v : v
}

/** Encoded luma, and the colour-difference pair a vectorscope plots (each −0.5…0.5). */
export function cbcr(r: number, g: number, b: number): { y: number; cb: number; cr: number } {
  const [kr, kg, kb] = LUMA_709
  const y = kr * r + kg * g + kb * b
  return { y, cb: (b - y) / (2 * (1 - kb)), cr: (r - y) / (2 * (1 - kr)) }
}

/** Display P3 (D65, linear) to XYZ. */
const P3_TO_XYZ = [
  [0.4865709, 0.2656677, 0.1982173],
  [0.2289746, 0.6917385, 0.0792869],
  [0, 0.0451134, 1.0439444]
] as const

/** A linear Display P3 colour's u′v′, or null where it is too dark to have one. */
export function uvOfLinear(r: number, g: number, b: number): { u: number; v: number } | null {
  const m = P3_TO_XYZ
  const X = m[0][0] * r + m[0][1] * g + m[0][2] * b
  const Y = m[1][0] * r + m[1][1] * g + m[1][2] * b
  const Z = m[2][0] * r + m[2][1] * g + m[2][2] * b
  const d = X + 15 * Y + 3 * Z
  if (Y < 0.002 || d <= 1e-9) return null
  return { u: (4 * X) / d, v: (9 * Y) / d }
}

/** The vectorscope's 75% targets (R, Yl, G, Cy, B, Mg) at their Cb/Cr. */
export function vectorTargets(): { name: string; cb: number; cr: number }[] {
  const c = (
    name: string,
    r: number,
    g: number,
    b: number
  ): { name: string; cb: number; cr: number } => {
    const { cb, cr } = cbcr(0.75 * r, 0.75 * g, 0.75 * b)
    return { name, cb, cr }
  }
  return [
    c('R', 1, 0, 0),
    c('Yl', 1, 1, 0),
    c('G', 0, 1, 0),
    c('Cy', 0, 1, 1),
    c('B', 0, 0, 1),
    c('Mg', 1, 0, 1)
  ]
}

/**
 * The skin-tone line's direction on the vectorscope (radians from +Cb, Cr
 * up): where a mid skin tone falls with these values and weights. (The 123°
 * of an analogue scope is U/V's scaling; skin of every depth falls within
 * a few degrees of this line here.)
 */
export const SKIN_LINE = ((): number => {
  const c = cbcr(0.78, 0.53, 0.33)
  return Math.atan2(c.cr, c.cb)
})()

/** Pixels a scope looks at: encoded Display P3 (1 = SDR white), RGBA rows. */
export interface ScopePixels {
  width: number
  height: number
  /** 0…255 bytes, or floats where 1 is white and above 1 is headroom. */
  data: Uint8ClampedArray | Float32Array
}

export interface ScopeOptions {
  /** Waveform and parade columns (at most the picture's width). */
  columns?: number
  /** Waveform and parade rows. */
  levels?: number
  /** Vectorscope bins a side. */
  vector?: number
  /** CIE density bins a side, over `chartBounds()`. */
  cie?: number
  /** At most this many pixels are read (an even stride across the picture). */
  budget?: number
  want?: readonly ScopeKind[]
  /**
   * A mask plane over the same pixels (RGBA, its first channel read): each
   * pixel counts by how much the mask holds it, a feathered edge in part
   * (the scopes "in mask", weighed as the engine's `weights` weigh them).
   */
  mask?: Uint8ClampedArray | null
}

/**
 * Counts behind the scopes, binned here from pixels or measured by the
 * engine (`engineBins`): each cell a sum of weights, whole pixels unless a
 * mask holds some in part.
 */
export interface ScopeBins {
  columns: number
  levels: number
  /** The encoded value at the waveform's top row: 1, or above it where the picture has headroom. */
  top: number
  /** columns × levels, row 0 is black. */
  waveform: Float32Array | null
  /** Red, green and blue waveforms, each columns × levels. */
  parade: Float32Array | null
  vectorSize: number
  /** vectorSize², x = Cb, y = Cr (row 0 is +0.5). */
  vector: Float32Array | null
  cieSize: number
  /** cieSize² over `chartBounds()`, row 0 at the top (high v′). */
  cie: Float32Array | null
  /** What was counted: pixels, or their weight in a mask. */
  pixels: number
  /** Measured by the engine on the settled picture (E76), not binned from the preview. */
  exact?: boolean
}

/** The waveform's top: 1, or the next half stop over the picture's brightest channel. */
export function waveformTop(maxEncoded: number): number {
  if (maxEncoded <= 1.0001) return 1
  return Math.min(4, Math.ceil(maxEncoded * 4) / 4)
}

/** `eotf` over 0…`top` in table steps: 256 for bytes, 1024 per unit for floats. */
function linearTable(top: number, bytes: boolean): Float32Array {
  const n = bytes ? 256 : Math.ceil(top * 1024) + 1
  const t = new Float32Array(n)
  for (let i = 0; i < n; i++) t[i] = eotf(bytes ? i / 255 : i / 1024)
  return t
}

/**
 * The bin `t` (0…1) falls in among `n`, the last closed at its top, or -1
 * outside: the engine's own rule (E76), so a settled scope and the drag's
 * bins put a value in the same cell.
 */
function cell(t: number, n: number): number {
  return t >= 0 && t <= 1 ? Math.min(n - 1, Math.floor(t * n)) : -1
}

export function binScopes(px: ScopePixels, o: ScopeOptions = {}): ScopeBins {
  const want = new Set(o.want ?? BINNED_SCOPES)
  const columns = Math.max(1, Math.min(o.columns ?? 512, px.width))
  const levels = o.levels ?? 256
  const vectorSize = o.vector ?? 256
  const cieSize = o.cie ?? 192
  const n = px.width * px.height
  const stride = Math.max(1, Math.ceil(Math.sqrt(n / (o.budget ?? 200_000))))
  const scale = px.data instanceof Uint8ClampedArray ? 1 / 255 : 1
  const d = px.data
  let top = 1
  if (scale === 1)
    for (let i = 0; i < d.length; i += 4 * stride) top = Math.max(top, d[i], d[i + 1], d[i + 2])
  top = waveformTop(top)
  const waveform = want.has('waveform') ? new Float32Array(columns * levels) : null
  const parade =
    want.has('parade') || want.has('waveform') ? new Float32Array(3 * columns * levels) : null
  const vector = want.has('vectorscope') ? new Float32Array(vectorSize * vectorSize) : null
  const cie = want.has('cie') ? new Float32Array(cieSize * cieSize) : null
  const B = chartBounds()
  const plane = columns * levels
  // Linear values for the CIE chart from a table: bytes exactly, floats in
  // 1/1024 steps up to the top (the chart's bins are far coarser).
  const lin = cie ? linearTable(scale === 1 ? top : 1, scale !== 1) : null
  const linStep = scale === 1 ? 1024 : 255
  const linear = (v: number): number => {
    if (v <= 0) return v < 0 ? eotf(v) : 0
    const k = Math.round(v * linStep)
    return k < lin!.length ? lin![k] : eotf(v)
  }
  // The engine's level: the value as a fraction of the top, the top closed.
  const row = (v: number): number =>
    v <= 0 ? 0 : v >= top ? levels - 1 : Math.min(levels - 1, Math.floor((v / top) * levels))
  const [kr, kg, kb] = LUMA_709
  let pixels = 0
  for (let y = 0; y < px.height; y += stride) {
    for (let x = 0; x < px.width; x += stride) {
      const i = (y * px.width + x) * 4
      const w = o.mask ? o.mask[i] / 255 : 1
      if (w === 0) continue
      const r = d[i] * scale
      const g = d[i + 1] * scale
      const b = d[i + 2] * scale
      pixels += w
      const col = Math.min(columns - 1, Math.floor((x * columns) / px.width))
      if (parade) {
        parade[row(r) * columns + col] += w
        parade[plane + row(g) * columns + col] += w
        parade[2 * plane + row(b) * columns + col] += w
      }
      if (waveform) waveform[row(kr * r + kg * g + kb * b) * columns + col] += w
      if (vector) {
        const c = cbcr(r, g, b)
        const vx = cell(c.cb + 0.5, vectorSize)
        const vy = cell(c.cr + 0.5, vectorSize)
        // Cr up: the engine counts its rows from the bottom, these from the top.
        if (vx >= 0 && vy >= 0) vector[(vectorSize - 1 - vy) * vectorSize + vx] += w
      }
      if (cie) {
        const uv = uvOfLinear(linear(r), linear(g), linear(b))
        if (uv) {
          const cx = Math.floor(((uv.u - B.u0) / (B.u1 - B.u0)) * cieSize)
          const cy = Math.floor((1 - (uv.v - B.v0) / (B.v1 - B.v0)) * cieSize)
          if (cx >= 0 && cx < cieSize && cy >= 0 && cy < cieSize) cie[cy * cieSize + cx] += w
        }
      }
    }
  }
  return {
    columns,
    levels,
    top,
    waveform,
    parade,
    vectorSize,
    vector,
    cieSize,
    cie,
    pixels
  }
}

// ── The settled picture's scopes, measured by the engine (E76) ───────────────

/** The binned scopes the engine measures exactly; the CIE chart (linear light) stays binned here. */
export const ENGINE_SCOPES: readonly ScopeKind[] = ['parade', 'waveform', 'vectorscope']
/** The engine's grids: as the preview's bins, a waveform panel's 512 columns at most. */
export const ENGINE_COLUMNS = 512
export const ENGINE_LEVELS = 256
export const ENGINE_VECTOR = 256

/**
 * What the engine is asked for to draw `want` from a picture `width` pixels
 * wide read at `stride`, or null when it draws none of them. The waveform
 * never has more columns than the frame sampled (the engine refuses one
 * that would leave a strip empty); the vectorscope is BT.709's over every
 * encoded colour (±0.5), as `binScopes` bins it.
 */
export function engineScopeSpec(
  want: readonly ScopeKind[],
  width: number,
  stride = 1
): ScopeSpec | null {
  const wave = want.includes('waveform') || want.includes('parade')
  const vector = want.includes('vectorscope')
  const across = Math.ceil(width / stride)
  if ((!wave && !vector) || across < 1) return null
  return {
    waveform: wave
      ? {
          columns: Math.min(ENGINE_COLUMNS, across),
          levels: ENGINE_LEVELS,
          planes: 'LumaAndChannels'
        }
      : null,
    vectorscope: vector ? { size: ENGINE_VECTOR, matrix: 'Bt709', extent: 0.5 } : null
  }
}

/**
 * The engine's scopes as the charts take them: its luma waveform and the
 * channels' as the parade (a grey picture's one channel in all three), and
 * its vectorscope with the rows turned over (the engine's row 0 is Cr's
 * bottom, the chart's its top). Float64 counts become Float32, half the
 * size over IPC and exact to 2²⁴ in a cell.
 */
export function engineBins(r: ScopeReport, pixels: number): ScopeBins {
  const w = r.waveform
  const v = r.vectorscope
  let parade: Float32Array | null = null
  if (w && w.channels.length > 0) {
    const plane = w.columns * w.levels
    parade = new Float32Array(3 * plane)
    for (let k = 0; k < 3; k++)
      parade.set(w.channels[Math.min(k, w.channels.length - 1)], k * plane)
  }
  let vector: Float32Array | null = null
  if (v) {
    const n = v.size
    vector = new Float32Array(n * n)
    for (let y = 0; y < n; y++) vector.set(v.counts.subarray((n - 1 - y) * n, (n - y) * n), y * n)
  }
  return {
    columns: w?.columns ?? 1,
    levels: w?.levels ?? 1,
    top: 1,
    waveform: w?.luma ? Float32Array.from(w.luma) : null,
    parade,
    vectorSize: v?.size ?? 1,
    vector,
    cieSize: 1,
    cie: null,
    pixels,
    exact: true
  }
}

/**
 * Counts painted as light: log density, so a few pixels still show and a
 * crowd does not burn out. Adds onto `out` (RGBA bytes, `w × h`), so several
 * channels can be laid over one another (an RGB waveform).
 */
export function paintDensity(
  out: Uint8ClampedArray,
  counts: ArrayLike<number>,
  w: number,
  h: number,
  colour: readonly [number, number, number],
  o: {
    /** Where in `counts` this plane starts (the parade's green is the second). */
    offset?: number
    gain?: number
    /** Row 0 of the counts at the bottom (a waveform's black), not the top. */
    flip?: boolean
  } = {}
): void {
  const offset = o.offset ?? 0
  const gain = o.gain ?? 1
  let max = 1
  for (let i = 0; i < w * h; i++) max = Math.max(max, counts[offset + i])
  // A little under the busiest bin, so the bulk of the picture reads bright.
  const ref = Math.log1p(Math.max(1, max * 0.6))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = counts[offset + (o.flip ? h - 1 - y : y) * w + x]
      if (c === 0) continue
      const k = Math.min(1, (0.25 + Math.log1p(c) / ref) * gain)
      const j = (y * w + x) * 4
      out[j] = Math.min(255, out[j] + colour[0] * k)
      out[j + 1] = Math.min(255, out[j + 1] + colour[1] * k)
      out[j + 2] = Math.min(255, out[j + 2] + colour[2] * k)
      out[j + 3] = 255
    }
}

// ── What the scopes show (the ui store, Settings) ───────────────────────────

/** The expanded viewer also has the metrics. */
export type ExpandedScope = ScopeKind | 'metrics'
export const EXPANDED_SCOPES: readonly ExpandedScope[] = [...SCOPE_KINDS, 'metrics']

export interface ScopePrefs {
  /** The one at the top of the right column. */
  inline: ScopeKind
  /** The expanded viewer: one, two or four at once. */
  layout: 1 | 2 | 4
  /** The expanded viewer's four places, in reading order. */
  slots: ExpandedScope[]
  /** The waveform as luma, or the three channels laid over one another. */
  waveform: 'luma' | 'rgb'
  /** The vectorscope at 1× or 2× (the middle of it, for skin and pastels). */
  vectorZoom: 1 | 2
  skinLine: boolean
  /** With a mask selected, the binned scopes read only what it holds. */
  inMask: boolean
}

export const DEFAULT_SCOPES: ScopePrefs = {
  inline: 'histogram',
  layout: 2,
  slots: ['parade', 'vectorscope', 'waveform', 'histogram'],
  waveform: 'luma',
  vectorZoom: 1,
  skinLine: true,
  inMask: false
}

/** Saved preferences made whole: what is missing or unknown takes its default. */
export function normaliseScopes(p: unknown): ScopePrefs {
  const o = (p && typeof p === 'object' ? p : {}) as Partial<Record<keyof ScopePrefs, unknown>>
  const kind = (v: unknown, d: ScopeKind): ScopeKind =>
    SCOPE_KINDS.includes(v as ScopeKind) ? (v as ScopeKind) : d
  const slot = (v: unknown, d: ExpandedScope): ExpandedScope =>
    EXPANDED_SCOPES.includes(v as ExpandedScope) ? (v as ExpandedScope) : d
  const slots = Array.isArray(o.slots) ? o.slots : []
  return {
    inline: kind(o.inline, DEFAULT_SCOPES.inline),
    layout: o.layout === 1 || o.layout === 2 || o.layout === 4 ? o.layout : DEFAULT_SCOPES.layout,
    slots: DEFAULT_SCOPES.slots.map((d, i) => slot(slots[i], d)),
    waveform: o.waveform === 'rgb' ? 'rgb' : 'luma',
    vectorZoom: o.vectorZoom === 2 ? 2 : 1,
    skinLine: o.skinLine !== false,
    inMask: o.inMask === true
  }
}

/** A slot's scope after or before its own, round the expanded viewer's list. */
export function cycleExpanded(kind: ExpandedScope, step: 1 | -1): ExpandedScope {
  const i = EXPANDED_SCOPES.indexOf(kind)
  return EXPANDED_SCOPES[(i + step + EXPANDED_SCOPES.length) % EXPANDED_SCOPES.length]
}
