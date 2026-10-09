/**
 * Screens that stand in front of the whole window until something is done:
 * an update the release policy requires (policy.json's floor), and the beta
 * gate (a beta build without confirmed beta access; shared/gate.ts). While
 * one shows, the app's keyboard shortcuts go nowhere; the menu (Quit) still
 * works, and main refuses the library, develop and export calls anyway.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { AccountStatus } from '../../../shared/account'
import { BETA_URL, type GateState } from '../../../shared/gate'
import type { Prefs, UpdateState } from '../../../shared/ipc'
import { ACCOUNT_URL } from '../../../shared/licence'
import { downloadUrl } from '../../../shared/policy'
import { api, errorText } from '../lib/api'
import { rich, t } from '../lib/i18n'

function GateScreen({
  title,
  children,
  actions
}: {
  title: string
  children: ReactNode
  actions: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    // Shortcuts listen on window: stop them here, before they get there.
    const swallow = (e: KeyboardEvent): void => e.stopPropagation()
    window.addEventListener('keydown', swallow, true)
    return () => window.removeEventListener('keydown', swallow, true)
  }, [])
  return (
    <div className="gate" role="alertdialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="gate-card">
        <h1 id="gate-title">{title}</h1>
        {children}
        <div className="gate-actions">{actions}</div>
      </div>
    </div>
  )
}

function progressLine(s: UpdateState): string | null {
  switch (s.phase) {
    case 'checking':
      return t('Looking for the update…')
    case 'available':
      return t('Version {{version}} found; downloading…', { version: s.version })
    case 'downloading':
      return s.version
        ? t('Downloading {{version}}… {{percent}}%', {
            version: s.version,
            percent: Math.round(s.progress?.percent ?? 0)
          })
        : t('Downloading the update… {{percent}}%', {
            percent: Math.round(s.progress?.percent ?? 0)
          })
    case 'downloaded':
      return t('Version {{version}} is ready.', { version: s.version })
    case 'not-available':
      return t('No update reached this copy yet. Try again shortly, or download it.')
    case 'error':
      return t("Couldn't update: {{error}}", { error: s.error ?? t('unknown error') })
    default:
      return null
  }
}

/** The release policy's floor: this version must update before it goes on. */
export function UpdateRequiredGate(): React.JSX.Element | null {
  const [state, setState] = useState<UpdateState | null>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  useEffect(() => {
    void api.updates.getState().then(setState)
    void api.prefs.get().then(setPrefs)
    return api.updates.onState(setState)
  }, [])
  if (!state?.required) return null
  const line = progressLine(state)
  const ready = state.phase === 'downloaded'
  const stuck = state.phase === 'error' || state.phase === 'not-available'
  return (
    <GateScreen
      title={t('Update required')}
      actions={
        <>
          {ready ? (
            <button className="primary" onClick={() => void api.updates.install()}>
              {t('Restart to update')}
            </button>
          ) : (
            <button
              disabled={state.phase === 'checking' || state.phase === 'downloading'}
              onClick={() => void api.updates.check()}
            >
              {t('Try again')}
            </button>
          )}
          {prefs && (
            <a
              className={stuck ? 'gate-link strong' : 'gate-link'}
              href={downloadUrl(prefs.platform, prefs.arch, state.channel)}
              target="_blank"
              rel="noreferrer"
            >
              {t('Download it instead')}
            </a>
          )}
        </>
      }
    >
      <p>
        {t(
          'This version of Pixl Playroom ({{current}}) needs updating before you go on: version {{min}} or later. Your photos and edits are kept as they are.',
          { current: state.currentVersion, min: state.required.minVersion }
        )}
      </p>
      {state.required.message && <p className="gate-note">{state.required.message}</p>}
      {line && (
        <p className="gate-status" role="status" aria-live="polite">
          {line}
        </p>
      )}
      {state.phase === 'downloading' && (
        <div className="gate-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(state.progress?.percent ?? 0)}%` }} />
        </div>
      )}
    </GateScreen>
  )
}

function UpdateProgress({ state }: { state: UpdateState }): React.JSX.Element | null {
  const line = progressLine(state)
  return (
    <>
      {line && (
        <p className="gate-status" role="status" aria-live="polite">
          {line}
        </p>
      )}
      {state.phase === 'downloading' && (
        <div className="gate-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(state.progress?.percent ?? 0)}%` }} />
        </div>
      )}
    </>
  )
}

