/**
 * Settings (⌘, / Ctrl+,): updates, crash reports, and the legal pages. And
 * the one question the first launch asks: may crash reports be sent?
 */
import { useEffect, useState } from 'react'
import type { Prefs, UpdateState } from '../../../shared/ipc'
import { Modal, Select } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useLibrary } from '../state/library'

const LEGAL = 'https://pixlfoundation.com/legal'

function updateLine(s: UpdateState): string {
  switch (s.phase) {
    case 'disabled':
      return 'Updates are off in development builds.'
    case 'checking':
      return 'Checking for updates…'
    case 'available':
      return `Version ${s.version} is available; downloading…`
    case 'downloading':
      return `Downloading ${s.version ?? 'the update'}… ${Math.round(s.progress?.percent ?? 0)}%`
    case 'downloaded':
      return `Version ${s.version} is ready. It installs when you quit, or restart now.`
    case 'not-available':
      return 'Playroom is up to date.'
    case 'error':
      return `Couldn't check for updates: ${s.error ?? 'unknown error'}`
    default:
      return 'Playroom checks for updates at launch and every few hours.'
  }
}

function useUpdates(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    void api.updates.getState().then(setState)
    return api.updates.onState(setState)
  }, [])
  return state
}

export function PreferencesDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const say = useLibrary((s) => s.say)
  const update = useUpdates()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  useEffect(() => {
    void api.prefs.get().then(setPrefs)
  }, [])
  const busy = update?.phase === 'checking' || update?.phase === 'downloading'
  return (
    <Modal title="Settings" onClose={() => setDialog(null)} icon="settings" className="prefs">
      <fieldset>
        <legend>Updates</legend>
        <p className="muted small">
          Pixl Playroom {prefs?.version ?? update?.currentVersion ?? ''}
          {prefs ? ` · ${prefs.platform} ${prefs.arch}` : ''}
        </p>
        {update && (
          <>
            <Select
              label="Channel"
              value={update.channel}
              options={[
                { value: 'latest', label: 'Stable' },
                { value: 'beta', label: 'Beta (early builds)' }
              ]}
              onChange={(c) =>
                void api.updates.setChannel(c).catch((e) => say(errorText(e), 'error'))
              }
            />
            <p className="prefs-status" role="status" aria-live="polite">
              {updateLine(update)}
            </p>
            <div className="prefs-row">
              <button
                disabled={update.phase === 'disabled' || busy}
                onClick={() => void api.updates.check().catch((e) => say(errorText(e), 'error'))}
              >
                Check now
              </button>
              {update.phase === 'downloaded' && (
                <button className="primary" onClick={() => void api.updates.install()}>
                  Restart to update
                </button>
              )}
            </div>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Privacy</legend>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs?.crashReports === 'on'}
            disabled={!prefs}
            onChange={async (e) => {
              const crashReports = await api.prefs.setCrashReports(e.target.checked ? 'on' : 'off')
              setPrefs((p) => (p ? { ...p, crashReports } : p))
            }}
          />
          Send crash reports
        </label>
        <p className="muted small">
          When Playroom crashes or hits an error, send a report so it can be fixed: what went wrong,
          the app version and your system. Never your photos, and never your folder names.
        </p>
      </fieldset>

      <fieldset>
        <legend>About</legend>
        <div className="prefs-links">
          <a href={`${LEGAL}/eula/`} target="_blank" rel="noreferrer">
            Licence agreement
          </a>
          <a href={`${LEGAL}/privacy/`} target="_blank" rel="noreferrer">
            Privacy policy
          </a>
          <button
            className="link"
            onClick={() => void api.app.openNotices().catch((e) => say(errorText(e), 'error'))}
          >
            Third-party notices
          </button>
        </div>
      </fieldset>
    </Modal>
  )
}

/** Asked once, at the first launch that finds no answer. */
export function CrashConsentDialog(): React.JSX.Element {
  const setDialog = useLibrary((s) => s.setDialog)
  const answer = (on: boolean): void => {
    void api.prefs.setCrashReports(on ? 'on' : 'off').finally(() => setDialog(null))
  }
  return (
    <Modal
      title="Help make Playroom better"
      // Closing without an answer asks again next launch.
      onClose={() => setDialog(null)}
      icon="settings"
      footer={
        <>
          <button onClick={() => answer(false)}>Don&apos;t send</button>
          <button className="primary" onClick={() => answer(true)}>
            Send crash reports
          </button>
        </>
      }
    >
      <p>
        When Playroom crashes or hits an error, it can send a report so the problem gets fixed: what
        went wrong, the app version and your system. Never your photos, and never your folder names.
      </p>
      <p className="muted small">You can change this any time in Settings.</p>
    </Modal>
  )
}
