import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '../../../../shared/ipc'
import { LOOKS } from '../../../../shared/looks/catalog'
import { COLLECTION_BY_ID } from '../../../../shared/looks/collections'
import { smartBlockers } from '../../../../shared/looks/smart'
import { lookLive, lookPreview, pickerRows, pickerSections } from '../../../../shared/quickdevelop'
import { Icon } from '../../components/icons'
import { Slider } from '../../components/ui'
import { api } from '../../lib/api'
import { smartReady } from '../../lib/applyLook'
import { t } from '../../lib/i18n'
import {
  applyLookTo,
  lookName,
  setLookAmount,
  sigOf,
  useQuick,
  type QuickLook
} from '../../lib/quickdevelop'
import { useAiJobs } from '../../state/jobs'
import { useLibrary } from '../../state/library'
import { useLibraryUndo } from '../../state/libraryUndo'
import { useLooks } from '../../state/looks'
import { useUi } from '../../state/ui'

/** The preview's long edge in CSS pixels. */
const PREVIEW_EDGE = 96
/** How long the picker holds still before the preview is asked for. */
const ASK_MS = 120

/** Counts the preview's asks: main shows only the newest. */
let token = 0

/**
 * The focused photo with `lookId` on it at `amount` (the photo as it is for
 * null): one small render with no Develop session, made in main from the
 * Library (main/quickdevelop.ts). `under`: the focused photo's step of a look
 * batch on trial, shown as it stood before it (the look swapped).
 */
function useQuickPreview(
  key: string | null,
  lookId: string | null,
  amount: number,
  under: number | undefined
): string | null {
  const [url, setUrl] = useState<string | null>(null)
  const want = useRef({ token: 0, key: '', id: '' })
  useEffect(() => {
    return api.looks.onThumb((e) => {
      const w = want.current
      if (e.token === w.token && e.key === w.key && e.id === w.id) setUrl(e.url)
    })
  }, [])
  useEffect(() => {
    if (!key) return
    const timer = setTimeout(() => {
      const id = lookId ?? 'current'
      want.current = { token: ++token, key, id }
      void api.looks
        .thumbs({
          key,
          token: want.current.token,
          ids: [id],
          edge: Math.round(PREVIEW_EDGE * 1.5 * (window.devicePixelRatio || 1)),
          amount,
          under
        })
        .catch(() => undefined)
    }, ASK_MS)
    return () => clearTimeout(timer)
  }, [key, lookId, amount, under])
  // Gone: main stops making it.
  useEffect(
    () => () => {
      if (key) void api.looks.cancel(key).catch(() => undefined)
    },
    [key]
  )
  return key ? url : null
}

/** The look batch on these targets, and whether it can still be swapped or scaled. */
function useTargetLook(keys: string[]): { look: QuickLook | null; live: boolean } {
  const look = useQuick((s) => s.look)
  const rewriting = useQuick((s) => s.rewriting)
  const done = useLibraryUndo((s) => s.done)
  if (!look || look.sig !== sigOf(keys)) return { look: null, live: false }
  // Being rewritten, its entry may be gone a moment: the Amount keeps the keyboard.
  return { look, live: rewriting === look.batchId || lookLive(look, done) }
}

/**
 * Quick develop's look picker: a search over My Looks, the user's presets,
 * the looks used lately and the catalog's collections, one preview of the
 * focused photo with the look picked, and the look's Amount once applied.
 * ↑/↓ pick, Enter applies (⌥Enter on top of the last), Esc clears the search
 * and then gives the keyboard back to the grid.
 */
