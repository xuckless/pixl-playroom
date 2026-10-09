import { Icon } from '../../components/icons'
import { useTargets } from '../../state/library'
import { useUi } from '../../state/ui'
import { MetadataEditor } from './MetadataEditor'
import { withKey } from '../../lib/commands'
import { t } from '../../lib/i18n'

/** The library's right-hand drawer: the selection's details and metadata (I). */
export function InfoDrawer(): React.JSX.Element {
  const open = useUi((s) => s.libraryInfo)
  const setOpen = useUi((s) => s.setLibraryInfo)
  const targets = useTargets()
  return (
    <aside className={`lib-info${open ? ' open' : ''}`} aria-label={t('Info')} inert={!open}>
      <div className="lib-info-inner">
        <header className="rail-head">
          <span className="micro">{t('Info')}</span>
          <button
            className="icon"
            title={withKey(t('Close'), 'library.info')}
            aria-label={t('Close info')}
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="lib-info-body">{open && <MetadataEditor keys={targets} />}</div>
      </div>
    </aside>
  )
}
