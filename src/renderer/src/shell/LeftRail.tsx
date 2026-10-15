import { useId } from 'react'
import { Icon, type IconName } from '../components/icons'
import { rovingNext } from '../lib/roving'
import { MasksPane } from '../panels/masks/MasksPane'
import { InfoPane, PresetsActions, PresetsPane } from '../panels/left'
import { HistoryPane } from '../panels/HistoryPane'
import { VersionsSection } from '../panels/VersionsSection'
import { EditsPane } from '../panels/EditsPane'
import { useUi, type Rail } from '../state/ui'
import { t, tk } from '../lib/i18n'

const RAILS: { id: Rail; label: string; icon: IconName }[] = [
  { id: 'presets', label: tk('Presets'), icon: 'presets' },
  { id: 'edits', label: tk('Edits'), icon: 'stack' },
  { id: 'history', label: tk('History'), icon: 'history' },
  { id: 'info', label: tk('Info'), icon: 'info' }
]

/**
 * The left rail: a thin spine of glyphs, and beside it one pane at a time.
 * Picking the glyph that is already showing folds the rail to its spine; the
 * chevron at the foot folds and unfolds it too. Both are remembered.
 *
 * To the keyboard the glyphs are tabs (one stop; Up and Down choose), and a
 * folded pane is inert: nothing in it takes focus while it cannot be seen.
 */
export function LeftRail(): React.JSX.Element {
  const rail = useUi((s) => s.rail)
  const open = useUi((s) => s.railOpen)
  const pick = useUi((s) => s.pickRail)
  const setOpen = useUi((s) => s.setRailOpen)
  const current = RAILS.find((r) => r.id === rail) ?? RAILS[0]
  const base = useId()
  const tabId = (id: Rail): string => `${base}-tab-${id}`
  const paneId = `${base}-pane`
  return (
    <aside className={`left-rail${open ? ' open' : ''}`}>
      <div className="spine">
        <div
          className="spine-tabs"
          role="tablist"
          aria-orientation="vertical"
          aria-label={t('Panels')}
          onKeyDown={(e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return
            const at = RAILS.findIndex((r) => r.id === rail)
            const next = rovingNext(
              e.key,
              at,
              RAILS.map(() => true),
              true
            )
            if (next < 0) return
            e.preventDefault()
            e.stopPropagation()
            if (RAILS[next].id !== rail) pick(RAILS[next].id)
            document.getElementById(tabId(RAILS[next].id))?.focus()
          }}
        >
          {RAILS.map((r) => (
            <button
              key={r.id}
              id={tabId(r.id)}
              role="tab"
              aria-selected={rail === r.id}
              aria-controls={paneId}
              tabIndex={rail === r.id ? 0 : -1}
              className={open && rail === r.id ? 'on' : ''}
              title={t(r.label)}
              aria-label={t(r.label)}
              onClick={() => pick(r.id)}
            >
              <Icon name={r.icon} />
            </button>
          ))}
        </div>
        <span className="gap" />
        <button
          className="fold"
          title={open ? t('Fold the panel') : t('Unfold the panel')}
          aria-label={t('Show the panel')}
          aria-expanded={open}
          aria-controls={paneId}
          onClick={() => setOpen(!open)}
        >
          <Icon name="chevronLeft" />
        </button>
      </div>
      <div
        className="rail-pane"
        id={paneId}
        role="tabpanel"
        aria-labelledby={tabId(current.id)}
        inert={!open}
      >
        <div className="rail-inner">
          <div className="rail-head">
            <span className="micro">{t(current.label)}</span>
            {rail === 'presets' && <PresetsActions />}
          </div>
          <div className="rail-body" key={rail}>
            {rail === 'presets' && <PresetsPane />}
            {rail === 'edits' && <EditsPane />}
            {rail === 'history' && (
              <>
                <VersionsSection />
                <HistoryPane />
              </>
            )}
            {rail === 'info' && <InfoPane />}
          </div>
        </div>
      </div>
      <MasksPane />
    </aside>
  )
}
