import { Histogram, HueChart } from '../components/charts'
import { useDevelop } from '../state/develop'
import { useScopesView } from '../state/scopesView'
import { pickHue } from './huePick'

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
