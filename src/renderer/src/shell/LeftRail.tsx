import { Icon, type IconName } from '../components/icons'
import { MasksPane } from '../panels/masks/MasksPane'
import { HistoryPane, InfoPane, PresetsActions, PresetsPane, SnapshotsPane } from '../panels/left'
import { useUi, type Rail } from '../state/ui'
import { t, tk } from '../lib/i18n'

const RAILS: { id: Rail; label: string; icon: IconName }[] = [
  { id: 'presets', label: tk('Presets'), icon: 'presets' },
  { id: 'snapshots', label: tk('Snapshots'), icon: 'snapshots' },
  { id: 'history', label: tk('History'), icon: 'history' },
  { id: 'info', label: tk('Info'), icon: 'info' }
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
            title={t(r.label)}
            aria-label={t(r.label)}
            onClick={() => pick(r.id)}
          >
            <Icon name={r.icon} />
          </button>
        ))}
        <span className="gap" />
        <button
          className="fold"
          title={open ? t('Fold the panel') : t('Unfold the panel')}
          aria-label={open ? t('Fold the panel') : t('Unfold the panel')}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevronLeft" />
        </button>
      </div>
      <div className="rail-pane" aria-hidden={!open}>
        <div className="rail-inner">
          <div className="rail-head">
            <span className="micro">{t(current.label)}</span>
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
      <MasksPane />
    </aside>
  )
}
