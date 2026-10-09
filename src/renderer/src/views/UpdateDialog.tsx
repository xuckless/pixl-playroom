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
import { t } from '../lib/i18n'
import { NotesBody } from './WhatsNew'

export function UpdateDialog(): React.JSX.Element | null {
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const u = useUpdateState()
  if (!u?.version) return null
  const ready = u.phase === 'downloaded'
  const pct = u.progress ? Math.round(u.progress.percent) : null
  const status = ready
    ? t('Downloaded: it installs when Playroom restarts.')
    : u.phase === 'downloading'
      ? pct !== null
        ? t('Downloading · {{percent}}%…', { percent: pct })
        : t('Downloading…')
      : u.phase === 'error'
        ? t('The download stopped: {{reason}}.', { reason: u.error ?? t('try again later') })
        : t('Downloading in the background…')
  return (
    <Modal
      title={t('Update available: Playroom {{version}}', { version: versionLabel(u.version) })}
      onClose={() => setDialog(null)}
      icon="smart"
      className="whats-new update-available"
      footer={
        <>
          <span className="muted small update-status">{status}</span>
          <button className="ghost" onClick={() => setDialog(null)}>
            {t('Later')}
          </button>
          <button
            className="primary"
            disabled={!ready}
            autoFocus
            onClick={() => void api.updates.install().catch((err) => say(errorText(err), 'error'))}
          >
            {t('Restart to update')}
          </button>
        </>
      }
    >
      {u.notes ? (
        <NotesBody notes={[u.notes]} next={u.notes.next} />
      ) : (
        <p className="wn-headline">
          {t('Playroom {{version}} is on its way. Its notes show once it is installed.', {
            version: versionLabel(u.version)
          })}
        </p>
      )}
    </Modal>
  )
}
