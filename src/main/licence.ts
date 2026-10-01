/**
 * This device's access, from the PIXL account: userData/licence.json holds
 * the entitlement token and its key set (both signed, so nothing in the file
 * needs hiding, and editing it grants nothing). The token is fetched at
 * launch when due, after signing in, hourly when it asks to be refreshed,
 * and when the window comes back to the front after a while. Signing out
 * forgets it. The rules are in shared/licence.ts and the logic in
 * account/access.ts. Licences are enforced from 1.0 (`licenceEnforced`);
 * before that `requireLicence` never refuses, and a beta build is held by
 * the beta gate (gate.ts) instead.
 */
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ACCOUNT_API, DEV_ROOT_KEYS, PRODUCT, ROOT_KEYS } from '../shared/account'
import { IPC } from '../shared/ipc'
import { LicenceError, licenceEnforced, type LicenceStatus, type Licensed } from '../shared/licence'
import { accessToken, accountStatus, onAccountChange, refreshAccess } from './account'
import { Access, type AccessFile } from './account/access'
import { AccountApi } from './account/api'
import { deviceHash, deviceName, deviceOs, machineId } from './account/device'

const betaBuild = app.getVersion().includes('-beta')
const enforced = licenceEnforced(app.getVersion())
/** The access section shows in development, in a beta build, when asked for, or once enforced. */
const visible = !app.isPackaged || betaBuild || process.env['PLAYROOM_LICENCE_UI'] === '1'
const hidden = process.env['PLAYROOM_HIDDEN'] === '1'
/** How often a running app looks at whether its token wants refreshing. */
const CHECK_EVERY_MS = 60 * 60 * 1000
/** Coming back to the window asks again at most this often. */
const FOCUS_GAP_MS = 10 * 60 * 1000

function filePath(): string {
  return join(app.getPath('userData'), 'licence.json')
}

function load(): AccessFile {
  try {
    const f = JSON.parse(readFileSync(filePath(), 'utf8')) as AccessFile
    return f && typeof f === 'object' ? f : {}
  } catch {
    return {}
  }
}

function save(f: AccessFile): void {
  writeFileSync(filePath(), JSON.stringify(f, null, 2) + '\n', 'utf8')
}

const access = new Access({
  load,
  save,
  server: new AccountApi({
    base: (process.env['PLAYROOM_ACCOUNT_URL'] || ACCOUNT_API).replace(/\/+$/, ''),
    product: PRODUCT,
    appVersion: app.getVersion(),
    fetch,
    accessToken,
    refreshAccess
  }),
  device: async () => ({
    deviceHash: deviceHash(await machineId(), PRODUCT),
    deviceName: deviceName(),
    os: deviceOs()
  }),
  // The development root signs the mock's key sets; a packaged app never trusts it.
  roots: app.isPackaged ? ROOT_KEYS : { ...ROOT_KEYS, ...DEV_ROOT_KEYS },
  product: PRODUCT,
  betaBuild,
  signedIn: () => accountStatus().signedIn,
  now: Date.now,
  onChange: () => broadcast()
})

const listeners: (() => void)[] = []
let ready = false

/** Told whenever the access status may have changed (gate.ts). */
export function onLicenceChange(fn: () => void): void {
  listeners.push(fn)
}

/** Whether the device has been read, so the status can judge the token. */
export function licenceReady(): boolean {
  return ready
}

function broadcast(): LicenceStatus {
  const status = licence()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.licence.changed, status)
  }
  for (const fn of listeners) fn()
  return status
}

export function licence(): LicenceStatus {
  return access.status(visible, enforced)
}

/** Throws (code `locked`) when this device's access doesn't allow `what`. */
export function requireLicence(what: Licensed): void {
  const s = licence()
  if (s.locked) {
    log.info(`licence: ${what} refused (${s.state.kind})`)
    throw new LicenceError(s.locked, 'locked')
  }
}

/** Runs what the user asked for, logging how it went (the error also goes back to Settings). */
async function logged(what: string, fn: () => Promise<void>): Promise<LicenceStatus> {
  try {
    await fn()
  } catch (err) {
    log.warn(`licence: ${what} failed`, err)
    throw err
  }
  const status = licence()
  log.info(`licence: ${what} done (${status.state.kind})`)
  return status
}

/** Check now: asks the account, whatever the token's refresh time. */
export function refreshLicence(): Promise<LicenceStatus> {
  return logged('check', () => access.refresh())
}

/** Starts the trial, or answers with the one running. */
export function startTrial(): Promise<LicenceStatus> {
  return logged('starting the trial', () => access.startTrial())
}

export function freeDevice(id: string): Promise<LicenceStatus> {
  return logged('freeing a device', () => access.freeDevice(id))
}

/** Refreshes when due, quietly: failures are logged, and the token there is stands. */
function refreshIfDue(why: string): void {
  if (!access.due()) return
  void access
    .refresh()
    .then(() => log.info(`licence: refreshed (${why}): ${licence().state.kind}`))
    .catch((err) => log.warn(`licence: refresh (${why}) failed`, err))
}

/** At ready: read the device, move the clock mark up, and refresh when due. */
export function startLicence(): void {
  void access
    .ready()
    .then(() => {
      ready = true
      access.touch()
      broadcast()
      if (!hidden) refreshIfDue('launch')
    })
    .catch((err) => log.warn("licence: couldn't identify this device", err))
  let signedIn = accountStatus().signedIn
  onAccountChange((s) => {
    if (s.signedIn === signedIn) return
    signedIn = s.signedIn
    if (signedIn) {
      void access
        .refresh()
        .then(() => log.info(`licence: refreshed after sign-in: ${licence().state.kind}`))
        .catch((err) => log.warn('licence: refresh after sign-in failed', err))
    } else access.forget()
  })
  // Automation asks for nothing in the background.
  if (hidden) return
  setInterval(() => {
    access.touch()
    refreshIfDue('hourly')
  }, CHECK_EVERY_MS).unref()
  let lastFocus = Date.now()
  app.on('browser-window-focus', () => {
    if (Date.now() - lastFocus < FOCUS_GAP_MS) return
    lastFocus = Date.now()
    refreshIfDue('focus')
  })
}