/** A beta build without confirmed beta access: sign in, join, wait for the answer, or update after the beta. */
export function BetaGate({ gate }: { gate: GateState | null }): React.JSX.Element | null {
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void api.account.status().then(setAccount)
    void api.updates.getState().then(setUpdate)
    void api.prefs.get().then(setPrefs)
    const offs = [api.account.onChange(setAccount), api.updates.onState(setUpdate)]
    return () => offs.forEach((off) => off())
  }, [])
  if (!gate || gate.kind === 'open' || gate.kind === 'pending') return null
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const email = account?.email
  const signOut = (
    <button disabled={busy} onClick={() => void run(() => api.account.signOut())}>
      {t('Use another account')}
    </button>
  )
  const join = (
    <a className="gate-link strong" href={BETA_URL} target="_blank" rel="noreferrer">
      {t('Join the beta')}
    </a>
  )
  const checkAgain = (label: string): React.JSX.Element => (
    <button disabled={busy} onClick={() => void run(() => api.licence.refresh())}>
      {label}
    </button>
  )
  const err = error && <p className="gate-error">{error}</p>
  const terms = (
    <p className="gate-fine">
      {rich(
        'The beta is free and comes as is: joining means accepting the {{terms}}, including that there is no warranty and that PIXL Foundation accepts no liability for it.',
        {
          terms: (
            <button className="link" onClick={() => void api.app.openBetaTerms()}>
              {t('beta terms')}
            </button>
          )
        }
      )}
    </p>
  )

  switch (gate.kind) {
    case 'sign-in':
      return (
        <GateScreen
          title={t('Sign in to the beta')}
          actions={
            account?.signingIn ? (
              <button onClick={() => void api.account.cancelSignIn()}>{t('Cancel')}</button>
            ) : (
              <>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run(() => api.account.signIn())}
                >
                  {t('Sign in…')}
                </button>
                {join}
              </>
            )
          }
        >
          <p>
            {t(
              'This is a beta of Pixl Playroom. Sign in with the PIXL account you joined the beta with, and the app opens.'
            )}
          </p>
          {terms}
          {account?.signingIn && (
            <p className="gate-status" role="status">
              {t('Finish signing in in your browser…')}
            </p>
          )}
          {err}
        </GateScreen>
      )
    case 'join':
      return (
        <GateScreen
          title={t('Join the beta')}
          actions={
            <>
              {join}
              {checkAgain(t('I’ve joined'))}
              {signOut}
            </>
          }
        >
          <p>
            {email
              ? t(
                  'You’re signed in as {{email}}, but this account isn’t in the beta yet. Join it on the beta page; the app opens as soon as you come back.',
                  { email }
                )
              : t(
                  'You’re signed in, but this account isn’t in the beta yet. Join it on the beta page; the app opens as soon as you come back.'
                )}
          </p>
          {terms}
          {err}
        </GateScreen>
      )
    case 'checking':
      return (
        <GateScreen
          title={
            gate.offline ? t('Connect to confirm your beta access') : t('Checking your beta access')
          }
          actions={
            <>
              {checkAgain(t('Check now'))}
              {signOut}
            </>
          }
        >
          <p>
            {gate.offline
              ? t(
                  'Pixl Playroom works offline for a month at a time. Connect to the internet so it can confirm your beta access, then choose Check now.'
                )
              : email
                ? t('Signed in as {{email}}. Confirming your beta access with your PIXL account…', {
                    email
                  })
                : t('Signed in. Confirming your beta access with your PIXL account…')}
          </p>
          {err}
        </GateScreen>
      )
    case 'device-limit':
      return (
        <GateScreen
          title={t('Free a device')}
          actions={
            <>
              <a className="gate-link" href={ACCOUNT_URL} target="_blank" rel="noreferrer">
                {t('Manage devices')}
              </a>
              {signOut}
            </>
          }
        >
          <p>
            {t(
              'Your account is already on as many devices as it allows. Free one to use this one.'
            )}
          </p>
          <ul className="prefs-devices">
            {gate.devices.map((d) => (
              <li key={d.id}>
                <span>{d.name}</span>
                <button
                  disabled={busy}
                  onClick={() => void run(() => api.licence.freeDevice(d.id))}
                >
                  {t('Free|device')}
                </button>
              </li>
            ))}
          </ul>
          {err}
        </GateScreen>
      )
    case 'beta-ended':
      return (
        <GateScreen
          title={t('The beta has ended')}
          actions={
            <>
              {update?.phase === 'downloaded' ? (
                <button className="primary" onClick={() => void api.updates.install()}>
                  {t('Restart to update')}
                </button>
              ) : (
                <button
                  disabled={update?.phase === 'checking' || update?.phase === 'downloading'}
                  onClick={() => void api.updates.check()}
                >
                  {t('Look for the update')}
                </button>
              )}
              {prefs && (
                <a
                  className="gate-link"
                  href={downloadUrl(prefs.platform, prefs.arch, 'latest')}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Download Pixl Playroom')}
                </a>
              )}
            </>
          }
        >
          <p>
            {t(
              'Thank you for testing. Pixl Playroom is out: update to the released version to keep going. Your photos and edits are kept as they are, and your tester discount is on your PIXL account.'
            )}
          </p>
          {update && <UpdateProgress state={update} />}
        </GateScreen>
      )
  }
}
