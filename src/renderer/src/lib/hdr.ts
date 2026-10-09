/**
 * A gain-map photo is graded on its SDR base or on the HDR rendition its map
 * lifts it to (recipe `gainMap`), and the develop session is opened on one
 * or the other. Whatever changes the recipe's choice — the toolbar's
 * SDR | HDR, an undo, a paste — the photo is opened again on the other.
 */
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { t } from './i18n'

export function startHdrUpkeep(): () => void {
  let busy = false
  /** The last photo and choice reopened for: not tried again if it did not take. */
  let tried = ''
  return useDevelop.subscribe((s) => {
    const { session, recipe } = s
    if (busy || !session || !recipe || !session.info.gain_map) return
    const want = recipe.gainMap === 'hdr'
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
          if (now.session && (now.recipe?.gainMap === 'hdr') !== now.session.isHdr)
            useLibrary.getState().say(t('The HDR rendition could not be opened'), 'error')
        })
        .finally(() => {
          busy = false
        })
    }, 60)
  })
}
