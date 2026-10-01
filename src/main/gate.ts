/**
 * The beta gate in the main process (shared/gate.ts decides): what the
 * window shows, told to it on `app:gate-changed`, and what IPC a gated
 * window may still make (ipc.ts refuses the rest). Coming back to the window
 * while gated asks the account again, so joining the beta in the browser
 * opens the app without a button. Development and automation skip it;
 * PLAYROOM_BETA_GATE=1 brings it back to try it out.
 */
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { allowedWhileGated, gateFor, type GateState } from '../shared/gate'
import { IPC } from '../shared/ipc'
import { accountStatus, onAccountChange } from './account'
import { licence, licenceReady, onLicenceChange, refreshLicence } from './licence'
import { onPolicy, policy } from './policy'

const betaBuild = app.getVersion().includes('-beta')
const skip =
  (!app.isPackaged || process.env['PLAYROOM_HIDDEN'] === '1') &&
  process.env['PLAYROOM_BETA_GATE'] !== '1'

let shown: GateState = { kind: 'pending' }

export function gate(): GateState {
  return gateFor({
    betaBuild,
    skip,
    ready: licenceReady(),
    signedIn: accountStatus().signedIn,
    state: licence().state,
    betaOpen: policy().betaOpen
  })
}

/** Whether a gated window's call on `channel` is refused. */
export function gateRefuses(channel: string): boolean {
  return gate().kind !== 'open' && !allowedWhileGated(channel)
}

function update(): void {
  const next = gate()
  if (JSON.stringify(next) === JSON.stringify(shown)) return
  log.info(`gate: ${shown.kind} → ${next.kind}`)
  shown = next
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.app.gateChanged, next)
  }
}

/** After the account, the licence and the policy have started. */
export function startGate(): void {
  shown = gate()
  onAccountChange(update)
  onLicenceChange(update)
  onPolicy(update)
  if (skip || !betaBuild) return
  let last = 0
  app.on('browser-window-focus', () => {
    const k = gate().kind
    if ((k !== 'join' && k !== 'checking') || Date.now() - last < 5000) return
    last = Date.now()
    void refreshLicence().catch(() => {})
  })
}
