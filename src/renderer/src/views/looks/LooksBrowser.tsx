/**
 * The Looks browser: every look PIXL ships and every preset the user saved,
 * shown on the open photo, to search, try and keep. Camera colour comes
 * first, then cinema, film, movies and the rest; a look added here joins My
 * Looks in the rail.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Preset } from '../../../../shared/ipc'
import { LOOKS } from '../../../../shared/looks/catalog'
import {
  COLLECTION_BY_ID,
  COLLECTIONS,
  FAMILIES,
  type LookFamily
} from '../../../../shared/looks/collections'
import { searchLooks } from '../../../../shared/looks/search'
import { formatEta } from '../../../../shared/looks/run'
import { planSmart, smartBlockers } from '../../../../shared/looks/smart'
import { Icon } from '../../components/icons'
import { Modal } from '../../components/ui'
import { applyToPhoto, removeLook, smartReady, useApplied } from '../../lib/applyLook'
import { useAiJobs } from '../../state/jobs'
import { useDevelop } from '../../state/develop'
import { useLibrary } from '../../state/library'
import { useLooks } from '../../state/looks'
import { t } from '../../lib/i18n'
import { useLookThumbs, useThumbs } from './useLookThumbs'

type Shelf =
  | { kind: 'all' }
  | { kind: 'mine' }
  | { kind: 'user' }
  | { kind: 'family'; id: LookFamily }
  | { kind: 'collection'; id: string }

/** The photo as it is, first among the cards. */
const CURRENT = 'current'
/** The cards' long edge in CSS pixels (the grid's widest card), for their thumbnails. */
const CARD_EDGE = 260

/** A look's name in the language shown (a preset the user saved keeps theirs). */
const nameOf = (p: Preset): string => (p.builtin ? t(p.name) : p.name)

const familyOf = (p: Preset): LookFamily | null =>
  p.meta ? (COLLECTION_BY_ID.get(p.meta.collection)?.family ?? null) : null

