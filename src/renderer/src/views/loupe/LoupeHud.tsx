import { useEffect, useState } from 'react'
import { estimate } from '../../../../shared/ai'
import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { Spinner } from '../../fx'
import { useDevelop } from '../../state/develop'
import { t, tk } from '../../lib/i18n'
import { useHudNote } from './hudNote'
import { useMastering, usePixlDemosaic } from './mastering'
import type { PixlDemosaicState } from '../../../../shared/ipc'

const PIXL_HINT: Record<PixlDemosaicState, string> = {
  developing: tk('PIXL demosaic: developing this RAW at full size'),
  on: tk(
    'PIXL demosaic: this RAW is developed by PIXL’s own model, zoomed out, at 1:1 and in the export'
  ),
  refused: tk(
    'PIXL demosaic: the engine refused it for this RAW, so it is shown with the released develop'
  )
}

/** The PIXL demosaic's state for the open RAW (a development kit's): a dot and its name. */
function PixlChip({ state }: { state: PixlDemosaicState }): React.JSX.Element {
  return (
    <span className={`hud-item pixl-chip ${state}`} title={t(PIXL_HINT[state])}>
      <i className="pixl-dot" aria-hidden />
      {t('PIXL demosaic')}
    </span>
  )
}

/** A RAW's full-size develop under way: how far by the clock (it takes seconds, and says nothing). */
function Developing({
  since,
  expectedMs
}: {
  since: number
  expectedMs: number
}): React.JSX.Element {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const tick = (): void => setProgress(estimate(Date.now() - since, expectedMs))
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [since, expectedMs])
  return (
    <span className="hud-item">
      <span className="activity-track hud-track" aria-hidden>
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </span>
      {t('Developing RAW')}
    </span>
  )
}

/**
 * What the engine is doing, and how far the loupe is zoomed, in a glass
 * badge at the corner of the loupe. It is the only part of the loupe that
 * follows the render state, so a render starting or ending repaints this
 * badge and nothing under the pointer.
 */
export function LoupeHud({ scale }: { scale: number | null }): React.JSX.Element | null {
  const rendering = useDevelop((s) => s.rendering)
  const compare = useDevelop((s) => s.compare)
  const error = useDevelop((s) => s.error)
  const straightened = useDevelop((s) => (s.recipe?.geometry.straighten ?? 0) !== 0)
  const { note, n } = useHudNote()
  const mastering = useMastering()
  const developing = useDevelop((s) => mastering.key !== null && s.session?.key === mastering.key)
  const key = useDevelop((s) => s.session?.key)
  const pixl = usePixlDemosaic((s) => (key ? s.states[key] : undefined))
  if (!rendering && compare !== 'before' && !error && scale === null && !note && !developing)
    return null
  return (
    <LiquidGlass className={`hud loupe-status${error ? ' bad' : ''}`} radius={2} bezel={8}>
      {scale !== null && (
        <span
          className="hud-item accent t-num"
          title={straightened ? t('Straightened: the zoom shows the preview, enlarged') : undefined}
        >
          {Math.round(scale * 100)}%{straightened ? ` · ${t('preview')}` : ''}
        </span>
      )}
      {rendering && (
        <span className="hud-item">
          <Spinner size={14} />
          {t('Rendering')}
        </span>
      )}
      {pixl && <PixlChip state={pixl} />}
      {developing && <Developing since={mastering.since} expectedMs={mastering.expectedMs} />}
      {compare === 'before' && <span className="hud-item accent">{t('Before')}</span>}
      {note && (
        <span key={n} className="hud-item accent hud-note">
          {note}
        </span>
      )}
      {error && <span className="hud-item error">{error}</span>}
    </LiquidGlass>
  )
}
