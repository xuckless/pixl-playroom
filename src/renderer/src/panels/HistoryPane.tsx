/**
 * History as a short timeline (shared/history.ts `groupTimeline`): the
 * editing sessions, newest first, each a few rows, a run of drags on one
 * slider one row ("Exposure 0 → +0.60 · 12×"). Every change is still kept
 * underneath; this is how it reads. Hovering a row shows the photo as it was
 * then; clicking brings it back as a new step ("Back to: 11:20"), so nothing
 * after it is lost and Undo returns. Switching an edit off is the Edits
 * list's (and the cards' eyes), Versions are above.
 */
import { useMemo, useRef, useState } from 'react'
import {
  deleteLabel,
  deletedSeqs,
  groupTimeline,
  recipeAt,
  withoutSteps,
  type TimelineRow,
  type TimelineSession
} from '../../../shared/history'
import { activeSteps, stackSignature } from '../../../shared/pixels'
import { Icon } from '../components/icons'
import { useDevelop } from '../state/develop'
import { useLibrary } from '../state/library'
import { sameValue } from '../../../shared/recipe'
import { t, tp } from '../lib/i18n'
import { stepLabel } from '../lib/stepLabel'

/** How long the pointer rests on a row before the loupe shows that moment. */
const HOVER_MS = 150

const clock = (at: string): string =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

const day = (at: string): string => {
  const d = new Date(at)
  return new Date().toDateString() === d.toDateString()
    ? t('Today')
    : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/** A slider's value as the timeline says it: signed, small values in hundredths. */
function num(v: number): string {
  const s = Math.abs(v) < 10 && !Number.isInteger(v) ? v.toFixed(2) : String(Math.round(v))
  return v > 0 ? `+${s}` : s.replace('-', '−')
}

function Row({
  row,
  onHover,
  onRestore,
  onDelete
}: {
  row: TimelineRow
  onHover: (row: TimelineRow | null) => void
  onRestore: (row: TimelineRow) => void
  onDelete: (row: TimelineRow) => void
}): React.JSX.Element {
  // A delete is taken back with Undo, not deleted in turn.
  const deletable = deletedSeqs(row.label) === null
  const label = stepLabel(row.label)
  const change =
    row.from !== undefined && row.to !== undefined ? `${num(row.from)} → ${num(row.to)}` : ''
  const times = row.seqs.length > 1 ? `${row.seqs.length}×` : ''
  return (
    <div
      role="button"
      tabIndex={0}
      className="rail-item timeline-row"
      title={t('Back to this moment')}
      onPointerEnter={() => onHover(row)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(row)}
      onBlur={() => onHover(null)}
      onClick={() => onRestore(row)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onRestore(row)
      }}
    >
      <span className="edit-text">
        <span className="edit-name">{label}</span>
        {(change || times) && (
          <span className="edit-summary">{[change, times].filter(Boolean).join(' · ')}</span>
        )}
      </span>
      <span className="timeline-time">{clock(row.at)}</span>
      {deletable && (
        <button
          type="button"
          className="icon sm ghost timeline-delete"
          aria-label={t('Delete this change')}
          title={t(
            'Delete this change: the photo loses it, everything after stays (Undo brings it back)'
          )}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(row)
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Icon name="trash" />
        </button>
      )}
    </div>
  )
}

function Session({
  session,
  open,
  onToggle,
  onHover,
  onRestore,
  onDelete
}: {
  session: TimelineSession
  open: boolean
  onToggle: () => void
  onHover: (row: TimelineRow | null) => void
  onRestore: (row: TimelineRow) => void
  onDelete: (row: TimelineRow) => void
}): React.JSX.Element {
  const n = session.rows.reduce((k, r) => k + r.seqs.length, 0)
  return (
    <div className="timeline-session">
      <button
        type="button"
        className="rail-group timeline-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon name={open ? 'chevronDown' : 'chevronUp'} />
        <span className="micro">
          {day(session.start)} {clock(session.start)}
        </span>
        <span className="line" />
        <span className="timeline-count">{tp('{{count}} change', '{{count}} changes', n)}</span>
      </button>
      {open && (
        <>
          {[...session.rows].reverse().map((row) => (
            <Row
              key={row.seqs[0]}
              row={row}
              onHover={onHover}
              onRestore={onRestore}
              onDelete={onDelete}
            />
          ))}
          {session.opened && (
            <div className="rail-item timeline-row base" aria-disabled>
              <span className="edit-name">{t('Opened')}</span>
              <span className="timeline-time">{clock(session.start)}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function HistoryPane(): React.JSX.Element {
  const history = useDevelop((s) => s.history)
  const sessions = useMemo(() => groupTimeline(history), [history])
  // The newest session open; others as the user leaves them.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  if (!history.base) return <p className="rail-empty">{t('Nothing has happened yet.')}</p>

  const hover = (row: TimelineRow | null): void => {
    clearTimeout(timer.current)
    const d = useDevelop.getState()
    if (!row) return d.preview('', null)
    timer.current = setTimeout(() => {
      const r = recipeAt(useDevelop.getState().history, row.seqs[row.seqs.length - 1])
      if (r) useDevelop.getState().preview(stepLabel(row.label), r)
    }, HOVER_MS)
  }
  const restore = (row: TimelineRow): void => {
    clearTimeout(timer.current)
    const d = useDevelop.getState()
    const r = recipeAt(d.history, row.seqs[row.seqs.length - 1])
    if (!r) return
    d.preview('', null)
    d.replace(r, `Back to: ${clock(row.at)}`)
  }
  const remove = (row: TimelineRow): void => {
    clearTimeout(timer.current)
    const d = useDevelop.getState()
    const out = withoutSteps(d.history, row.seqs)
    if (!out || !d.recipe) return
    d.preview('', null)
    // Overwritten since (a later change to the same slider): nothing of it is left to take out.
    if (sameValue(out.recipe, d.recipe)) {
      useLibrary.getState().say(t('A later change already replaced that one: nothing to delete.'))
      return
    }
    d.replace(out.recipe, deleteLabel(row.label, out.removed))
  }
  // The pixel steps (AI, heals) then and now differ: hover grades over today's pixels.
  const now = useDevelop.getState().recipe
  const stepsNow = now ? stackSignature(activeSteps(now.pixels)) : ''
  const differs = sessions.some((s) => s.rows.some((r) => r.pixels !== stepsNow))

  return (
    <div className="rail-list timeline">
      {differs && (
        <p className="rail-empty timeline-note">
          {t('Hovering shows each moment’s settings on today’s AI and heal steps.')}
        </p>
      )}
      {[...sessions].reverse().map((s, i) => {
        const id = s.start
        const open = toggled[id] ?? i === 0
        return (
          <Session
            key={id}
            session={s}
            open={open}
            onToggle={() => setToggled({ ...toggled, [id]: !open })}
            onHover={hover}
            onRestore={restore}
            onDelete={remove}
          />
        )
      })}
    </div>
  )
}
