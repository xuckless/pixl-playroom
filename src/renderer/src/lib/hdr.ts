/**
 * A gain-map photo is graded on the HDR rendition its map lifts it to, or on
 * its SDR base (Photo → Edit as SDR, or pixel steps: shared/recipe
 * `editsInHdr`), and the develop session is opened on one or the other.
 * Whatever changes it — the dialog, an undo, a paste — the photo is opened
 * again on the other.
 */
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { t } from './i18n'
import { editsInHdr } from '../../../shared/recipe'

export function startHdrUpkeep(): () => void {
  let busy = false
  /** The last photo and choice reopened for: not tried again if it did not take. */
  let tried = ''
  return useDevelop.subscribe((s) => {
    const { session, recipe } = s
    if (busy || !session || !recipe || !session.info.gain_map) return
    const want = editsInHdr(recipe, true)
    if (want === session.isHdr) {
      tried = ''
      return
    }
    const attempt = `${session.key}:${want}`
    if (tried === attempt) return
    tried = attempt
    busy = true
    // After the edit that asked for it has reached the session.
    setTimeout(() => {
      void useDevelop
        .getState()
        .reopen()
        .then(() => {
          const now = useDevelop.getState()
          if (now.session && now.recipe && editsInHdr(now.recipe, true) !== now.session.isHdr)
            useLibrary.getState().say(t('The HDR rendition could not be opened'), 'error')
        })
        .finally(() => {
          busy = false
        })
    }, 60)
  })
}
