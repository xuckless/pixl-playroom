import { LiquidGlass } from '../../components/glass/LiquidGlass'
import { useDevelop } from '../../state/develop'

/**
 * What the engine is doing, in a glass badge at the corner of the loupe. It
 * is the only part of the loupe that follows the render state, so a render
 * starting or ending repaints this badge and nothing under the pointer.
 */
export function LoupeHud(): React.JSX.Element | null {
  const rendering = useDevelop((s) => s.rendering)
  const compare = useDevelop((s) => s.compare)
  const error = useDevelop((s) => s.error)
  if (!rendering && compare !== 'before' && !error) return null
  return (
    <LiquidGlass className={`hud loupe-status${error ? ' bad' : ''}`} radius={2} bezel={8}>
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
