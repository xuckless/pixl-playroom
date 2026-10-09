/**
 * "Update available": what the new version brings, read from the update
 * feed before it is installed (shared/releasenotes.ts `parseReleaseNotes`),
 * how far its download has come, and Restart to update once it is here.
 */
import { versionLabel } from '../../../shared/releasenotes'
import { Modal } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useUpdateState } from '../lib/updates'
import { useLibrary } from '../state/library'
import { NotesBody } from './WhatsNew'

export function UpdateDialog(): React.JSX.Element | null {
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const u = useUpdateState()
  if (!u?.version) return null
  const ready = u.phase === 'downloaded'
  const pct = u.progress ? Math.round(u.progress.percent) : null
  const status = ready
    ? 'Downloaded: it installs when Playroom restarts.'
    : u.phase === 'downloading'
      ? `Downloading${pct !== null ? ` · ${pct}%` : ''}…`
      : u.phase === 'error'
        ? `The download stopped: ${u.error ?? 'try again later'}.`
        : 'Downloading in the background…'
  return (
    <Modal
      title={`Update available: Playroom ${versionLabel(u.version)}`}
      onClose={() => setDialog(null)}
      icon="smart"
      className="whats-new update-available"
      footer={
        <>
          <span className="muted small update-status">{status}</span>
          <button className="ghost" onClick={() => setDialog(null)}>
            Later
          </button>
          <button
            className="primary"
            disabled={!ready}
            autoFocus
            onClick={() => void api.updates.install().catch((err) => say(errorText(err), 'error'))}
          >
            Restart to update
          </button>
        </>
      }
    >
      {u.notes ? (
        <NotesBody notes={[u.notes]} next={u.notes.next} />
      ) : (
        <p className="wn-headline">
          Playroom {versionLabel(u.version)} is on its way. Its notes show once it is installed.
        </p>
      )}
    </Modal>
  )
}