export function LookPicker({ keys }: { keys: string[] }): React.JSX.Element {
  const focus = useLibrary((s) => s.focus)
  const mine = useLooks((s) => s.mine)
  const user = useLooks((s) => s.user)
  const recent = useUi((s) => s.recentLooks)
  const caps = useAiJobs((s) => s.capabilities)
  const ready = useMemo(() => caps?.smart ?? smartReady(), [caps])
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const { look, live } = useTargetLook(keys)
  // The Amount while it moves, until its write lands (then the look's own).
  const [drag, setDrag] = useState<number | null>(null)
  // As last moved: a key's step and its commit come in one go.
  const amountNow = useRef(100)
  // Counts the Amounts let go: the newest one's write ends the drag.
  const commits = useRef(0)
  const amount = drag ?? look?.amount ?? 100
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (useLooks.getState().mine === null) void useLooks.getState().load()
  }, [])

  const sections = useMemo(
    () =>
      pickerSections({
        catalog: LOOKS,
        user,
        mine: mine ?? [],
        recent,
        query,
        // The browser's "Works now": smart looks this build cannot do are left out.
        usable: (p) => !p.smart || smartBlockers(p.smart, ready).length === 0
      }),
    [user, mine, recent, query, ready]
  )
  const rows = useMemo(() => pickerRows(sections), [sections])
  const at = rows.findIndex((r) => r.row === picked)
  // A look locked under later edits is not picked again by itself: Apply would stack it.
  const chosen: Preset | null = at >= 0 ? rows[at].look : live ? (look?.look ?? null) : null
  const shown = lookPreview(
    chosen?.id ?? null,
    look ? { id: look.look.id, amount: look.amount, live } : null,
    drag
  )
  const under =
    shown.under && look && focus ? look.steps.find((s) => s.key === focus)?.seq : undefined
  const url = useQuickPreview(focus, shown.id, shown.amount, under)

  const move = (by: number): void => {
    if (rows.length === 0) return
    const next = rows[Math.max(0, Math.min(rows.length - 1, (at < 0 ? -1 : at) + by))]
    setPicked(next.row)
    list.current
      ?.querySelector(`[data-row="${CSS.escape(next.row)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }
  const apply = (p: Preset | null, stack = false): void => {
    if (p && keys.length > 0) void applyLookTo(p, { stack })
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey) return
    if (e.key === 'ArrowDown') move(1)
    else if (e.key === 'ArrowUp') move(-1)
    else if (e.key === 'Enter') apply(chosen, e.altKey)
    else if (e.key === 'Escape') {
      if (query) setQuery('')
      else (document.activeElement as HTMLElement | null)?.blur()
    } else {
      // Typing goes to the search; nothing else answers it.
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const isApplied = !!(look && live && chosen && look.look.id === chosen.id)
  return (
    <div className="qd-looks">
      <label className="search-field qd-search">
        <Icon name="search" />
        <input
          className="search"
          placeholder={t('Search looks')}
          aria-label={t('Search looks')}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPicked(null)
          }}
          onKeyDown={onKey}
        />
      </label>
      <div className="qd-look-list" ref={list} role="listbox" aria-label={t('Looks')}>
        {sections.map((s) => (
          <div key={s.id} role="group" aria-label={s.label ? t(s.label) : undefined}>
            {s.label && <div className="qd-look-shelf micro">{t(s.label)}</div>}
            {s.looks.map((p) => {
              const row = `${s.id}:${p.id}`
              return (
                <button
                  key={row}
                  data-row={row}
                  role="option"
                  aria-selected={row === picked}
                  tabIndex={-1}
                  className={`qd-look${row === picked ? ' on' : ''}${look?.look.id === p.id && live ? ' applied' : ''}`}
                  onClick={() => setPicked(row)}
                  onDoubleClick={(e) => apply(p, e.altKey)}
                  title={
                    p.meta?.inspiredBy
                      ? t('Inspired by {{name}}', { name: p.meta.inspiredBy })
                      : lookName(p)
                  }
                >
                  <span className="qd-look-name">{lookName(p)}</span>
                  {p.smart && <span className="look-badge smart">{t('Smart')}</span>}
                </button>
              )
            })}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="rail-empty">{t('No look matches “{{query}}”.', { query })}</p>
        )}
      </div>
      <div className="qd-look-pick">
        <div className="qd-preview">
          {url ? <img src={url} alt="" draggable={false} /> : <span className="look-skeleton" />}
        </div>
        <div className="qd-look-about">
          <strong>{chosen ? lookName(chosen) : t('No look picked')}</strong>
          {chosen?.meta && (
            <span className="muted">
              {t(COLLECTION_BY_ID.get(chosen.meta.collection)?.label ?? '')}
            </span>
          )}
          <button
            className="sm primary"
            disabled={!chosen || keys.length === 0 || isApplied}
            title={
              look && live && !isApplied
                ? t('Takes the place of {{name}} (Alt: on top of it)', {
                    name: lookName(look.look)
                  })
                : undefined
            }
            onClick={(e) => apply(chosen, e.altKey)}
          >
            {isApplied ? t('Applied') : t('Apply')}
          </button>
        </div>
      </div>
      {look &&
        (live ? (
          <Slider
            label={t('Amount')}
            value={amount}
            min={0}
            max={100}
            def={100}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => {
              amountNow.current = Math.round(v)
              setDrag(amountNow.current)
            }}
            onCommit={() => {
              const n = ++commits.current
              void setLookAmount(amountNow.current).finally(() => {
                if (commits.current === n) setDrag(null)
              })
            }}
          />
        ) : (
          <p className="qd-note muted">
            {t('{{look}} applied, Amount locked', { look: lookName(look.look) })}
          </p>
        ))}
    </div>
  )
}
