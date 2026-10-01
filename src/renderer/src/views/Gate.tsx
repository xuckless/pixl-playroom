/**
 * Screens that stand in front of the whole window until something is done:
 * an update the release policy requires (policy.json's floor). The beta gate
 * (Pass 26a) will use the same screen. While one shows, the app's keyboard
 * shortcuts go nowhere; the menu (Quit, Settings) still works.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { Prefs, UpdateState } from '../../../shared/ipc'
import { downloadUrl } from '../../../shared/policy'
import { api } from '../lib/api'

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
