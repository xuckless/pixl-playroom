/** Small non-component helpers shared by the views (kept apart for fast refresh). */
import type { MaskComponentSetting } from '../../../shared/recipe'
import { HSL_BANDS, HSL_BAND_CENTRES, newId, type HslBand } from '../../../shared/recipe'

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
