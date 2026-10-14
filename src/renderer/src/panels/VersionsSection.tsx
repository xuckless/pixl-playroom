/**
 * Versions, at the top of History (shared/versions.ts): the photo as it was
 * at a moment worth coming back to. Named ones are the user's (made here,
 * kept for good); automatic ones Playroom makes as it goes (an editing
 * session's end, before a look or an AI step, an export, settings pasted
 * over), folded under "Automatic". Each can be brought back (a new step of
 * History, undone like any), compared with in Before/After, renamed or
 * deleted; an automatic one can be kept.
 */
import { useEffect, useState } from 'react'
import type { Snapshot } from '../../../shared/ipc'
import { isNamed, newestFirst } from '../../../shared/versions'
import { Icon } from '../components/icons'
import { useDevelop } from '../state/develop'
import { t } from '../lib/i18n'
import { stepLabel } from '../lib/stepLabel'

/** When a version was made: the time today, else the day and the time. */
function when(at: string): string {
  const d = new Date(at)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function VersionRow({ v }: { v: Snapshot }): React.JSX.Element {
  const comparing = useDevelop((s) => s.comparing === v.id)
  const [renaming, setRenaming] = useState<string | null>(null)
  const d = useDevelop.getState
  const name = isNamed(v) ? v.name : stepLabel(v.name)
  const compare = (): void => {
    if (comparing) return d().compareWith(null)
    d().compareWith(v.id)
    // Shown beside the photo at once.
    if (d().compare === 'off') d().setCompare('split')
  }
  const rename = (): void => {
    const next = renaming?.trim()
    setRenaming(null)
    if (next && next !== v.name) void d().renameVersion(v.id, next)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      className={`rail-item version-row${comparing ? ' on' : ''}`}
      title={t('Back to this version')}
      onClick={() => renaming === null && d().restoreVersion(v.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && renaming === null) d().restoreVersion(v.id)
      }}
    >
      {renaming !== null ? (
        <input
          className="name version-rename"
          autoFocus
          value={renaming}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') rename()
            if (e.key === 'Escape') setRenaming(null)
          }}
        />
      ) : (
        <span className="edit-text">
          <span className="edit-name">{name}</span>
          <span className="edit-summary">{when(v.at)}</span>
        </span>
      )}
      <span className="version-acts" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={`icon sm${comparing ? ' on' : ''}`}
          aria-pressed={comparing}
          title={comparing ? t('Stop comparing') : t('Compare with this version')}
          aria-label={comparing ? t('Stop comparing') : t('Compare with this version')}
          onClick={compare}
        >
          <Icon name="overlay" />
        </button>
        {!isNamed(v) && (
          <button
            type="button"
            className="icon sm"
            title={t('Keep this version')}
            aria-label={t('Keep this version')}
            onClick={() => void d().keepVersion(v.id)}
          >
            <Icon name="pin" />
          </button>
        )}
        {isNamed(v) && (
          <button
            type="button"
            className="icon sm"
            title={t('Rename')}
            aria-label={t('Rename')}
            onClick={() => setRenaming(v.name)}
          >
            <Icon name="rename" />
          </button>
        )}
        <button
          type="button"
          className="icon sm"
          title={t('Delete version')}
          aria-label={t('Delete version')}
          onClick={() => void d().deleteVersion(v.id)}
        >
          <Icon name="trash" />
        </button>
      </span>
    </div>
  )
}

export function VersionsSection(): React.JSX.Element {
  const versions = useDevelop((s) => s.snapshots)
  const session = useDevelop((s) => s.session)
  const steps = useDevelop((s) => s.history.steps.length)
  const add = useDevelop((s) => s.addVersion)
  const [name, setName] = useState('')
  const [autoOpen, setAutoOpen] = useState(false)
  // Main makes automatic ones as it goes (an AI step, an export): read again
  // when History opens and as steps land.
  useEffect(() => {
    void useDevelop
      .getState()
      .refreshVersions()
      .catch(() => undefined)
  }, [session?.key, steps])
  const named = versions.filter(isNamed).sort(newestFirst)
  const autos = versions.filter((v) => !isNamed(v)).sort(newestFirst)
  const save = (): void => {
    void add(name.trim() || new Date().toLocaleString())
    setName('')
  }
  return (
    <div className="rail-list versions">
      <div className="rail-form">
        <input
          className="name"
          placeholder={t('Version name')}
          value={name}
          disabled={!session}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') save()
          }}
        />
        <button
          className="sm"
          disabled={!session}
          onClick={save}
          title={t('Keep the photo as it is now, to come back to or compare with')}
        >
          <Icon name="plus" />
          {t('Save version')}
        </button>
      </div>
      {named.map((v) => (
        <VersionRow key={v.id} v={v} />
      ))}
      {autos.length > 0 && (
        <>
          <button
            type="button"
            className="rail-group versions-auto"
            aria-expanded={autoOpen}
            onClick={() => setAutoOpen(!autoOpen)}
          >
            <Icon name={autoOpen ? 'chevronDown' : 'chevronUp'} />
            <span className="micro">
              {t('Automatic')} ({autos.length})
            </span>
            <span className="line" />
          </button>
          {autoOpen && autos.map((v) => <VersionRow key={v.id} v={v} />)}
        </>
      )}
    </div>
  )
}
