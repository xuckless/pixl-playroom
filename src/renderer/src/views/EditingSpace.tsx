/**
 * A gain-map photo's editing space (Photo → Edit as SDR): the HDR picture
 * its map lifts it to, Playroom's default, or the SDR picture the file
 * stores. A setting of the photo's recipe (it undoes, and pastes with the
 * HDR group); lib/hdr.ts opens the photo again on the other picture.
 */
import { Modal } from '../components/ui'
import { editsInHdr } from '../../../shared/recipe'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { t, tk } from '../lib/i18n'

export function EditingSpaceDialog(): React.JSX.Element | null {
  const setDialog = useLibrary((s) => s.setDialog)
  const recipe = useDevelop((s) => s.recipe)
  const hasMap = useDevelop((s) => !!s.session?.info.gain_map)
  const edit = useDevelop((s) => s.edit)
  const commit = useDevelop((s) => s.commit)
  const close = (): void => setDialog(null)
  if (!recipe || !hasMap) return null

  const inHdr = editsInHdr(recipe, true)
  const switchTo = (space: 'base' | 'hdr'): void => {
    edit((r) => (r.gainMap = space))
    commit(space === 'hdr' ? tk('Edit as HDR') : tk('Edit as SDR'))
    close()
  }

  if (inHdr)
    return (
      <Modal
        title={t('Edit as SDR')}
        onClose={close}
        icon="info"
        footer={
          <>
            <button onClick={close}>{t('Cancel')}</button>
            <button className="primary" onClick={() => switchTo('base')}>
              {t('Edit as SDR')}
            </button>
          </>
        }
      >
        <p>
          {t(
            'This photo holds two pictures: an HDR one, with highlights brighter than white, and the SDR picture its file stores for screens without HDR. Playroom edits the HDR picture.'
          )}
        </p>
        <p>
          {t(
            'Editing in SDR works on the stored SDR picture instead. Its highlights stop at white, so Full HDR and Headroom have nothing above white to show. Your adjustments stay, and you can switch back here at any time.'
          )}
        </p>
        <p className="muted small">
          {t('AI tools (AI Denoise, AI Remove and Enhance) need the SDR editing space for now.')}
        </p>
      </Modal>
    )

  // In SDR because of pixel steps: made on the SDR picture, which an HDR photo cannot take.
  if (recipe.pixels.length > 0)
    return (
      <Modal
        title={t('Edit as HDR')}
        onClose={close}
        icon="info"
        footer={
          <button className="primary" onClick={close}>
            {t('Close')}
          </button>
        }
      >
        <p>
          {t(
            'This photo has AI edits (AI Denoise, Enhance, or baked heals and removals). They were made on the SDR picture, and an HDR photo can’t take them yet, so it stays in SDR.'
          )}
        </p>
        <p className="muted small">
          {t(
            'To edit it in HDR, remove those steps first, in History or the panel that made them.'
          )}
        </p>
      </Modal>
    )

  return (
    <Modal
      title={t('Edit as HDR')}
      onClose={close}
      icon="info"
      footer={
        <>
          <button onClick={close}>{t('Cancel')}</button>
          <button className="primary" onClick={() => switchTo('hdr')}>
            {t('Edit as HDR')}
          </button>
        </>
      }
    >
      <p>
        {t(
          'This photo is edited on the SDR picture its file stores. Editing in HDR works on the picture its gain map lifts it to, with highlights brighter than white that Full HDR shows and an HDR export keeps. Your adjustments stay.'
        )}
      </p>
    </Modal>
  )
}
