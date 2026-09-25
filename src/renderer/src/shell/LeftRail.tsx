import { Icon, type IconName } from '../components/icons'
import { HistoryPane, InfoPane, PresetsActions, PresetsPane, SnapshotsPane } from '../panels/left'
import { useUi, type Rail } from '../state/ui'

const RAILS: { id: Rail; label: string; icon: IconName }[] = [
  { id: 'presets', label: 'Presets', icon: 'presets' },
  { id: 'snapshots', label: 'Snapshots', icon: 'snapshots' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'info', label: 'Info', icon: 'info' }
]

/**
 * The left rail: a thin spine of glyphs, and beside it one pane at a time.
 * Picking the glyph that is already showing folds the rail to its spine; the
 * chevron at the foot folds and unfolds it too. Both are remembered.
 */
export function LeftRail(): React.JSX.Element {
  const rail = useUi((s) => s.rail)
  const open = useUi((s) => s.railOpen)
  const pick = useUi((s) => s.pickRail)
  const setOpen = useUi((s) => s.setRailOpen)
  const current = RAILS.find((r) => r.id === rail) ?? RAILS[0]
  return (
    <aside className={`left-rail${open ? ' open' : ''}`}>
      <div className="spine" role="tablist" aria-orientation="vertical">
        {RAILS.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={open && rail === r.id}
            className={open && rail === r.id ? 'on' : ''}
            title={r.label}
            aria-label={r.label}
            onClick={() => pick(r.id)}
          >
            <Icon name={r.icon} />
          </button>
        ))}
        <span className="gap" />
        <button
          className="fold"
          title={open ? 'Fold the panel' : 'Unfold the panel'}
          aria-label={open ? 'Fold the panel' : 'Unfold the panel'}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevronLeft" />
        </button>
      </div>
      <div className="rail-pane" aria-hidden={!open}>
        <div className="rail-inner">
          <div className="rail-head">
            <span className="micro">{current.label}</span>
            {rail === 'presets' && <PresetsActions />}
          </div>
          <div className="rail-body" key={rail}>
            {rail === 'presets' && <PresetsPane />}
            {rail === 'snapshots' && <SnapshotsPane />}
            {rail === 'history' && <HistoryPane />}
            {rail === 'info' && <InfoPane />}
          </div>
        </div>
      </div>
    </aside>
  )
}
