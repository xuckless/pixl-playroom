import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { copiedAgo, groupsSummary } from '../../../../shared/clipboard'
import { NUDGE_ROWS, targetsSummary, type NudgeRow as Row } from '../../../../shared/quickdevelop'
import { api } from '../../lib/api'
import { autoWbBatch } from '../../lib/autowb'
import { copySettings, pasteSettings, photoName } from '../../lib/clipboard'
import { keyHint, withKey } from '../../lib/commands'
import { t, tp } from '../../lib/i18n'
import { autoToneTargets, nudge, sigOf, useQuick } from '../../lib/quickdevelop'
import { useLibrary, useTargets } from '../../state/library'
import { useUi } from '../../state/ui'
import { LookPicker } from './LookPicker'
import { NudgeRow } from './NudgeRow'

/** The tab's header: what it acts on ("12 photos · 3 RAW · 1 HDR", or the focused one). */
function Targets({ keys }: { keys: string[] }): React.JSX.Element {
  const selected = useLibrary((s) => s.selection.length > 0)
  const want = useMemo(() => new Set(keys), [keys])
  const items = useLibrary(useShallow((s) => s.items.filter((i) => want.has(i.key))))
  const expanded = useLibrary((s) => s.expandedStacks)
  const sum = targetsSummary(items, expanded)
  if (items.length === 0)
    return <p className="rail-empty">{t('Select photos to develop them here.')}</p>
  const parts = [
    !selected && items.length === 1
      ? t('{{name}} (focused)', { name: photoName(items[0]) })
      : tp('{{count}} photo', '{{count}} photos', sum.count),
    ...(sum.raw > 0 ? [t('{{count}} RAW', { count: sum.raw })] : []),
    ...(sum.hdr > 0 ? [t('{{count}} HDR', { count: sum.hdr })] : [])
  ]
  return (
    <div className="qd-targets">
      <p className="meta-count micro">{parts.join(' · ')}</p>
      {sum.offline + sum.unreadable > 0 && (
        <p className="qd-note muted">
          {tp(
            '{{count}} offline or unreadable: settings only, Auto cannot measure it',
            '{{count}} offline or unreadable: settings only, Auto cannot measure them',
            sum.offline + sum.unreadable
          )}
        </p>
      )}
      {sum.stacks > 0 && (
        <p className="qd-note muted">
          {tp(
            '{{count}} collapsed stack: its cover only',
            '{{count}} collapsed stacks: their covers only',
            sum.stacks
          )}
        </p>
      )}
    </div>
  )
}

