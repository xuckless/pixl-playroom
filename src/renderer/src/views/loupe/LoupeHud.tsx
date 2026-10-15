import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { Spinner } from '../../fx'
import { useDevelop } from '../../state/develop'
import { t, tk } from '../../lib/i18n'
import { useHudNote } from './hudNote'
import { isNamed } from '../../../../shared/versions'
import { stepLabel } from '../../lib/stepLabel'
import { duration } from '../modelCopy'
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

/**
 * A RAW's full-size develop under way: how far by the engine's own count
 * (the model's windows done), a sweep until it counts anything, and about
 * how long is left once a tenth is done ("about 4 seconds").
 */
function Developing({
  fill,
  left
}: {
  fill: number | null
  left: number | null
}): React.JSX.Element {
  const percent = fill === null ? null : Math.round(fill * 100)
  return (
    <span className="hud-item">
      <span
        className={`activity-track hud-track${percent === null ? ' sweep' : ''}`}
        role="progressbar"
        aria-label={t('Developing RAW')}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(percent !== null ? { 'aria-valuenow': percent } : {})}
      >
        <i style={percent === null ? undefined : { width: `${percent}%` }} />
      </span>
      {t('Developing RAW')}
      {left !== null && <span className="hud-sub t-num">{duration(left)}</span>}
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
  // Before/After against a Version (History's top): its name.
  const versus = useDevelop((s) => {
    const v = s.comparing ? s.snapshots.find((x) => x.id === s.comparing) : undefined
    return v ? (isNamed(v) ? v.name : stepLabel(v.name)) : null
  })
  const mastering = useMastering()
  const developing = useDevelop((s) => mastering.key !== null && s.session?.key === mastering.key)
  const key = useDevelop((s) => s.session?.key)
  const pixl = usePixlDemosaic((s) => (key ? s.states[key] : undefined))
  // Nothing to say: no badge (the PIXL chip and a compared version are things to say).
  const comparingVersion = compare !== 'off' && versus !== null
  if (
    !rendering &&
    compare !== 'before' &&
    !comparingVersion &&
    !error &&
    scale === null &&
    !note &&
    !developing &&
    !pixl
  )
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
      {developing && <Developing fill={mastering.fill} left={mastering.leftMs} />}
      {comparingVersion && (
        <span className="hud-item accent">{t('Comparing with {{name}}', { name: versus })}</span>
      )}
      {compare === 'before' && !versus && <span className="hud-item accent">{t('Before')}</span>}
      {note && (
        <span key={n} className="hud-item accent hud-note">
          {note}
        </span>
      )}
      {error && <span className="hud-item error">{error}</span>}
    </LiquidGlass>
  )
}
