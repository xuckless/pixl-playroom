import { Icon } from '../../components/icons'
import { useTargets } from '../../state/library'
import { useUi } from '../../state/ui'
import { MetadataEditor } from './MetadataEditor'
import { withKey } from '../../lib/commands'

/** The library's right-hand drawer: the selection's details and metadata (I). */
export function InfoDrawer(): React.JSX.Element {
  const open = useUi((s) => s.libraryInfo)
  const setOpen = useUi((s) => s.setLibraryInfo)
  const targets = useTargets()
  return (
    <aside className={`lib-info${open ? ' open' : ''}`} aria-label="Info" inert={!open}>
      <div className="lib-info-inner">
        <header className="rail-head">
          <span className="micro">Info</span>
          <button
            className="icon"
            title={withKey('Close', 'library.info')}
            aria-label="Close info"
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
