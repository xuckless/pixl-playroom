/**
 * Settings (⌘, / Ctrl+,): the licence, updates, crash reports, the legal
 * pages, and the key bindings. And the one question the first launch asks:
 * may crash reports be sent?
 */
import { useEffect, useState } from 'react'
import type { Prefs, UpdateState } from '../../../shared/ipc'
import { ACCOUNT_URL, BUY_URL, type LicenceStatus } from '../../../shared/licence'
import { Modal, Select, Tabs } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useLibrary } from '../state/library'
import { KeyBindingsSection } from './KeyBindings'
import { ModelsSection } from './ModelsSection'

const LEGAL = 'https://playroom.pixlfoundation.com/legal'

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

function licenceLine(s: LicenceStatus): string {
  const st = s.state
  switch (st.kind) {
    case 'trial':
      return `Free trial: ${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left.`
    case 'trial-ended':
      return 'Your free trial has ended.'
    case 'licensed': {
      const who = s.customerName ? `Licensed to ${s.customerName}` : 'Licensed'
      const devices =
        s.devicesUsed !== undefined ? ` · ${s.devicesUsed} of ${s.deviceLimit} devices` : ''
      return `${who}${devices}.`
    }
    case 'revalidate':
      return 'Connect to the internet so Playroom can confirm your licence.'
    case 'inactive':
      return `This device is no longer activated: ${st.reason}`
  }
}

/** The licence: trial days, or who it's licensed to and on how many devices; activate or free this device. */
function LicenceSection(): React.JSX.Element | null {
  const say = useLibrary((s) => s.say)
  const [status, setStatus] = useState<LicenceStatus | null>(null)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.licence.status().then(setStatus)
    return api.licence.onChange(setStatus)
  }, [])
  if (!status?.visible) return null
  const run = async (fn: () => Promise<LicenceStatus>, done?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await fn())
      if (done) say(done)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const kind = status.state.kind
  const active = kind === 'licensed' || kind === 'revalidate'
  return (
    <fieldset>
      <legend>Licence</legend>
      <p className="prefs-status" role="status" aria-live="polite">
        {licenceLine(status)}
        {active && status.keyHint ? <span className="muted"> Key {status.keyHint}</span> : null}
      </p>
      {!status.enforced && (
        <p className="muted small">
          Licences aren&apos;t required yet: every feature works either way.
        </p>
      )}
      {active ? (
        <div className="prefs-row">
          <button disabled={busy} onClick={() => void run(() => api.licence.validate())}>
            Check now
          </button>
          <button
            disabled={busy}
            title="Frees this device's place, so the licence can be used on another"
            onClick={() => void run(() => api.licence.deactivate(), 'This device is deactivated')}
          >
            Deactivate this device
          </button>
          <a href={ACCOUNT_URL} target="_blank" rel="noreferrer">
            Manage devices
          </a>
        </div>
      ) : (
        <form
          className="prefs-row"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => api.licence.activate(key), 'Licence activated').then(() => setKey(''))
          }}
        >
          <input
            className="licence-key"
            value={key}
            placeholder="Licence key"
            aria-label="Licence key"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="submit" className="primary" disabled={busy || !key.trim()}>
            Activate
          </button>
          <a href={BUY_URL} target="_blank" rel="noreferrer">
            Buy a licence
          </a>
        </form>
      )}
      {error && <p className="error small">{error}</p>}
    </fieldset>
  )
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
  const [tab, setTab] = useState<'general' | 'keys'>('general')
  return (
    <Modal
      title="Settings"
      onClose={() => setDialog(null)}
      icon="settings"
      className={`prefs${tab === 'keys' ? ' keys' : ''}`}
    >
      <Tabs
        value={tab}
        tabs={[
          { value: 'general', label: 'General' },
          { value: 'keys', label: 'Key bindings' }
        ]}
        onChange={setTab}
      />
      {tab === 'keys' ? <KeyBindingsSection /> : <GeneralSettings />}
    </Modal>
  )
}

function GeneralSettings(): React.JSX.Element {
  const say = useLibrary((s) => s.say)
  const update = useUpdates()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  useEffect(() => {
    void api.prefs.get().then(setPrefs)
  }, [])
  const busy = update?.phase === 'checking' || update?.phase === 'downloading'
  return (
    <>
      <LicenceSection />
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

      <ModelsSection />

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
    </>
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
