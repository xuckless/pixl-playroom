/**
 * The loupe's own mask: what the engine will make of a local layer's mask,
 * worked out on the GPU from the recipe so the overlay follows a handle, a
 * slider or a lasso at once, and the engine's plane replaces it when it
 * lands. This is the model the shaders follow (views/loupe/maskgl), kept
 * here in plain numbers so it can be tested and calibrated against the
 * engine's own planes.
 */
import type { KeyBand, MaskMode } from './engine-types'
import type { LocalLayer, MaskComponentSetting, RangeComponent } from './recipe'

/**
 * How components join, as the engine combines them (measured against its
 * planes: two components at 0.6 and 0.7 add to 0.88, 0.6 less 0.5 is 0.3,
 * 0.6 with 0.5 is 0.3). Add is a screen (a union that builds up), Subtract
 * takes the component's share away, Intersect keeps what both select.
 */
export function combine(prev: number, v: number, mode: MaskMode): number {
  switch (mode) {
    case 'Add':
      return prev + v - prev * v
    case 'Subtract':
      return prev * (1 - v)
    case 'Intersect':
      return prev * v
  }
}

/** A component's own value: its shape, inverted if asked, scaled by its opacity (0…1). */
export function componentValue(shape: number, invert: boolean, opacity: number): number {
  return (invert ? 1 - shape : shape) * opacity
}

/**
 * A key band's weight at `x`: full within half the width of the centre,
 * easing to nothing across the softness beyond. Hue wraps at 360.
 */
export function bandWeight(b: KeyBand, x: number, period = 0): number {
  let d = Math.abs(x - b.centre)
  if (period > 0) d = Math.min(d % period, period - (d % period))
  const inner = b.width / 2
  if (d <= inner) return 1
  if (b.softness <= 0) return 0
  const t = Math.min(1, (d - inner) / b.softness)
  return 1 - t * t * (3 - 2 * t)
}

/** HSV hue (degrees), HSV saturation and Display P3 luma of an encoded colour (0…1). */
export function keyValues(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  let hue = 0
  if (chroma > 0) {
    if (max === r) hue = 60 * (((g - b) / chroma + 6) % 6)
    else if (max === g) hue = 60 * ((b - r) / chroma + 2)
    else hue = 60 * ((r - g) / chroma + 4)
  }
  return [hue, max > 0 ? chroma / max : 0, 0.2289 * r + 0.6917 * g + 0.0793 * b]
}

/** A range component's key at a colour: every band it has, multiplied. */
export function rangeWeight(c: RangeComponent, rgb: [number, number, number]): number {
  const [h, s, l] = keyValues(rgb[0], rgb[1], rgb[2])
  let w = 1
  if (c.hue) w *= bandWeight(c.hue, h, 360)
  if (c.saturation) w *= bandWeight(c.saturation, s)
  if (c.luma) w *= bandWeight(c.luma, l)
  return w
}

/**
 * The Gaussian a feather radius (a fraction of the frame's shorter side)
 * becomes, in pixels of a plane whose shorter side is `shortPx`. Measured on
 * the engine's planes: a hard edge feathered by R spreads from 75% to 25%
 * over 1.35 × 1.08 R, with the tails of a Gaussian.
 */
export const FEATHER_SIGMA_PER_RADIUS = 1.08
export function featherSigmaPx(radius: number, shortPx: number): number {
  return radius * shortPx * FEATHER_SIGMA_PER_RADIUS
}

/** A component's feather as the engine gets it (see compile.ts `maskComponent`). */
export function featherRadius(c: MaskComponentSetting): number {
  const smooth =
    c.kind === 'range' ? (Math.min(100, Math.max(0, c.smoothness ?? 0)) / 100) * 0.01 : 0
  return Math.min(0.5, Math.max(0, (c.feather / 100) * 0.1 + smooth))
}

/** The most components the loupe composes itself; a mask with more waits for the engine. */
export const MAX_PREVIEW_COMPONENTS = 8

/** Whether the loupe can draw this mask itself. */
export function previewable(l: LocalLayer): boolean {
  const n = l.components.filter(drawable).length
  return n > 0 && n <= MAX_PREVIEW_COMPONENTS
}

/** Components the engine will draw (a lasso needs three points, a range a band). */
export function drawable(c: MaskComponentSetting): boolean {
  if (c.kind === 'polygon') return c.points.length >= 3
  if (c.kind === 'range') return Boolean(c.hue || c.saturation || c.luma)
  if (c.kind === 'brush') return Boolean(c.png || c.ref)
  return true
}

/**
 * What a component's own plane depends on (its shape and feather, not its
 * mode, opacity or inversion, which apply as it joins): a plane is redrawn
 * only when this changes.
 */
export function planeKey(c: MaskComponentSetting): string {
  if (c.kind === 'brush')
    return JSON.stringify([c.kind, c.ref ?? `${c.png.length}:${c.png.slice(-32)}`, c.feather])
  return JSON.stringify(c, (k, v) => (JOINING.has(k) ? undefined : v))
}
const JOINING = new Set(['id', 'name', 'mode', 'opacity', 'invert'])

/** The whole mask of a layer at one point, from its components' values there. */
export function layerValue(
  l: Pick<LocalLayer, 'components' | 'invert'>,
  valueOf: (c: MaskComponentSetting) => number
): number {
  let m = 0
  l.components.filter(drawable).forEach((c, i) => {
    const v = componentValue(valueOf(c), c.invert, Math.min(1, Math.max(0, c.opacity / 100)))
    m = combine(m, v, i === 0 ? 'Add' : c.mode)
  })
  return l.invert ? 1 - m : m
}
