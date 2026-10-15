import { Icon } from '../../components/icons'
import { Tabs } from '../../components/ui'
import { useTargets } from '../../state/library'
import { useUi, type LibraryTab } from '../../state/ui'
import { MetadataEditor } from './MetadataEditor'
import { QuickDevelop } from './QuickDevelop'
import { withKey } from '../../lib/commands'
import { t } from '../../lib/i18n'

/**
 * The library's right-hand drawer (I): the selection's details and
 * metadata, or Quick develop (⇧I) beside them. The tab shown last is kept.
 */
export function InfoDrawer(): React.JSX.Element {
  const open = useUi((s) => s.libraryInfo)
  const setOpen = useUi((s) => s.setLibraryInfo)
  const tab = useUi((s) => s.libraryTab)
  const setTab = useUi((s) => s.setLibraryTab)
  const targets = useTargets()
  return (
    <aside className={`lib-info${open ? ' open' : ''}`} aria-label={t('Info')} inert={!open}>
      <div className="lib-info-inner">
        <header className="rail-head">
          <Tabs<LibraryTab>
            className="lib-info-tabs"
            value={tab}
            tabs={[
              { value: 'info', label: t('Info'), title: withKey(t('Info'), 'library.info') },
              {
                value: 'quick',
                label: t('Quick develop'),
                title: withKey(t('Quick develop'), 'library.quickDevelop')
              }
            ]}
            onChange={setTab}
          />
          <button
            className="icon"
            title={withKey(t('Close'), 'library.info')}
            aria-label={t('Close info')}
            onClick={() => setOpen(false)}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="lib-info-body">
          {open && tab === 'info' && <MetadataEditor keys={targets} />}
          {open && tab === 'quick' && <QuickDevelop />}
        </div>
      </div>
    </aside>
  )
}
