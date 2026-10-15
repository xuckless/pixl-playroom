import { useEffect, useMemo, useRef, useState } from 'react'
import { notesPages, versionLabel, type ReleaseNotes } from '../../../shared/releasenotes'
import { Icon } from '../components/icons'
import { Modal } from '../components/ui'
import { api } from '../lib/api'
import { useLibrary } from '../state/library'
import { useWhatsNew } from '../state/whatsNew'
import { t } from '../lib/i18n'

/**
 * What a release brings, and what is on its way: one release a page, the
 * newest first, the older ones a page back (‹ ›, or ← →). What's coming
 * shows on the newest page only; the older pages' plans have happened.
 */
export function WhatsNewDialog(): React.JSX.Element | null {
  const setDialog = useLibrary((s) => s.setDialog)
  const { notes, atLaunch } = useWhatsNew()
  const pages = useMemo(() => (notes[0] ? notesPages(notes[0].version) : []), [notes])
  const [page, setPage] = useState(0)
  const body = useRef<HTMLDivElement>(null)
  const close = (): void => {
    if (atLaunch) void api.app.notesSeen().catch(() => undefined)
    setDialog(null)
  }
  const shown = pages[page] ?? notes[0]
  const older = page < pages.length - 1 ? pages[page + 1] : null
  const newer = page > 0 ? pages[page - 1] : null
  // A page opens at its top.
  useEffect(() => {
    body.current?.closest('.modal-body')?.scrollTo({ top: 0 })
  }, [page])
  // ← and → turn the pages (not the photos behind the dialog).
  useEffect(() => {
    const k = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return
      const to = e.key === 'ArrowLeft' ? page + 1 : e.key === 'ArrowRight' ? page - 1 : null
      if (to === null) return
      e.preventDefault()
      e.stopPropagation()
      if (to >= 0 && to < pages.length) setPage(to)
    }
    window.addEventListener('keydown', k, true)
    return () => window.removeEventListener('keydown', k, true)
  }, [page, pages.length])
  if (!shown) return null
  return (
    <Modal
      title={t('What’s new in Playroom {{version}}', { version: versionLabel(shown.version) })}
      onClose={close}
      icon="smart"
      className="whats-new"
      footer={
        <>
          {pages.length > 1 && (
            <nav className="wn-pager" aria-label={t('Release notes')}>
              <button
                className="icon"
                disabled={!older}
                title={older ? versionLabel(older.version) : undefined}
                aria-label={t('Older release notes')}
                onClick={() => setPage(page + 1)}
              >
                <Icon name="chevronLeft" />
              </button>
              <span className="t-num muted" aria-live="polite">
                {t('{{n}} of {{total}}', { n: page + 1, total: pages.length })}
              </span>
              <button
                className="icon"
                disabled={!newer}
                title={newer ? versionLabel(newer.version) : undefined}
                aria-label={t('Newer release notes')}
                onClick={() => setPage(page - 1)}
              >
                <Icon name="chevronRight" />
              </button>
            </nav>
          )}
          <button className="primary" autoFocus onClick={close}>
            {t('Let’s go')}
          </button>
        </>
      }
    >
      <div ref={body} key={shown.version} className="wn-page">
        <NotesBody notes={[shown]} next={page === 0 ? shown.next : undefined} />
      </div>
    </Modal>
  )
}

/** Releases' notes, and what is coming: the What's new and Update available dialogs both show them. */
export function NotesBody({
  notes,
  next
}: {
  notes: ReleaseNotes[]
  next?: ReleaseNotes['next']
}): React.JSX.Element {
  return (
    <>
      {notes.map((n) => (
        <section key={n.version} className="wn-release">
          {notes.length > 1 && <h3 className="wn-version">{versionLabel(n.version)}</h3>}
          <p className="wn-headline">{t(n.headline)}</p>
          {n.sections.map((s) => (
            <div key={s.title} className="wn-section">
              <span className="micro">{t(s.title)}</span>
              <ul>
                {s.items.map((item) => (
                  <li key={item}>{t(item)}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {next && (
        <div className="wn-next">
          <span className="micro">{t('Coming soon')}</span>
          <div className="wn-next-grid">
            {next.map((x) => (
              <div key={x.title} className="wn-next-card">
                <strong>{t(x.title)}</strong>
                <span>{t(x.text)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
