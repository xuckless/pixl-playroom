/**
 * In-app updates through electron-updater, from updates.pixlfoundation.com
 * (electron-builder.yml `publish`; release.yml uploads there). Ported from
 * space-pixl's updater. Checks at launch and every four hours, downloads in
 * the background, and installs on quit or on "Restart to update".
 * PLAYROOM_UPDATE_URL reads another feed (a staging folder) instead, to test
 * an update before it goes out (RELEASING.md); the update is still checked
 * against the app's signature on both platforms.
 *
 * macOS only accepts a signed, notarized update (Squirrel.Mac): until the
 * builds are signed a check there ends in an error, which the settings show.
 */
import { app, BrowserWindow } from 'electron'
import log from 'electron-log/main'
import type { AppUpdater, ProgressInfo, UpdateInfo } from 'electron-updater'
import { IPC, type UpdateChannel, type UpdateState } from '../shared/ipc'
import { belowFloor } from '../shared/policy'
import { parseReleaseNotes } from '../shared/releasenotes'
import { onPolicy } from './policy'
import { readSettings, writeSettings } from './settings'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
/**
 * A beta build always follows the beta channel: the stable feed holds no
 * betas, so a beta install reading it would never hear of the next beta,
 * and the beta feed gets every stable release too.
 */
const betaBuild = app.getVersion().includes('-beta')
const channelFor = (chosen: UpdateChannel): UpdateChannel => (betaBuild ? 'beta' : chosen)

let state: UpdateState = {
  phase: 'idle',
  channel: 'latest',
  currentVersion: app.getVersion()
}
let enabled = false
let timer: NodeJS.Timeout | undefined
/** electron-updater, loaded only where updates run (a packaged build): never on a dev launch's path. */
let autoUpdater: AppUpdater

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
  // One downloaded waits to be installed: a re-check (the 4-hourly one,
  // offline) would only put it behind 'checking' and 'error', and lose it.
  if (!enabled || state.phase === 'downloading' || state.phase === 'downloaded') return state
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
  if ((channel !== 'latest' && channel !== 'beta') || betaBuild) return state
  writeSettings({ updateChannel: channel })
  setState({ channel, phase: enabled ? 'idle' : state.phase, version: undefined, error: undefined })
  if (!enabled) return state
  applyChannel(channel)
  return checkForUpdates()
}

/** Wire electron-updater. Call once, after `app.whenReady()`. */
export async function setupUpdater(): Promise<void> {
  state = { ...state, channel: channelFor(readSettings().updateChannel) }
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
  // electron-updater exports autoUpdater through a getter Node's import of a
  // CommonJS module doesn't see, so from import() it is only on `default`.
  const updater = await import('electron-updater')
  autoUpdater =
    updater.autoUpdater ?? (updater as unknown as { default: typeof updater }).default.autoUpdater
  enabled = true
  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  if (!app.isPackaged) autoUpdater.forceDevUpdateConfig = true
  const feed = process.env['PLAYROOM_UPDATE_URL']
  if (feed) {
    log.info(`updates: reading ${feed} (PLAYROOM_UPDATE_URL)`)
    autoUpdater.setFeedURL({ provider: 'generic', url: feed.replace(/\/+$/, '') })
  }
  applyChannel(state.channel)

  autoUpdater.on('checking-for-update', () => {
    setState({ phase: 'checking', error: undefined, lastCheckedAt: new Date().toISOString() })
  })
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setState({
      phase: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      // What it brings, from the feed (build/release-notes.md as published).
      notes: parseReleaseNotes(info.releaseNotes, info.version)
    })
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
    setState({
      phase: 'downloaded',
      version: info.version,
      progress: undefined,
      notes: parseReleaseNotes(info.releaseNotes, info.version) ?? state.notes
    })
  })
  autoUpdater.on('error', (err: Error) => {
    // electron-updater's messages run on with headers and a stack: the log
    // keeps all of it, the window says the first line.
    setState({ phase: 'error', error: err.message.split('\n')[0] })
  })

  // Below the release policy's floor (policy.json): the window says an
  // update is required, and the update is looked for at once.
  onPolicy((p) => {
    const required = belowFloor(app.getVersion(), p)
      ? { minVersion: p.minVersion as string, message: p.message }
      : undefined
    if (JSON.stringify(required) === JSON.stringify(state.required)) return
    if (required) log.warn(`updates: ${app.getVersion()} is below the floor ${required.minVersion}`)
    setState({ required })
    if (required) void checkForUpdates()
  })

  void checkForUpdates()
  timer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
  app.on('before-quit', () => clearInterval(timer))
}
