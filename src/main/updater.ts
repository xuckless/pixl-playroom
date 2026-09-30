/**
 * In-app updates through electron-updater, against the GitHub releases
 * electron-builder publishes (electron-builder.yml `publish`). Ported from
 * space-pixl's updater. Checks at launch and every four hours, downloads in
 * the background, and installs on quit or on "Restart to update".
 *
 * macOS only accepts a signed, notarized update (Squirrel.Mac): until the
 * builds are signed a check there ends in an error, which the settings show.
 */
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { IPC, type UpdateChannel, type UpdateState } from '../shared/ipc'
import { readSettings, writeSettings } from './settings'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

let state: UpdateState = {
  phase: 'idle',
  channel: 'latest',
  currentVersion: app.getVersion()
}
let enabled = false
let timer: NodeJS.Timeout | undefined

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.updates.event, state)
  }
}

function setState(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  broadcast()
}

function applyChannel(channel: UpdateChannel): void {
  // A beta build (0.3.0-beta.1) is published to the `beta` channel by
  // electron-builder, a stable one to `latest`. Following beta means reading
  // the beta manifest and accepting prereleases.
  autoUpdater.channel = channel
  autoUpdater.allowPrerelease = channel === 'beta'
  autoUpdater.allowDowngrade = false
}

export function updateState(): UpdateState {
  return state
}

export async function checkForUpdates(): Promise<UpdateState> {
  if (!enabled || state.phase === 'downloading') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    // checkForUpdates rejects on network errors; the 'error' event says so too.
    log.warn('update check failed', err)
  }
  return state
}

/** Quit and install a downloaded update. The quit drains pending edits first (index.ts). */
export function installUpdate(): void {
  if (enabled && state.phase === 'downloaded') setImmediate(() => autoUpdater.quitAndInstall())
}

export async function setUpdateChannel(channel: UpdateChannel): Promise<UpdateState> {
  if (channel !== 'latest' && channel !== 'beta') return state
  writeSettings({ updateChannel: channel })
  setState({ channel, phase: enabled ? 'idle' : state.phase, version: undefined, error: undefined })
  if (!enabled) return state
  applyChannel(channel)
  return checkForUpdates()
}

/** Wire electron-updater. Call once, after `app.whenReady()`. */
export function setupUpdater(): void {
  state = { ...state, channel: readSettings().updateChannel }
  // In development there is nothing to update against. PLAYROOM_FORCE_UPDATER=1
  // reads dev-app-update.yml instead, to exercise the flow from `pnpm dev`.
  // Automation (PLAYROOM_HIDDEN) never updates.
  if (
    (!app.isPackaged && !process.env['PLAYROOM_FORCE_UPDATER']) ||
    process.env['PLAYROOM_HIDDEN'] === '1'
  ) {
    state = { ...state, phase: 'disabled' }
    return
  }
  enabled = true
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true
  applyChannel(state.channel)

  autoUpdater.on('checking-for-update', () => {
    setState({ phase: 'checking', error: undefined, lastCheckedAt: new Date().toISOString() })
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState({ phase: 'available', version: info.version, releaseDate: info.releaseDate })
  })
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    setState({ phase: 'not-available', version: info.version, progress: undefined })
  })
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    setState({
      phase: 'downloading',
      progress: {
        percent: p.percent,
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond
      }
    })
  })
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setState({ phase: 'downloaded', version: info.version, progress: undefined })
  })
  autoUpdater.on('error', (err: Error) => {
    setState({ phase: 'error', error: err.message })
  })

  void checkForUpdates()
  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
  app.on('before-quit', () => clearInterval(timer))
}
