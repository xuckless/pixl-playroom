/** Small non-component helpers shared by the views (kept apart for fast refresh). */
import type { MaskComponentSetting } from '../../../shared/recipe'
import { HSL_BANDS, HSL_BAND_CENTRES, newId, type HslBand } from '../../../shared/recipe'

/** The shortcut modifier as the platform writes it: ⌘ on a Mac, Ctrl+ elsewhere. */
export const MOD =
  typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'

export const LABEL_COLOURS: Record<string, string> = {
  red: '#d9534f',
  yellow: '#e8c547',
  green: '#5cb85c',
  blue: '#4a8fd9',
  purple: '#9b6bd1'
}

/** The HSL band a hue belongs to (nearest centre, around the circle). */
export function bandOfHue(h: number): HslBand {
  let best: HslBand = 'red'
  let bestD = 999
  for (const b of HSL_BANDS) {
    const d = Math.abs(((h - HSL_BAND_CENTRES[b] + 540) % 360) - 180)
    if (d < bestD) {
      bestD = d
      best = b
    }
  }
  return best
}

/** A new colour- or luminance-range mask component with sensible bands. */
export function emptyRange(kind: 'color' | 'luminance'): MaskComponentSetting {
  return {
    id: newId(),
    kind: 'range',
    mode: 'Add',
    opacity: 100,
    invert: false,
    feather: 5,
    hue: kind === 'color' ? { centre: 210, width: 40, softness: 25 } : null,
    saturation: kind === 'color' ? { centre: 0.6, width: 0.8, softness: 0.2 } : null,
    luma: kind === 'luminance' ? { centre: 0.5, width: 0.4, softness: 0.15 } : null,
    smoothness: 0
  }
}

/**
 * A sampled colour (0…1 channels, Display P3 encoded, as the loupe shows it)
 * as the engine's keys see it: HSV hue in degrees, HSV saturation, and luma.
 */
export function hsvOf(
  r: number,
  g: number,
  b: number
): { hue: number; saturation: number; luma: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  let hue = 0
  if (chroma > 0) {
    if (max === r) hue = 60 * (((g - b) / chroma + 6) % 6)
    else if (max === g) hue = 60 * ((b - r) / chroma + 2)
    else hue = 60 * ((r - g) / chroma + 4)
  }
  const saturation = max > 0 ? chroma / max : 0
  const luma = 0.2289 * r + 0.6917 * g + 0.0793 * b // Display P3 luminance weights
  return { hue, saturation, luma }
}
