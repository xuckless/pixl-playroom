/**
 * One scope, whichever it is: the engine's histogram and hue chart, the
 * waveform, parade and vectorscope binned from the picture, the CIE chart,
 * or (expanded only) the metrics. The right column shows one at a time; the
 * expanded viewer one per place.
 */
import { useState } from 'react'
import { Histogram, HueChart } from '../../components/charts'
import { VISION_LABEL, type VisionKind } from '../../../../shared/scopemetrics'
import { readable } from '../../lib/frames'
import { t } from '../../lib/i18n'
import { useScopeBins } from '../../lib/scopes/live'
import { useDevelop } from '../../state/develop'
import { useUi } from '../../state/ui'
import { useLibrary } from '../../state/library'
import type { ExpandedScope, ScopeKind } from '../../../../shared/scopes'
import { BigHistogram } from './BigHistogram'
import { CieChart } from './CieChart'
import { MetricsPanel } from './MetricsPanel'
import { ParadeScope, VectorScope, WaveformScope } from './BinnedScopes'
import { pickHue } from '../huePick'

const BINNED: Partial<Record<ExpandedScope, ScopeKind>> = {
  parade: 'parade',
  waveform: 'waveform',
  vectorscope: 'vectorscope',
  cie: 'cie'
}

/** A scope's own options (the waveform's channels, the vectorscope's zoom and skin line). */
export function ScopeOptions({ kind }: { kind: ExpandedScope }): React.JSX.Element | null {
  const prefs = useUi((s) => s.scopes)
  const set = useUi((s) => s.setScopes)
  if (kind === 'waveform')
    return (
      <div className="seg sm" role="group" aria-label={t('Waveform')}>
        <button
          className={prefs.waveform === 'luma' ? 'on' : ''}
          onClick={() => set({ waveform: 'luma' })}
        >
          Y
        </button>
        <button
          className={prefs.waveform === 'rgb' ? 'on' : ''}
          onClick={() => set({ waveform: 'rgb' })}
        >
          RGB
        </button>
      </div>
    )
  if (kind === 'vectorscope')
    return (
      <>
        <div className="seg sm" role="group" aria-label={t('Zoom')}>
          <button
            className={prefs.vectorZoom === 1 ? 'on' : ''}
            onClick={() => set({ vectorZoom: 1 })}
          >
            1×
          </button>
          <button
            className={prefs.vectorZoom === 2 ? 'on' : ''}
            onClick={() => set({ vectorZoom: 2 })}
          >
            2×
          </button>
        </div>
        <button
          className={`chip sm${prefs.skinLine ? ' on' : ''}`}
          aria-pressed={prefs.skinLine}
          title={t('The skin tone line')}
          onClick={() => set({ skinLine: !prefs.skinLine })}
        >
          {t('Skin')}
        </button>
      </>
    )
  return null
}

export function ScopeView({
  kind,
  expanded = false
}: {
  kind: ExpandedScope
  expanded?: boolean
}): React.JSX.Element {
  const stats = useDevelop((s) => s.stats)
  const hdrStats = useDevelop((s) => s.hdrStats)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  const clipping = useDevelop((s) => s.clipping)
  const setClipping = useDevelop((s) => s.setClipping)
  const picture = useDevelop((s) => s.picture)
  const prefs = useUi((s) => s.scopes)
  const binned = BINNED[kind]
  const bins = useScopeBins(binned ? [binned] : [])
  switch (kind) {
    case 'histogram':
      return expanded ? (
        <BigHistogram
          stats={stats}
          hdr={hdrStats}
          before={before?.stats ?? null}
          clipping={clipping}
          onClipping={setClipping}
        />
      ) : (
        <Histogram stats={stats} hdr={hdrStats} clipping={clipping} onClipping={setClipping} />
      )
    case 'hue':
      return expanded ? (
        <ColoursExpanded />
      ) : (
        <HueChart
          stats={stats}
          before={before?.stats ?? null}
          masked={layerId ? (mask?.maskStats ?? null) : null}
          onPick={pickHue}
        />
      )
    case 'waveform':
      return <WaveformScope bins={bins} mode={prefs.waveform} />
    case 'parade':
      return <ParadeScope bins={bins} />
    case 'vectorscope':
      return <VectorScope bins={bins} zoom={prefs.vectorZoom} skinLine={prefs.skinLine} />
    case 'cie':
      return <CieChart density={bins} compact={!expanded} />
    case 'metrics':
      return (
        <MetricsPanel
          stats={stats}
          hdr={hdrStats}
          before={before?.stats ?? null}
          pictureUrl={picture ? readable(picture) : null}
        />
      )
  }
}

/** The colour chart at full size, with how it looks to each kind of colour vision. */
function ColoursExpanded(): React.JSX.Element {
  const [vision, setVision] = useState<VisionKind | null>(null)
  const stats = useDevelop((s) => s.stats)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  return (
    <div className="se-colours">
      <div className="seg sm" role="group" aria-label={t('How the colours look to')}>
        <button className={vision === null ? 'on' : ''} onClick={() => setVision(null)}>
          {t('Normal')}
        </button>
        {(['protan', 'deutan', 'tritan'] as VisionKind[]).map((k) => (
          <button
            key={k}
            className={vision === k ? 'on' : ''}
            onClick={() => setVision(k)}
            title={t(VISION_LABEL[k])}
          >
            {k === 'protan' ? t('Protan') : k === 'deutan' ? t('Deutan') : t('Tritan')}
          </button>
        ))}
      </div>
      <HueChart
        stats={stats}
        before={before?.stats ?? null}
        masked={layerId ? (mask?.maskStats ?? null) : null}
        vision={vision}
        onPick={(hue, band, newMask) => {
          // The mixer or the new mask is behind the scopes: they step aside.
          useLibrary.getState().setDialog(null)
          pickHue(hue, band, newMask)
        }}
      />
      <p className="muted small">
        {t(
          'Click a bar to open that colour in the Colour mixer; Shift-click makes a mask of it. The faint bars are the photo before your edits.'
        )}
      </p>
    </div>
  )
}
