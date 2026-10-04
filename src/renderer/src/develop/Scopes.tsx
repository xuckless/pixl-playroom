import { newLocalLayer, type HslBand } from '../../../shared/recipe'
import { Histogram, HueChart } from '../components/charts'
import { emptyRange } from '../lib/helpers'
import { useDevelop } from '../state/develop'
import { useScopesView } from '../state/scopesView'
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

/**
 * The scopes, pinned above the thumb-wheel: the histogram, and the
 * colour-concentration chart whose bars lead to the HSL band (click) or to
 * a new colour-range mask (Shift-click).
 */
export function Scopes(): React.JSX.Element {
  const stats = useDevelop((s) => s.stats)
  const hdrStats = useDevelop((s) => s.hdrStats)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  const clipping = useDevelop((s) => s.clipping)
  const setClipping = useDevelop((s) => s.setClipping)
  const open = useScopesView((v) => v.open)
  return (
    <div className="scopes">
      <Histogram
        stats={stats}
        hdr={hdrStats}
        clipping={clipping}
        onClipping={setClipping}
        onExpand={() => open('histogram')}
      />
      <HueChart
        stats={stats}
        before={before?.stats ?? null}
        masked={layerId ? (mask?.maskStats ?? null) : null}
        onPick={pickHue}
        onExpand={() => open('colours')}
      />
    </div>
  )
}
