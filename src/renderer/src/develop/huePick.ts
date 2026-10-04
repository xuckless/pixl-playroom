import { newLocalLayer, type HslBand } from '../../../shared/recipe'
import { emptyRange } from '../lib/helpers'
import { useDevelop } from '../state/develop'
import { jumpToCard, openMasks } from './tools'

/**
 * A click on a hue in the colour chart: its HSL band in the Colour mixer, or
 * (Shift) a new colour-range mask centred on it. Shared with the expanded view.
 */
export function pickHue(hue: number, band: HslBand, newMask: boolean): void {
  const d = useDevelop.getState()
  if (newMask) {
    if (!d.recipe) return
    const comp = emptyRange('color')
    if (comp.kind === 'range') comp.hue = { centre: Math.round(hue), width: 20, softness: 15 }
    const layer = newLocalLayer(`${band} range`)
    layer.components.push(comp)
    d.replace(
      { ...d.recipe, layers: [...d.recipe.layers, layer] },
      `Colour mask at ${Math.round(hue)}°`
    )
    d.setLayer(layer.id)
    openMasks()
  } else {
    d.setHslFocus(band)
    d.setHslTab('all')
    jumpToCard('mixer')
  }
}
