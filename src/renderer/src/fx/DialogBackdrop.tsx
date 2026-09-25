import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { Ambient } from './index'

/**
 * What a dialog floats over: the photo being developed, blurred and dimmed,
 * over the ambient gradient — so the glass has something to bend.
 */
export function DialogBackdrop(): React.JSX.Element {
  const picture = useDevelop((s) => s.picture?.url ?? null)
  const inDevelop = useLibrary((s) => s.view === 'develop')
  return (
    <div className="dialog-backdrop" aria-hidden>
      <Ambient intensity={0.55} />
      {inDevelop && picture && <img className="backdrop-photo" src={picture} alt="" />}
      <div className="scrim" />
    </div>
  )
}
