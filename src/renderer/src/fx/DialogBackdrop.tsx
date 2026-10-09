import { useDevelop } from '../state/develop'
import { readable } from '../lib/frames'
import { Picture } from '../views/loupe/DecodedImage'
import { useLibrary } from '../state/library'
import { Ambient } from './index'

/**
 * What a dialog floats over: the photo being developed, blurred and dimmed,
 * over the ambient gradient, held still — what the dialog's frosted glass shows through.
 */
export function DialogBackdrop(): React.JSX.Element {
  // Blurred and dimmed behind a dialog: the SDR picture, never one glowing in HDR.
  const picture = useDevelop((s) => (s.picture ? readable(s.picture) : null))
  const inDevelop = useLibrary((s) => s.view === 'develop')
  return (
    <div className="dialog-backdrop" aria-hidden>
      {/* Still: a moving gradient would have the dialog's glass re-filter every frame. */}
      <Ambient intensity={0.55} still />
      {inDevelop && picture && <Picture className="backdrop-photo" src={picture} />}
      <div className="scrim" />
    </div>
  )
}