/** A group of rows under its name, with its Auto when it has one. */
function Group({
  label,
  auto,
  autoTitle,
  children
}: {
  label: string
  auto?: () => void
  autoTitle?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="qd-group">
      <div className="rail-group">
        <span className="micro">{label}</span>
        <span className="line" />
        {auto && (
          <button className="sm ghost qd-auto" title={autoTitle} onClick={auto}>
            {t('Auto')}
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

/** The clipboard (⌘C): whose settings, how long ago, which groups, and Paste. */
function Clipboard({ keys }: { keys: string[] }): React.JSX.Element {
  const clip = useLibrary((s) => s.clipboard)
  // The source's item: patched (a new thumbnail, an edit) when its photo changes.
  const source = useLibrary((s) => s.items.find((i) => i.key === s.clipboard?.source.key))
  // The source's stamp as last read: another than the copy's, it changed since.
  const [seen, setSeen] = useState<{ copy: number; stamp: string } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Its age moves on; its photo may have been edited since.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    if (!clip?.stamp) return
    const key = clip.source.key
    const copy = clip.at
    let gone = false
    void api.library
      .stamps([key])
      .then((s) => {
        if (!gone && s[key]) setSeen({ copy, stamp: s[key] })
      })
      .catch(() => undefined)
    return () => {
      gone = true
    }
  }, [clip, source])
  const changed = !!clip?.stamp && seen?.copy === clip.at && seen.stamp !== clip.stamp
  return (
    <section className="qd-group">
      <div className="rail-group">
        <span className="micro">{t('Clipboard')}</span>
        <span className="line" />
      </div>
      {clip ? (
        <div className="qd-clip">
          <button
            className="qd-clip-line ghost"
            title={t('Copy the settings of {{name}} again', { name: clip.source.name })}
            onClick={() => void copySettings(clip.source.key)}
          >
            <span className="qd-clip-name">
              {clip.source.name} · {copiedAgo(clip.at, now)}
            </span>
            <span className="muted">
              {groupsSummary(clip.groups)}
              {changed && <span className="qd-changed"> · {t('changed since')}</span>}
            </span>
          </button>
          <button
            className="sm"
            disabled={keys.length === 0}
            title={withKey(t('Paste settings onto the selection'), 'library.paste')}
            onClick={() => void pasteSettings(keys)}
          >
            {t('Paste')}
          </button>
        </div>
      ) : (
        <p className="qd-note muted">
          {t("Copy a photo's settings ({{key}}) to paste them here.", {
            key: keyHint('library.copy')
          })}
        </p>
      )}
    </section>
  )
}

/**
 * Quick develop, the info drawer's second tab (⇧I): looks, nudges and Auto
 * on the selection, each a Library batch (lib/quickdevelop.ts). In the tab,
 * ↑/↓ move between the rows, ←/→ nudge the one focused (⇧ a big step), A
 * runs its Auto, and Esc gives the keyboard back to the grid. These keys
 * stop at the drawer: they never reach the grid or open the photo.
 */
export function QuickDevelop(): React.JSX.Element {
  const keys = useTargets()
  const sig = sigOf(keys)
  const readouts = useQuick((s) => (s.sig === sig ? s.readouts : null))
  const more = useUi((s) => s.quickMore)
  const setMore = useUi((s) => s.setQuickMore)
  const mixed = useLibrary((s) => {
    const want = new Set(keys)
    let raw = 0
    let all = 0
    for (const i of s.items)
      if (want.has(i.key)) {
        all++
        if (i.isRaw) raw++
      }
    return raw > 0 && raw < all
  })
  const none = keys.length === 0
  const row = (r: Row): React.JSX.Element => (
    <NudgeRow
      key={r.id}
      row={r}
      change={readouts?.[r.id] ?? 0}
      mixed={mixed && r.id === 'temp'}
      disabled={none}
    />
  )
  const rowsOf = (group: Row['group']): Row[] =>
    NUDGE_ROWS.filter((r) => r.group === group && (!r.more || more))
  const autoOf = (id: string): (() => void) | null =>
    id === 'exposure' || id === 'contrast'
      ? () => void autoToneTargets(keys)
      : id === 'temp' || id === 'tint'
        ? () => void autoWbBatch(keys)
        : null

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // ⌥ and ⌘ keys are the Library's own (the nudges, undo), wherever the focus is.
    if (e.altKey || e.metaKey || e.ctrlKey) return
    const el = e.target as HTMLElement
    const at = el.closest<HTMLElement>('[data-qd-row]')
    if (!at) {
      // A button in the tab: Enter presses it, and neither it nor an arrow
      // goes on to open the photo or move the grid.
      if (el.tagName === 'INPUT') return
      if (e.key === 'Escape') el.blur()
      else if (e.key !== 'Enter' && !e.key.startsWith('Arrow')) return
      e.stopPropagation()
      return
    }
    const id = at.dataset.qdRow as Row['id']
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-qd-row]')]
    const i = all.indexOf(at)
    if (e.key === 'ArrowDown') all[Math.min(all.length - 1, i + 1)]?.focus()
    else if (e.key === 'ArrowUp') all[Math.max(0, i - 1)]?.focus()
    else if (e.key === 'ArrowRight') nudge(id, 1, e.shiftKey)
    else if (e.key === 'ArrowLeft') nudge(id, -1, e.shiftKey)
    else if (e.key.toLowerCase() === 'a') autoOf(id)?.()
    else if (e.key === 'Escape') at.blur()
    else if (e.key !== 'Enter') return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="qd-develop" onKeyDown={onKey}>
      <Targets keys={keys} />
      <Group label={t('Look')}>
        <LookPicker keys={keys} />
      </Group>
      <Group
        label={t('Tone')}
        auto={none ? undefined : () => void autoToneTargets(keys)}
        autoTitle={withKey(t('Auto tone on each photo'), 'library.autoTone')}
      >
        {rowsOf('tone').map(row)}
      </Group>
      <Group
        label={t('White balance')}
        auto={none ? undefined : () => void autoWbBatch(keys)}
        autoTitle={withKey(t('Auto white balance on each photo'), 'autoWbBatch')}
      >
        {rowsOf('wb').map(row)}
      </Group>
      <Group label={t('Presence')}>
        {rowsOf('presence').map(row)}
        <button className="qd-more ghost sm" aria-expanded={more} onClick={() => setMore(!more)}>
          {more ? t('Less') : t('More: Clarity, Saturation')}
        </button>
      </Group>
      <Clipboard keys={keys} />
    </div>
  )
}
