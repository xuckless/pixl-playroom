import { versionLabel, type ReleaseNotes } from '../../../shared/releasenotes'
import { Modal } from '../components/ui'
import { api } from '../lib/api'
import { useLibrary } from '../state/library'
import { useWhatsNew } from '../state/whatsNew'

/** What a release brings, and what is on its way. */
export function WhatsNewDialog(): React.JSX.Element | null {
  const setDialog = useLibrary((s) => s.setDialog)
  const { notes, atLaunch } = useWhatsNew()
  const close = (): void => {
    if (atLaunch) void api.app.notesSeen().catch(() => undefined)
    setDialog(null)
  }
  const newest = notes[0]
  if (!newest) return null
  const next = notes.find((n) => n.next?.length)?.next
  return (
    <Modal
      title={`What’s new in Playroom ${versionLabel(newest.version)}`}
      onClose={close}
      icon="smart"
      className="whats-new"
      footer={
        <button className="primary" autoFocus onClick={close}>
          Let’s go
        </button>
      }
    >
      <NotesBody notes={notes} next={next} />
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
          <p className="wn-headline">{n.headline}</p>
          {n.sections.map((s) => (
            <div key={s.title} className="wn-section">
              <span className="micro">{s.title}</span>
              <ul>
                {s.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {next && (
        <div className="wn-next">
          <span className="micro">Coming soon</span>
          <div className="wn-next-grid">
            {next.map((x) => (
              <div key={x.title} className="wn-next-card">
                <strong>{x.title}</strong>
                <span>{x.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
