import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { useDevelop } from '../../state/develop'

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
  if (!rendering && compare !== 'before' && !error && scale === null) return null
  return (
    <LiquidGlass className={`hud loupe-status${error ? ' bad' : ''}`} radius={2} bezel={8}>
      {scale !== null && (
        <span
          className="hud-item accent t-num"
          title={straightened ? 'Straightened: the zoom shows the preview, enlarged' : undefined}
        >
          {Math.round(scale * 100)}%{straightened ? ' · preview' : ''}
        </span>
      )}
      {rendering && (
        <span className="hud-item">
          <i className="hud-dot busy" />
          Rendering
        </span>
      )}
      {compare === 'before' && <span className="hud-item accent">Before</span>}
      {error && <span className="hud-item error">{error}</span>}
    </LiquidGlass>
  )
}
