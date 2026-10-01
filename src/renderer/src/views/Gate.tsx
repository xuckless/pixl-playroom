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
      return 'Looking for the update…'
    case 'available':
      return `Version ${s.version} found; downloading…`
    case 'downloading':
      return `Downloading ${s.version ?? 'the update'}… ${Math.round(s.progress?.percent ?? 0)}%`
    case 'downloaded':
      return `Version ${s.version} is ready.`
    case 'not-available':
      return 'No update reached this copy yet. Try again shortly, or download it.'
    case 'error':
      return `Couldn't update: ${s.error ?? 'unknown error'}`
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
      title="Update required"
      actions={
        <>
          {ready ? (
            <button className="primary" onClick={() => void api.updates.install()}>
              Restart to update
            </button>
          ) : (
            <button
              disabled={state.phase === 'checking' || state.phase === 'downloading'}
              onClick={() => void api.updates.check()}
            >
              Try again
            </button>
          )}
          {prefs && (
            <a
              className={stuck ? 'gate-link strong' : 'gate-link'}
              href={downloadUrl(prefs.platform, prefs.arch, state.channel)}
              target="_blank"
              rel="noreferrer"
            >
              Download it instead
            </a>
          )}
        </>
      }
    >
      <p>
        This version of Pixl Playroom ({state.currentVersion}) needs updating before you go on:
        version {state.required.minVersion} or later. Your photos and edits are kept as they are.
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
  const who = account?.email ? ` as ${account.email}` : ''
  const signOut = (
    <button disabled={busy} onClick={() => void run(() => api.account.signOut())}>
      Use another account
    </button>
  )
  const join = (
    <a className="gate-link strong" href={BETA_URL} target="_blank" rel="noreferrer">
      Join the beta
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
      The beta is free and comes as is: joining means accepting the{' '}
      <button className="link" onClick={() => void api.app.openBetaTerms()}>
        beta terms
      </button>
      , including that there is no warranty and that PIXL Foundation accepts no liability for it.
    </p>
  )

  switch (gate.kind) {
    case 'sign-in':
      return (
        <GateScreen
          title="Sign in to the beta"
          actions={
            account?.signingIn ? (
              <button onClick={() => void api.account.cancelSignIn()}>Cancel</button>
            ) : (
              <>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void run(() => api.account.signIn())}
                >
                  Sign in…
                </button>
                {join}
              </>
            )
          }
        >
          <p>
            This is a beta of Pixl Playroom. Sign in with the PIXL account you joined the beta with,
            and the app opens.
          </p>
          {terms}
          {account?.signingIn && (
            <p className="gate-status" role="status">
              Finish signing in in your browser…
            </p>
          )}
          {err}
        </GateScreen>
      )
    case 'join':
      return (
        <GateScreen
          title="Join the beta"
          actions={
            <>
              {join}
              {checkAgain('I’ve joined')}
              {signOut}
            </>
          }
        >
          <p>
            You’re signed in{who}, but this account isn’t in the beta yet. Join it on the beta page;
            the app opens as soon as you come back.
          </p>
          {terms}
          {err}
        </GateScreen>
      )
    case 'checking':
      return (
        <GateScreen
          title={gate.offline ? 'Connect to confirm your beta access' : 'Checking your beta access'}
          actions={
            <>
              {checkAgain('Check now')}
              {signOut}
            </>
          }
        >
          <p>
            {gate.offline
              ? 'Pixl Playroom works offline for a month at a time. Connect to the internet so it can confirm your beta access, then choose Check now.'
              : `Signed in${who}. Confirming your beta access with your PIXL account…`}
          </p>
          {err}
        </GateScreen>
      )
    case 'device-limit':
      return (
        <GateScreen
          title="Free a device"
          actions={
            <>
              <a className="gate-link" href={ACCOUNT_URL} target="_blank" rel="noreferrer">
                Manage devices
              </a>
              {signOut}
            </>
          }
        >
          <p>Your account is already on as many devices as it allows. Free one to use this one.</p>
          <ul className="prefs-devices">
            {gate.devices.map((d) => (
              <li key={d.id}>
                <span>{d.name}</span>
                <button
                  disabled={busy}
                  onClick={() => void run(() => api.licence.freeDevice(d.id))}
                >
                  Free
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
          title="The beta has ended"
          actions={
            <>
              {update?.phase === 'downloaded' ? (
                <button className="primary" onClick={() => void api.updates.install()}>
                  Restart to update
                </button>
              ) : (
                <button
                  disabled={update?.phase === 'checking' || update?.phase === 'downloading'}
                  onClick={() => void api.updates.check()}
                >
                  Look for the update
                </button>
              )}
              {prefs && (
                <a
                  className="gate-link"
                  href={downloadUrl(prefs.platform, prefs.arch, 'latest')}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download Pixl Playroom
                </a>
              )}
            </>
          }
        >
          <p>
            Thank you for testing. Pixl Playroom is out: update to the released version to keep
            going. Your photos and edits are kept as they are, and your tester discount is on your
            PIXL account.
          </p>
          {update && <UpdateProgress state={update} />}
        </GateScreen>
      )
  }
}
