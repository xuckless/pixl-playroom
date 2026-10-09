/**
 * The scopes at full size, in a window like the preset browser's: the
 * histogram with every channel (overlay, parade, one at a time), the colour
 * chart, the CIE 1976 chromaticity chart, and the metrics (tone, colour,
 * colour vision, palette). Opened from the corner of either scope in the
 * panel; the tab is the one it was opened from.
 */
import { useState } from 'react'
import { readable } from '../lib/frames'
import { t, tk } from '../lib/i18n'
import { Modal, Tabs } from '../components/ui'
import { HueChart } from '../components/charts'
import { VISION_LABEL, type VisionKind } from '../../../shared/scopemetrics'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { useScopesView, type ScopesTab } from '../state/scopesView'
import { BigHistogram } from './scopes/BigHistogram'
import { CieChart } from './scopes/CieChart'
import { MetricsPanel } from './scopes/MetricsPanel'
import { pickHue } from './huePick'

const TABS: { value: ScopesTab; label: string }[] = [
  { value: 'histogram', label: tk('Histogram') },
  { value: 'colours', label: tk('Colours') },
  { value: 'cie', label: 'CIE 1976' },
  { value: 'metrics', label: tk('Metrics') }
]

export function ScopesExpandedDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const opened = useScopesView((s) => s.tab)
  const [tab, setTab] = useState<ScopesTab>(opened)
  const [vision, setVision] = useState<VisionKind | null>(null)
  const stats = useDevelop((s) => s.stats)
  const hdrStats = useDevelop((s) => s.hdrStats)
  const before = useDevelop((s) => s.before)
  const mask = useDevelop((s) => s.mask)
  const layerId = useDevelop((s) => s.layerId)
  const clipping = useDevelop((s) => s.clipping)
  const setClipping = useDevelop((s) => s.setClipping)
  const picture = useDevelop((s) => s.picture)
  const close = (): void => setDialog(null)

  return (
    <Modal
      title={t('Scopes')}
      onClose={close}
      icon="info"
      className="scopes-expanded"
      footer={
        <button className="primary" autoFocus onClick={close}>
          {t('Done')}
        </button>
      }
    >
      <div className="se-tabs">
        <Tabs value={tab} tabs={TABS.map((x) => ({ ...x, label: t(x.label) }))} onChange={setTab} />
      </div>
      {tab === 'histogram' && (
        <BigHistogram
          stats={stats}
          hdr={hdrStats}
          before={before?.stats ?? null}
          clipping={clipping}
          onClipping={setClipping}
        />
      )}
      {tab === 'colours' && (
        <div className="se-colours">
          <div className="seg" role="group" aria-label={t('How the colours look to')}>
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
              close()
              pickHue(hue, band, newMask)
            }}
          />
          <p className="muted small">
            {t(
              'Click a bar to open that colour in the Colour mixer; Shift-click makes a mask of it. The faint bars are the photo before your edits.'
            )}
          </p>
        </div>
      )}
      {tab === 'cie' && <CieChart />}
      {tab === 'metrics' && (
        <MetricsPanel
          stats={stats}
          hdr={hdrStats}
          before={before?.stats ?? null}
          pictureUrl={picture ? readable(picture) : null}
        />
      )}
    </Modal>
  )
}
