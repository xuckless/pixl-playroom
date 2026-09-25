import { useDevelop } from '../../state/develop'

/**
 * What the engine is doing, in a corner of the loupe. It is the only part of
 * the loupe that follows the render state, so a render starting or ending
 * repaints this badge and nothing under the pointer.
 */
export function LoupeHud(): React.JSX.Element {
  const rendering = useDevelop((s) => s.rendering)
  const compare = useDevelop((s) => s.compare)
  const error = useDevelop((s) => s.error)
  return (
    <div className="loupe-status">
      {rendering ? '● rendering' : ''}
      {compare === 'before' ? ' · BEFORE' : ''}
      {error ? <span className="error"> {error}</span> : ''}
    </div>
  )
}
