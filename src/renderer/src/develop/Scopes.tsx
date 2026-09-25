import { newLocalLayer } from '../../../shared/recipe'
import { Histogram, HueChart } from '../components/charts'
import { emptyRange } from '../lib/helpers'
import { useDevelop } from '../state/develop'
import { selectPanel } from './tools'

/**
 * The scopes, pinned above the thumb-wheel: the histogram, and the
 * colour-concentration chart whose bars lead to the HSL band (click) or to
 * a new colour-range mask (Shift-click).
 */
export function Scopes(): React.JSX.Element {
  const stats = useDevelop((s) => s.stats)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  const clipping = useDevelop((s) => s.clipping)
  const setClipping = useDevelop((s) => s.setClipping)
  const setHslFocus = useDevelop((s) => s.setHslFocus)
  const setHslTab = useDevelop((s) => s.setHslTab)
  return (
    <div className="scopes">
      <Histogram stats={stats} clipping={clipping} onClipping={setClipping} />
      <HueChart
        stats={stats}
        before={before?.stats ?? null}
        masked={layerId ? (mask?.maskStats ?? null) : null}
        onPick={(hue, band, newMask) => {
          if (newMask) {
            const d = useDevelop.getState()
            if (!d.recipe) return
            const comp = emptyRange('color')
            if (comp.kind === 'range')
              comp.hue = { centre: Math.round(hue), width: 20, softness: 15 }
            const layer = newLocalLayer(`${band} range`)
            layer.components.push(comp)
            d.replace(
              { ...d.recipe, layers: [...d.recipe.layers, layer] },
              `Colour mask at ${Math.round(hue)}°`
            )
            d.setLayer(layer.id)
            selectPanel('masks')
          } else {
            setHslFocus(band)
            setHslTab('all')
            selectPanel('hsl')
          }
        }}
      />
    </div>
  )
}