export function LooksBrowser(): React.JSX.Element | null {
  const setDialog = useLibrary((s) => s.setDialog)
  const session = useDevelop((s) => s.session)
  const picture = useDevelop((s) => s.picture)
  const mine = useLooks((s) => s.mine)
  const user = useLooks((s) => s.user)
  const applied = useApplied()
  const worksNow = useLooks((s) => s.worksNow)
  // What this build can do for smart looks (a model downloaded changes it).
  const caps = useAiJobs((s) => s.capabilities)
  const ready = useMemo(() => caps?.smart ?? smartReady(), [caps])
  const blockers = (p: Preset): string[] => (p.smart ? smartBlockers(p.smart, ready) : [])
  const [query, setQuery] = useState(() => useLooks.getState().browseQuery)
  const [shelf, setShelf] = useState<Shelf>({ kind: 'all' })
  const [focus, setFocus] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const close = (): void => setDialog(null)

  useEffect(() => {
    if (useLooks.getState().mine === null) void useLooks.getState().load()
  }, [])
  // The browser belongs to a photo: none open (or the view left), it goes.
  useEffect(() => {
    if (!session) setDialog(null)
  }, [session, setDialog])

  const mineIds = useMemo(() => mine ?? [], [mine])
  const source = useMemo((): Preset[] => {
    switch (shelf.kind) {
      case 'all':
        return [...LOOKS, ...user]
      case 'mine':
        return mineIds.flatMap((id) => LOOKS.find((l) => l.id === id) ?? [])
      case 'user':
        return user
      case 'family':
        return LOOKS.filter((l) => familyOf(l) === shelf.id)
      case 'collection':
        return LOOKS.filter((l) => l.meta.collection === shelf.id)
    }
  }, [shelf, user, mineIds])
  const q = query.trim()
  const shown = useMemo(() => {
    const found = q ? searchLooks(source, q) : source
    // "Works now": the smart looks this build cannot do all of are left out.
    return worksNow
      ? found.filter((p) => !p.smart || smartBlockers(p.smart, ready).length === 0)
      : found
  }, [source, q, worksNow, ready])
  // Shelves of collections while browsing; one ranked list while searching.
  const sections = useMemo(() => {
    if (q || shelf.kind === 'mine' || shelf.kind === 'user' || shelf.kind === 'collection')
      return [{ id: 'flat', label: '', looks: shown }]
    const by = new Map<string, Preset[]>()
    for (const p of shown) {
      const id = p.meta?.collection ?? 'user'
      by.set(id, [...(by.get(id) ?? []), p])
    }
    return [...by].map(([id, looks]) => ({
      id,
      label: t(COLLECTION_BY_ID.get(id)?.label ?? 'My presets'),
      looks
    }))
  }, [shown, q, shelf])
  const order = useMemo(
    () => [CURRENT, ...sections.flatMap((s) => s.looks.map((p) => p.id))],
    [sections]
  )
  const byId = useMemo(() => new Map(shown.map((p) => [p.id, p])), [shown])

  const edge = Math.round(CARD_EDGE * (window.devicePixelRatio || 1))
  const observe = useLookThumbs(grid, order, edge)
  const thumbs = useThumbs((s) => s.byId)

  if (!session) return null
  const aspect = picture ? picture.width / Math.max(1, picture.height) : 1.5
  const focused = focus ? (byId.get(focus) ?? null) : null
  const kept = (id: string): boolean => mineIds.includes(id)
  const toggleKeep = (p: Preset): void => {
    if (!p.builtin) return
    if (kept(p.id)) useLooks.getState().remove(p.id)
    else useLooks.getState().add(p.id)
  }
  // Applying keeps the browser open to try another (which takes its place);
  // a double-click applies and closes. Alt puts it on top instead.
  const apply = (p: Preset, opts: { stack?: boolean; done?: boolean } = {}): void => {
    void applyToPhoto(p, { stack: opts.stack })
    if (opts.done) close()
  }

  const move = (delta: number | 'up' | 'down'): void => {
    const el = grid.current
    const cols = el ? getComputedStyle(el).gridTemplateColumns.split(' ').length : 1
    const step = delta === 'up' ? -cols : delta === 'down' ? cols : delta
    const ids = order.filter((id) => id !== CURRENT)
    const at = focus ? ids.indexOf(focus) : -1
    const next = ids[Math.max(0, Math.min(ids.length - 1, at + step))]
    if (!next) return
    setFocus(next)
    el?.querySelector(`[data-look="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' })
  }
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowRight') move(1)
    else if (e.key === 'ArrowLeft') move(-1)
    else if (e.key === 'ArrowDown') move('down')
    else if (e.key === 'ArrowUp') move('up')
    else if (e.key === 'Enter' && focused) apply(focused, { stack: e.altKey })
    else if (e.key === ' ' && focused) toggleKeep(focused)
    else return
    e.preventDefault()
  }

  const card = (p: Preset): React.JSX.Element => {
    const thumb = thumbs[p.id]
    const on = focus === p.id
    const isApplied = applied?.lookId === p.id
    return (
      <div
        key={p.id}
        ref={observe(p.id)}
        className={`look-card${on ? ' on' : ''}${isApplied ? ' applied' : ''}`}
        role="button"
        tabIndex={-1}
        onClick={() => setFocus(p.id)}
        onDoubleClick={(e) => apply(p, { stack: e.altKey, done: true })}
        title={
          p.meta?.inspiredBy ? t('Inspired by {{name}}', { name: p.meta.inspiredBy }) : nameOf(p)
        }
      >
        <div className="look-thumb" style={{ aspectRatio: String(aspect) }}>
          {thumb ? (
            <img src={thumb.url} alt="" draggable={false} />
          ) : (
            <span className="look-skeleton" />
          )}
        </div>
        <div className="look-meta">
          <span className="look-name">{nameOf(p)}</span>
          {p.smart && (
            <span
              className={`look-badge smart${blockers(p).length ? ' blocked' : ''}`}
              title={
                blockers(p).length
                  ? t('Smart look. {{reasons}}', { reasons: blockers(p).join('; ') })
                  : t('Smart look: makes masks or runs AI as it is applied')
              }
            >
              {t('Smart')}
            </span>
          )}
          {isApplied && (
            <span className="look-badge applied" title={t('Applied to the photo')}>
              <Icon name="check" />
            </span>
          )}
          {p.meta?.approximates && (
            <span className="look-badge" title={t('Approximated with the sliders we have')}>
              ≈
            </span>
          )}
        </div>
        {p.builtin && (
          <button
            className={`icon sm look-keep${kept(p.id) ? ' kept' : ''}`}
            title={kept(p.id) ? t('In My Looks: remove') : t('Add to My Looks')}
            onClick={(e) => {
              e.stopPropagation()
              toggleKeep(p)
            }}
          >
            <Icon name={kept(p.id) ? 'check' : 'plus'} />
          </button>
        )}
      </div>
    )
  }

  const shelfButton = (s: Shelf, label: string, count?: number): React.JSX.Element => {
    const on = JSON.stringify(s) === JSON.stringify(shelf)
    return (
      <button
        key={label}
        className={`looks-shelf${on ? ' on' : ''}${s.kind === 'collection' ? ' sub' : ''}`}
        onClick={() => {
          setShelf(s)
          grid.current?.scrollTo({ top: 0 })
        }}
      >
        <span>{label}</span>
        {count !== undefined && <span className="t">{count}</span>}
      </button>
    )
  }

  const current = thumbs[CURRENT]
  const appliedName = !applied
    ? ''
    : LOOKS.some((l) => l.id === applied.lookId)
      ? t(applied.name)
      : applied.name
  const currentCard = (
    <div
      ref={observe(CURRENT)}
      className={`look-card current${focus === null ? ' on' : ''}`}
      onClick={() => setFocus(null)}
    >
      <div className="look-thumb" style={{ aspectRatio: String(aspect) }}>
        {current ? (
          <img src={current.url} alt="" draggable={false} />
        ) : (
          <span className="look-skeleton" />
        )}
      </div>
      <div className="look-meta">
        <span className="look-name">{applied ? t('Without look') : t('Current')}</span>
      </div>
    </div>
  )
  return (
    <Modal
      title={t('Looks')}
      icon="presets"
      wide
      className="looks-browser"
      onClose={close}
      footer={
        focused ? (
          <div className="looks-detail">
            <div className="looks-detail-text">
              <strong>{nameOf(focused)}</strong>
              {focused.meta?.inspiredBy && (
                <span>{t('Inspired by {{name}}', { name: focused.meta.inspiredBy })}</span>
              )}
              {focused.meta?.description && (
                <span className="muted">{t(focused.meta.description)}</span>
              )}
              {focused.smart && session && (
                <SmartDetail
                  plan={planSmart(focused.smart, ready, {
                    frameWidth: session.frameWidth,
                    frameHeight: session.frameHeight
                  })}
                />
              )}
              {focused.meta?.approximates && (
                <span className="muted">
                  {t('≈ Approximates {{list}} with the sliders we have.', {
                    list: focused.meta.approximates.join(', ')
                  })}
                </span>
              )}
            </div>
            {focused.builtin && (
              <button className="ghost" onClick={() => toggleKeep(focused)}>
                <Icon name={kept(focused.id) ? 'check' : 'plus'} />
                {kept(focused.id) ? t('In My Looks') : t('Add to My Looks')}
              </button>
            )}
            <button
              className="primary"
              disabled={applied?.lookId === focused.id}
              onClick={(e) => apply(focused, { stack: e.altKey })}
              title={
                applied
                  ? t('Takes the place of {{name}} (Alt: on top of it)', { name: appliedName })
                  : undefined
              }
            >
              {applied?.lookId === focused.id ? t('Applied') : t('Apply')}
            </button>
          </div>
        ) : applied ? (
          <div className="looks-detail">
            <div className="looks-detail-text">
              <strong>{appliedName}</strong>
              <span className="muted">
                {t('Applied at {{amount}}%. Pick another look to swap it, or take it off.', {
                  amount: applied.amount
                })}
              </span>
            </div>
            <button className="ghost" onClick={removeLook}>
              <Icon name="reset" />
              {t('Take off')}
            </button>
            <button className="primary" onClick={close}>
              {t('Done')}
            </button>
          </div>
        ) : (
          <p className="looks-disclaimer">
            {t(
              "PIXL's own looks, made with Playroom's sliders. Cameras, film stocks and films are named only as what inspired a look; PIXL is not affiliated with or endorsed by their owners."
            )}
          </p>
        )
      }
    >
      <div className="looks-layout">
        <nav className="looks-shelves" aria-label={t('Collections')}>
          {shelfButton({ kind: 'all' }, t('All looks'), LOOKS.length + user.length)}
          {shelfButton({ kind: 'mine' }, t('My Looks'), mineIds.length)}
          {user.length > 0 && shelfButton({ kind: 'user' }, t('My presets'), user.length)}
          {FAMILIES.map((f) => {
            const cols = COLLECTIONS.filter((c) => c.family === f.id)
            return (
              <div key={f.id} className="looks-family">
                {shelfButton(
                  { kind: 'family', id: f.id },
                  t(f.label),
                  LOOKS.filter((l) => familyOf(l) === f.id).length
                )}
                {cols.length > 1 &&
                  cols.map((c) => shelfButton({ kind: 'collection', id: c.id }, t(c.label)))}
              </div>
            )
          })}
        </nav>
        <div className="looks-main">
          <label className="search-field looks-search">
            <Icon name="search" />
            <input
              className="search"
              autoFocus
              placeholder={t('Search by name, camera, film stock, movie or mood')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Escape clears a search first, and closes the browser after.
                if (e.key === 'Escape' && query) {
                  e.stopPropagation()
                  setQuery('')
                  return
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  grid.current?.focus()
                  move(0)
                  return
                }
                if (e.key !== 'Escape') e.stopPropagation()
              }}
            />
            <span className="t">{shown.length}</span>
          </label>
          <label
            className="looks-worksnow"
            title={t('Hide the smart looks that need something this build does not have yet')}
          >
            <input
              type="checkbox"
              checked={worksNow}
              onChange={(e) => useLooks.setState({ worksNow: e.target.checked })}
            />
            {t('Works now')}
          </label>
          <div className="looks-grid" ref={grid} tabIndex={0} onKeyDown={onKey}>
            {sections.map((s, i) => (
              <SectionCards key={s.id} label={s.label}>
                {/* The photo as it is leads the first row, to compare against. */}
                {i === 0 && currentCard}
                {s.looks.map(card)}
              </SectionCards>
            ))}
            {shown.length === 0 && (
              <p className="rail-empty looks-none">
                {t('No look matches “{{query}}”.', { query: q })}
              </p>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function SectionCards({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      {label && (
        <div className="looks-section rail-group">
          <span className="micro">{label}</span>
          <span className="line" />
        </div>
      )}
      {children}
    </>
  )
}

/** What a smart look makes on this photo, how long it takes, and what it waits for. */
function SmartDetail({ plan }: { plan: ReturnType<typeof planSmart> }): React.JSX.Element {
  const makes = plan.summary.join(' · ')
  return (
    <>
      {makes && (
        <span className="muted">
          {t('Makes: {{list}}', { list: makes })}
          {plan.etaMs > 0 && ` · ${formatEta(plan.etaMs)}`}
          {plan.picks > 0 && ` · ${t('asks you to point at an object')}`}
        </span>
      )}
      {plan.skipped.length > 0 && (
        <span className="looks-needs">
          {plan.skipped.map((x) => `${x.name}: ${x.why}`).join(' · ')}
        </span>
      )}
    </>
  )
}
